// ABOUTME: Estimates JMA seismic intensity (shindo) from peak ground
// ABOUTME: acceleration — a rough, clearly-labeled proxy, not official.

// 1 g expressed in gal (cm/s²); estimatePGA reports PGA as a fraction of g, and
// the intensity relation below is defined in gal.
const GRAVITY_GAL = 980.665;

// Official JMA instrumental-intensity cutoffs mapped to the display bands users
// see, ordered high to low so the first match wins. The "-"/"+" bands are the
// JMA weak/strong (弱/強) subdivisions, rendered here as ASCII for readability.
const SHINDO_BANDS = [
  {min: 6.5, band: "7"},
  {min: 6.0, band: "6+"},
  {min: 5.5, band: "6-"},
  {min: 5.0, band: "5+"},
  {min: 4.5, band: "5-"},
  {min: 3.5, band: "4"},
  {min: 2.5, band: "3"},
  {min: 1.5, band: "2"},
  {min: 0.5, band: "1"},
  {min: -Infinity, band: "0"},
];

/**
 * Rough PGA to JMA instrumental intensity: I = 2·log10(a) + 0.94, a in gal.
 * A single PGA value cannot capture JMA's filtered, multi-cycle measure, so
 * this is an estimate (~±0.5 intensity); present it as such, never official.
 * @param {number} pgaGal Peak ground acceleration in gal (cm/s²).
 * @return {number} Estimated instrumental intensity; 0 for non-positive input.
 */
function intensityForPga(pgaGal) {
  if (!(pgaGal > 0)) return 0;
  return 2 * Math.log10(pgaGal) + 0.94;
}

/**
 * Bins an instrumental intensity into its JMA shindo display band.
 * @param {number} intensity Instrumental intensity.
 * @return {string} Band label (e.g. "5+"); clamps to "0" below 0.5 and "7"
 *     at/above 6.5.
 */
function shindoForIntensity(intensity) {
  for (const level of SHINDO_BANDS) {
    if (intensity >= level.min) {
      return level.band;
    }
  }
  // Unreachable: the table's final floor is -Infinity.
  return "0";
}

/**
 * Estimates the shindo a quake produced at the monitored point from its modeled
 * PGA. estimatePGA reports PGA as a fraction of g, so it is converted to gal
 * before the intensity relation is applied.
 * @param {number} pgaG Peak ground acceleration as a fraction of g.
 * @return {{pgaGal: number, intensity: number, band: string}} The gal value,
 *     estimated instrumental intensity, and shindo band label.
 */
function estimateShindo(pgaG) {
  const pgaGal = pgaG * GRAVITY_GAL;
  const intensity = intensityForPga(pgaGal);
  return {pgaGal, intensity, band: shindoForIntensity(intensity)};
}

module.exports = {intensityForPga, shindoForIntensity, estimateShindo};
