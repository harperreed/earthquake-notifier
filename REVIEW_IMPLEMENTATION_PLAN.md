<!-- ABOUTME: Phased TDD implementation plan to remediate the 14-reviewer audit. -->
<!-- ABOUTME: Each phase has a verification gate; stop for approval between phases. -->

# earthquake-notifier — Review Remediation Plan

Derived from the 14-reviewer squad audit (2026-06-25). Finding IDs below map to
the consolidated report: **C#** = critical, **I#** = important, **M** = minor.

## Ground rules

- **TDD throughout.** RED (failing test) → GREEN (minimal fix) → refactor. The
  project already has `node --test` wired (`package.json`) and `alertRange.test.js`
  as precedent.
- **Branch per phase.** Work on `fix/review-phaseN-<topic>`, PR back to `main`.
  No work directly on `main`.
- **Phased execution.** Max 5 files per phase. **Complete a phase, run the full
  verification gate, and get explicit approval before starting the next.**
- **No mocks.** Real USGS (historical fixtures are deterministic), Firestore
  emulator (already configured, port 8080), Pushover test-mode token (`token=a`).
- Each phase's gate must be **pristine**: tests green, lint clean for touched files.

## Decisions needed before we start (do not block Phase 0–1)

1. **OpenAI proxy (C7).** Keep the Cloud Run proxy but make it an env var with a
   fallback to `api.openai.com`, OR drop it and go direct with Secret Manager?
2. **Shindo scale (Product).** Add an estimated JMA shindo (震度) alongside/instead
   of magnitude? There is no exact USGS→shindo conversion; it needs an
   intensity model (e.g. PGA→JMA instrumental intensity). Scope decision.
3. **"Real-time" framing (Product).** Reframe to an honest "post-event digest,"
   or invest in lower-latency ingest (USGS `updatedafter`/stream)? JMA EEW is a
   separate architecture and out of scope unless you want it.
4. **Alert language (Product).** English-only, or add Japanese for family?

---

## Phase 0 — Safety net (tests before fixes)

**Goal:** lock current behavior so Phase 1+ changes are provably safe. No prod code changes.

**Findings:** Test gaps (C/Test #3–6, I/Test #7–12).

**Files:** `functions/distance.test.js`, `functions/priority.test.js`,
`functions/fixtures/kuji-m69-2026-06-24.json`, `functions/package.json` (coverage script).

**Steps:**
1. Add a live-USGS fixture for the Kuji M6.9 (the quake that started this) and a
   unit test asserting `calculateDistance(Kofu, Kuji) ≈ 600 km`.
2. Characterization tests for `determineAlertPriority` — one per branch, boundary
   values at `depth=70`, `depth=30`, `mag=5.0/4.5`.
3. Wire `node --test --experimental-test-coverage` (Node 18.19+) into `test`.

**Gate:** `cd functions && npm test` green; new tests cover `calculateDistance` +
`determineAlertPriority` fully.

---

## Phase 1 — CRITICAL correctness (pure logic, high-leverage, low-risk)

**Goal:** stop shipping wrong numbers. All changes are unit-testable pure functions.

**Findings:** **C1** estimatePGA args, **C2** PGA formula, **I10** double-stringify,
**I18** priority-loop return overwrite, **I17** alert-gate contradiction.

**Files:** `functions/index.js`, `functions/ai.js`, `functions/pga.test.js`,
`functions/index.test.js` (new), `functions/alertRange.js` (+ its test).

**Steps (RED→GREEN each):**
1. **C1+C2:** Write failing tests for `estimatePGA` with a known mag/distance/depth →
   expected PGA. Fix the signature to `estimatePGA(magnitude, distanceKm, depthKm)`,
   use real `depth` in `R = sqrt(dist² + depth²)`, and switch to base-10
   (`Math.log10` / `Math.pow(10, …)`) to match the Boore-Atkinson constants. Update
   the call site `index.js:98`.
3. **I10:** Test that `getAISummary` receives parseable JSON. Pass the raw array
   (drop the `JSON.stringify` at `index.js:124`); keep the single stringify in `ai.js:6`.
4. **I18:** Track the highest-priority message separately so the return value isn't
   overwritten by the P0 alert (loop 0→2 or capture separately).
5. **I17:** Reconcile `alertRange` M4.5/300 km with `determineAlertPriority`'s
   `depth<30` — align thresholds or document the intended seam with a test.
6. **C3 prompt prep:** delete the `"just make up a story"` line (`ai.js:34`) and fix
   the backwards "Yamanashi as the epicenter" wording (`ai.js:28`). (Behavioral AI
   resilience lands in Phase 2.)

**Gate:** full `npm test` green incl. new PGA + index tests; lint clean on touched files.

---

## Phase 2 — CRITICAL alert delivery + AI hot-path resilience

**Goal:** a real quake always produces a notification, even if OpenAI is down.

**Findings:** **C3** fabrication, **C5** fire-and-forget send, **C6** silent failure,
**I11** send/mark ordering, **I19** max_tokens/timeout, **C/Reliab** LLM SPOF.

**Files:** `functions/index.js`, `functions/ai.js`, `functions/alertMessage.js` (new,
deterministic one-liner), `functions/alertMessage.test.js`, `functions/notify.js` (new, promisified Pushover).

**Steps:**
1. **🚙 Jimny pattern (fixes C5 + LLM SPOF at once):** build a deterministic
   plain-text one-liner (`M5.8 · 23km NW Kofu · depth 12km · P1`) and **send it
   first**. Then attempt the AI summary as an optional follow-up. If the LLM throws,
   the human already got the alert.
2. **C5:** Promisify `pushover.send` and actually `await` it in `sendAlert`; surface
   failures to the caller.
3. **AI resilience:** wrap `getAISummary` in try/catch; add `OPENAI_MODEL` default;
   set `max_tokens` (Pushover ~1024 char cap) and a request timeout.
4. **C6:** return a structured `{status, found, sent, error}` from `checkEarthquake`;
   on any dependency failure send a **separate admin Pushover**; write a heartbeat doc.
5. **I11:** mark-as-sent only after confirmed delivery; batch the marks.

**Gate:** emulator integration test — simulate LLM failure, assert the plain-text
alert still sends and an admin alert fires; assert no duplicate on re-run.

---

## Phase 3 — CRITICAL security / infra / deploy

**Goal:** deployable on a supported runtime; endpoints and DB not wide open.

**Findings:** **C9** Node 18 EOL, **C8** unauth endpoints + no rules, **C7** proxy,
**I20** stale deps, secrets→Secret Manager.

**Files:** `functions/package.json`, `firestore.rules` (new), `firestore.indexes.json`
(new), `firebase.json`, `functions/index.js`/`functions/ai.js` (auth + proxy env).

**Steps:**
1. **C9:** bump `engines.node` → 22; add `.nvmrc`; redeploy-test.
2. **C8:** add `firestore.rules` (`allow read, write: if false;` — Admin SDK bypasses);
   register rules + a composite index for `alerts(timestamp)` in `firebase.json`;
   add App Check or a secret header to `earthquakeCheck`; clamp `radius`.
3. **C7 (per decision #1):** move `openai.baseURL` to `process.env.OPENAI_BASE_URL`
   with a fallback; move secrets to `defineSecret()` / Secret Manager.
4. **I20:** bump `axios` (CVEs), `firebase-admin`, `firebase-functions`, `openai`;
   re-run tests.

**Gate:** `firebase deploy --only functions` dry-run/build succeeds on Node 22;
rules + index files present and referenced; `npm test` green.

---

## Phase 4 — IMPORTANT efficiency + Firestore correctness

**Findings:** **I13** USGS time window, **I14** batch dedup reads, **I16** JST boundary,
**I12** axios timeout/retry/status, **I15** composite index (verify), `maxInstances:1`,
serverTimestamp, TTL.

**Files:** `functions/index.js`, `functions/usgs.js` (new, fetch+parse), `firebase.json`
(TTL/index), `functions/index.test.js`.

**Steps:** add `&starttime=<now-2h>` to the USGS query; `Promise.all`/`getAll` for dedup;
compute the "today" boundary in JST + `timeZone:"Asia/Tokyo"` on the scheduler; axios
timeout + status check; `maxInstances:1`; `FieldValue.serverTimestamp()`; TTL field on
`sent_alerts`.

**Gate:** emulator test proves dedup batch works and JST boundary is correct; a busy-day
fixture runs in <10s.

---

## Phase 5 — Product redesign (decision-driven)

**Findings (persona consensus):** shindo scale, action guidance, terse format,
priority mapping (**I21** felt M4.5 → audible), README "real-time" reframe, JA language.

**Files:** `functions/shindo.js` (new) + test, `functions/alertMessage.js`, `functions/ai.js`,
`README.md`.

**Steps (gated on decisions #2–4):** estimate JMA shindo from PGA and lead with it;
add a one-line action ("No action needed" / "Aftershocks likely" / "Take cover");
bump felt quakes to Pushover priority ≥1; rewrite the README to describe a post-event
digest; optional Japanese output.

**Gate:** sample alerts reviewed by you for format + tone; shindo unit tests green.

---

## Phase 6 — MINOR cleanup

Dead deps (`node-pushover`, `firebase-functions-test`); ABOUTME headers on
`index.js`/`ai.js`; clear the 28 lint errors + `ecmaVersion`→2021; remove dead code
(`api.dud.org`, commented logger, empty `manufactureAlert`, no-op spread, redundant
priority branch); `firebase-functions/logger`; USGS id `/` sanitization; CI workflow.

**Gate:** `npm run lint` clean (0 errors); `npm test` green; predeploy lint re-enabled.

---

## Suggested order

Phase 0 → **1** (biggest correctness win) → **2** (never-miss-an-alert) → 3 (deploy/security)
→ 4 (efficiency) → 5 (product, after decisions) → 6 (cleanup). Phases 0–2 are pure
backend correctness with no open decisions — we can start immediately.
