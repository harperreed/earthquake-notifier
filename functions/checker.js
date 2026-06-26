// ABOUTME: Earthquake check + alert delivery orchestration, with Firestore
// ABOUTME: injected so the logic runs against the emulator or real Firebase.

const axios = require("axios");
// FieldValue is a stateless sentinel factory; importing it needs no
// initializeApp, so this module stays free of Firebase bootstrapping.
const {FieldValue} = require("firebase-admin/firestore");
const {getAISummary} = require("./ai");
const {sendPushover} = require("./notify");
const {isWithinAlertRange} = require("./alertRange");
const {groupByPriority} = require("./alertGrouping");
const {alertLineForQuake} = require("./alertMessage");
const {
  calculateDistance,
  estimatePGA,
  determineAlertPriority,
} = require("./quake");

// Bound a hung USGS request so the scheduled run can't block indefinitely.
const REQUEST_TIMEOUT_MS = 10000;
// The scheduler runs twice an hour, so a two-hour window absorbs a missed run
// plus USGS ingestion lag while keeping the result set small instead of
// querying all of recorded history.
const RECENT_WINDOW_MS = 2 * 60 * 60 * 1000;
// Japan Standard Time is a fixed UTC+9 with no daylight saving, so the "today"
// boundary is a constant nine-hour shift from UTC.
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
// Dedup markers exist only to suppress repeat alerts; 30 days outlives any
// quake's "recent" window, after which a Firestore TTL policy can reap them so
// the collection never grows without bound.
const SENT_ALERT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Builds the USGS FDSN query URL for recent earthquakes around a point.
 * @param {Object} params Query parameters.
 * @param {string} params.base USGS API base URL.
 * @param {string} params.latitude Center latitude.
 * @param {string} params.longitude Center longitude.
 * @param {string} params.radius Search radius in km.
 * @param {string} params.startTime ISO8601 lower bound on event time.
 * @return {string} The fully-formed query URL.
 */
function buildQueryUrl({base, latitude, longitude, radius, startTime}) {
  return `${base}/fdsnws/event/1/query?format=geojson` +
      `&latitude=${latitude}&longitude=${longitude}` +
      `&maxradiuskm=${radius}&starttime=${startTime}`;
}

/**
 * Returns the lower bound for the USGS time window: a fixed interval before
 * the given moment.
 * @param {Date} now The current time.
 * @return {string} An ISO8601 timestamp RECENT_WINDOW_MS before now.
 */
function recentWindowStart(now) {
  return new Date(now.getTime() - RECENT_WINDOW_MS).toISOString();
}

/**
 * Computes the start of "today" in Japan Standard Time, returned as a UTC
 * instant, so the daily digest rolls over at JST midnight rather than at the
 * server's UTC midnight.
 * @param {Date} now The current time.
 * @return {Date} The UTC instant of 00:00 JST for now's JST day.
 */
function startOfTodayTokyo(now) {
  const jst = new Date(now.getTime() + JST_OFFSET_MS);
  const midnightUtcLabelled = Date.UTC(
      jst.getUTCFullYear(),
      jst.getUTCMonth(),
      jst.getUTCDate(),
  );
  return new Date(midnightUtcLabelled - JST_OFFSET_MS);
}

/**
 * Maps an internal alert priority to the Pushover priority used at delivery,
 * raising a felt quake (internal 0) to Pushover's audible "high" floor so it
 * never arrives as a silenceable notification. Higher priorities pass through,
 * so an M7+ quake still delivers at Pushover's emergency level.
 * @param {number} alertPriority Internal alert priority (0 felt, 1, or 2).
 * @return {number} The Pushover priority, never below 1.
 */
function pushoverPriorityFor(alertPriority) {
  return Math.max(1, alertPriority);
}

// The Firestore instance is injected by createChecker so this module stays free
// of Firebase initialization and can run against the emulator or real Firebase.
let db;

/**
 * Checks USGS for recent earthquakes near a point, scores each against the
 * alert gates, and delivers a notification per priority bucket. Records a
 * heartbeat and surfaces dependency failures to the admin so a stalled or
 * broken run is never silent.
 * @param {string} latitude Center latitude of the monitored point.
 * @param {string} longitude Center longitude of the monitored point.
 * @param {string} radius USGS search radius in kilometers.
 * @return {Promise<{status: string, found: number, sent: number,
 *     error: ?string}>} The structured run result.
 */
async function checkEarthquake(latitude, longitude, radius) {
  const base = process.env.USGS_API_URL || "https://earthquake.usgs.gov";
  const url = buildQueryUrl({
    base,
    latitude,
    longitude,
    radius,
    startTime: recentWindowStart(new Date()),
  });
  console.log(url);
  let result = {status: "ok", found: 0, sent: 0, error: null};
  try {
    const response = await axios.get(url, {timeout: REQUEST_TIMEOUT_MS});
    const data = response.data;
    const earthquakeData = [];

    const features = data.features || [];
    if (features.length > 0) {
      // One batched read of every dedup marker up front, so a busy day is a
      // single Firestore round-trip instead of one read per quake.
      const sentIds = await fetchSentIds(features.map((eq) => eq.id));

      for (const earthquake of features) {
        const earthquakeInfo = earthquake.properties;
        const [eqLongitude, eqLatitude, depth] =
                    earthquake.geometry.coordinates;

        // Skip quakes already alerted on in an earlier run.
        if (sentIds.has(earthquake.id)) {
          continue;
        }

        // Calculate distance from the specified point
        const distance = calculateDistance(
            parseFloat(latitude),
            parseFloat(longitude),
            eqLatitude,
            eqLongitude,
        );

        // Skip quakes too far away to matter for their magnitude. The USGS
        // query is intentionally wide so big distant quakes are returned;
        // this gate keeps small distant quakes from becoming noise.
        if (!isWithinAlertRange(earthquakeInfo.mag, distance)) {
          continue;
        }

        // Determine alert priority based on magnitude and depth
        const alertPriority = determineAlertPriority(
            earthquakeInfo.mag,
            depth,
        );

        const estimatedPGA = estimatePGA(earthquakeInfo.mag, distance, depth);

        if (alertPriority >= 0) {
          earthquakeData.push({
            ...earthquake,
            alertPriority,
            distance_from_kofu: distance,
            calculatedDepth: depth,
            estimatedPGA: estimatedPGA,
          });
        }
      }
    }

    result.found = earthquakeData.length;

    if (earthquakeData.length === 0) {
      // Either USGS returned nothing or nothing cleared the alert gates.
      result.status = "no_quakes";
    } else {
      // Deliver each priority bucket, most urgent first.
      const groups = groupByPriority(earthquakeData);
      const confirmedSent = [];
      for (const group of groups) {
        const delivered = await deliverGroup(
            group,
            parseFloat(latitude),
            parseFloat(longitude),
        );
        // Only quakes whose terse alert was confirmed delivered get marked, so
        // a failed send is retried next run instead of silently dropped.
        if (delivered) {
          confirmedSent.push(...group.earthquakes);
        }
      }
      result.sent = confirmedSent.length;
      await markAlertsAsSent(confirmedSent);
    }
  } catch (error) {
    console.error("Error checking for earthquakes:", error);
    result = {status: "error", found: 0, sent: 0, error: error.message};
    await sendAdminAlert(`earthquake check failed: ${error.message}`);
  } finally {
    // Always record a heartbeat so external monitoring can detect a stalled
    // function even when no alerts are sent.
    await writeHeartbeat(result);
  }

  return result;
}

/**
 * Persists a delivered alert and its quakes to the "alerts" collection so
 * the daily digest endpoint can replay them. Best-effort: a failure is logged
 * rather than thrown, so it cannot mask a successful notification.
 * @param {Array<Object>} earthquakes The scored quakes in this alert.
 * @param {string} message The delivered alert text (AI summary or terse line).
 * @param {number} priority The internal alert priority.
 * @return {Promise<void>}
 */
async function storeAlertInFirebase(earthquakes, message, priority) {
  try {
    const alertRef = await db.collection("alerts").add({
      timestamp: FieldValue.serverTimestamp(),
      message: message,
      priority: priority,
      earthquakes: earthquakes.map((eq) => ({...eq})),
    });
    console.log(`Alert stored in Firebase with ID: ${alertRef.id}`);
  } catch (error) {
    console.error("Error storing alert in Firebase:", error);
  }
}

/**
 * Delivers one priority bucket: the deterministic line first (the guaranteed
 * notification), then the AI summary as an optional follow-up. Marks the bucket
 * deliverable only when the deterministic line is confirmed sent to Pushover.
 * @param {{priority: number, earthquakes: Array<Object>}} group The bucket.
 * @param {number} fromLat Latitude of the monitored point in degrees.
 * @param {number} fromLng Longitude of the monitored point in degrees.
 * @return {Promise<boolean>} True when the terse line was confirmed delivered.
 */
async function deliverGroup(group, fromLat, fromLng) {
  const terseMessage = group.earthquakes
      .map((eq) => alertLineForQuake(eq, fromLat, fromLng))
      .join("<br/>");
  // Felt quakes (internal priority 0) deliver at the audible floor so they are
  // never silenceable; higher priorities are unchanged.
  const pushoverPriority = pushoverPriorityFor(group.priority);

  try {
    await sendPushover({
      token: process.env.PUSHOVER_TOKEN,
      user: process.env.PUSHOVER_USER,
      message: terseMessage,
      priority: pushoverPriority,
    });
  } catch (error) {
    // The core notification failed; surface it and let the next run retry.
    console.error("Error sending alert:", error);
    await sendAdminAlert(`alert delivery failed: ${error.message}`);
    return false;
  }

  // The AI summary is a follow-up, never a blocker. If OpenAI is down the
  // terse line above has already notified, so a failure here is only logged.
  let summary = null;
  try {
    summary = await getAISummary(group.earthquakes);
    await sendPushover({
      token: process.env.PUSHOVER_TOKEN,
      user: process.env.PUSHOVER_USER,
      message: summary,
      priority: pushoverPriority,
    });
  } catch (error) {
    // Users already have the terse alert; tell the admin the AI is degraded.
    console.error("AI summary unavailable; terse alert already sent:", error);
    await sendAdminAlert(`AI summary unavailable: ${error.message}`);
  }

  await storeAlertInFirebase(
      group.earthquakes,
      summary || terseMessage,
      group.priority,
  );
  return true;
}

/**
 * Sends a high-priority notice to the admin recipient so dependency failures
 * (USGS, Pushover, Firestore) surface instead of failing silently. Falls back
 * to the normal user when no dedicated admin recipient is configured.
 * @param {string} detail Human-readable description of the failure.
 * @return {Promise<void>}
 */
async function sendAdminAlert(detail) {
  try {
    await sendPushover({
      token: process.env.PUSHOVER_TOKEN,
      user: process.env.ADMIN_PUSHOVER_USER || process.env.PUSHOVER_USER,
      message: `[quake-notifier] ${detail}`,
      priority: 1,
    });
  } catch (error) {
    console.error("Failed to send admin alert:", error);
  }
}

/**
 * Records the outcome of a run so external monitoring can detect a stalled
 * function even when there is nothing to alert on. Never throws.
 * @param {Object} result The structured run result.
 * @return {Promise<void>}
 */
async function writeHeartbeat(result) {
  try {
    await db.collection("health").doc("heartbeat").set({
      timestamp: FieldValue.serverTimestamp(),
      status: result.status,
      found: result.found,
      sent: result.sent,
      error: result.error,
    });
  } catch (error) {
    console.error("Error writing heartbeat:", error);
  }
}

/**
 * Reads every dedup marker in one batched getAll so a run makes a single
 * Firestore round-trip regardless of how many quakes USGS returned.
 * @param {Array<string>} ids Earthquake IDs to look up.
 * @return {Promise<Set<string>>} The subset of ids already marked sent.
 */
async function fetchSentIds(ids) {
  if (ids.length === 0) {
    return new Set();
  }
  try {
    const refs = ids.map((id) => db.collection("sent_alerts").doc(id));
    const snaps = await db.getAll(...refs);
    const present = snaps.filter((snap) => snap.exists);
    return new Set(present.map((snap) => snap.id));
  } catch (error) {
    console.error("Error checking alert status:", error);
    throw error;
  }
}

/**
 * Batch-marks the given earthquakes as having had an alert sent, in a single
 * Firestore commit. Best-effort: a failure is logged and surfaced to the admin
 * rather than thrown, so it cannot mask a successful delivery.
 * @param {Array<Object>} earthquakes Quakes whose alert was confirmed sent.
 * @return {Promise<void>}
 */
async function markAlertsAsSent(earthquakes) {
  if (earthquakes.length === 0) {
    return;
  }
  try {
    const batch = db.batch();
    for (const earthquake of earthquakes) {
      const ref = db.collection("sent_alerts").doc(earthquake.id);
      // TTL field; a Firestore policy on expireAt auto-reaps stale markers.
      const expireAt = new Date(Date.now() + SENT_ALERT_TTL_MS);
      batch.set(ref, {...earthquake, sent: true, expireAt});
    }
    await batch.commit();
    console.log(`Marked ${earthquakes.length} earthquake(s) as sent.`);
  } catch (error) {
    console.error("Error marking alerts as sent:", error);
    await sendAdminAlert(`failed to mark alerts as sent: ${error.message}`);
  }
}

/**
 * Returns the alerts stored so far during the current JST day, most recent
 * first, for the daily digest endpoint.
 * @return {Promise<Array<Object>>} Today's stored alert documents.
 */
async function getTodayAlerts() {
  try {
    const today = startOfTodayTokyo(new Date());

    const alertsSnapshot = await db.collection("alerts")
        .where("timestamp", ">=", today)
        .orderBy("timestamp", "desc")
        .get();

    const alerts = [];
    alertsSnapshot.forEach((doc) => {
      alerts.push({
        id: doc.id,
        ...doc.data(),
        // Convert Firestore Timestamp to JS Date
        timestamp: doc.data().timestamp.toDate(),
      });
    });

    return alerts;
  } catch (error) {
    console.error("Error fetching today's alerts:", error);
    throw error;
  }
}

/**
 * Binds the earthquake checker to a Firestore instance so this module needs no
 * Firebase initialization of its own and can be driven directly against the
 * emulator (or any real Firestore) in tests.
 * @param {FirebaseFirestore.Firestore} injectedDb An initialized Firestore.
 * @return {{checkEarthquake: Function, getTodayAlerts: Function}} The checker.
 */
function createChecker(injectedDb) {
  db = injectedDb;
  return {checkEarthquake, getTodayAlerts};
}

module.exports = {
  createChecker,
  buildQueryUrl,
  recentWindowStart,
  startOfTodayTokyo,
  pushoverPriorityFor,
  REQUEST_TIMEOUT_MS,
};
