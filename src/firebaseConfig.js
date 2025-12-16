// Firebase 설정
import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';

// Firebase 설정
// ⚠️ storageBucket 은 Firebase 콘솔에서 제공하는 형식(보통 "<projectId>.appspot.com")을 사용해야
// Firebase Storage 업로드가 정상 동작합니다.
const firebaseConfig = {
  apiKey: "AIzaSyA-9lJU40kkicjT7-HLVxhkUrqMKMwBtek",
  authDomain: "learning-log-be16a.firebaseapp.com",
  projectId: "learning-log-be16a",
  // Firebase 콘솔의 기본 버킷 도메인 형식으로 수정
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

