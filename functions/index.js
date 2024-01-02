/* eslint-disable require-jsdoc */
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
    let alertPriority = -1;
    const earthquakeData = [];
    if (data.features && data.features.length > 0) {
      for (const earthquake of data.features) {
        const earthquakeInfo = earthquake.properties;
        const earthquakeId = earthquake.id; // Unique ID for the earthquake

        // Check if an alert for this earthquake ID has already been sent
        const isAlertSent = await checkIfAlertSent(earthquakeId);
        if (isAlertSent) {
          continue; // Skip this earthquake as an alert has already been sent
        }


        // console.log(earthquakeInfo.title);
        switch (true) {
          case (earthquakeInfo.mag >= 5.0 && earthquakeInfo.mag < 6.0):
            if (alertPriority < 0) {
              alertPriority = 0;
            }
            break;
          case (earthquakeInfo.mag >= 6.0 && earthquakeInfo.mag < 8.0):
            if (alertPriority < 1) {
              alertPriority = 1;
            }

            break;
          case (earthquakeInfo.mag >= 8.0):
            if (alertPriority < 2) {
              alertPriority = 2;
            }
            break;
        }
        earthquakeData.push(earthquake);
      }

      if (earthquakeData.length == 0) {
        return "No new earthquakes detected.";
      }

      console.log(earthquakeData.length);
      const message = await manufactureAlert(JSON.stringify(earthquakeData));

      await sendAlert(message, alertPriority);

      // Mark all earthquakes as having sent an alert
      for (const earthquake of earthquakeData) {
        const earthquakeId = earthquake.id;
        await markAlertAsSent(earthquakeId, earthquake);
      }

      return message;
    } else {
      return "No significant earthquakes detected.";
    }
  } catch (error) {
    console.error("Error checking for earthquakes:", error);
    return "Error occurred while checking for earthquakes.";
  }
}


// Function to send Pushover alert
async function manufactureAlert(data) {
  const summary = await getAISummary(data);
  return summary;
}

// Function to send Pushover alert
async function sendAlert(message, priority) {
  const pushoverConfig = {
    token: process.env.PUSHOVER_TOKEN, // Replace with your Pushover API token
    user: process.env.PUSHOVER_USER, // Replace with your Pushover user key
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
    throw error; // You can decide to handle this differently
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
    throw error; // You can decide to handle this differently
  }
}

// HTTP Triggered Function
exports.earthquakeCheck = onRequest(async (req, res) => {
  // Default values or use query parameters
  // 37.350; 136.933
  const latitude = req.query.lat || "35.662139";
  const longitude = req.query.lng || "138.568222";
  const radius = req.query.radius || "100";

  const result = await checkEarthquake(latitude, longitude, radius);
  res.send(result);
});

exports.earthquakeCheckCrontab = onSchedule("0 */1 * * *", async (event) => {
  // Default values or use query parameters
  const latitude = "35.662139";
  const longitude = "138.568222";
  const radius = "100";

  const result = await checkEarthquake(latitude, longitude, radius);
  console.log(result);
  return result;
});
