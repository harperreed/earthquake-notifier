// ABOUTME: Characterization tests locking current quake.js behavior before the
// ABOUTME: Phase 1 correctness fixes to estimatePGA's signature and formula.

const {test} = require("node:test");
const assert = require("node:assert/strict");

const {
  calculateDistance,
  estimatePGA,
  determineAlertPriority,
} = require("./quake");
const {isWithinAlertRange} = require("./alertRange");
const kuji = require("./fixtures/kuji-m69-2026-06-24.json");

// Kofu, Yamanashi — the monitored location.
const KOFU_LAT = 35.662139;
const KOFU_LNG = 138.568222;

test("calculateDistance returns 0 for the same point", () => {
  assert.equal(calculateDistance(KOFU_LAT, KOFU_LNG, KOFU_LAT, KOFU_LNG), 0);
});

test("calculateDistance: Kofu to the real Kuji M6.9 is ~600km", () => {
  const [lon, lat] = kuji.geometry.coordinates;
  const distance = calculateDistance(KOFU_LAT, KOFU_LNG, lat, lon);
  assert.ok(Math.abs(distance - 600.43) < 0.5, `got ${distance}`);
});

test("Kuji M6.9 regression: in range, priority 1 (mag tier)", () => {
  // The quake that started this: 600km out, slipped the old flat 500km radius.
  const [lon, lat, depth] = kuji.geometry.coordinates;
  const mag = kuji.properties.mag;
  const distance = calculateDistance(KOFU_LAT, KOFU_LNG, lat, lon);
  assert.equal(isWithinAlertRange(mag, distance), true);
  // 6.9 is below the 7.0 priority-2 tier, so it lands in the >=6.0 tier.
  assert.equal(determineAlertPriority(mag, depth), 1);
});

// estimatePGA(magnitude, distanceKm, depthKm) uses the real hypocentral
// distance R = sqrt(distance^2 + depth^2) and base-10 GMPE constants.
test("estimatePGA returns a positive, finite number", () => {
  const pga = estimatePGA(6.0, 100, 10);
  assert.ok(Number.isFinite(pga) && pga > 0, `got ${pga}`);
});

test("estimatePGA increases with magnitude at a fixed distance", () => {
  assert.ok(estimatePGA(7.0, 100, 10) > estimatePGA(6.0, 100, 10));
});

test("estimatePGA decreases with epicentral distance", () => {
  assert.ok(estimatePGA(6.0, 10, 10) > estimatePGA(6.0, 100, 10));
});

test("estimatePGA decreases with depth (deeper quake, less shaking)", () => {
  // Old code ignored real depth (fixed 30km); depth must now matter.
  assert.ok(estimatePGA(6.0, 100, 10) > estimatePGA(6.0, 100, 600));
});

test("estimatePGA scales per magnitude in base 10, not natural log", () => {
  // ~10^0.229 ≈ 1.69x per magnitude unit; natural log would give ~1.26x.
  const ratio = estimatePGA(7.0, 100, 10) / estimatePGA(6.0, 100, 10);
  assert.ok(Math.abs(ratio - 1.69) < 0.05, `got ${ratio}`);
});

test("estimatePGA pins the corrected formula output", () => {
  assert.ok(Math.abs(estimatePGA(6.0, 10, 10) - 0.19577931) < 1e-6);
});

test("magnitude 7.0+ is always priority 2", () => {
  assert.equal(determineAlertPriority(8.2, 10), 2);
  assert.equal(determineAlertPriority(7.0, 300), 2);
});

test("magnitude 6.0-6.9 is priority 1", () => {
  assert.equal(determineAlertPriority(6.5, 40), 1);
  assert.equal(determineAlertPriority(6.0, 200), 1);
});

test("M5.0-5.9 alerts as priority 1 only when depth < 70", () => {
  assert.equal(determineAlertPriority(5.5, 50), 1);
  assert.equal(determineAlertPriority(5.5, 69), 1);
  assert.equal(determineAlertPriority(5.5, 70), -1);
  assert.equal(determineAlertPriority(5.0, 69), 1);
});

test("M4.5-4.9 alerts as priority 0 only when depth < 30", () => {
  assert.equal(determineAlertPriority(4.7, 20), 0);
  assert.equal(determineAlertPriority(4.5, 29), 0);
  assert.equal(determineAlertPriority(4.5, 30), -1);
});

test("below M4.5 never alerts", () => {
  assert.equal(determineAlertPriority(4.4, 5), -1);
  assert.equal(determineAlertPriority(3.0, 5), -1);
});

// I17 seam: index.js gates an alert on BOTH isWithinAlertRange (magnitude →
// radius) AND determineAlertPriority(...) >= 0 (magnitude + depth). These two
// independent gates must stay aligned; these tests pin where they interact.
const alerts = (mag, distanceKm, depth) =>
  isWithinAlertRange(mag, distanceKm) &&
  determineAlertPriority(mag, depth) >= 0;

test("seam: a shallow M4.5 within 300km alerts", () => {
  assert.equal(alerts(4.5, 250, 20), true);
});

test("seam: a deep M4.5 within 300km does not alert (priority gate)", () => {
  // In range, but depth >= 30 makes determineAlertPriority return -1.
  assert.equal(isWithinAlertRange(4.5, 250), true);
  assert.equal(alerts(4.5, 250, 40), false);
});

test("seam: an M4.5 beyond 300km does not alert (range gate)", () => {
  // Shallow enough for priority 0, but the range gate excludes it.
  assert.equal(determineAlertPriority(4.5, 20) >= 0, true);
  assert.equal(alerts(4.5, 350, 20), false);
});

test("seam: both gates share the M4.5 floor — below it never alerts", () => {
  assert.equal(isWithinAlertRange(4.4, 10), false);
  assert.equal(determineAlertPriority(4.4, 10), -1);
  assert.equal(alerts(4.4, 10, 10), false);
});
