// ABOUTME: Decides how far from Kofu an earthquake of a given magnitude is
// ABOUTME: still worth alerting on — a magnitude-scaled alert radius.

/**
 * Returns the maximum distance (km) from Kofu at which an earthquake of the
 * given magnitude is still worth alerting on. Larger quakes are felt and
 * matter much farther away, so the radius scales with magnitude. Quakes below
 * the minimum alert magnitude return 0, so they are never in range.
 * @param {number} magnitude Earthquake magnitude.
 * @return {number} Maximum alert radius in kilometers.
 */
function maxAlertRadiusForMagnitude(magnitude) {
  if (magnitude >= 7.0) return 1500;
  if (magnitude >= 6.0) return 800;
  if (magnitude >= 5.0) return 500;
  if (magnitude >= 4.5) return 300;
  return 0;
}

/**
 * Reports whether an earthquake is close enough to Kofu to be worth alerting
 * on, given its magnitude and distance.
 * @param {number} magnitude Earthquake magnitude.
 * @param {number} distanceKm Distance from Kofu in kilometers.
 * @return {boolean} True if within the magnitude-scaled alert radius.
 */
function isWithinAlertRange(magnitude, distanceKm) {
  return distanceKm <= maxAlertRadiusForMagnitude(magnitude);
}

module.exports = {maxAlertRadiusForMagnitude, isWithinAlertRange};
