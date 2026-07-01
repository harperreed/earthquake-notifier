// ABOUTME: Deterministic plain-text earthquake alert line and the compass
// ABOUTME: bearing it uses — the resilient fallback when the AI summary fails.

const {estimateShindo} = require("./shindo");

const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];

/**
 * Compass direction (8-point) from one geographic point to another — e.g. the
 * direction of the earthquake as seen from Kofu.
 * @param {number} fromLat Latitude of the origin in degrees.
 * @param {number} fromLng Longitude of the origin in degrees.
 * @param {number} toLat Latitude of the destination in degrees.
 * @param {number} toLng Longitude of the destination in degrees.
 * @return {string} One of N, NE, E, SE, S, SW, W, NW.
 */
function compassBearing(fromLat, fromLng, toLat, toLng) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLng = toRad(toLng - fromLng);
  const lat1 = toRad(fromLat);
  const lat2 = toRad(toLat);
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) -
      Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  const deg = ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
  return COMPASS[Math.round(deg / 45) % 8];
}

/**
 * Builds the deterministic one-line alert, e.g.
 * "est. shindo 5- · M5.8 · 23km NW of Kofu · depth 12km · P1". The estimated
 * shindo leads, magnitude is secondary. Sent first and never depends on the AI
 * summary, so a real quake always produces a notification.
 * @param {string} shindoBand Estimated JMA shindo band (e.g. "5-").
 * @param {number} magnitude Earthquake magnitude.
 * @param {number} distanceKm Distance from Kofu in kilometers.
 * @param {string} bearing Compass direction from Kofu (e.g. "NW").
 * @param {number} depthKm Earthquake depth in kilometers.
 * @param {number} priority Alert priority (0-2).
 * @return {string} The one-line alert.
 */
function formatAlertLine(
    shindoBand, magnitude, distanceKm, bearing, depthKm, priority) {
  const shindo = `est. shindo ${shindoBand}`;
  const mag = `M${magnitude.toFixed(1)}`;
  const loc = `${Math.round(distanceKm)}km ${bearing} of Kofu`;
  const depth = `depth ${Math.round(depthKm)}km`;
  return `${shindo} · ${mag} · ${loc} · ${depth} · P${priority}`;
}

/**
 * Human-readable age of a quake, e.g. "3 min ago". Coarsens as it ages
 * (minutes, then hours, then days) and never reads negative, so a quake
 * stamped slightly in the future by clock skew still shows "just now".
 * @param {number} quakeMs Quake origin time in epoch milliseconds (UTC).
 * @param {number} nowMs Current time in epoch milliseconds (UTC).
 * @return {string} Relative age such as "just now", "3 min ago", "2 hr ago".
 */
function formatRelativeTime(quakeMs, nowMs) {
  const diffMs = nowMs - quakeMs;
  if (diffMs < 60 * 1000) {
    return "just now";
  }
  const minutes = Math.floor(diffMs / (60 * 1000));
  if (minutes < 60) {
    return `${minutes} min ago`;
  }
  const hours = Math.floor(diffMs / (60 * 60 * 1000));
  if (hours < 24) {
    return `${hours} hr ago`;
  }
  const days = Math.floor(diffMs / (24 * 60 * 60 * 1000));
  return `${days} ${days === 1 ? "day" : "days"} ago`;
}

/**
 * Wall-clock time of an instant in one IANA zone, split into the "HH:MM" time
 * and the short zone abbreviation. Uses a 24-hour clock so midnight reads "00",
 * and the short zone name so daylight saving shows (e.g. CDT vs CST).
 * @param {number} epochMs Instant in epoch milliseconds (UTC).
 * @param {string} timeZone IANA zone name (e.g. "America/Chicago").
 * @return {{time: string, abbrev: string}} The "HH:MM" time and zone abbrev.
 */
function clockParts(epochMs, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZoneName: "short",
  }).formatToParts(new Date(epochMs));
  const get = (type) => parts.find((part) => part.type === type).value;
  const time = `${get("hour")}:${get("minute")}`;
  return {time, abbrev: get("timeZoneName")};
}

/**
 * Renders a quake's origin time in both reader zones: Tokyo (the quake's local
 * time) and US Central (the reader's). Tokyo is always labelled "JST" — Japan
 * has no daylight saving and Intl reports a numeric offset there — while the
 * Central abbreviation comes from Intl so it flips between CDT and CST.
 * @param {number} epochMs Quake origin time in epoch milliseconds (UTC).
 * @return {string} e.g. "14:23 JST / 00:23 CDT".
 */
function formatZonedClocks(epochMs) {
  const tokyo = clockParts(epochMs, "Asia/Tokyo");
  const central = clockParts(epochMs, "America/Chicago");
  return `${tokyo.time} JST / ${central.time} ${central.abbrev}`;
}

/**
 * The time fragment appended to an alert line: how long ago the quake struck
 * plus its wall-clock time in Tokyo and US Central.
 * @param {number} quakeMs Quake origin time in epoch milliseconds (UTC).
 * @param {number} nowMs Current time in epoch milliseconds (UTC).
 * @return {string} e.g. "3 min ago (14:23 JST / 00:23 CDT)".
 */
function formatQuakeTime(quakeMs, nowMs) {
  const relative = formatRelativeTime(quakeMs, nowMs);
  const clocks = formatZonedClocks(quakeMs);
  return `${relative} (${clocks})`;
}

/**
 * Builds the terse alert line for one enriched USGS earthquake feature — the
 * shape index.js assembles, with the precomputed distance, depth, priority,
 * and estimated PGA. The shindo band is estimated from that PGA; the bearing
 * is the compass direction from the monitored point to the quake.
 * @param {Object} quake Enriched feature with geometry.coordinates
 *     ([lng, lat, depth]), properties.mag, properties.time (epoch ms),
 *     distance_from_kofu, calculatedDepth, alertPriority, and estimatedPGA.
 * @param {number} fromLat Latitude of the monitored point in degrees.
 * @param {number} fromLng Longitude of the monitored point in degrees.
 * @param {number} nowMs Current time in epoch milliseconds, for the quake age.
 * @return {string} The deterministic one-line alert.
 */
function alertLineForQuake(quake, fromLat, fromLng, nowMs) {
  const [lng, lat] = quake.geometry.coordinates;
  const bearing = compassBearing(fromLat, fromLng, lat, lng);
  const {band} = estimateShindo(quake.estimatedPGA);
  const line = formatAlertLine(
      band,
      quake.properties.mag,
      quake.distance_from_kofu,
      bearing,
      quake.calculatedDepth,
      quake.alertPriority,
  );
  return `${line} · ${formatQuakeTime(quake.properties.time, nowMs)}`;
}

module.exports = {
  compassBearing,
  formatAlertLine,
  formatRelativeTime,
  formatZonedClocks,
  formatQuakeTime,
  alertLineForQuake,
};
