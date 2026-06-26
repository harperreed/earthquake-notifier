// ABOUTME: Tests for the deterministic alert line and compass bearing — the
// ABOUTME: AI-independent fallback that guarantees a quake always notifies.

const {test} = require("node:test");
const assert = require("node:assert/strict");

const {
  compassBearing,
  formatAlertLine,
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

// alertLineForQuake adapts an enriched USGS feature (geometry.coordinates
// [lng, lat, depth], properties.mag, and the derived distance_from_kofu /
// calculatedDepth / alertPriority / estimatedPGA) into the terse line.
const enrichedQuake = (coordinates, mag, distance, depth, priority, pga) => ({
  geometry: {coordinates},
  properties: {mag},
  distance_from_kofu: distance,
  calculatedDepth: depth,
  alertPriority: priority,
  estimatedPGA: pga,
});

test("alertLineForQuake formats a quake due north of the origin", () => {
  const quake = enrichedQuake([0, 1, 12], 5.8, 23, 12, 1, 0.1);
  assert.equal(
      alertLineForQuake(quake, 0, 0),
      "est. shindo 5- · M5.8 · 23km N of Kofu · depth 12km · P1",
  );
});

test("alertLineForQuake derives bearing from coordinates (due east)", () => {
  const quake = enrichedQuake([1, 0, 5], 6.2, 80, 5, 1, 0.3);
  assert.equal(
      alertLineForQuake(quake, 0, 0),
      "est. shindo 6- · M6.2 · 80km E of Kofu · depth 5km · P1",
  );
});

test("alertLineForQuake uses stored distance/depth, not raw geometry", () => {
  // Coordinate depth (999) is ignored; calculatedDepth (12) is what shows.
  const quake = enrichedQuake([0, 1, 999], 7.0, 600, 12, 2, 0.05);
  assert.equal(
      alertLineForQuake(quake, 0, 0),
      "est. shindo 4 · M7.0 · 600km N of Kofu · depth 12km · P2",
  );
});

test("alertLineForQuake leads with the shindo estimated from PGA", () => {
  // Same quake, stronger vs. weaker PGA → higher vs. lower shindo band.
  const strong = enrichedQuake([0, 1, 10], 6.5, 30, 10, 1, 0.3);
  const weak = enrichedQuake([0, 1, 10], 6.5, 30, 10, 1, 0.025);
  assert.match(alertLineForQuake(strong, 0, 0), /^est\. shindo 6- · /);
  assert.match(alertLineForQuake(weak, 0, 0), /^est\. shindo 4 · /);
});
