// ABOUTME: Tests for buildSummaryMessages — single-encoded earthquake payload
// ABOUTME: and a system prompt that never instructs the model to fabricate.

const {test} = require("node:test");
const assert = require("node:assert/strict");

const {buildSummaryMessages} = require("./summaryPrompt");

const SAMPLE = [
  {id: "us6000t7zq", properties: {mag: 6.9}, estimatedPGA: 0.0277},
];

test("buildSummaryMessages returns a system then a user message", () => {
  const messages = buildSummaryMessages(SAMPLE);
  assert.equal(messages.length, 2);
  assert.equal(messages[0].role, "system");
  assert.equal(messages[1].role, "user");
});

test("buildSummaryMessages encodes the data exactly once", () => {
  // Regression for the double-stringify bug: the user content must parse
  // straight back to the original array, not to a JSON string-of-a-string.
  const messages = buildSummaryMessages(SAMPLE);
  const parsed = JSON.parse(messages[1].content);
  assert.deepEqual(parsed, SAMPLE);
});

test("system prompt never instructs the model to make up a story", () => {
  const messages = buildSummaryMessages(SAMPLE);
  assert.ok(!/make up a story/i.test(messages[0].content));
});

test("system prompt does not call Yamanashi the epicenter", () => {
  const messages = buildSummaryMessages(SAMPLE);
  assert.ok(!/yamanashi as the epicenter/i.test(messages[0].content));
});
