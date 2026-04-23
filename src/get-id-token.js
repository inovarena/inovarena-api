const { initializeApp } = require('firebase/app');
const { getAuth, signInWithEmailAndPassword } = require('firebase/auth');

const firebaseConfig = {
  apiKey: "AIzaSyD81vCtOZLGahB4m5BmZR80ClO_p2ndXsQ",
  authDomain: "inovarena-e2ae4.firebaseapp.com",
  projectId: "inovarena-e2ae4",
  storageBucket: "inovarena-e2ae4.firebasestorage.app",
  messagingSenderId: "556921955113",
  appId: "1:556921955113:web:31215a4f2fe79151764d38"
};

const email = 'thaina-iorio@hotmail.com';
const senha = '123456';

async function main() {
  try {
    const app = initializeApp(firebaseConfig);
    const auth = getAuth(app);

    const cred = await signInWithEmailAndPassword(auth, email, senha);
    const token = await cred.user.getIdToken();

    console.log('\nID TOKEN:\n');
    console.log(token);
  } catch (error) {
    console.error('Erro ao gerar idToken:', error.message);
  }
}

main();
