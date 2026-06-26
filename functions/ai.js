/* eslint-disable require-jsdoc */

const {OpenAI} = require("openai");
const {buildSummaryMessages} = require("./summaryPrompt");

async function getAISummary(data) {
  const model = process.env.OPENAI_MODEL;

  const openAiCompletionArgs = {
    model: model,
    messages: buildSummaryMessages(data),
  };

  const openai = new OpenAI();
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
