// ABOUTME: Tests for the deterministic alert line and compass bearing — the
// ABOUTME: AI-independent fallback that guarantees a quake always notifies.

const {test} = require("node:test");
const assert = require("node:assert/strict");

const {
  compassBearing,
  formatAlertLine,
  formatRelativeTime,
  formatZonedClocks,
  formatQuakeTime,
  alertLineForQuake,
} = require("./alertMessage");

test("compassBearing reads due north as N", () => {
  assert.equal(compassBearing(0, 0, 1, 0), "N");
});

test("compassBearing reads due east as E", () => {
  assert.equal(compassBearing(0, 0, 0, 1), "E");
});

test("compassBearing reads due south as S", () => {
  assert.equal(compassBearing(0, 0, -1, 0), "S");
});

test("compassBearing reads due west as W", () => {
  assert.equal(compassBearing(0, 0, 0, -1), "W");
});

test("compassBearing reads a NE diagonal as NE", () => {
  assert.equal(compassBearing(0, 0, 1, 1), "NE");
});

test("formatAlertLine leads with shindo, magnitude second", () => {
  const line = formatAlertLine("5-", 5.8, 23, "NW", 12, 1);
  assert.equal(
      line,
      "est. shindo 5- · M5.8 · 23km NW of Kofu · depth 12km · P1",
  );
});

test("formatAlertLine rounds distance and depth to whole km", () => {
  const line = formatAlertLine("4", 6.0, 600.43, "NE", 50.923, 1);
  assert.equal(
      line,
      "est. shindo 4 · M6.0 · 600km NE of Kofu · depth 51km · P1",
  );
});

test("formatAlertLine always shows magnitude to one decimal", () => {
  const line = formatAlertLine("7", 7, 10, "N", 5, 2);
  assert.equal(
      line,
      "est. shindo 7 · M7.0 · 10km N of Kofu · depth 5km · P2",
  );
});

// Fixed instants keep the time assertions deterministic. The summer instant
// renders US Central as CDT; the winter one proves the abbreviation flips to
// CST while JST stays constant (Japan never observes daylight saving).
const QUAKE_MS = Date.UTC(2024, 5, 10, 5, 23, 0); // 14:23 JST / 00:23 CDT
const NOW_MS = QUAKE_MS + 3 * 60 * 1000; // three minutes later
const TIME_SUFFIX = " · 3 min ago (14:23 JST / 00:23 CDT)";

test("formatRelativeTime reads anything under a minute as 'just now'", () => {
  assert.equal(formatRelativeTime(0, 0), "just now");
  assert.equal(formatRelativeTime(0, 59 * 1000), "just now");
  // Clock skew (quake stamped slightly in the future) must not read negative.
  assert.equal(formatRelativeTime(5000, 0), "just now");
});

test("formatRelativeTime reports whole minutes", () => {
  assert.equal(formatRelativeTime(0, 60 * 1000), "1 min ago");
  assert.equal(formatRelativeTime(0, 3 * 60 * 1000 + 40 * 1000), "3 min ago");
  assert.equal(formatRelativeTime(0, 59 * 60 * 1000), "59 min ago");
});

test("formatRelativeTime reports whole hours", () => {
  assert.equal(formatRelativeTime(0, 60 * 60 * 1000), "1 hr ago");
  assert.equal(
      formatRelativeTime(0, 2 * 60 * 60 * 1000 + 30 * 60 * 1000),
      "2 hr ago",
  );
  assert.equal(formatRelativeTime(0, 23 * 60 * 60 * 1000), "23 hr ago");
});

test("formatRelativeTime reports whole days", () => {
  assert.equal(formatRelativeTime(0, 24 * 60 * 60 * 1000), "1 day ago");
  assert.equal(formatRelativeTime(0, 50 * 60 * 60 * 1000), "2 days ago");
});

test("formatZonedClocks renders JST and summer Central as CDT", () => {
  assert.equal(formatZonedClocks(QUAKE_MS), "14:23 JST / 00:23 CDT");
});

test("formatZonedClocks flips Central to CST in winter, JST unchanged", () => {
  const winter = Date.UTC(2024, 0, 15, 6, 13, 0);
  assert.equal(formatZonedClocks(winter), "15:13 JST / 00:13 CST");
});

test("formatQuakeTime joins the relative age with both wall clocks", () => {
  assert.equal(
      formatQuakeTime(QUAKE_MS, NOW_MS),
      "3 min ago (14:23 JST / 00:23 CDT)",
  );
});

// alertLineForQuake adapts an enriched USGS feature (geometry.coordinates
// [lng, lat, depth], properties.mag / properties.time, and the derived
// distance_from_kofu / calculatedDepth / alertPriority / estimatedPGA) into
// the terse line, appending how long ago the quake struck.
const enrichedQuake = (coordinates, mag, distance, depth, priority, pga) => ({
  geometry: {coordinates},
  properties: {mag, time: QUAKE_MS},
  distance_from_kofu: distance,
  calculatedDepth: depth,
  alertPriority: priority,
  estimatedPGA: pga,
});

test("alertLineForQuake formats a quake due north of the origin", () => {
  const quake = enrichedQuake([0, 1, 12], 5.8, 23, 12, 1, 0.1);
  assert.equal(
      alertLineForQuake(quake, 0, 0, NOW_MS),
      "est. shindo 5- · M5.8 · 23km N of Kofu · depth 12km · P1" + TIME_SUFFIX,
  );
});

test("alertLineForQuake derives bearing from coordinates (due east)", () => {
  const quake = enrichedQuake([1, 0, 5], 6.2, 80, 5, 1, 0.3);
  assert.equal(
      alertLineForQuake(quake, 0, 0, NOW_MS),
      "est. shindo 6- · M6.2 · 80km E of Kofu · depth 5km · P1" + TIME_SUFFIX,
  );
});

test("alertLineForQuake uses stored distance/depth, not raw geometry", () => {
  // Coordinate depth (999) is ignored; calculatedDepth (12) is what shows.
  const quake = enrichedQuake([0, 1, 999], 7.0, 600, 12, 2, 0.05);
  assert.equal(
      alertLineForQuake(quake, 0, 0, NOW_MS),
      "est. shindo 4 · M7.0 · 600km N of Kofu · depth 12km · P2" + TIME_SUFFIX,
  );
});

test("alertLineForQuake leads with the shindo estimated from PGA", () => {
  // Same quake, stronger vs. weaker PGA → higher vs. lower shindo band.
  const strong = enrichedQuake([0, 1, 10], 6.5, 30, 10, 1, 0.3);
  const weak = enrichedQuake([0, 1, 10], 6.5, 30, 10, 1, 0.025);
  assert.match(alertLineForQuake(strong, 0, 0, NOW_MS), /^est\. shindo 6- · /);
  assert.match(alertLineForQuake(weak, 0, 0, NOW_MS), /^est\. shindo 4 · /);
});
