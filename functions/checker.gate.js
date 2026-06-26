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
// The fake USGS feed serves whatever the active test assigns here, so one
// server backs both the single-quake outage test and the busy-day batch test.
let usgsFeatures = [kuji];

before(async () => {
  // USGS catcher: every query returns the currently-configured features.
  usgsServer = http.createServer((req, res) => {
    res.writeHead(200, {"content-type": "application/json"});
    const body = {type: "FeatureCollection", features: usgsFeatures};
    res.end(JSON.stringify(body));
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

    // Shindo leads: the real PGA model puts the far M6.9 at est. shindo 4.
    assert.match(
        terse.message,
        /^est\. shindo 4 · M6\.9 · \d+km \w+ of Kofu · depth 51km · P1$/,
    );
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

    // The alert timestamp is a server-set Timestamp, so the digest range
    // query and .toDate() conversion keep working.
    assert.equal(typeof alerts.docs[0].data().timestamp.toDate, "function");

    // The quake is marked sent so future runs skip it.
    const marker = await db.collection("sent_alerts").doc(kuji.id).get();
    assert.ok(marker.exists);
    assert.equal(marker.data().sent, true);

    // The marker carries a TTL ~30 days out so a Firestore policy can reap
    // it and the dedup collection never grows without bound.
    const expireAt = marker.data().expireAt;
    assert.ok(expireAt, "marker has an expireAt for Firestore TTL");
    const daysOut = (expireAt.toDate().getTime() - Date.now()) / 86400000;
    assert.ok(daysOut > 25 && daysOut < 35, `expireAt ~30d (got ${daysOut})`);

    // The heartbeat reflects the latest (quiet) run, proving it always writes.
    const heartbeat = await db.collection("health").doc("heartbeat").get();
    assert.ok(heartbeat.exists);
    assert.equal(heartbeat.data().status, "no_quakes");
    assert.equal(heartbeat.data().found, 0);
  });
});

test("a busy day dedups every quake through one batched read", async (t) => {
  const busyDay = JSON.parse(
      fs.readFileSync(
          path.join(__dirname, "fixtures", "busy-day-2026-06-24.json"),
          "utf8",
      ),
  );
  // The fixture is 3 qualifying M6+ quakes near Kofu plus 3 sub-M4.5 noise
  // quakes the range gate drops, so exactly 3 alerts and 3 dedup markers.
  usgsFeatures = busyDay;

  await t.test("alerts every qualifying quake in a single run", async () => {
    pushoverMessages.length = 0;
    const result = await checkEarthquake(KOFU_LAT, KOFU_LNG, RADIUS);
    assert.deepEqual(result, {status: "ok", found: 3, sent: 3, error: null});

    // All three share priority 1, so they arrive as one terse alert of three
    // lines, followed by the single AI-degraded admin notice.
    assert.equal(pushoverMessages.length, 2);
    assert.equal(pushoverMessages[0].message.split("<br/>").length, 3);
  });

  await t.test("the rerun dedups all of them, sending nothing", async () => {
    pushoverMessages.length = 0;
    const result = await checkEarthquake(KOFU_LAT, KOFU_LNG, RADIUS);
    assert.deepEqual(result, {
      status: "no_quakes", found: 0, sent: 0, error: null,
    });
    assert.equal(pushoverMessages.length, 0);
  });
});
