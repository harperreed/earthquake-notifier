// ABOUTME: Real-HTTP integration tests for sendPushover — a local catcher
// ABOUTME: stands in for Pushover so delivery and failures are exercised live.

const {test} = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");

const {sendPushover} = require("./notify");

// Starts a throwaway HTTP server that records the request and replies with the
// given status and body. Resolves to {url, received, close}.
const startCatcher = (statusCode, responseBody) => {
  const received = {};
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
    });
    req.on("end", () => {
      received.method = req.method;
      received.url = req.url;
      received.body = raw ? JSON.parse(raw) : null;
      res.writeHead(statusCode, {"Content-Type": "application/json"});
      res.end(JSON.stringify(responseBody));
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const {port} = server.address();
      resolve({
        url: `http://127.0.0.1:${port}`,
        received,
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
};

test("sendPushover posts the alert to the messages endpoint", async () => {
  const catcher = await startCatcher(200, {status: 1, request: "abc"});
  process.env.PUSHOVER_API_URL = catcher.url;
  try {
    const data = await sendPushover({
      token: "t", user: "u", message: "M5.8 quake", priority: 1,
    });
    assert.equal(catcher.received.method, "POST");
    assert.equal(catcher.received.url, "/1/messages.json");
    assert.equal(catcher.received.body.message, "M5.8 quake");
    assert.equal(catcher.received.body.token, "t");
    assert.equal(data.status, 1);
  } finally {
    await catcher.close();
    delete process.env.PUSHOVER_API_URL;
  }
});

test("sendPushover rejects on an error status", async () => {
  const catcher = await startCatcher(500, {status: 0});
  process.env.PUSHOVER_API_URL = catcher.url;
  try {
    await assert.rejects(sendPushover({
      token: "t", user: "u", message: "down", priority: 0,
    }));
  } finally {
    await catcher.close();
    delete process.env.PUSHOVER_API_URL;
  }
});

test("sendPushover adds retry/expire for priority 2", async () => {
  const catcher = await startCatcher(200, {status: 1});
  process.env.PUSHOVER_API_URL = catcher.url;
  try {
    await sendPushover({
      token: "t", user: "u", message: "big", priority: 2,
    });
    assert.equal(catcher.received.body.retry, 180);
    assert.equal(catcher.received.body.expire, 3600);
  } finally {
    await catcher.close();
    delete process.env.PUSHOVER_API_URL;
  }
});
