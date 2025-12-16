// Firebase 설정
import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';

// Firebase 설정 (실제 프로젝트의 설정값으로 교체해야 합니다)
const firebaseConfig = {
  apiKey: "AIzaSyA-9lJU40kkicjT7-HLVxhkUrqMKMwBtek",
  authDomain: "learning-log-be16a.firebaseapp.com",
  projectId: "learning-log-be16a",
  storageBucket: "learning-log-be16a.firebasestorage.app",
  messagingSenderId: "4739118094",
  appId: "1:4739118094:web:08014a5113b6069d68f85f"
};

// Firebase 초기화
const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);
export const googleProvider = new GoogleAuthProvider();

