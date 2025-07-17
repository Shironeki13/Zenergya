// Import the functions you need from the SDKs you need
import { initializeApp, getApps } from "firebase/app";
import { getFirestore } from "firebase/firestore";

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: "zenergy-f8276.firebaseapp.com",
  projectId: "zenergy-f8276",
  storageBucket: "zenergy-f8276.appspot.com",
  messagingSenderId: "105631849496",
  appId: "1:105631849496:web:4b5b76c8c49a5b67a5b6e7"
};

// Initialize Firebase
let app;
if (!getApps().length) {
  app = initializeApp(firebaseConfig);
} else {
  app = getApps()[0];
}

const db = getFirestore(app);

export { db };
