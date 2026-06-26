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
 * Builds the terse alert line for one enriched USGS earthquake feature — the
 * shape index.js assembles, with the precomputed distance, depth, priority,
 * and estimated PGA. The shindo band is estimated from that PGA; the bearing
 * is the compass direction from the monitored point to the quake.
 * @param {Object} quake Enriched feature with geometry.coordinates
 *     ([lng, lat, depth]), properties.mag, distance_from_kofu, calculatedDepth,
 *     alertPriority, and estimatedPGA.
 * @param {number} fromLat Latitude of the monitored point in degrees.
 * @param {number} fromLng Longitude of the monitored point in degrees.
 * @return {string} The deterministic one-line alert.
 */
function alertLineForQuake(quake, fromLat, fromLng) {
  const [lng, lat] = quake.geometry.coordinates;
  const bearing = compassBearing(fromLat, fromLng, lat, lng);
  const {band} = estimateShindo(quake.estimatedPGA);
  return formatAlertLine(
      band,
      quake.properties.mag,
      quake.distance_from_kofu,
      bearing,
      quake.calculatedDepth,
      quake.alertPriority,
  );
}

module.exports = {compassBearing, formatAlertLine, alertLineForQuake};
