const { onRequest } = require("firebase-functions/v2/https");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const { onSchedule } = require("firebase-functions/v2/scheduler");

const axios = require("axios");
const Pushover = require("pushover-notifications");
const { getAISummary } = require("./ai");

// Initialize Firebase
initializeApp();

const db = getFirestore();

// Function to calculate distance between two points using Haversine formula
/**
 * Calculates the distance between two geographic points on the Earth using the Haversine formula.
 * @param {number} lat1 Latitude of the first point in degrees.
 * @param {number} lon1 Longitude of the first point in degrees.
 * @param {number} lat2 Latitude of the second point in degrees.
 * @param {number} lon2 Longitude of the second point in degrees.
 * @returns {number} The distance between the two points in kilometers, rounded to two decimal places.
 */
function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // Radius of the Earth in km
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos((lat1 * Math.PI) / 180) *
            Math.cos((lat2 * Math.PI) / 180) *
            Math.sin(dLon / 2) *
            Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const distance = R * c; // Distance in km
    return Math.round(distance * 100) / 100; // Round to 2 decimal places
}

// Function to estimate Peak Ground Acceleration (PGA) using a simple attenuation relationship
function estimatePGA(magnitude, distance) {
    // This is a simplified version of the Boore-Atkinson (2008) ground motion prediction equation
    // Note: This is still an approximation and should be used cautiously
    const a = 0.03615;
    const b = 0.229;
    const c = -0.00114;
    const d = -0.647;

    const R = Math.sqrt(distance * distance + 30 * 30); // Accounting for depth
    const logPGA = a + b * (magnitude - 6) + c * (magnitude - 6) * (magnitude - 6) + d * Math.log(R);

    return Math.exp(logPGA);
}

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

                // Determine alert priority based on magnitude and depth
                const alertPriority = determineAlertPriority(
                    earthquakeInfo.mag,
                    depth,
                );

                const estimatedPGA = estimatePGA(earthquakeInfo.mag, depth, distance);


                if (alertPriority >= 0) {
                    earthquakeData.push({
                        ...earthquake,
                        alertPriority,
                        distance_from_kofu: distance,
                        calculatedDepth: depth,
                        estimatedPGA: estimatedPGA
                    });
                }
            }

            if (earthquakeData.length == 0) {
                return "No new significant earthquakes detected.";
            }

            let message = "";
            // Process alerts for each priority level
            for (let priority = 2; priority >= 0; priority--) {
                const priorityEarthquakes = earthquakeData.filter(
                    (eq) => eq.alertPriority === priority,
                );
                if (priorityEarthquakes.length > 0) {
                    message = await manufactureAlert(
                        JSON.stringify(priorityEarthquakes),
                    );
                    await sendAlert(message, priority);
                    await storeAlertInFirebase(
                        priorityEarthquakes,
                        message,
                        priority,
                    );
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

// Update the storeAlertInFirebase function to include JMA intensity
async function storeAlertInFirebase(earthquakes, message, priority) {
    try {
        const alertRef = await db.collection("alerts").add({
            timestamp: new Date(),
            message: message,
            priority: priority,
            earthquakes: earthquakes.map(eq => ({
                ...eq,
                estimatedPGA: eq.estimatedPGA
            }))
        });
        console.log(`Alert stored in Firebase with ID: ${alertRef.id}`);
    } catch (error) {
        console.error("Error storing alert in Firebase:", error);
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
    alertsSnapshot.forEach(doc => {
      alerts.push({
        id: doc.id,
        ...doc.data(),
        timestamp: doc.data().timestamp.toDate() // Convert Firestore Timestamp to JS Date
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

    let alerts_response = ""

    if (alerts.length === 0) {
        alerts_response = "No alerts found for today.";
    } else {
        alerts_response = alerts_response + "Alerts for today:<br/>";
        alerts.forEach((alert) => {
            alerts_response = alerts_response + `Priority: ${alert.priority}<br/>Message: ${alert.message}<br/> <hr>`;
        });
    }


    res.send(alerts_response)
  } catch (error) {
    console.error("Error in todayAlerts function:", error);
    res.status(500).send("Error retrieving today's alerts");
  }
});


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
