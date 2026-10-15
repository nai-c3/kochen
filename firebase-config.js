// Firebase-Zugangsdaten der Web-App. Diese Werte sind nicht geheim (sie stehen in jeder
// Firebase-Web-App im Browser); geschützt wird über das Familien-Passwort und firestore.rules.
// Werte aus: Firebase Console → Projekteinstellungen → Allgemein → Meine Apps → SDK-Konfiguration.
export const firebaseConfig = {
  apiKey: "HIER_EINTRAGEN",
  authDomain: "HIER_EINTRAGEN.firebaseapp.com",
  projectId: "HIER_EINTRAGEN",
  storageBucket: "HIER_EINTRAGEN.appspot.com",
  messagingSenderId: "HIER_EINTRAGEN",
  appId: "HIER_EINTRAGEN",
};

// Das gemeinsame Familienkonto. Muss mit firestore.rules und functions/index.js übereinstimmen.
export const FAMILY_EMAIL = "familie@kochbuch.example";

// Region der Cloud Function (Frankfurt).
export const FUNCTIONS_REGION = "europe-west3";
