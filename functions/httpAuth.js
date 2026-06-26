// ABOUTME: Pure request guards for the HTTP endpoints — a constant-time shared
// ABOUTME: secret check and a radius clamp, kept import-safe for unit tests.

const crypto = require("crypto");

const DEFAULT_RADIUS_KM = 1500;
const MIN_RADIUS_KM = 1;
const MAX_RADIUS_KM = 2000;

// Constant-time compare so a wrong token can't be guessed from timing.
// Different lengths short-circuit; timingSafeEqual needs equal-size buffers.
const safeEqual = (a, b) => {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ab.length !== bb.length) {
    return false;
  }
  return crypto.timingSafeEqual(ab, bb);
};

/**
 * Authorizes a request by comparing the presented shared secret against the
 * configured one in constant time. Fails closed: an unset or empty expected
 * secret denies every request rather than leaving the endpoint open.
 * @param {string|undefined} provided The token presented on the request.
 * @param {string|undefined} expected The configured shared secret.
 * @return {boolean} True only when both are present and equal.
 */
function authorize(provided, expected) {
  if (!expected || !provided) {
    return false;
  }
  return safeEqual(provided, expected);
}

/**
 * Clamps a user radius (km) to a sane range so one request cannot ask USGS for
 * an unbounded result set. Non-numeric input falls back to the default.
 * @param {string|number|undefined} raw The raw radius query parameter.
 * @return {number} A radius within [MIN_RADIUS_KM, MAX_RADIUS_KM].
 */
function clampRadius(raw) {
  const n = Number.parseInt(raw, 10);
  if (Number.isNaN(n)) {
    return DEFAULT_RADIUS_KM;
  }
  return Math.min(MAX_RADIUS_KM, Math.max(MIN_RADIUS_KM, n));
}

module.exports = {authorize, clampRadius};
