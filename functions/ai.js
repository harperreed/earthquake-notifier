/* eslint-disable require-jsdoc */

const {OpenAI} = require("openai");
const {buildSummaryMessages} = require("./summaryPrompt");

// Cap the reply so it fits Pushover's ~1024-character message limit; at roughly
// four characters per token, 256 tokens stays comfortably under that ceiling.
const SUMMARY_MAX_TOKENS = 256;
// Bound a hung OpenAI request so the alert hot path cannot block indefinitely.
const OPENAI_TIMEOUT_MS = 20000;

async function getAISummary(data) {
  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";

  const openAiCompletionArgs = {
    model: model,
    messages: buildSummaryMessages(data),
    // eslint-disable-next-line camelcase
    max_tokens: SUMMARY_MAX_TOKENS,
  };

  const openai = new OpenAI({timeout: OPENAI_TIMEOUT_MS});
  // openai.baseURL = "https://api.dud.org/api/v1";
  openai.baseURL = "https://openaiproxy-baxvbakvia-uc.a.run.app/v1";
  const response = await openai.chat.completions.create(openAiCompletionArgs);
  // logger.info({ response });

  const aiResponse = response.choices[0].message.content;
  console.log(aiResponse);
  return aiResponse;
}

module.exports = {
  getAISummary,
};
