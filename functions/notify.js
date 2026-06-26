// ABOUTME: Promisified Pushover delivery over HTTP so sends can be awaited and
// ABOUTME: failures surfaced; the API base URL is configurable for testing.

const axios = require("axios");

/**
 * Sends a Pushover notification and resolves only on confirmed delivery.
 * Rejects on a transport error or non-2xx response, so callers can react to a
 * failed send instead of marking an alert delivered when it was not.
 * @param {Object} params Delivery parameters.
 * @param {string} params.token Pushover application token.
 * @param {string} params.user Pushover user/group key.
 * @param {string} params.message The message body (may contain HTML).
 * @param {number} params.priority Pushover priority (-2..2).
 * @return {Promise<Object>} Resolves with the Pushover API response data.
 */
async function sendPushover({token, user, message, priority}) {
  const body = {token, user, message, priority, html: 1};
  if (priority > 1) {
    body.expire = 3600;
    body.retry = 180;
  }
  const base = process.env.PUSHOVER_API_URL || "https://api.pushover.net";
  const response = await axios.post(`${base}/1/messages.json`, body, {
    timeout: 10000,
  });
  return response.data;
}

module.exports = {sendPushover};
