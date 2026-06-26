// ABOUTME: Emulator gate proving the Firestore rules deny direct client access
// ABOUTME: while the Admin SDK used by Cloud Functions still reads and writes.

const {test, before, after} = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const admin = require("firebase-admin");

const PROJECT = "demo-quake";
// Its own collection so this gate never collides with checker.gate.js, which
// runs against the same shared emulator and counts the alerts it writes.
const PROBE_PATH = "ruleprobe/probe";

let app;
let db;

before(async () => {
  // Firestore is provided by `firebase emulators:exec`, which sets
  // FIRESTORE_EMULATOR_HOST so the admin SDK connects to the local emulator.
  app = admin.initializeApp({projectId: PROJECT});
  db = admin.firestore();
});

after(async () => {
  if (app) await app.delete();
});

/**
 * Issues a plain, unauthenticated GET against the emulator REST API. Unlike the
 * privileged Admin SDK, such a request is subject to the security rules.
 * @param {string} docPath The document path beneath .../documents.
 * @return {Promise<number>} The HTTP status code of the response.
 */
function restStatus(docPath) {
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  const url = `http://${host}/v1/projects/${PROJECT}` +
      `/databases/(default)/documents/${docPath}`;
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      res.resume();
      resolve(res.statusCode);
    }).on("error", reject);
  });
}

test("Firestore rules deny clients but not the Admin SDK", async (t) => {
  await t.test("Admin SDK reads its own write (bypasses rules)", async () => {
    await db.doc(PROBE_PATH).set({ok: true});
    const snap = await db.doc(PROBE_PATH).get();
    assert.equal(snap.exists, true);
  });

  await t.test("an unauthenticated client read is denied", async () => {
    const status = await restStatus(PROBE_PATH);
    assert.equal(status, 403);
  });
});
