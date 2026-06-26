// ABOUTME: Earthquake check + alert delivery orchestration, with Firestore
// ABOUTME: injected so the logic runs against the emulator or real Firebase.

const axios = require("axios");
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

// The Firestore instance is injected by createChecker so this module stays free
// of Firebase initialization and can run against the emulator or real Firebase.
let db;

// Function to check for earthquakes with parameters
async function checkEarthquake(latitude, longitude, radius) {
  const base = process.env.USGS_API_URL || "https://earthquake.usgs.gov";
  const url = `${base}/fdsnws/event/1/query?` +
      `format=geojson&latitude=${latitude}&` +
      `longitude=${longitude}&maxradiuskm=${radius}`;
  console.log(url);
  let result = {status: "ok", found: 0, sent: 0, error: null};
  try {
    const response = await axios.get(url);
    const data = response.data;
    const earthquakeData = [];

    if (data.features && data.features.length > 0) {
      for (const earthquake of data.features) {
        const earthquakeInfo = earthquake.properties;
        const earthquakeId = earthquake.id;
        const [eqLongitude, eqLatitude, depth] =
                    earthquake.geometry.coordinates;

        // Check if an alert for this earthquake ID has already been sent
        const isAlertSent = await checkIfAlertSent(earthquakeId);
        if (isAlertSent) {
          continue; // Skip this earthquake as an alert has already been sent
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

// Update the storeAlertInFirebase function to include JMA intensity
async function storeAlertInFirebase(earthquakes, message, priority) {
  try {
    const alertRef = await db.collection("alerts").add({
      timestamp: new Date(),
      message: message,
      priority: priority,
      earthquakes: earthquakes.map((eq) => ({
        ...eq,
        estimatedPGA: eq.estimatedPGA,
      })),
    });
    console.log(`Alert stored in Firebase with ID: ${alertRef.id}`);
  } catch (error) {
    console.error("Error storing alert in Firebase:", error);
  }
}

// Function to generate alert message
async function manufactureAlert(data) {
  const summary = await getAISummary(data);
  return summary;
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

  try {
    await sendPushover({
      token: process.env.PUSHOVER_TOKEN,
      user: process.env.PUSHOVER_USER,
      message: terseMessage,
      priority: group.priority,
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
    summary = await manufactureAlert(group.earthquakes);
    await sendPushover({
      token: process.env.PUSHOVER_TOKEN,
      user: process.env.PUSHOVER_USER,
      message: summary,
      priority: group.priority,
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
      timestamp: new Date(),
      status: result.status,
      found: result.found,
      sent: result.sent,
      error: result.error,
    });
  } catch (error) {
    console.error("Error writing heartbeat:", error);
  }
}

// Function to check if an alert has already been sent for a given earthquake ID
async function checkIfAlertSent(earthquakeId) {
  try {
    const doc = await db.collection("sent_alerts").doc(earthquakeId).get();
    return doc.exists;
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
      batch.set(ref, {...earthquake, sent: true});
    }
    await batch.commit();
    console.log(`Marked ${earthquakes.length} earthquake(s) as sent.`);
  } catch (error) {
    console.error("Error marking alerts as sent:", error);
    await sendAdminAlert(`failed to mark alerts as sent: ${error.message}`);
  }
}

// Function to get today's alerts
async function getTodayAlerts() {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const alertsSnapshot = await db.collection("alerts")
        .where("timestamp", ">=", today)
        .orderBy("timestamp", "desc")
        .get();

    const alerts = [];
    alertsSnapshot.forEach((doc) => {
      alerts.push({
        id: doc.id,
        ...doc.data(),
        timestamp: doc.data().timestamp.toDate(), // Convert Firestore Timestamp to JS Date
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

module.exports = {createChecker};
