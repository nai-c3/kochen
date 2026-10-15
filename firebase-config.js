// Firebase-Zugangsdaten der Web-App. Diese Werte sind nicht geheim (sie stehen in jeder
// Firebase-Web-App im Browser); geschützt wird über das Familien-Passwort und firestore.rules.
// Werte aus: Firebase Console → Projekteinstellungen → Allgemein → Meine Apps → SDK-Konfiguration.
export const firebaseConfig = {
  apiKey: "AIzaSyBIa_PBZcjDxRpK3xWD1xvyDl7IZcuPLp4",
  authDomain: "nikikis-kochbuch.firebaseapp.com",
  projectId: "nikikis-kochbuch",
  storageBucket: "nikikis-kochbuch.firebasestorage.app",
  messagingSenderId: "955811460972",
  appId: "1:955811460972:web:16da30f3459b88f4866549",
};

// Das gemeinsame Familienkonto. Muss mit firestore.rules und functions/index.js übereinstimmen.
export const FAMILY_EMAIL = "familie@kochbuch.example";

// Region der Cloud Function (Frankfurt).
export const FUNCTIONS_REGION = "europe-west3";
