const {onRequest} = require("firebase-functions/v2/https");
const {initializeApp} = require("firebase-admin/app");
const {getFirestore} = require("firebase-admin/firestore");
const {onSchedule} = require("firebase-functions/v2/scheduler");

const axios = require("axios");
const Pushover = require("pushover-notifications");
const {getAISummary} = require("./ai");
const {isWithinAlertRange} = require("./alertRange");
const {groupByPriority} = require("./alertGrouping");
const {
  calculateDistance,
  estimatePGA,
  determineAlertPriority,
} = require("./quake");

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
        const [eqLongitude, eqLatitude, depth] =
                    earthquake.geometry.coordinates;

        // Check if an alert for this earthquake ID has already been sent
        const isAlertSent = await checkIfAlertSent(earthquakeId);
        if (isAlertSent) {
          continue; // Skip this earthquake as an alert has already been sent
        }

        // Calculate distance from the specified point
        const distance = calculateDistance(
            parseFloat(latitude),
            parseFloat(longitude),
            eqLatitude,
            eqLongitude,
        );

        // Skip quakes too far away to matter for their magnitude. The USGS
        // query is intentionally wide so big distant quakes are returned;
        // this gate keeps small distant quakes from becoming noise.
        if (!isWithinAlertRange(earthquakeInfo.mag, distance)) {
          continue;
        }

        // Determine alert priority based on magnitude and depth
        const alertPriority = determineAlertPriority(
            earthquakeInfo.mag,
            depth,
        );

        const estimatedPGA = estimatePGA(earthquakeInfo.mag, distance, depth);


        if (alertPriority >= 0) {
          earthquakeData.push({
            ...earthquake,
            alertPriority,
            distance_from_kofu: distance,
            calculatedDepth: depth,
            estimatedPGA: estimatedPGA,
          });
        }
      }

      if (earthquakeData.length == 0) {
        return "No new significant earthquakes detected.";
      }

      // Process alerts for each priority bucket, most urgent first, so the
      // returned message reflects the highest-priority alert (not the last).
      const groups = groupByPriority(earthquakeData);
      let message = "";
      for (const group of groups) {
        const alertMessage = await manufactureAlert(group.earthquakes);
        // The first (highest-priority) bucket drives the returned message.
        if (message === "") {
          message = alertMessage;
        }
        await sendAlert(alertMessage, group.priority);
        await storeAlertInFirebase(
            group.earthquakes,
            alertMessage,
            group.priority,
        );
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

// Update the storeAlertInFirebase function to include JMA intensity
async function storeAlertInFirebase(earthquakes, message, priority) {
  try {
    const alertRef = await db.collection("alerts").add({
      timestamp: new Date(),
      message: message,
      priority: priority,
      earthquakes: earthquakes.map((eq) => ({
        ...eq,
        estimatedPGA: eq.estimatedPGA,
      })),
    });
    console.log(`Alert stored in Firebase with ID: ${alertRef.id}`);
  } catch (error) {
    console.error("Error storing alert in Firebase:", error);
  }
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

// Function to get today's alerts
async function getTodayAlerts() {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const alertsSnapshot = await db.collection("alerts")
        .where("timestamp", ">=", today)
        .orderBy("timestamp", "desc")
        .get();

    const alerts = [];
    alertsSnapshot.forEach((doc) => {
      alerts.push({
        id: doc.id,
        ...doc.data(),
        timestamp: doc.data().timestamp.toDate(), // Convert Firestore Timestamp to JS Date
      });
    });

    return alerts;
  } catch (error) {
    console.error("Error fetching today's alerts:", error);
    throw error;
  }
}

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
