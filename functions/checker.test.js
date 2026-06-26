// ABOUTME: Unit tests for checker.js pure helpers — the USGS query/time window
// ABOUTME: and the JST "today" boundary, all independent of Firestore.

const {test} = require("node:test");
const assert = require("node:assert/strict");

const {
  buildQueryUrl,
  recentWindowStart,
  startOfTodayTokyo,
  pushoverPriorityFor,
  REQUEST_TIMEOUT_MS,
} = require("./checker");

test("buildQueryUrl builds the geojson query with a start time", () => {
  const url = buildQueryUrl({
    base: "https://earthquake.usgs.gov",
    latitude: "35.662139",
    longitude: "138.568222",
    radius: "1500",
    startTime: "2026-06-25T10:00:00.000Z",
  });
  assert.equal(
      url,
      "https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson" +
      "&latitude=35.662139&longitude=138.568222&maxradiuskm=1500" +
      "&starttime=2026-06-25T10:00:00.000Z",
  );
});

test("recentWindowStart returns an ISO string two hours before now", () => {
  const now = new Date("2026-06-25T12:00:00.000Z");
  assert.equal(recentWindowStart(now), "2026-06-25T10:00:00.000Z");
});

test("startOfTodayTokyo is JST midnight (15:00 UTC the prior day)", () => {
  // 09:00 JST on Jun 25 -> the JST day is Jun 25, whose midnight is
  // 2026-06-24T15:00Z.
  const morning = new Date("2026-06-25T00:00:00.000Z");
  assert.equal(
      startOfTodayTokyo(morning).toISOString(),
      "2026-06-24T15:00:00.000Z",
  );
});

test("startOfTodayTokyo rolls to the next JST day after 15:00 UTC", () => {
  // 16:00 UTC is 01:00 JST on Jun 26, so "today" starts 2026-06-25T15:00Z.
  const evening = new Date("2026-06-25T16:00:00.000Z");
  assert.equal(
      startOfTodayTokyo(evening).toISOString(),
      "2026-06-25T15:00:00.000Z",
  );
});

test("REQUEST_TIMEOUT_MS bounds the USGS request", () => {
  assert.ok(Number.isInteger(REQUEST_TIMEOUT_MS));
  assert.ok(REQUEST_TIMEOUT_MS > 0);
});

test("pushoverPriorityFor raises a felt quake to the audible floor", () => {
  // Internal priority 0 (felt) must not arrive as a silenceable Pushover 0.
  assert.equal(pushoverPriorityFor(0), 1);
});

test("pushoverPriorityFor passes high and emergency priorities through", () => {
  // 1 stays high; 2 stays emergency (notify.js adds retry/expire for >1).
  assert.equal(pushoverPriorityFor(1), 1);
  assert.equal(pushoverPriorityFor(2), 2);
});
