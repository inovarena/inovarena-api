const admin = require('firebase-admin');

let serviceAccount;

if (process.env.SERVICE_ACCOUNT_KEY) {
  serviceAccount = JSON.parse(process.env.SERVICE_ACCOUNT_KEY);
} else {
  serviceAccount = require('../serviceAccountKey.json');
}

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}

const auth = admin.auth();
const db = admin.firestore();

module.exports = { admin, auth, db };