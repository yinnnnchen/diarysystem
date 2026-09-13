// Firebase App
import {
    initializeApp
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-app.js";

// Firebase Authentication
import {
    getAuth,
    GoogleAuthProvider
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";

// Firestore
import {
    getFirestore
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";


const firebaseConfig = {
    apiKey: "AIzaSyCXTsllzRSTazih89fnzQW_OR_TJsFevWA",
    authDomain: "ai-diary-win.firebaseapp.com",
    projectId: "ai-diary-win",
    storageBucket: "ai-diary-win.firebasestorage.app",
    messagingSenderId: "590752964499",
    appId: "1:590752964499:web:371621148a3c9b7791d266"
};


// 初始化 Firebase
const app = initializeApp(firebaseConfig);

// Authentication
const auth = getAuth(app);

// Google Provider
const googleProvider = new GoogleAuthProvider();

// Firestore
const db = getFirestore(app);


export {
    app,
    auth,
    googleProvider,
    db
};