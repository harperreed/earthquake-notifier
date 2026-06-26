// ABOUTME: OpenAI summary generation — turns scored earthquakes into a short
// ABOUTME: human-readable digest; base URL and model are env-configurable.

const {OpenAI} = require("openai");
const {buildSummaryMessages} = require("./summaryPrompt");

// Cap the reply so it fits Pushover's ~1024-character message limit; at roughly
// four characters per token, 256 tokens stays comfortably under that ceiling.
const SUMMARY_MAX_TOKENS = 256;
// Bound a hung OpenAI request so the alert hot path cannot block indefinitely.
const OPENAI_TIMEOUT_MS = 20000;

/**
 * Resolves the OpenAI base URL from the environment so the proxy is
 * configurable per deploy instead of hardcoded, falling back to the existing
 * Cloud Run proxy.
 * @return {string} The base URL for the OpenAI client.
 */
function openAiBaseUrl() {
  return process.env.OPENAI_BASE_URL ||
      "https://openaiproxy-baxvbakvia-uc.a.run.app/v1";
}

/**
 * Generates a short natural-language summary of the scored earthquakes via the
 * OpenAI chat API. The reply is token-capped and time-bounded so it cannot
 * overflow Pushover's message limit or block the alert hot path.
 * @param {Array<Object>} data The scored earthquakes to summarize.
 * @return {Promise<string>} The model's summary text.
 */
async function getAISummary(data) {
  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";

  const openAiCompletionArgs = {
    model: model,
    messages: buildSummaryMessages(data),
    // eslint-disable-next-line camelcase
    max_tokens: SUMMARY_MAX_TOKENS,
  };

  const openai = new OpenAI({timeout: OPENAI_TIMEOUT_MS});
  openai.baseURL = openAiBaseUrl();
  const response = await openai.chat.completions.create(openAiCompletionArgs);

  const aiResponse = response.choices[0].message.content;
  console.log(aiResponse);
  return aiResponse;
}

module.exports = {
  getAISummary,
  openAiBaseUrl,
};
