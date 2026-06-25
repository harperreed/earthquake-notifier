// ABOUTME: Pure earthquake math, no Firebase deps: Haversine distance, PGA
// ABOUTME: ground-motion estimate, and magnitude/depth alert priority.

// Function to calculate distance between two points using Haversine formula
/**
 * Calculates the distance between two geographic points on the Earth using the Haversine formula.
 * @param {number} lat1 Latitude of the first point in degrees.
 * @param {number} lon1 Longitude of the first point in degrees.
 * @param {number} lat2 Latitude of the second point in degrees.
 * @param {number} lon2 Longitude of the second point in degrees.
 * @return {number} The distance between the two points in kilometers, rounded to two decimal places.
 */
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // Radius of the Earth in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos((lat1 * Math.PI) / 180) *
            Math.cos((lat2 * Math.PI) / 180) *
            Math.sin(dLon / 2) *
            Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distance = R * c; // Distance in km
  return Math.round(distance * 100) / 100; // Round to 2 decimal places
}

// Function to estimate Peak Ground Acceleration (PGA) using a simple attenuation relationship
function estimatePGA(magnitude, distance) {
  // This is a simplified version of the Boore-Atkinson (2008) ground motion prediction equation
  // Note: This is still an approximation and should be used cautiously
  const a = 0.03615;
  const b = 0.229;
  const c = -0.00114;
  const d = -0.647;

  const R = Math.sqrt(distance * distance + 30 * 30); // Accounting for depth
  const logPGA = a + b * (magnitude - 6) + c * (magnitude - 6) * (magnitude - 6) + d * Math.log(R);

  return Math.exp(logPGA);
}

// Function to determine alert priority based on magnitude and depth
function determineAlertPriority(magnitude, depth) {
  if (magnitude >= 8.0) return 2;
  if (magnitude >= 7.0) return 2;
  if (magnitude >= 6.0) return 1;
  if (magnitude >= 5.0 && depth < 70) return 1; // Shallow earthquakes are more likely to be felt
  if (magnitude >= 4.5 && depth < 30) return 0; // Very shallow earthquakes can be significant even at lower magnitudes
  return -1; // No alert for smaller earthquakes
}

module.exports = {calculateDistance, estimatePGA, determineAlertPriority};
