/**
 * Import function triggers from their respective submodules:
 *
 * const {onCall} = require("firebase-functions/v2/https");
 * const {onDocumentWritten} = require("firebase-functions/v2/firestore");
 *
 * See a full list of supported triggers at https://firebase.google.com/docs/functions
 */

// Make sure 'onRequest' is imported
const {onRequest} = require("firebase-functions/v2/https");
// Define and export an HTTP function
exports.myApiEndpoint = onRequest((request, response) => {
  response.send("Hello from your API!");
});

const {logger} = require("firebase-functions");

exports.anotherFunction = onRequest((request, response) => {
  logger.info("Function 'anotherFunction' was called!"); // Using the logger
  logger.warn("This is a warning message."); // Another example
  response.send("Function executed!");
});


const {setGlobalOptions} = require("firebase-functions");

// Then you can use it:
setGlobalOptions({maxInstances: 10});


// });
