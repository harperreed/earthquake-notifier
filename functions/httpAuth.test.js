// ABOUTME: Tests for the pure HTTP endpoint guards — the shared-secret auth and
// ABOUTME: the radius clamp that bounds how much a single USGS query can pull.

const {test} = require("node:test");
const assert = require("node:assert/strict");

const {authorize, clampRadius} = require("./httpAuth");

test("authorize accepts a matching token", () => {
  assert.equal(authorize("s3cret", "s3cret"), true);
});

test("authorize rejects a mismatched token", () => {
  assert.equal(authorize("wrong", "s3cret"), false);
});

test("authorize rejects tokens of differing length", () => {
  assert.equal(authorize("short", "a-much-longer-secret"), false);
});

test("authorize fails closed when no secret is configured", () => {
  assert.equal(authorize("anything", ""), false);
  assert.equal(authorize("anything", undefined), false);
});

test("authorize rejects a missing presented token", () => {
  assert.equal(authorize(undefined, "s3cret"), false);
});

test("clampRadius caps an oversized radius at the maximum", () => {
  assert.equal(clampRadius("99999"), 2000);
});

test("clampRadius raises a zero/negative radius to the floor", () => {
  assert.equal(clampRadius("0"), 1);
  assert.equal(clampRadius("-50"), 1);
});

test("clampRadius passes a normal radius through unchanged", () => {
  assert.equal(clampRadius("1500"), 1500);
});

test("clampRadius falls back to the default on non-numeric input", () => {
  assert.equal(clampRadius("abc"), 1500);
  assert.equal(clampRadius(undefined), 1500);
});
