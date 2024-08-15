const {onRequest} = require("firebase-functions/v2/https");
const {initializeApp} = require("firebase-admin/app");
const {getFirestore} = require("firebase-admin/firestore");
const {onSchedule} = require("firebase-functions/v2/scheduler");

const axios = require("axios");
const Pushover = require("pushover-notifications");
const {getAISummary} = require("./ai");

// Initialize Firebase
initializeApp();

const db = getFirestore();

// Function to check for earthquakes with parameters
async function checkEarthquake(latitude, longitude, radius) {
  const url = `https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&latitude=${latitude}&longitude=${longitude}&maxradiuskm=${radius}`;
  console.log(url);
  try {
    const response = await axios.get(url);
    const data = response.data;
    const earthquakeData = [];

    if (data.features && data.features.length > 0) {
      for (const earthquake of data.features) {
        const earthquakeInfo = earthquake.properties;
        const earthquakeId = earthquake.id;

        // Check if an alert for this earthquake ID has already been sent
        const isAlertSent = await checkIfAlertSent(earthquakeId);
        if (isAlertSent) {
          continue; // Skip this earthquake as an alert has already been sent
        }

        // Determine alert priority based on magnitude and depth
        const alertPriority = determineAlertPriority(earthquakeInfo.mag, earthquakeInfo.depth);

        if (alertPriority >= 0) {
          earthquakeData.push({...earthquake, alertPriority});
        }
      }

      if (earthquakeData.length == 0) {
        return "No new significant earthquakes detected.";
      }

      console.log(`${earthquakeData.length} new significant earthquakes detected.`);
      const message = await manufactureAlert(JSON.stringify(earthquakeData));

      // Send alerts for each priority level
      for (let priority = 2; priority >= 0; priority--) {
        const priorityEarthquakes = earthquakeData.filter(eq => eq.alertPriority === priority);
        if (priorityEarthquakes.length > 0) {
          await sendAlert(message, priority);
        }
      }

      // Mark all earthquakes as having sent an alert
      for (const earthquake of earthquakeData) {
        await markAlertAsSent(earthquake.id, earthquake);
      }

      return message;
    } else {
      return "No earthquakes detected.";
    }
  } catch (error) {
    console.error("Error checking for earthquakes:", error);
    return "Error occurred while checking for earthquakes.";
  }
}

// Function to determine alert priority based on magnitude and depth
function determineAlertPriority(magnitude, depth) {
  if (magnitude >= 8.0) return 2;
  if (magnitude >= 7.0) return 2;
  if (magnitude >= 6.0) return 1;
  if (magnitude >= 5.0 && depth < 70) return 1; // Shallow earthquakes are more likely to be felt
  if (magnitude >= 4.5 && depth < 30) return 0; // Very shallow earthquakes can be significant even at lower magnitudes
  return -1; // No alert for smaller earthquakes
}

// Function to generate alert message
async function manufactureAlert(data) {
  const summary = await getAISummary(data);
  return summary;
}

// Function to send Pushover alert
async function sendAlert(message, priority) {
  const pushoverConfig = {
    token: process.env.PUSHOVER_TOKEN,
    user: process.env.PUSHOVER_USER,
  };

  // Initialize Pushover
  const pushover = new Pushover(pushoverConfig);
  const msg = {
    message: message,
    html: 1,
    priority: priority,
  };
  if (priority > 1) {
    msg.expire = 3600;
    msg.retry = 180;
  }
  console.log(msg);
  pushover.send(msg, (err, result) => {
    if (err) {
      console.error("Error sending alert:", err);
    } else {
      console.log("Alert sent:", result);
    }
  });
}

// Function to check if an alert has already been sent for a given earthquake ID
async function checkIfAlertSent(earthquakeId) {
  try {
    const doc = await db.collection("sent_alerts").doc(earthquakeId).get();
    return doc.exists;
  } catch (error) {
    console.error("Error checking alert status:", error);
    throw error;
  }
}

// Function to mark an earthquake ID as having sent an alert
async function markAlertAsSent(earthquakeId, earthquake) {
  try {
    earthquake.sent = true;
    await db.collection("sent_alerts").doc(earthquakeId).set(earthquake);
    console.log(`Alert marked as sent for earthquake ID: ${earthquakeId}`);
  } catch (error) {
    console.error("Error marking alert as sent:", error);
    throw error;
  }
}

// HTTP Triggered Function
exports.earthquakeCheck = onRequest(async (req, res) => {
  const latitude = req.query.lat || "35.662139";
  const longitude = req.query.lng || "138.568222";
  const radius = req.query.radius || "500"; // Increased default radius

  const result = await checkEarthquake(latitude, longitude, radius);
  res.send(result);
});

// Scheduled Function
exports.earthquakeCheckCrontab = onSchedule("*/30 * * * *", async (event) => {
  const latitude = "35.662139";
  const longitude = "138.568222";
  const radius = "500"; // Increased radius

  const result = await checkEarthquake(latitude, longitude, radius);
  console.log(result);
  return result;
});
