const {onRequest} = require("firebase-functions/v2/https");
const {initializeApp} = require("firebase-admin/app");
const {getFirestore} = require("firebase-admin/firestore");
const {onSchedule} = require("firebase-functions/v2/scheduler");
const {defineSecret} = require("firebase-functions/params");

const {createChecker} = require("./checker");
const {authorize, clampRadius} = require("./httpAuth");

// Initialize Firebase
initializeApp();

const db = getFirestore();
const {checkEarthquake, getTodayAlerts} = createChecker(db);

// Shared secret guarding the public HTTP endpoints; provisioned via Secret
// Manager and required as an X-Quake-Token header on each request.
const quakeToken = defineSecret("QUAKE_API_TOKEN");
const httpOpts = {secrets: [quakeToken]};

// New HTTP Triggered Function for Today's Alerts
exports.todayAlerts = onRequest(httpOpts, async (req, res) => {
  if (!authorize(req.get("X-Quake-Token"), quakeToken.value())) {
    res.status(403).send("Forbidden");
    return;
  }

  try {
    const alerts = await getTodayAlerts();

    let alerts_response = "";

    if (alerts.length === 0) {
      alerts_response = "No alerts found for today.";
    } else {
      alerts_response = alerts_response + "Alerts for today:<br/>";
      alerts.forEach((alert) => {
        alerts_response = alerts_response + `Priority: ${alert.priority}<br/>Message: ${alert.message}<br/> <hr>`;
      });
    }


    res.send(alerts_response);
  } catch (error) {
    console.error("Error in todayAlerts function:", error);
    res.status(500).send("Error retrieving today's alerts");
  }
});


// HTTP Triggered Function
exports.earthquakeCheck = onRequest(httpOpts, async (req, res) => {
  if (!authorize(req.get("X-Quake-Token"), quakeToken.value())) {
    res.status(403).send("Forbidden");
    return;
  }

  const latitude = req.query.lat || "35.662139";
  const longitude = req.query.lng || "138.568222";
  // Wide query radius; alertRange gates alerts by magnitude. Clamp user input
  // so a single request cannot pull an unbounded USGS result set.
  const radius = clampRadius(req.query.radius);

  const result = await checkEarthquake(latitude, longitude, radius);
  res.send(result);
});

// Scheduled Function
exports.earthquakeCheckCrontab = onSchedule("*/30 * * * *", async (event) => {
  const latitude = "35.662139";
  const longitude = "138.568222";
  // Wide query radius; alertRange gates alerts by magnitude.
  const radius = "1500";

  const result = await checkEarthquake(latitude, longitude, radius);
  console.log(result);
  return result;
});
