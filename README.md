# Earthquake Alert App

## Description
This application is designed to provide real-time alerts for earthquakes around specific geographic locations. It utilizes data from the USGS Earthquake API and sends notifications based on the severity of the seismic activity. The app ensures that alerts are not duplicated by checking against records in Firestore.

## Features
- Fetches earthquake data from the USGS Earthquake API.
- Determines alert priority based on earthquake magnitude.
- Uses Firestore to track sent alerts, preventing duplicate notifications.
- Custom app icon representing seismic activity and alert status.

## Installation

### Prerequisites
- Node.js
- Firebase account and project
- Firebase Admin SDK (for server-side operations)



### Firebase Configuration
- Set up Firebase Admin SDK with your project's service account key.
- Update Firestore rules to allow necessary read/write operations.

## Usage
Run the application (provide instructions on how to run the app, such as executing a specific script or command).

## Contributing
Contributions to the Earthquake Alert App are welcome. Please ensure to follow the existing code style and submit your pull requests for review.
