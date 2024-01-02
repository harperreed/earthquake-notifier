/* eslint-disable require-jsdoc */

const {OpenAI} = require("openai");


async function getAISummary(data) {
  const dataStr = JSON.stringify(data);
  // eslint-disable-next-line max-len
  const earthQuakeBotPrompt = `
  You are a news reporter that is doing a live blog about an earthquake(s).
  You are given a list of earthquakes in JSON format. 
  Your job is to explain the data in English.
  Don't mention the data directly. 
  Use bullets where necessary.
  You summarize the data in english.
  Limit to 3 major points. Be concise. Don't be verbose.
  You can use html to style it (b, i, and u tags)`;

  const model = process.env.OPENAI_QUICKMODEL;

  const openAiCompletionArgs = {
    model: model,
    messages: [
      {"role": "system", "content": earthQuakeBotPrompt},
      {"role": "user", "content": dataStr},
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

