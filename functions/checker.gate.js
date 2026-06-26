// ABOUTME: Emulator integration gate proving the Jimny delivery path survives a
// ABOUTME: real OpenAI outage — terse alert still sends, no repeat on rerun.

const {test, before, after} = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const admin = require("firebase-admin");

const {createChecker} = require("./checker");

// Force a real AI failure: with no credentials new OpenAI() throws for real, so
// the gate exercises the genuine degraded path rather than a stubbed one.
delete process.env.OPENAI_API_KEY;

// One qualifying quake (M6.9, ~600km NE of Kofu) wrapped as USGS returns it.
const kuji = JSON.parse(
    fs.readFileSync(
        path.join(__dirname, "fixtures", "kuji-m69-2026-06-24.json"),
        "utf8",
    ),
);

const KOFU_LAT = "35.662139";
const KOFU_LNG = "138.568222";
const RADIUS = "1500";

/**
 * Resolves once an http.Server is listening on an ephemeral loopback port.
 * @param {http.Server} server The server to start.
 * @return {Promise<void>}
 */
function listen(server) {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
}

/**
 * Closes an http.Server, resolving when it has fully shut down.
 * @param {http.Server} server The server to stop.
 * @return {Promise<void>}
 */
function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

let usgsServer;
let pushoverServer;
let app;
let checkEarthquake;
const pushoverMessages = [];

before(async () => {
  // USGS catcher: every query returns the one fixture quake as a collection.
  usgsServer = http.createServer((req, res) => {
    res.writeHead(200, {"content-type": "application/json"});
    res.end(JSON.stringify({type: "FeatureCollection", features: [kuji]}));
  });
  await listen(usgsServer);
  process.env.USGS_API_URL = `http://127.0.0.1:${usgsServer.address().port}`;

  // Pushover catcher: records every delivery and acks like the real API.
  pushoverServer = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      pushoverMessages.push(JSON.parse(body));
      res.writeHead(200, {"content-type": "application/json"});
      res.end(JSON.stringify({status: 1, request: "gate"}));
    });
  });
  await listen(pushoverServer);
  const pushoverPort = pushoverServer.address().port;
  process.env.PUSHOVER_API_URL = `http://127.0.0.1:${pushoverPort}`;
  process.env.PUSHOVER_TOKEN = "gate-token";
  process.env.PUSHOVER_USER = "gate-user";

  // Firestore is provided by `firebase emulators:exec`, which sets
  // FIRESTORE_EMULATOR_HOST so the admin SDK connects to the local emulator.
  app = admin.initializeApp({projectId: "demo-quake"});
  const db = admin.firestore();
  ({checkEarthquake} = createChecker(db));
});

after(async () => {
  if (usgsServer) await close(usgsServer);
  if (pushoverServer) await close(pushoverServer);
  if (app) await app.delete();
});

test("Jimny delivery survives a real OpenAI outage", async (t) => {
  await t.test("delivers the terse alert and warns the admin", async () => {
    const result = await checkEarthquake(KOFU_LAT, KOFU_LNG, RADIUS);
    assert.deepEqual(result, {status: "ok", found: 1, sent: 1, error: null});

    // Two messages: the guaranteed terse line, then the admin degraded notice.
    assert.equal(pushoverMessages.length, 2);
    const [terse, adminAlert] = pushoverMessages;

    assert.match(terse.message, /^M6\.9 · \d+km \w+ Kofu · depth 51km · P1$/);
    assert.equal(terse.priority, 1);
    assert.equal(terse.html, 1);

    assert.match(
        adminAlert.message,
        /^\[quake-notifier\] AI summary unavailable:/,
    );
    assert.equal(adminAlert.priority, 1);
  });

  await t.test("does not re-alert an already-sent quake", async () => {
    pushoverMessages.length = 0;
    const result = await checkEarthquake(KOFU_LAT, KOFU_LNG, RADIUS);
    assert.deepEqual(result, {
      status: "no_quakes", found: 0, sent: 0, error: null,
    });
    assert.equal(pushoverMessages.length, 0);
  });

  await t.test("persists alert, dedup marker, and heartbeat", async () => {
    const db = admin.firestore();

    // Exactly one alert was stored (run 1); the rerun stored nothing.
    const alerts = await db.collection("alerts").get();
    assert.equal(alerts.size, 1);

    // The quake is marked sent so future runs skip it.
    const marker = await db.collection("sent_alerts").doc(kuji.id).get();
    assert.ok(marker.exists);
    assert.equal(marker.data().sent, true);

    // The heartbeat reflects the latest (quiet) run, proving it always writes.
    const heartbeat = await db.collection("health").doc("heartbeat").get();
    assert.ok(heartbeat.exists);
    assert.equal(heartbeat.data().status, "no_quakes");
    assert.equal(heartbeat.data().found, 0);
  });
});
