// Import the functions you need from the SDKs you need
import { initializeApp, getApps, getApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";
import { getAuth } from "firebase/auth";

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyDBNZu4OZVqAQNY07FbGU5jDIQqWm4Plcg",
  authDomain: "zenergy-f8276.firebaseapp.com",
  projectId: "zenergy-f8276",
  storageBucket: "zenergy-f8276.appspot.com",
  messagingSenderId: "105631849496",
  appId: "1:105631849496:web:ba5d073bee98e99b9bf76d",
  measurementId: "G-MHF0K9NRFP"
};

// Initialize Firebase
const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();
let db: any;
try {
  db = getFirestore(app);
} catch (e) {
  console.warn("Firebase Firestore not initialized (likely on server):", e);
}

let storage: any;
try {
  storage = getStorage(app);
} catch (e) {
  console.warn("Firebase Storage not initialized (likely on server):", e);
}

let auth: any;
try {
  auth = getAuth(app);
} catch (e) {
  console.warn("Firebase Auth not initialized (likely on server):", e);
}

export { db, storage, auth };
