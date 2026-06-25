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

// These estimatePGA assertions lock the CURRENT formula and 2-arg signature.
// Phase 1 fixes the call-site arg bug and the log10/depth formula, which will
// deliberately change these numbers — update them RED->GREEN at that point.
test("estimatePGA returns a positive, finite number", () => {
  const pga = estimatePGA(6.0, 100);
  assert.ok(Number.isFinite(pga) && pga > 0, `got ${pga}`);
});

test("estimatePGA increases with magnitude at a fixed distance", () => {
  assert.ok(estimatePGA(7.0, 100) > estimatePGA(6.0, 100));
});

test("estimatePGA decreases with distance at a fixed magnitude", () => {
  assert.ok(estimatePGA(6.0, 10) > estimatePGA(6.0, 100));
});

test("estimatePGA pins the current formula output", () => {
  assert.ok(Math.abs(estimatePGA(6.0, 10) - 0.1109685) < 1e-6);
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
