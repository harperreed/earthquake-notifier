// ABOUTME: Tests for the magnitude-scaled alert radius decision.
// ABOUTME: Covers the regression where a major quake past 500km was missed.

const {test} = require("node:test");
const assert = require("node:assert/strict");

const {
  maxAlertRadiusForMagnitude,
  isWithinAlertRange,
} = require("./alertRange");

test("maxAlertRadiusForMagnitude scales the radius up with magnitude", () => {
  assert.equal(maxAlertRadiusForMagnitude(8.2), 1500);
  assert.equal(maxAlertRadiusForMagnitude(7.0), 1500);
  assert.equal(maxAlertRadiusForMagnitude(6.9), 800);
  assert.equal(maxAlertRadiusForMagnitude(6.0), 800);
  assert.equal(maxAlertRadiusForMagnitude(5.5), 500);
  assert.equal(maxAlertRadiusForMagnitude(5.0), 500);
  assert.equal(maxAlertRadiusForMagnitude(4.7), 300);
  assert.equal(maxAlertRadiusForMagnitude(4.5), 300);
});

test("maxAlertRadiusForMagnitude returns 0 below the alert floor", () => {
  assert.equal(maxAlertRadiusForMagnitude(4.4), 0);
  assert.equal(maxAlertRadiusForMagnitude(3.0), 0);
});

test("isWithinAlertRange catches the missed M6.9 at 600km from Kofu", () => {
  // Regression: the 2026-06-25 Kuji M6.9 was 600km away and slipped past the
  // old flat 500km radius. It must now register as in range.
  assert.equal(isWithinAlertRange(6.9, 600), true);
});

test("isWithinAlertRange ignores distant small quakes (no spam)", () => {
  // A small quake at the same 600km distance is not worth alerting on.
  assert.equal(isWithinAlertRange(4.5, 600), false);
  // The Izu M5.7 at 629km is outside the M5 tier's 500km radius.
  assert.equal(isWithinAlertRange(5.7, 629), false);
});

test("isWithinAlertRange treats the radius boundary as inclusive", () => {
  assert.equal(isWithinAlertRange(6.9, 800), true);
  assert.equal(isWithinAlertRange(6.9, 801), false);
  assert.equal(isWithinAlertRange(5.0, 500), true);
});

test("a below-floor quake is never in range, even when adjacent", () => {
  assert.equal(isWithinAlertRange(4.4, 10), false);
});
