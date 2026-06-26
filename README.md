# Earthquake Alert App

## Description
This app sends a push notification when a notable earthquake happens near a
monitored location (Kofu, Yamanashi by default). It is a **near-real-time
digest, not an early-warning system**: a scheduled Cloud Function polls the USGS
Earthquake API roughly every 30 minutes, so an alert reports a quake that has
**already occurred** — usually within minutes, but always after the shaking. It
deduplicates against Firestore so the same quake is never alerted twice.

Each alert leads with the **estimated shindo** (see below), with magnitude,
distance and bearing from the monitored point, and depth as supporting detail. A
deterministic one-line alert always sends; a short AI-written summary follows
when the language model is reachable.

## What is "shindo"?
**Shindo** is the Japan Meteorological Agency (JMA) seismic-intensity scale. It
describes how strongly the ground *shook at a given place* — what you actually
feel — rather than the earthquake's total energy released, which is
**magnitude**. A distant magnitude-7 quake can register a low shindo locally,
while a shallow nearby magnitude-5 can register a high one. The scale runs
0, 1, 2, 3, 4, 5-, 5+, 6-, 6+, 7.

This app currently shows an **estimated** shindo, labelled `est.`, derived from
USGS data (peak ground acceleration) because USGS does not publish JMA
intensity. It is a rough proxy, good to roughly ±0.5 of a band. Sourcing the
**real** JMA shindo from a Japan-native feed (e.g. P2PQuake) is planned, and
will replace the estimate for Japanese quakes.

## Features
- Polls the USGS Earthquake API on a schedule and reports recent quakes near the
  monitored location.
- Leads each alert with an estimated JMA shindo; magnitude, distance, bearing,
  and depth follow.
- Scales the alert radius by magnitude, so big distant quakes still notify while
  small distant ones stay quiet.
- Delivers felt-but-minor quakes audibly, so a nighttime alert is never silently
  dropped.
- Sends a guaranteed deterministic alert first, then an optional AI summary — the
  notification never depends on the AI being up.
- Tracks sent alerts in Firestore to prevent duplicate notifications.

## Installation

### Prerequisites
- Node.js (version 22, matching the Cloud Functions runtime)
- Firebase account and project
- Firebase Admin SDK (for server-side operations)

### Firebase Configuration
- Set up Firebase Admin SDK with your project's service account key.
- Update Firestore rules to allow necessary read/write operations.

## Usage
The app runs as Firebase Cloud Functions (see `functions/`). Common commands,
run from the `functions/` directory:

- `npm test` — run the unit suite.
- `npm run test:gate` — run the emulator integration gate (Node 22).
- `npm run serve` — run the functions locally in the Firebase emulator.
- `npm run deploy` — deploy the functions to Firebase.

## Contributing
Contributions to the Earthquake Alert App are welcome. Please ensure to follow
the existing code style and submit your pull requests for review.
