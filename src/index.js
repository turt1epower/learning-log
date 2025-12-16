import { auth, googleProvider } from './firebaseConfig.js';
import { signInWithPopup } from 'firebase/auth';
import { getFirestore, doc, setDoc, getDoc, updateDoc } from 'firebase/firestore';
import { db } from './firebaseConfig.js';

// 로그인 버튼 이벤트
document.getElementById('studentLogin').addEventListener('click', () => {
    login('student');
});

document.getElementById('teacherLogin').addEventListener('click', () => {
    login('teacher');
});

async function login(role) {
    try {
        const result = await signInWithPopup(auth, googleProvider);
        const user = result.user;
        
        // 사용자 정보를 Firestore에 저장
        const userRef = doc(db, 'users', user.uid);
        const userSnap = await getDoc(userRef);
        
        if (!userSnap.exists()) {
            // 새 사용자인 경우
            await setDoc(userRef, {
                email: user.email,
                displayName: user.displayName,
                photoURL: user.photoURL,
                role: role,
                createdAt: new Date()
            });
            console.log('새 사용자 생성, 역할:', role);
        } else {
            // 기존 사용자의 역할 강제 업데이트
            await updateDoc(userRef, {
                role: role
            });
            console.log('기존 사용자 역할 업데이트:', role);
        }
        
        // 역할이 제대로 저장되었는지 확인 (최대 3번 재시도)
        let retryCount = 0;
        let roleUpdated = false;
        while (retryCount < 3 && !roleUpdated) {
            await new Promise(resolve => setTimeout(resolve, 300));
            const updatedSnap = await getDoc(userRef);
            if (updatedSnap.exists() && updatedSnap.data().role === role) {
                roleUpdated = true;
                console.log('역할 저장 확인 완료:', role);
            } else {
                retryCount++;
                console.log('역할 저장 확인 재시도:', retryCount);
            }
        }
        
        if (!roleUpdated) {
            console.warn('역할 저장 확인 실패, 하지만 계속 진행합니다.');
        }
        
        // 역할에 따라 페이지 이동
        if (role === 'student') {
            window.location.href = '/student.html';
        } else if (role === 'teacher') {
            window.location.href = '/teacherMonitor.html';
        }
    } catch (error) {
        console.error('로그인 오류:', error);
        const statusEl = document.getElementById('loginStatus');
        if (statusEl) {
            statusEl.textContent = '로그인에 실패했습니다: ' + error.message;
        }
    }
}

// 이미 로그인된 경우 확인 (초기 로드 시에만 실행)
let isInitialCheck = true;
auth.onAuthStateChanged(async (user) => {
    if (user && isInitialCheck) {
        // 사용자 역할 확인 후 자동 리다이렉트
        try {
            const userRef = doc(db, 'users', user.uid);
            const docSnap = await getDoc(userRef);
            if (docSnap.exists()) {
                const userData = docSnap.data();
                if (userData.role === 'student') {
                    window.location.href = '/student.html';
                } else if (userData.role === 'teacher') {
                    window.location.href = '/teacherMonitor.html';
                }
            }
        } catch (error) {
            console.error('역할 확인 오류:', error);
        }
        isInitialCheck = false; // 한 번만 실행
    }
});

