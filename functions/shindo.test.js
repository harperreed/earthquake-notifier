// ABOUTME: Unit tests for shindo.js — the PGA→JMA intensity estimate, its
// ABOUTME: official band cutoffs, and the end-to-end estimate for a real quake.

const {test} = require("node:test");
const assert = require("node:assert/strict");

const {
  intensityForPga,
  shindoForIntensity,
  estimateShindo,
} = require("./shindo");
const {calculateDistance, estimatePGA} = require("./quake");
const kuji = require("./fixtures/kuji-m69-2026-06-24.json");

const KOFU_LAT = 35.662139;
const KOFU_LNG = 138.568222;

test("intensityForPga applies I = 2·log10(a) + 0.94 with a in gal", () => {
  assert.ok(Math.abs(intensityForPga(1) - 0.94) < 1e-9);
  assert.ok(Math.abs(intensityForPga(10) - 2.94) < 1e-9);
  assert.ok(Math.abs(intensityForPga(100) - 4.94) < 1e-9);
  assert.ok(Math.abs(intensityForPga(1000) - 6.94) < 1e-9);
});

test("intensityForPga floors non-positive acceleration at 0", () => {
  assert.equal(intensityForPga(0), 0);
  assert.equal(intensityForPga(-5), 0);
});

test("shindoForIntensity bins every official JMA boundary", () => {
  const cases = [
    [-1, "0"], [0.49, "0"], [0.5, "1"], [1.49, "1"], [1.5, "2"],
    [2.5, "3"], [3.5, "4"], [4.49, "4"], [4.5, "5-"], [4.99, "5-"],
    [5.0, "5+"], [5.49, "5+"], [5.5, "6-"], [6.0, "6+"], [6.49, "6+"],
    [6.5, "7"], [9, "7"],
  ];
  for (const [intensity, band] of cases) {
    assert.equal(shindoForIntensity(intensity), band, `I=${intensity}`);
  }
});

test("estimateShindo converts g to gal before binning", () => {
  const s = estimateShindo(0.255);
  assert.ok(Math.abs(s.pgaGal - 250.07) < 0.5, `gal ${s.pgaGal}`);
  assert.equal(s.band, "6-");
  assert.ok(Number.isFinite(s.intensity));
});

test("estimateShindo floors imperceptible shaking, caps near 1g", () => {
  assert.equal(estimateShindo(0.0001).band, "0");
  assert.equal(estimateShindo(1.0).band, "7");
});

test("kuji M6.9 estimates to shindo 4 through the real PGA model", () => {
  const [lon, lat, depth] = kuji.geometry.coordinates;
  const distance = calculateDistance(KOFU_LAT, KOFU_LNG, lat, lon);
  const pga = estimatePGA(kuji.properties.mag, distance, depth);
  const shindo = estimateShindo(pga);
  assert.equal(shindo.band, "4");
});
