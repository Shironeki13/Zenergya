// Import the functions you need from the SDKs you need
import { initializeApp, getApps, getApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyDBNZu4OZVqAQNY07FbGU5jDIQqWm4Plcg",
  authDomain: "zenergy-f8276.firebaseapp.com",
  projectId: "zenergy-f8276",
  storageBucket: "zenergy-f8276.firebasestorage.app",
  messagingSenderId: "105631849496",
  appId: "1:105631849496:web:ba5d073bee98e99b9bf76d",
  measurementId: "G-MHF0K9NRFP"
};

// Initialize Firebase
const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();
const db = getFirestore(app);

export { db };
