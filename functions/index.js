const {onRequest} = require("firebase-functions/v2/https");
const {initializeApp} = require("firebase-admin/app");
const {getFirestore} = require("firebase-admin/firestore");
const {onSchedule} = require("firebase-functions/v2/scheduler");

const {createChecker} = require("./checker");

// Initialize Firebase
initializeApp();

const db = getFirestore();
const {checkEarthquake, getTodayAlerts} = createChecker(db);

// New HTTP Triggered Function for Today's Alerts
exports.todayAlerts = onRequest(async (req, res) => {
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
exports.earthquakeCheck = onRequest(async (req, res) => {
  const latitude = req.query.lat || "35.662139";
  const longitude = req.query.lng || "138.568222";
  // Wide query radius; alertRange gates alerts by magnitude.
  const radius = req.query.radius || "1500";

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
