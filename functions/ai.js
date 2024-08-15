/* eslint-disable require-jsdoc */

const {OpenAI} = require("openai");

async function getAISummary(data) {
  const dataStr = JSON.stringify(data);
  // eslint-disable-next-line max-len
  const earthQuakeBotPrompt = `
  You are a news reporter in Kofu Yamanashi that is doing a live blog about an earthquake(s).
  You are given a list of earthquakes in JSON format.
  Your job is to explain the data in English.

  Use bullets where necessary.
  You summarize the data in english.
  Put a headline at the top
  Limit to 3 major points. Be concise. Don't be verbose.
  You can use html to style it (b, i, and u tags)

  Important things to cover:
  - How far from Kofu, Yamanashi is the earthquake?
  - What is the impact of the earthquake?
  - Were people effected?
  - Only mention if the PGA values (Peak Ground Acceleration) it is significant? .
    - PGA > 0.34g (severe shaking)
    - PGA > 0.092g (strong shaking)
    - PGA > 0.039g (moderate shaking)
    - the PGA is calculated with yamanashi as the epicenter
    - IMPORTANT: Do not say PGA. Just say if it is significant and what the shaking is like.



  Don't mention the data directly.
  It is ok if these things are not appropriate for the data you are given. If that is the case, then just make up a story that fits the data you are given.
  `;

  const userPrompt = `${dataStr}`;

  const model = process.env.OPENAI_MODEL;

  const openAiCompletionArgs = {
    model: model,
    messages: [
      {role: "system", content: earthQuakeBotPrompt},
      {role: "user", content: userPrompt},
    ],
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
