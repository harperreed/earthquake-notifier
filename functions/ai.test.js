// ABOUTME: Tests for ai.js configuration seams — the OpenAI base URL resolves
// ABOUTME: from the environment with a fallback so the proxy is not hardcoded.

const {test} = require("node:test");
const assert = require("node:assert/strict");

const {openAiBaseUrl} = require("./ai");

const PROXY = "https://openaiproxy-baxvbakvia-uc.a.run.app/v1";

test("openAiBaseUrl defaults to the Cloud Run proxy", () => {
  delete process.env.OPENAI_BASE_URL;
  assert.equal(openAiBaseUrl(), PROXY);
});

test("openAiBaseUrl honors OPENAI_BASE_URL when set", () => {
  process.env.OPENAI_BASE_URL = "https://api.openai.com/v1";
  assert.equal(openAiBaseUrl(), "https://api.openai.com/v1");
  delete process.env.OPENAI_BASE_URL;
});
