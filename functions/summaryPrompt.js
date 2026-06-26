// ABOUTME: Pure builder for the earthquake live-blog AI prompt — system
// ABOUTME: instructions plus the single-encoded earthquake data payload.

// The prompt is prose; reflowing lines would inject newlines into the text
// the model receives, so max-len is disabled across the literal.
/* eslint-disable max-len */
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
  - Include the URL
  - Only mention if the PGA values (Peak Ground Acceleration) it is significant? .
    - PGA > 0.34g (severe shaking)
    - PGA > 0.092g (strong shaking)
    - PGA > 0.039g (moderate shaking)
    - the PGA is the estimated shaking at Kofu, Yamanashi
    - IMPORTANT: Do not say PGA. Just say if it is significant and what the shaking is like.



  Don't mention the data directly.
  It is ok if these things are not appropriate for the data you are given. If that is the case, then leave them out and only report what the data supports.
  `;
/* eslint-enable max-len */

/**
 * Builds the chat messages for the earthquake summary model. The earthquake
 * data is encoded as JSON exactly once here, so callers must pass the raw
 * array of earthquakes — never a pre-stringified string.
 * @param {Array<Object>} earthquakes The scored earthquakes to summarize.
 * @return {Array<{role: string, content: string}>} Chat messages.
 */
function buildSummaryMessages(earthquakes) {
  const dataStr = JSON.stringify(earthquakes);
  return [
    {role: "system", content: earthQuakeBotPrompt},
    {role: "user", content: dataStr},
  ];
}

module.exports = {buildSummaryMessages};
