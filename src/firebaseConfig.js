// Firebase 설정
import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';

// Firebase 설정
// ⚠️ 반드시 Firebase 콘솔에 표시된 설정값을 그대로 사용해야 합니다.
// 특히 storageBucket 은 보통 "<projectId>.appspot.com" 형식입니다.
const firebaseConfig = {
  apiKey: "AIzaSyA-9lJU40kkicjT7-HLVxhkUrqMKMwBtek",
  authDomain: "learning-log-be16a.firebaseapp.com",
  projectId: "learning-log-be16a",
  // Firebase 콘솔에 표시되는 기본 버킷 이름으로 수정
  storageBucket: "learning-log-be16a.appspot.com",
  messagingSenderId: "4739118094",
  appId: "1:4739118094:web:08014a5113b6069d68f85f"
};

// Firebase 초기화
const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);
export const googleProvider = new GoogleAuthProvider();

