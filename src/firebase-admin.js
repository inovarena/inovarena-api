const admin = require('firebase-admin');

let serviceAccount;

if (process.env.SERVICE_ACCOUNT_KEY) {
  try {
    serviceAccount = JSON.parse(process.env.SERVICE_ACCOUNT_KEY);
    console.log('SERVICE_ACCOUNT_KEY carregado do ambiente. project_id:', serviceAccount.project_id);
  } catch (e) {
    console.error('Erro ao fazer parse do SERVICE_ACCOUNT_KEY:', e.message);
    process.exit(1);
  }
} else {
  console.log('SERVICE_ACCOUNT_KEY não encontrado, usando arquivo local.');
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