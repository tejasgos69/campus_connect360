import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";

const firebaseConfig = {
  apiKey: "AIzaSyBBgVNkVHINeM1bu0KIUtnzoVQDAqXty2w",
  authDomain: "campusconnect360-768e1.firebaseapp.com",
  projectId: "campusconnect360-768e1",
  storageBucket: "campusconnect360-768e1.firebasestorage.app",
  messagingSenderId: "23321634204",
  appId: "1:23321634204:web:08686edcf231b66d955459",
  measurementId: "G-25RB51SK94"
};

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();

export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);

export default app;
