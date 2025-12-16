import { auth, db, storage } from './firebaseConfig.js';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { collection, doc, setDoc, getDoc, getDocs, query, where, orderBy, updateDoc } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, getDay } from 'date-fns';

// 전역 변수
let currentUser = null;
let morningChatCount = 0;
let closingChatCount = 0;
let morningEmotion = null;
let closingEmotion = null;
let isDrawing = false;
let currentTool = 'pen';
let textBoxCounter = 0;
let morningSummaryRequested = false; // 정리 문장 요청 여부
let morningSummaryText = ''; // 학생이 작성한 정리 문장
let closingSummaryRequested = false; // 종례 정리 문장 요청 여부
let closingSummaryText = ''; // 종례 학생이 작성한 정리 문장
let closingSubmitted = false; // 종례 제출 완료 여부 (중복 제출 방지)

// ChatGPT API 호출 함수
async function callChatGPT(messages, systemMessage = null) {
    const apiKey = import.meta.env.VITE_CHATGPT_API_KEY;
    if (!apiKey) {
        throw new Error('ChatGPT API 키가 설정되지 않았습니다. .env 파일에 VITE_CHATGPT_API_KEY를 설정해주세요.');
    }

    const requestMessages = systemMessage 
        ? [{ role: 'system', content: systemMessage }, ...messages]
        : messages;

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
            model: 'gpt-4o-mini',
            messages: requestMessages,
            temperature: 0.7
        })
    });

    if (!response.ok) {
        throw new Error('ChatGPT API 호출 실패');
    }

    const data = await response.json();
    return data.choices[0].message.content;
}

// 인증 상태 확인
onAuthStateChanged(auth, async (user) => {
    if (user) {
        // 사용자 역할 확인
        const userRef = doc(db, 'users', user.uid);
        const userSnap = await getDoc(userRef);
        
        // 교사인 경우 교사 모니터링 페이지로 리다이렉트
        if (userSnap.exists() && userSnap.data().role === 'teacher') {
            window.location.href = '/teacherMonitor.html';
            return;
        }
        
        // 학생인 경우에만 계속 진행
        currentUser = user;
        
        // 프로젝트 폰트 로드 (인증 후에도 실행)
        loadProjectFonts();
        
        // public/image 폴더의 배경 이미지 적용
        applyPublicBackgroundImage();
        
        await loadUserData();
        await loadProfile();
    } else {
        window.location.href = '/index.html';
    }
});

// 프로필 설정 모달
document.getElementById('profileSection').addEventListener('click', () => {
    document.getElementById('profileSettingsModal').style.display = 'flex';
    loadProfile();
});

document.getElementById('closeProfileModal').addEventListener('click', () => {
    document.getElementById('profileSettingsModal').style.display = 'none';
});

// 프로필 로드
async function loadProfile() {
    if (!currentUser) return;
    
    let customName = null;
    let profileEmoji = null;
    
    try {
        const userRef = doc(db, 'users', currentUser.uid);
        const userSnap = await getDoc(userRef);
        
        if (userSnap.exists()) {
            const userData = userSnap.data();
            customName = userData.customName;
            profileEmoji = userData.profileEmoji;
            
            // 모달에 현재 값 설정
            const profileNameInput = document.getElementById('profileNameInput');
            if (profileNameInput) {
                profileNameInput.value = customName || '';
            }
            
            // 교사 피드백 이모지만 가져오기
            const emotionsRef = collection(db, 'students', currentUser.uid, 'emotions');
            const emotionsSnapshot = await getDocs(emotionsRef);
            
            const feedbackEmojis = new Set();
            emotionsSnapshot.forEach(docSnap => {
                const data = docSnap.data();
                // 새로운 구조: feedbacks 배열에서 모든 이모지 수집
                if (Array.isArray(data.feedbacks) && data.feedbacks.length > 0) {
                    data.feedbacks.forEach(feedback => {
                        if (feedback && feedback.emoji) {
                            feedbackEmojis.add(feedback.emoji);
                        }
                    });
                }
                // 기존 구조(단일 teacherEmoji)도 지원
                if (data.teacherEmoji) {
                    feedbackEmojis.add(data.teacherEmoji);
                }
            });
            
            // 이모지 선택 그리드 업데이트
            const emojiGrid = document.querySelector('.emoji-selection-grid');
            if (emojiGrid) {
                emojiGrid.innerHTML = ''; // 기존 이모지 제거
                
                const emojiList = feedbackEmojis.size > 0 ? Array.from(feedbackEmojis) : ['🍇'];
                emojiList.forEach(emoji => {
                    const btn = document.createElement('button');
                    btn.className = 'emoji-option';
                    btn.dataset.emoji = emoji;
                    btn.textContent = emoji;
                    if ((profileEmoji && profileEmoji === emoji) || (!profileEmoji && emoji === '🍇')) {
                        btn.classList.add('selected');
                    }
                    emojiGrid.appendChild(btn);
                });
            }
            
            // 커스텀 이모지 입력 영역 숨기기
            const customEmojiInput = document.getElementById('customProfileEmojiInput');
            const addCustomEmojiBtn = document.getElementById('addCustomProfileEmojiBtn');
            if (customEmojiInput) customEmojiInput.style.display = 'none';
            if (addCustomEmojiBtn) addCustomEmojiBtn.style.display = 'none';
        }
        
        // 이름 표시
        const userNameEl = document.getElementById('userName');
        if (userNameEl) {
            userNameEl.textContent = customName || currentUser.displayName || currentUser.email;
        }
        
        // 프로필 이미지 표시 (기본값: 포도 이모티콘)
        const effectiveEmoji = profileEmoji || '🍇';
        const profileImageEl = document.getElementById('profileImage');
        if (profileImageEl) {
            profileImageEl.textContent = effectiveEmoji;
        }
        
        // 헤더 제목 업데이트 (이름과 프로필 이모티콘 반영)
        const headerTitleEl = document.getElementById('studentHeaderTitle');
        if (headerTitleEl) {
            const displayName = customName || currentUser.displayName || currentUser.email;
            headerTitleEl.textContent = `${effectiveEmoji} ${displayName}의 배움공책`;
        }
    } catch (error) {
        console.error('프로필 로드 오류:', error);
    }
}

// 프로필 저장
document.getElementById('saveProfileBtn').addEventListener('click', async () => {
    if (!currentUser) return;
    
    const customName = document.getElementById('profileNameInput').value.trim();
    const selectedEmoji = document.querySelector('.emoji-option.selected');
    const profileEmoji = selectedEmoji ? selectedEmoji.dataset.emoji : null;
    
    try {
        const userRef = doc(db, 'users', currentUser.uid);
        await updateDoc(userRef, {
            customName: customName || null,
            profileEmoji: profileEmoji || null
        }, { merge: true });
        
        // 화면 업데이트
        const userNameEl = document.getElementById('userName');
        if (userNameEl) {
            userNameEl.textContent = customName || currentUser.displayName || currentUser.email;
        }
        
        const profileImageEl = document.getElementById('profileImage');
        if (profileImageEl) {
            profileImageEl.textContent = profileEmoji || '👤';
        }
        
        // 헤더 제목 업데이트 (이름과 프로필 이모티콘 반영)
        const headerTitleEl = document.getElementById('studentHeaderTitle');
        if (headerTitleEl) {
            const displayName = customName || currentUser.displayName || currentUser.email;
            const emoji = profileEmoji || '📚';
            headerTitleEl.textContent = `${emoji} ${displayName}의 배움공책`;
        }
        
        alert('프로필이 저장되었습니다!');
        document.getElementById('profileSettingsModal').style.display = 'none';
    } catch (error) {
        console.error('프로필 저장 오류:', error);
        alert('프로필 저장 중 오류가 발생했습니다.');
    }
});

// 이모지 선택 (이벤트 위임 사용, 커스텀 추가 제거됨)
document.addEventListener('click', (e) => {
    // 이모지 선택
    if (e.target.closest('.emoji-option')) {
        const btn = e.target.closest('.emoji-option');
        document.querySelectorAll('.emoji-option').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
    }
});

// 로그아웃
document.getElementById('logoutBtn').addEventListener('click', async () => {
    await signOut(auth);
    window.location.href = '/index.html';
});

// 폰트 설정 모달
document.getElementById('fontSettingsBtn').addEventListener('click', () => {
    document.getElementById('fontSettingsModal').style.display = 'flex';
});

document.getElementById('closeFontModal').addEventListener('click', () => {
    document.getElementById('fontSettingsModal').style.display = 'none';
});

// 모달 외부 클릭 시 닫기
document.getElementById('fontSettingsModal').addEventListener('click', (e) => {
    if (e.target.id === 'fontSettingsModal') {
        document.getElementById('fontSettingsModal').style.display = 'none';
    }
});

// 폰트 파일 업로드
document.getElementById('fontFileInput').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    // 파일 형식 확인
    const fileExtension = file.name.split('.').pop().toLowerCase();
    const validExtensions = ['ttf', 'otf', 'woff', 'woff2'];
    
    if (!validExtensions.includes(fileExtension)) {
        alert('지원하지 않는 파일 형식입니다. TTF, OTF, WOFF, WOFF2 파일만 업로드 가능합니다.');
        return;
    }
    
    // 파일을 Data URL로 변환
    const reader = new FileReader();
    reader.onload = (event) => {
        const fontDataUrl = event.target.result;
        
        // 로컬 스토리지에 저장
        localStorage.setItem('customFont', fontDataUrl);
        localStorage.setItem('customFontName', file.name.replace(/\.[^/.]+$/, ''));
        localStorage.setItem('customFontType', fileExtension);
        
        // 폰트 적용
        applyCustomFont(fontDataUrl, file.name.replace(/\.[^/.]+$/, ''), fileExtension);
        
        // 폰트 선택 옵션 업데이트
        document.getElementById('fontSelect').value = 'custom';
        
        alert('폰트가 적용되었습니다!');
    };
    reader.readAsDataURL(file);
});

// 배경 이미지 적용 함수
function applyBackgroundImage(imageUrl) {
    const body = document.body;
    if (body) {
        body.style.backgroundImage = `url('${imageUrl}')`;
        body.style.backgroundSize = 'cover';
        body.style.backgroundPosition = 'center';
        body.style.backgroundRepeat = 'no-repeat';
        body.style.backgroundAttachment = 'fixed';
    }
}

// public/image 폴더의 배경 이미지 적용 함수
function applyPublicBackgroundImage() {
    // public/image 폴더에서 가능한 이미지 파일명 목록 (우선순위 순서)
    const possibleImageNames = [
        'light-purple-check-pattern.png',
        'school-image.png',
        'background.jpg',
        'background.png',
        'background.jpeg',
        'background.gif',
        'background.webp',
        'bg.jpg',
        'bg.png',
        'bg.jpeg',
        'bg.gif',
        'bg.webp'
    ];
    
    // 각 이미지 파일 존재 여부 확인 및 적용
    let checkIndex = 0;
    
    function checkAndApplyImage() {
        if (checkIndex >= possibleImageNames.length) {
            return; // 모든 파일 확인 완료
        }
        
        const imageName = possibleImageNames[checkIndex];
        const imageUrl = `/image/${imageName}`;
        const img = new Image();
        
        img.onload = function() {
            // 이미지가 존재하면 배경으로 적용
            applyBackgroundImage(imageUrl);
        };
        
        img.onerror = function() {
            // 이미지가 없으면 다음 파일 확인
            checkIndex++;
            checkAndApplyImage();
        };
        
        img.src = imageUrl;
    }
    
    // 첫 번째 이미지 확인 시작
    checkAndApplyImage();
}

// 폰트 선택 변경
document.getElementById('fontSelect').addEventListener('change', (e) => {
    if (e.target.value === 'custom') {
        const fontDataUrl = localStorage.getItem('customFont');
        const fontName = localStorage.getItem('customFontName');
        const fontType = localStorage.getItem('customFontType');
        
        if (fontDataUrl && fontName && fontType) {
            // 프로젝트 폰트 제거
            const projectStyle = document.getElementById('projectFontStyle');
            if (projectStyle) projectStyle.remove();
            
            applyCustomFont(fontDataUrl, fontName, fontType);
        } else {
            alert('업로드된 폰트가 없습니다. 먼저 폰트를 업로드해주세요.');
            e.target.value = 'default';
        }
    } else if (e.target.value === 'project') {
        // 프로젝트 폰트 다시 로드
        loadProjectFonts();
    } else {
        // 기본 폰트
        removeCustomFont();
        const projectStyle = document.getElementById('projectFontStyle');
        if (projectStyle) projectStyle.remove();
    }
});

// 커스텀 폰트 적용 함수
function applyCustomFont(fontDataUrl, fontName, fontType) {
    // 기존 폰트 스타일 제거
    const existingStyle = document.getElementById('customFontStyle');
    if (existingStyle) {
        existingStyle.remove();
    }
    
    // 새로운 폰트 스타일 추가
    const style = document.createElement('style');
    style.id = 'customFontStyle';
    
    let fontFormat = '';
    switch(fontType) {
        case 'ttf':
            fontFormat = 'truetype';
            break;
        case 'otf':
            fontFormat = 'opentype';
            break;
        case 'woff':
            fontFormat = 'woff';
            break;
        case 'woff2':
            fontFormat = 'woff2';
            break;
    }
    
    style.textContent = `
        @font-face {
            font-family: '${fontName}';
            src: url('${fontDataUrl}') format('${fontFormat}');
            font-display: swap;
        }
        
        body, * {
            font-family: '${fontName}', 'Malgun Gothic', 'Apple SD Gothic Neo', sans-serif !important;
        }
    `;
    
    document.head.appendChild(style);
    
    // 미리보기 업데이트
    updateFontPreview();
}

// 커스텀 폰트 제거 함수
function removeCustomFont() {
    const existingStyle = document.getElementById('customFontStyle');
    if (existingStyle) {
        existingStyle.remove();
    }
    updateFontPreview();
}

// 폰트 미리보기 업데이트
function updateFontPreview() {
    const preview = document.getElementById('fontPreview');
    if (preview) {
        const computedFont = getComputedStyle(document.body).fontFamily;
        preview.style.fontFamily = computedFont;
        
        // 실제 적용된 폰트 확인 (디버깅용)
        setTimeout(() => {
            const actualFont = getComputedStyle(preview).fontFamily;
            console.log('📝 실제 적용된 폰트:', actualFont);
            
            // 폰트가 실제로 로드되었는지 확인
            if (document.fonts && document.fonts.check) {
                const fontList = actualFont.split(',');
                for (const font of fontList) {
                    const fontName = font.trim().replace(/['"]/g, '');
                    if (fontName && fontName !== 'Malgun Gothic' && fontName !== 'Apple SD Gothic Neo' && fontName !== 'sans-serif') {
                        const isLoaded = document.fonts.check(`16px "${fontName}"`);
                        console.log(`  - ${fontName}: ${isLoaded ? '✅ 로드됨' : '❌ 로드 안됨'}`);
                    }
                }
            }
        }, 1000);
    }
}

// 프로젝트 폰트 설정 파일 로드
async function loadFontConfig() {
    try {
        const response = await fetch('/fonts/fonts.json');
        if (response.ok) {
            const config = await response.json();
            console.log('폰트 설정 파일 로드 성공:', config);
            return config;
        } else {
            console.log('폰트 설정 파일을 찾을 수 없습니다.');
        }
    } catch (e) {
        console.log('폰트 설정 파일 로드 실패:', e);
    }
    return null;
}

// 프로젝트 폴더의 폰트 파일 자동 로드
async function loadProjectFonts() {
    try {
        // 먼저 fonts.json 설정 파일 확인
        const config = await loadFontConfig();
        
        if (config && config.fonts && config.fonts.length > 0) {
            // 설정 파일에서 지정된 폰트들을 순서대로 시도
            for (const font of config.fonts) {
                const fontPath = `/fonts/${font.file}`;
                const fileExtension = font.file.split('.').pop().toLowerCase();
                const fontName = font.name || font.file.replace(/\.[^/.]+$/, '');
                
                console.log('폰트 적용 시도:', fontPath, fontName, fileExtension);
                
                // 폰트 파일 존재 확인 및 Base64로 변환하여 로드
                try {
                    const fontResponse = await fetch(fontPath);
                    if (fontResponse.ok) {
                        console.log('폰트 파일 확인 성공:', fontPath);
                        
                        // 폰트 파일을 Blob으로 변환 후 Base64로 인코딩
                        const fontBlob = await fontResponse.blob();
                        const fontBase64 = await new Promise((resolve, reject) => {
                            const reader = new FileReader();
                            reader.onload = () => resolve(reader.result);
                            reader.onerror = reject;
                            reader.readAsDataURL(fontBlob);
                        });
                        
                        // Base64로 인코딩된 폰트로 적용
                        await applyProjectFontBase64(fontBase64, fontName, fileExtension);
                        
                        // 폰트 선택 옵션 업데이트
                        const fontSelect = document.getElementById('fontSelect');
                        if (fontSelect) {
                            // 프로젝트 폰트 옵션 추가
                            if (!Array.from(fontSelect.options).find(opt => opt.value === 'project')) {
                                const option = document.createElement('option');
                                option.value = 'project';
                                option.textContent = `프로젝트 폰트 (${fontName})`;
                                fontSelect.appendChild(option);
                            }
                            fontSelect.value = 'project';
                        }
                        console.log('폰트 적용 완료:', fontName);
                        return; // 성공하면 종료
                    } else {
                        console.warn('폰트 파일을 찾을 수 없습니다:', fontPath);
                    }
                } catch (e) {
                    console.warn('폰트 파일 확인/로드 실패:', e);
                }
            }
        }
        
        // 설정 파일이 없으면 fonts 폴더의 모든 폰트 파일 시도 (WOFF2 우선)
        const fontExtensions = ['woff2', 'woff', 'ttf', 'otf']; // WOFF2 우선
        const fontFiles = [];
        
        // 일반적인 폰트 파일명 패턴 시도
        const commonFontNames = [
            'NanumGothic', 'NanumBarunGothic', 'NanumPen', 'NanumBrush',
            'NotoSansKR', 'NotoSerifKR',
            'Pretendard', 'GmarketSans',
            'Cafe24', 'Cafe24Onepretty', 'Cafe24Ssurround',
            'font', 'custom-font', 'main-font',
            // 강원교육 폰트들
            'GangwonEduHyunok', 'GangwonEduModuBold', 'GangwonEduModuLight', 'GangwonEduSaeum'
        ];
        
        for (const fontName of commonFontNames) {
            for (const ext of fontExtensions) {
                const fontPath = `/fonts/${fontName}.${ext}`;
                try {
                    const response = await fetch(fontPath, { method: 'HEAD' });
                    if (response.ok) {
                        fontFiles.push({ name: fontName, path: fontPath, type: ext });
                        break; // 첫 번째로 찾은 확장자 사용
                    }
                } catch (e) {
                    // 파일이 없으면 무시
                }
            }
        }
        
        // 폰트 파일이 있으면 첫 번째 것 적용
        if (fontFiles.length > 0) {
            const font = fontFiles[0];
            await applyProjectFont(font.path, font.name, font.type);
            
            // 폰트 선택 옵션 업데이트
            const fontSelect = document.getElementById('fontSelect');
            if (fontSelect) {
                // 프로젝트 폰트 옵션 추가
                if (!Array.from(fontSelect.options).find(opt => opt.value === 'project')) {
                    const option = document.createElement('option');
                    option.value = 'project';
                    option.textContent = `프로젝트 폰트 (${font.name})`;
                    fontSelect.appendChild(option);
                }
                fontSelect.value = 'project';
            }
        }
    } catch (error) {
        console.log('프로젝트 폰트 로드 실패:', error);
    }
}

// 프로젝트 폰트 적용 함수 (Base64 방식)
async function applyProjectFontBase64(fontBase64, fontName, fontType) {
    console.log('applyProjectFontBase64 호출:', fontName, fontType);
    
    // 기존 폰트 스타일 제거
    const existingStyle = document.getElementById('projectFontStyle');
    if (existingStyle) {
        existingStyle.remove();
    }
    
    // 커스텀 폰트 스타일도 제거 (프로젝트 폰트 우선)
    const customStyle = document.getElementById('customFontStyle');
    if (customStyle) {
        customStyle.remove();
    }
    
    // 폰트 이름을 안전하게 처리
    const safeFontName = fontName.replace(/'/g, "\\'").replace(/"/g, '\\"');
    
    let fontFormat = '';
    switch(fontType) {
        case 'ttf':
            fontFormat = 'truetype';
            break;
        case 'otf':
            fontFormat = 'opentype';
            break;
        case 'woff':
            fontFormat = 'woff';
            break;
        case 'woff2':
            fontFormat = 'woff2';
            break;
    }
    
    // Base64로 인코딩된 폰트를 직접 CSS에 포함
    // format을 생략하여 브라우저가 자동 감지하도록 함
    const style = document.createElement('style');
    style.id = 'projectFontStyle';
    style.textContent = `
        @font-face {
            font-family: '${safeFontName}';
            src: url('${fontBase64}');
            font-display: swap;
            font-weight: normal;
            font-style: normal;
        }
        
        body, * {
            font-family: '${safeFontName}', 'Malgun Gothic', 'Apple SD Gothic Neo', sans-serif !important;
        }
    `;
    
    document.head.appendChild(style);
    console.log('폰트 스타일 추가 완료 (Base64, format 생략):', safeFontName);
    
    // 폰트 로드 확인
    updateFontPreview();
    
    // FontFace API로도 로드 시도 (Base64 URL 사용)
    if (window.FontFace) {
        try {
            // Base64 데이터를 ArrayBuffer로 변환 후 Blob URL 생성
            const base64Data = fontBase64.split(',')[1]; // data:font/otf;base64, 부분 제거
            const binaryString = atob(base64Data);
            const bytes = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) {
                bytes[i] = binaryString.charCodeAt(i);
            }
            const fontBlob = new Blob([bytes], { type: `font/${fontType}` });
            const fontUrl = URL.createObjectURL(fontBlob);
            
            // Object URL을 사용하여 FontFace 생성
            const fontFace = new FontFace(safeFontName, `url(${fontUrl})`);
            await fontFace.load();
            document.fonts.add(fontFace);
            
            // Object URL 정리
            URL.revokeObjectURL(fontUrl);
            
            console.log('✅ FontFace API로 폰트 로드 성공:', safeFontName);
        } catch (error) {
            console.warn('⚠️ FontFace API 로드 실패 (CSS @font-face는 적용됨):', error.message);
            // CSS @font-face는 이미 적용되어 있으므로 계속 진행
            // 브라우저가 폰트를 파싱하지 못해도 CSS는 적용되어 fallback 폰트 사용
        }
    }
}

// 프로젝트 폰트 적용 함수 (URL 방식 - 하위 호환성)
async function applyProjectFont(fontPath, fontName, fontType) {
    console.log('applyProjectFont 호출:', fontPath, fontName, fontType);
    
    // 기존 폰트 스타일 제거
    const existingStyle = document.getElementById('projectFontStyle');
    if (existingStyle) {
        existingStyle.remove();
    }
    
    // 커스텀 폰트 스타일도 제거 (프로젝트 폰트 우선)
    const customStyle = document.getElementById('customFontStyle');
    if (customStyle) {
        customStyle.remove();
    }
    
    // 폰트 이름을 안전하게 처리
    const safeFontName = fontName.replace(/'/g, "\\'").replace(/"/g, '\\"');
    
    // FontFace API 사용 시도 (format 없이 시도 - 브라우저가 자동 감지)
    if (window.FontFace) {
        try {
            // format 없이 URL만 전달 (브라우저가 자동으로 감지)
            const fontFace = new FontFace(safeFontName, `url('${fontPath}')`);
            
            // 로드 타임아웃 설정 (5초)
            const loadPromise = fontFace.load();
            const timeoutPromise = new Promise((_, reject) => 
                setTimeout(() => reject(new Error('FontFace load timeout')), 5000)
            );
            
            await Promise.race([loadPromise, timeoutPromise]);
            document.fonts.add(fontFace);
            
            // CSS 스타일 추가
            const style = document.createElement('style');
            style.id = 'projectFontStyle';
            style.textContent = `
                body, * {
                    font-family: '${safeFontName}', 'Malgun Gothic', 'Apple SD Gothic Neo', sans-serif !important;
                }
            `;
            document.head.appendChild(style);
            
            console.log('✅ FontFace API로 폰트 로드 성공:', safeFontName);
            updateFontPreview();
            return;
        } catch (error) {
            console.warn('⚠️ FontFace API 로드 실패, @font-face로 시도:', error.message);
            // FontFace API 실패는 무시하고 @font-face로 진행
        }
    }
    
    // FontFace API가 실패하거나 지원되지 않는 경우 @font-face 사용
    const style = document.createElement('style');
    style.id = 'projectFontStyle';
    
    let fontFormat = '';
    switch(fontType) {
        case 'ttf':
            fontFormat = 'truetype';
            break;
        case 'otf':
            fontFormat = 'opentype';
            break;
        case 'woff':
            fontFormat = 'woff';
            break;
        case 'woff2':
            fontFormat = 'woff2';
            break;
    }
    
    // format을 명시하되, WOFF2의 경우 format 생략 시도 (브라우저 호환성)
    let fontSrc = '';
    if (fontType === 'woff2') {
        // WOFF2는 format 생략해도 브라우저가 자동 감지
        fontSrc = `url('${fontPath}') format('${fontFormat}'), url('${fontPath}')`;
    } else {
        fontSrc = `url('${fontPath}') format('${fontFormat}')`;
    }
    
    style.textContent = `
        @font-face {
            font-family: '${safeFontName}';
            src: ${fontSrc};
            font-display: swap;
            font-weight: normal;
            font-style: normal;
        }
        
        body, * {
            font-family: '${safeFontName}', 'Malgun Gothic', 'Apple SD Gothic Neo', sans-serif !important;
        }
    `;
    
    document.head.appendChild(style);
    console.log('폰트 스타일 추가 완료 (@font-face):', safeFontName);
    
    // CSS는 이미 적용되었으므로, 폰트가 실제로 로드되었는지는 나중에 확인
    // 폰트가 로드되지 않아도 CSS는 적용되어 fallback 폰트가 사용됨
    updateFontPreview();
    
    // 폰트 로드 확인 (비동기로 실행, 블로킹하지 않음)
    setTimeout(() => {
        if (document.fonts && document.fonts.check) {
            document.fonts.ready.then(() => {
                // 더 긴 대기 시간 (브라우저가 폰트를 파싱하는데 시간이 걸릴 수 있음)
                setTimeout(() => {
                    try {
                        const isLoaded = document.fonts.check(`16px "${safeFontName}"`);
                        if (isLoaded) {
                            console.log('✅ 폰트 로드 확인 성공:', safeFontName);
                        } else {
                            // 폰트가 로드되지 않았지만 CSS는 적용되어 있음
                            console.log('ℹ️ 폰트 로드 확인 실패 (CSS 스타일은 적용됨, 브라우저가 폰트를 렌더링할 수 있음):', safeFontName);
                            // 브라우저 콘솔의 경고 메시지는 무시 가능 (CSS는 정상 적용됨)
                        }
                    } catch (e) {
                        // 폰트 확인 오류는 무시 (CSS는 정상 적용됨)
                        console.log('ℹ️ 폰트 확인 중 오류 (무시 가능, CSS는 적용됨):', e.message);
                    }
                }, 2000); // 2초 대기
            }).catch(() => {
                // 에러는 무시 (CSS는 정상 적용됨)
            });
        }
    }, 100);
}

// 페이지 로드 시 저장된 폰트 또는 프로젝트 폰트 적용
window.addEventListener('load', () => {
    // 먼저 프로젝트 폰트 시도
    loadProjectFonts().then(() => {
        // 프로젝트 폰트가 없으면 로컬 스토리지의 폰트 확인
        const fontDataUrl = localStorage.getItem('customFont');
        const fontName = localStorage.getItem('customFontName');
        const fontType = localStorage.getItem('customFontType');
        
        if (fontDataUrl && fontName && fontType) {
            // 프로젝트 폰트가 적용되지 않았을 때만 로컬 스토리지 폰트 적용
            if (!document.getElementById('projectFontStyle')) {
                applyCustomFont(fontDataUrl, fontName, fontType);
                const fontSelect = document.getElementById('fontSelect');
                if (fontSelect) {
                    fontSelect.value = 'custom';
                }
            }
        }
    });
});

// 탭 전환
document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        const tabName = btn.dataset.tab;
        switchTab(tabName);
    });
});

function switchTab(tabName) {
    // 탭 전환 시 스크롤을 맨 위로 초기화
    window.scrollTo({ top: 0, behavior: 'smooth' });
    
    document.querySelectorAll('.tab-btn').forEach(b => {
        b.classList.remove('active');
        b.classList.remove('animate__pulse');
    });
    document.querySelectorAll('.tab-content').forEach(c => {
        c.classList.remove('active');
        c.classList.remove('animate__animated', 'animate__fadeIn');
    });
    
    const activeBtn = document.querySelector(`[data-tab="${tabName}"]`);
    if (activeBtn) {
        activeBtn.classList.add('active');
        activeBtn.classList.add('animate__animated', 'animate__pulse');
        // 애니메이션 후 pulse 제거 (일시적 효과)
        setTimeout(() => {
            activeBtn.classList.remove('animate__pulse');
        }, 600);
    }
    
    const activeTab = document.getElementById(`${tabName}Tab`);
    if (activeTab) {
        activeTab.classList.add('active');
        activeTab.classList.add('animate__animated', 'animate__fadeIn');
    }

    if (tabName === 'calendar') {
        renderGrapeClusters();
    } else if (tabName === 'lessons') {
        // 수업 기록 탭 내부 전환은 별도 처리
    } else if (tabName === 'morning') {
        checkMorningRecorded();
    } else if (tabName === 'closing') {
        // 종례시간 탭이 열릴 때 아침 감정 불러오기 및 챗봇 첫 메시지
        initClosingTab();
    } else if (tabName === 'subjectReview') {
        // 과목별 보기 탭 초기화
        const subjectFilter = document.getElementById('subjectFilter');
        if (subjectFilter) {
            subjectFilter.value = '';
            const container = document.getElementById('subjectLessonsContainer');
            if (container) {
                container.innerHTML = '<p class="empty-message">과목을 선택하면 해당 과목의 공책 내용을 모아서 볼 수 있어요!</p>';
            }
        }
    }
}

// 수업 기록 탭 내부 전환
document.querySelectorAll('.lesson-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        const lessonTabName = btn.dataset.lessonTab;
        
        document.querySelectorAll('.lesson-tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.lesson-tab-content').forEach(c => c.classList.remove('active'));
        
        btn.classList.add('active');
        const tabElement = document.getElementById(`${lessonTabName}LessonTab`);
        if (tabElement) {
            tabElement.classList.add('active');
        } else {
            console.error(`탭 요소를 찾을 수 없습니다: ${lessonTabName}LessonTab`);
        }
        
        if (lessonTabName === 'review') {
            loadReviewLessons();
        } else if (lessonTabName === 'write') {
            // 기록 탭으로 돌아올 때 폼 초기화
            resetLessonForm();
        }
    });
});

// 아침 감정일기
const morningChatMessages = [];
const morningSystemMessage = "너는 초등학생 친구와 이야기해 주는 따뜻한 감정 상담 챗봇이야. 항상 반말을 쓰고, 친구처럼 편하게 이야기해 줘. 학생의 감정을 공감해 주고, 부담스럽지 않게 긍정적인 관점을 보여 줘. 문장은 너무 길지 않게, 한두 문장 정도로 짧고 자연스럽게 답해.";

const sendChatBtn = document.getElementById('sendChatBtn');
if (sendChatBtn) {
    sendChatBtn.addEventListener('click', sendMorningMessage);
}
const chatInputEl = document.getElementById('chatInput');
if (chatInputEl) {
    chatInputEl.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            // 정리 문장 입력 단계에서는 Enter 키로 전송하지 않음
            if (!morningSummaryRequested) {
                sendMorningMessage();
            }
        }
    });
    
    // 정리 문장 입력 단계에서 입력창 값이 변경될 때마다 실시간으로 저장
    chatInputEl.addEventListener('input', () => {
        if (morningSummaryRequested) {
            morningSummaryText = chatInputEl.value.trim();
            // 전송 버튼 표시 상태 업데이트
            updateSubmitButtonVisibility();
        }
    });
    
    // 정리 문장 입력 단계에서 입력창 클릭 시 이전 내용 제거
    chatInputEl.addEventListener('focus', () => {
        if (morningSummaryRequested && chatInputEl.value === morningSummaryText) {
            chatInputEl.value = '';
            morningSummaryText = '';
        }
    });
}

async function sendMorningMessage() {
    const input = document.getElementById('chatInput');
    const message = input.value.trim();
    if (!message) return;

    // 정리 문장 요청 후에는 채팅에 표시하지 않고 문장만 저장
    if (morningSummaryRequested) {
        morningSummaryText = message; // 학생이 작성한 정리 문장 저장 (채팅창에 표시 안 함)
        
        // 입력창은 그대로 유지 (학생이 계속 수정할 수 있도록)
        // 입력창 옆 전송 버튼은 그대로 유지 (선택사항)
        
        // 전송 버튼 표시 상태 업데이트
        updateSubmitButtonVisibility();
        
        return; // 챗봇 응답 없음
    }

    // 일반 대화: 채팅에 메시지 표시
    addChatMessage('user', message, 'chatMessages');
    morningChatMessages.push({ role: 'user', content: message });
    input.value = '';
    morningChatCount++;

    // 로딩 표시
    const loadingId = addChatMessage('assistant', '생각 중...', 'chatMessages');

    try {
        // 대화 턴수에 따라 system message 동적 조정
        let currentSystemMessage = morningSystemMessage;
        
        if (morningChatCount === 1 || morningChatCount === 2) {
            // 1-2턴: 학생이 더 자세히 이야기할 수 있도록 질문으로 끝나도록 유도
            currentSystemMessage = morningSystemMessage + " 중요: 너의 응답은 반드시 질문으로 끝나야 해. 학생이 자신의 감정에 대해 더 자세히 이야기할 수 있도록 구체적이고 따뜻한 질문을 던져줘. 예: '그 기분이 어떤 느낌이었어?', '그때 뭐가 가장 기억에 남아?', '그 일이 너에게 어떤 의미였어?' 같은 식으로.";
        } else if (morningChatCount === 3) {
            // 3턴: 학생의 감정을 요약하고 정리 문장을 유도
            currentSystemMessage = morningSystemMessage + " 중요: 학생이 지금까지 이야기한 감정을 요약해주고, 학생이 스스로 감정을 한 문장으로 정리할 수 있도록 안내해줘. 질문 형태가 아닌 요약과 안내 문장으로 끝내야 해. 예: '지금까지 너가 말한 걸 정리해보면... 이제 너의 기분을 한 문장으로 정리해볼래?'";
        }

        const response = await callChatGPT(morningChatMessages, currentSystemMessage);
        morningChatMessages.push({ role: 'assistant', content: response });
        
        // 로딩 메시지 제거하고 실제 응답 추가 (타이핑 효과)
        document.getElementById(loadingId).parentElement.remove();
        addChatMessage('assistant', response, 'chatMessages', true);

        // 3턴일 때: 응답 후 추가로 정리 문장 요청 (질문이 아닌 요약 후 유도)
        if (morningChatCount === 3 && !morningSummaryRequested) {
            const responseLength = response.length;
            const typingDelay = responseLength * 30; // 타이핑 시간 계산
            
            setTimeout(() => {
                const emojiMessages = [
                    '이제 그 기분을 이모티콘으로 표현해볼래? 😊',
                    '지금 기분을 나타내는 이모티콘 하나 골라줄래? 😄',
                    '이 기분을 이모티콘으로 보여줄 수 있을까? 🤔',
                    '딱 맞는 이모티콘 하나 골라서 표현해봐! 💭',
                    '어울리는 이모티콘 하나 찍어줄래? ✨',
                    '지금 이 마음을 이모티콘으로 보여줘! 🎨'
                ];
                const emojiMessage = emojiMessages[Math.floor(Math.random() * emojiMessages.length)];
                morningChatMessages.push({ role: 'assistant', content: emojiMessage });
                addChatMessage('assistant', emojiMessage, 'chatMessages', true);
                morningSummaryRequested = true;
                
                // 정리 문장 요청 후 이모지 선택 화면 표시
                setTimeout(() => {
                    const emotionSelection = document.getElementById('emotionSelection');
                    if (emotionSelection) {
                        emotionSelection.style.display = 'block';
                    }
                    
                    // 입력창과 전송 버튼은 그대로 유지 (학생이 계속 수정할 수 있도록)
                    // 전송 버튼 표시 상태 업데이트
                    updateSubmitButtonVisibility();
                }, 2000);
            }, typingDelay + 500);
        }
    } catch (error) {
        document.getElementById(loadingId).parentElement.remove();
        addChatMessage('assistant', '미안, 뭔가 오류가 난 것 같아. 잠시 후에 다시 한 번 시도해 줄래?', 'chatMessages', true);
        console.error(error);
    }
}

// 감정 기록하기 버튼
const recordEmotionBtn = document.getElementById('recordEmotionBtn');
if (recordEmotionBtn) {
    recordEmotionBtn.addEventListener('click', () => {
        const emotionSelection = document.getElementById('emotionSelection');
        if (emotionSelection) {
            emotionSelection.style.display = 'block';
        }
        recordEmotionBtn.style.display = 'none';
    });
}

// 아침 감정 다시 대화하기 버튼
const restartMorningChatBtn = document.getElementById('restartMorningChatBtn');
if (restartMorningChatBtn) {
    restartMorningChatBtn.addEventListener('click', restartMorningChat);
}

// 전송 버튼 표시 상태 업데이트 함수
function updateSubmitButtonVisibility() {
    const submitBtn = document.getElementById('submitMorningEmotionBtn');
    if (!submitBtn) return;
    
    // 입력창의 값도 확인
    const chatInput = document.getElementById('chatInput');
    const inputValue = chatInput ? chatInput.value.trim() : '';
    
    // 문장과 이모티콘이 모두 있는지 확인 (입력창 값 또는 저장된 값)
    const hasSummary = (morningSummaryText && morningSummaryText.trim().length > 0) || inputValue.length > 0;
    const hasEmotion = morningEmotion && morningEmotion.length > 0;
    
    if (hasSummary && hasEmotion) {
        submitBtn.style.display = 'block';
    } else {
        submitBtn.style.display = 'none';
    }
}

// 이모지 선택 (동적으로 생성되는 버튼 포함)
function setupEmojiButtons() {
    document.querySelectorAll('#emotionSelection .emoji-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            morningEmotion = btn.dataset.emoji;
            document.querySelectorAll('#emotionSelection .emoji-btn').forEach(b => b.classList.remove('selected'));
            btn.classList.add('selected');
            
            // 전송 버튼 표시 상태 업데이트
            updateSubmitButtonVisibility();
        });
    });
}

// 초기 이모지 버튼 설정
setupEmojiButtons();

// 커스텀 이모지 추가
const addCustomEmojiBtnEl = document.getElementById('addCustomEmojiBtn');
if (addCustomEmojiBtnEl) {
    addCustomEmojiBtnEl.addEventListener('click', () => {
        const customInput = document.getElementById('customEmojiInput');
        const customEmoji = customInput ? customInput.value.trim() : '';
        
        if (customEmoji && customEmoji.length <= 2) {
            // 이미 존재하는지 확인
            const existingBtn = Array.from(document.querySelectorAll('#emotionSelection .emoji-btn'))
                .find(btn => btn.dataset.emoji === customEmoji);
            
            if (!existingBtn) {
                // 새로운 이모지 버튼 생성
                const emojiContainer = document.querySelector('#emotionSelection .emotion-emoji');
                if (!emojiContainer) return;
                const newBtn = document.createElement('button');
                newBtn.className = 'emoji-btn';
                newBtn.dataset.emoji = customEmoji;
                newBtn.textContent = customEmoji;
                emojiContainer.appendChild(newBtn);
                
                // 이벤트 리스너 추가
                newBtn.addEventListener('click', () => {
                    morningEmotion = newBtn.dataset.emoji;
                    document.querySelectorAll('#emotionSelection .emoji-btn').forEach(b => b.classList.remove('selected'));
                    newBtn.classList.add('selected');
                    
                    // 전송 버튼 표시 상태 업데이트
                    updateSubmitButtonVisibility();
                });
            } else {
                // 이미 존재하면 선택
                existingBtn.click();
            }
            
            if (customInput) {
                customInput.value = '';
            }
        } else {
            alert('올바른 이모지를 입력해주세요.');
        }
    });
    
    // Enter 키로도 추가 가능
    const customEmojiInputEl = document.getElementById('customEmojiInput');
    if (customEmojiInputEl) {
        customEmojiInputEl.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                addCustomEmojiBtnEl.click();
            }
        });
    }
}

// 전송 버튼 클릭 이벤트
const submitMorningEmotionBtn = document.getElementById('submitMorningEmotionBtn');
if (submitMorningEmotionBtn) {
    submitMorningEmotionBtn.addEventListener('click', async () => {
        // 입력창의 최종 값을 확인하여 저장
        const chatInput = document.getElementById('chatInput');
        if (chatInput && chatInput.value.trim()) {
            morningSummaryText = chatInput.value.trim();
        }
        
        if (!morningEmotion || !morningSummaryText) {
            alert('감정 문장과 이모티콘을 모두 선택해주세요.');
            return;
        }
        
        // 학생이 입력한 문장과 이모티콘을 챗봇 화면에 표시 및 메시지 배열에 추가
        const summaryWithEmoji = `${morningSummaryText} ${morningEmotion}`;
        addChatMessage('user', summaryWithEmoji, 'chatMessages');
        morningChatMessages.push({ role: 'user', content: summaryWithEmoji });
        
        // Firestore에 저장
        await saveMorningEmotion();
        
        // 기록 완료 후 UI 업데이트
        showMorningRecorded();
    });
}

// 다시 기록하기 버튼 제거됨 - 삭제하지 않고 주석 처리

async function saveMorningEmotion() {
    if (!morningEmotion || !currentUser) return;
    
    const today = format(new Date(), 'yyyy-MM-dd');
    const emotionRef = doc(db, 'students', currentUser.uid, 'emotions', today);
    
    await setDoc(emotionRef, {
        morningEmotion: morningEmotion,
        morningChat: morningChatMessages,
        morningSummary: morningSummaryText, // 정리 문장 저장
        date: today,
        timestamp: new Date(),
        morningRecorded: true
    }, { merge: true });
}

function showMorningRecorded() {
    // 채팅 컨테이너는 항상 보이도록 하고, 입력 영역만 숨김
    const chatContainer = document.getElementById('morningChatContainer');
    if (chatContainer) {
        chatContainer.style.display = 'block';
        const inputArea = chatContainer.querySelector('.chat-input-area');
        if (inputArea) {
            inputArea.style.display = 'none'; // 입력 영역 숨김
        }
        
        // 이모지 선택 영역과 전송 버튼 숨김
        const emotionSelection = document.getElementById('emotionSelection');
        if (emotionSelection) {
            emotionSelection.style.display = 'none';
        }
        const submitBtn = document.getElementById('submitMorningEmotionBtn');
        if (submitBtn) {
            submitBtn.style.display = 'none';
        }
    }
    
    // 다시 입력하기 버튼 표시
    const alreadyRecordedEl = document.getElementById('morningAlreadyRecorded');
    if (alreadyRecordedEl) {
        alreadyRecordedEl.style.display = 'block';
    }
    
    // 하단 안내 메시지 표시
    const completeMessage = document.getElementById('morningCompleteMessage');
    if (completeMessage) {
        completeMessage.style.display = 'block';
    }
}

// 아침 감정 다시 대화하기 (재기록)
async function restartMorningChat() {
    const chatContainer = document.getElementById('morningChatContainer');
    if (!chatContainer) return;

    // 메모리 상 상태 초기화
    morningChatMessages.length = 0;
    morningChatCount = 0;
    morningSummaryRequested = false;
    morningSummaryText = '';
    morningEmotion = null;

    // 화면에 보이는 채팅 내용 초기화
    const chatMessagesEl = document.getElementById('chatMessages');
    if (chatMessagesEl) {
        chatMessagesEl.innerHTML = '';
    }

    // 입력 영역 다시 표시
    const inputArea = chatContainer.querySelector('.chat-input-area');
    if (inputArea) {
        inputArea.style.display = '';
    }
    
    // 일반 전송 버튼 다시 표시
    const sendChatBtn = document.getElementById('sendChatBtn');
    if (sendChatBtn) {
        sendChatBtn.style.display = '';
    }
    
    // 입력창 초기화
    const chatInput = document.getElementById('chatInput');
    if (chatInput) {
        chatInput.value = '';
    }

    // 이모지 선택 영역/버튼 초기화
    const emotionSelection = document.getElementById('emotionSelection');
    if (emotionSelection) {
        emotionSelection.style.display = 'none';
        emotionSelection.querySelectorAll('.emoji-btn').forEach(btn => btn.classList.remove('selected'));
    }

    const recordEmotionBtnEl = document.getElementById('recordEmotionBtn');
    if (recordEmotionBtnEl) {
        recordEmotionBtnEl.style.display = 'none';
    }

    // 전송 버튼 숨기기
    const submitBtn = document.getElementById('submitMorningEmotionBtn');
    if (submitBtn) {
        submitBtn.style.display = 'none';
    }

    // "이미 기록됨" 영역 숨기기
    const alreadyRecordedEl = document.getElementById('morningAlreadyRecorded');
    if (alreadyRecordedEl) {
        alreadyRecordedEl.style.display = 'none';
    }

    // 완료 메시지 숨기기
    const completeMessage = document.getElementById('morningCompleteMessage');
    if (completeMessage) {
        completeMessage.style.display = 'none';
    }

    // Firestore 상의 아침 감정 상태도 초기화 (다시 기록 가능하도록)
    try {
        if (currentUser) {
            const today = format(new Date(), 'yyyy-MM-dd');
            const emotionRef = doc(db, 'students', currentUser.uid, 'emotions', today);
            await setDoc(emotionRef, {
                morningEmotion: null,
                morningChat: [],
                morningSummary: '',
                morningRecorded: false
            }, { merge: true });
        }
    } catch (e) {
        console.error('아침 감정 재시작 초기화 오류:', e);
    }
}

// 수업 기록 - 텍스트와 도식을 동시에 사용 가능하도록
document.querySelectorAll('.record-type-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        // 토글 방식으로 변경 (둘 다 활성화 가능)
        btn.classList.toggle('active');
        
        const type = btn.dataset.type;
        if (type === 'text') {
            const textArea = document.getElementById('textInputArea');
            if (btn.classList.contains('active')) {
                textArea.classList.add('active');
            } else {
                textArea.classList.remove('active');
            }
        } else if (type === 'drawing') {
            const drawingArea = document.getElementById('drawingArea');
            if (btn.classList.contains('active')) {
                drawingArea.classList.add('active');
                initDrawingCanvas();
            } else {
                drawingArea.classList.remove('active');
            }
        } else if (type === 'photo') {
            const photoArea = document.getElementById('photoInputArea');
            if (btn.classList.contains('active')) {
                photoArea.style.display = 'block';
            } else {
                photoArea.style.display = 'none';
            }
        }
    });
});

// 사진 첨부 관련 변수
let uploadedPhoto = null;

// 사진 선택 버튼
document.getElementById('selectPhotoBtn')?.addEventListener('click', () => {
    document.getElementById('photoFileInput')?.click();
});

// 이미지 리사이징 함수
function resizeImage(file, maxWidth = 1200, maxHeight = 1200, quality = 0.8) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                let width = img.width;
                let height = img.height;
                
                // 비율 유지하면서 리사이징
                if (width > maxWidth || height > maxHeight) {
                    const ratio = Math.min(maxWidth / width, maxHeight / height);
                    width = width * ratio;
                    height = height * ratio;
                }
                
                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                
                // 이미지 그리기
                ctx.drawImage(img, 0, 0, width, height);
                
                // Canvas를 Blob으로 변환
                canvas.toBlob((blob) => {
                    if (blob) {
                        resolve(blob);
                    } else {
                        reject(new Error('이미지 변환에 실패했습니다.'));
                    }
                }, 'image/jpeg', quality);
            };
            img.onerror = reject;
            img.src = e.target.result;
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

// 사진 파일 선택 이벤트
document.getElementById('photoFileInput')?.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    if (!file.type.startsWith('image/')) {
        alert('이미지 파일만 업로드할 수 있습니다.');
        return;
    }
    
    try {
        // 이미지 리사이징
        const resizedBlob = await resizeImage(file, 1200, 1200, 0.8);
        uploadedPhoto = resizedBlob;
        
        // 미리보기 표시
        const previewContainer = document.getElementById('photoPreviewContainer');
        if (previewContainer) {
            const reader = new FileReader();
            reader.onload = (event) => {
                previewContainer.innerHTML = `
                    <div style="position: relative; display: inline-block;">
                        <img src="${event.target.result}" alt="업로드된 사진" style="max-width: 100%; max-height: 400px; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);" />
                        <button id="removePhotoBtn" style="position: absolute; top: 5px; right: 5px; background: rgba(255,0,0,0.7); color: white; border: none; border-radius: 50%; width: 30px; height: 30px; cursor: pointer; font-size: 18px;">×</button>
                    </div>
                `;
                
                // 삭제 버튼 이벤트
                document.getElementById('removePhotoBtn')?.addEventListener('click', () => {
                    uploadedPhoto = null;
                    previewContainer.innerHTML = '';
                    document.getElementById('photoFileInput').value = '';
                });
            };
            reader.readAsDataURL(resizedBlob);
        }
    } catch (error) {
        console.error('이미지 처리 오류:', error);
        alert('이미지 업로드 중 오류가 발생했습니다.');
    }
});

// 도식 그리기 초기화
let canvasInitialized = false;
let textBoxClickHandler = null;
let canvasHistory = []; // Canvas 상태 히스토리
let historyIndex = -1; // 현재 히스토리 인덱스
let maxHistoryIndex = -1; // Redo를 위한 최대 히스토리 인덱스
let currentPenColor = '#000000'; // 현재 펜 색상

function saveCanvasState() {
    const canvas = document.getElementById('drawingCanvas');
    const textBoxes = document.getElementById('textBoxes');
    
    // 현재 상태 저장
    const state = {
        imageData: canvas.toDataURL(),
        textBoxes: Array.from(textBoxes.children).map(box => ({
            id: box.dataset.id,
            innerHTML: box.innerHTML,
            style: {
                left: box.style.left,
                top: box.style.top,
                x: box.dataset.x,
                y: box.dataset.y,
                displayX: box.style.left,
                displayY: box.style.top
            }
        }))
    };
    
    // 현재 인덱스 이후의 히스토리 제거 (새로운 동작이 발생했을 때)
    canvasHistory = canvasHistory.slice(0, historyIndex + 1);
    
    // 새 상태 추가
    canvasHistory.push(state);
    historyIndex = canvasHistory.length - 1;
    maxHistoryIndex = historyIndex; // Redo를 위한 최대 인덱스 업데이트
    
    // 히스토리가 너무 많이 쌓이지 않도록 제한 (최대 50개)
    if (canvasHistory.length > 50) {
        canvasHistory.shift();
        historyIndex--;
        maxHistoryIndex--;
    }
    
    // Redo 버튼 상태 업데이트
    updateRedoButton();
}

function restoreCanvasState() {
    if (historyIndex < 0) return;
    
    const canvas = document.getElementById('drawingCanvas');
    const ctx = canvas.getContext('2d');
    const textBoxes = document.getElementById('textBoxes');
    const state = canvasHistory[historyIndex];
    
    // Canvas 복원
    const img = new Image();
    img.onload = () => {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0);
    };
    img.src = state.imageData;
    
    // 텍스트 상자 복원
    textBoxes.innerHTML = '';
    state.textBoxes.forEach(boxData => {
        const box = document.createElement('div');
        box.className = 'text-box';
        box.dataset.id = boxData.id;
        box.dataset.x = boxData.style.x;
        box.dataset.y = boxData.style.y;
        box.style.left = boxData.style.left;
        box.style.top = boxData.style.top;
        box.innerHTML = boxData.innerHTML;
        box.contentEditable = true;
        
        // 클릭 시 "텍스트 입력" 문구 제거
        box.addEventListener('click', function(e) {
            if (this.textContent === '텍스트 입력') {
                this.textContent = '';
            }
        }, { once: true });
        
        // 드래그 기능 다시 추가
        makeDraggable(box);
        textBoxes.appendChild(box);
    });
}

function undoCanvas() {
    if (historyIndex > 0) {
        historyIndex--;
        restoreCanvasState();
        updateRedoButton();
        updateUndoButton();
    } else if (historyIndex === 0) {
        // 첫 번째 상태로 돌아가면 빈 상태로 복원
        const canvas = document.getElementById('drawingCanvas');
        const ctx = canvas.getContext('2d');
        const textBoxes = document.getElementById('textBoxes');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        textBoxes.innerHTML = '';
        historyIndex = -1;
        maxHistoryIndex = -1;
        canvasHistory = [];
        updateUndoButton();
        updateRedoButton();
    }
}

function redoCanvas() {
    if (historyIndex < maxHistoryIndex) {
        historyIndex++;
        restoreCanvasState();
        updateUndoButton();
        updateRedoButton();
    }
}

function updateUndoButton() {
    const undoBtn = document.getElementById('undoBtn');
    if (undoBtn) {
        undoBtn.disabled = historyIndex <= 0;
    }
}

function updateRedoButton() {
    const redoBtn = document.getElementById('redoBtn');
    if (redoBtn) {
        redoBtn.disabled = historyIndex >= maxHistoryIndex;
    }
}

function initDrawingCanvas() {
    if (canvasInitialized) {
        // 이미 초기화된 경우 히스토리만 초기화
        canvasHistory = [];
        historyIndex = -1;
        maxHistoryIndex = -1;
        saveCanvasState(); // 초기 상태 저장
        updateUndoButton();
        updateRedoButton();
        return;
    }
    canvasInitialized = true;
    
    const canvas = document.getElementById('drawingCanvas');
    const ctx = canvas.getContext('2d');
    
    // 초기 상태 저장
    saveCanvasState();
    
    // 펜 크기 표시 업데이트
    const penSizeSlider = document.getElementById('penSize');
    const penSizeDisplay = document.getElementById('penSizeDisplay');
    if (penSizeSlider && penSizeDisplay) {
        penSizeDisplay.textContent = penSizeSlider.value;
        penSizeSlider.addEventListener('input', (e) => {
            penSizeDisplay.textContent = e.target.value;
        });
    }
    
    // 색상 팔레트 초기화
    document.querySelectorAll('.color-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const color = btn.dataset.color;
            currentPenColor = color;
            document.querySelectorAll('.color-btn').forEach(b => b.classList.remove('selected'));
            btn.classList.add('selected');
        });
    });
    
    // 첫 번째 색상 선택 (검정)
    const firstColorBtn = document.querySelector('.color-btn[data-color="#000000"]');
    if (firstColorBtn) {
        firstColorBtn.classList.add('selected');
    }
    
    // 커스텀 색상 추가
    document.getElementById('addCustomColorBtn')?.addEventListener('click', () => {
        const customColorPicker = document.getElementById('customColorPicker');
        const color = customColorPicker.value.toUpperCase();
        
        // 이미 존재하는지 확인
        const existingBtn = Array.from(document.querySelectorAll('.color-btn'))
            .find(btn => btn.dataset.color.toUpperCase() === color);
        
        if (!existingBtn) {
            const palette = document.querySelector('.color-palette');
            const newBtn = document.createElement('button');
            newBtn.className = 'color-btn';
            newBtn.dataset.color = color;
            newBtn.style.backgroundColor = color;
            newBtn.style.border = '1px solid #ccc';
            newBtn.title = color;
            
            newBtn.addEventListener('click', () => {
                currentPenColor = color;
                document.querySelectorAll('.color-btn').forEach(b => b.classList.remove('selected'));
                newBtn.classList.add('selected');
            });
            
            // 커스텀 색상 피커 앞에 추가
            customColorPicker.parentNode.insertBefore(newBtn, customColorPicker);
        } else {
            // 이미 존재하면 선택
            existingBtn.click();
        }
    });
    
    // 펜 도구
    document.getElementById('penTool').addEventListener('click', () => {
        currentTool = 'pen';
        document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
        document.getElementById('penTool').classList.add('active');
        
        // 텍스트 상자 클릭 이벤트 제거
        if (textBoxClickHandler) {
            canvas.removeEventListener('click', textBoxClickHandler);
            textBoxClickHandler = null;
        }
    });

    // 텍스트 상자 도구
    document.getElementById('textBoxTool').addEventListener('click', () => {
        currentTool = 'textbox';
        document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
        document.getElementById('textBoxTool').classList.add('active');
        
        // 기존 핸들러 제거 후 새로 추가
        if (textBoxClickHandler) {
            canvas.removeEventListener('click', textBoxClickHandler);
        }
        textBoxClickHandler = addTextBox;
        canvas.addEventListener('click', textBoxClickHandler);
    });

    let drawingStartX = 0;
    let drawingStartY = 0;
    
    // 펜 그리기
    canvas.addEventListener('mousedown', (e) => {
        if (currentTool === 'pen') {
            isDrawing = true;
            const rect = canvas.getBoundingClientRect();
            drawingStartX = e.clientX - rect.left;
            drawingStartY = e.clientY - rect.top;
            ctx.beginPath();
            ctx.moveTo(drawingStartX, drawingStartY);
        }
    });

    canvas.addEventListener('mousemove', (e) => {
        if (isDrawing && currentTool === 'pen') {
            const rect = canvas.getBoundingClientRect();
            ctx.lineTo(e.clientX - rect.left, e.clientY - rect.top);
            ctx.strokeStyle = currentPenColor;
            ctx.lineWidth = document.getElementById('penSize').value;
            ctx.lineCap = 'round';
            ctx.stroke();
        }
    });

    canvas.addEventListener('mouseup', () => {
        if (isDrawing && currentTool === 'pen') {
            isDrawing = false;
            // 그리기 완료 후 상태 저장
            saveCanvasState();
            updateUndoButton();
        }
    });

    // 뒤로 돌아가기 (Undo)
    document.getElementById('undoBtn').addEventListener('click', () => {
        undoCanvas();
    });
    
    // 다시 실행 (Redo)
    document.getElementById('redoBtn').addEventListener('click', () => {
        redoCanvas();
    });
    
    // 초기 버튼 상태
    updateUndoButton();
    updateRedoButton();
}

// Canvas 크롭 함수 - 그린 부분만 감지하여 크롭
function cropCanvas(canvas) {
    const ctx = canvas.getContext('2d');
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    
    let minX = canvas.width;
    let minY = canvas.height;
    let maxX = 0;
    let maxY = 0;
    
    // 그린 부분(알파 값이 있는 픽셀) 찾기
    for (let y = 0; y < canvas.height; y++) {
        for (let x = 0; x < canvas.width; x++) {
            const index = (y * canvas.width + x) * 4;
            const alpha = data[index + 3];
            
            if (alpha > 0) { // 투명하지 않은 픽셀
                minX = Math.min(minX, x);
                minY = Math.min(minY, y);
                maxX = Math.max(maxX, x);
                maxY = Math.max(maxY, y);
            }
        }
    }
    
    // 텍스트 상자 영역도 고려
    const textBoxes = document.querySelectorAll('.text-box');
    textBoxes.forEach(box => {
        const boxRect = box.getBoundingClientRect();
        const canvasRect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / canvasRect.width;
        const scaleY = canvas.height / canvasRect.height;
        
        const boxX = parseFloat(box.style.left) * scaleX;
        const boxY = parseFloat(box.style.top) * scaleY;
        const boxWidth = boxRect.width * scaleX;
        const boxHeight = boxRect.height * scaleY;
        
        if (boxX >= 0 && boxY >= 0 && boxX < canvas.width && boxY < canvas.height) {
            minX = Math.min(minX, boxX);
            minY = Math.min(minY, boxY);
            maxX = Math.max(maxX, boxX + boxWidth);
            maxY = Math.max(maxY, boxY + boxHeight);
        }
    });
    
    // 여백 추가 (10px)
    const padding = 10;
    minX = Math.max(0, minX - padding);
    minY = Math.max(0, minY - padding);
    maxX = Math.min(canvas.width, maxX + padding);
    maxY = Math.min(canvas.height, maxY + padding);
    
    // 그린 부분이 없으면 전체 캔버스 반환
    if (minX >= maxX || minY >= maxY) {
        return {
            dataUrl: canvas.toDataURL(),
            offsetX: 0,
            offsetY: 0,
            width: canvas.width,
            height: canvas.height
        };
    }
    
    // 크롭된 영역의 크기
    const width = maxX - minX;
    const height = maxY - minY;
    
    // 새로운 캔버스에 크롭된 이미지 그리기
    const croppedCanvas = document.createElement('canvas');
    croppedCanvas.width = width;
    croppedCanvas.height = height;
    const croppedCtx = croppedCanvas.getContext('2d');
    
    // 배경을 흰색으로
    croppedCtx.fillStyle = '#FFFFFF';
    croppedCtx.fillRect(0, 0, width, height);
    
    // 원본 이미지를 크롭된 위치에 그리기
    croppedCtx.drawImage(canvas, minX, minY, width, height, 0, 0, width, height);
    
    return {
        dataUrl: croppedCanvas.toDataURL(),
        offsetX: minX,
        offsetY: minY,
        width: width,
        height: height
    };
}

function addTextBox(e) {
    if (currentTool !== 'textbox') return;
    
    e.stopPropagation();
    
    const canvas = document.getElementById('drawingCanvas');
    const canvasRect = canvas.getBoundingClientRect();
    const container = document.getElementById('textBoxes');
    
    // canvas의 실제 크기와 표시 크기 비율 계산
    const scaleX = canvas.width / canvasRect.width;
    const scaleY = canvas.height / canvasRect.height;
    
    const x = (e.clientX - canvasRect.left) * scaleX;
    const y = (e.clientY - canvasRect.top) * scaleY;
    
    const textBox = document.createElement('div');
    textBox.className = 'text-box';
    textBox.style.left = (x / scaleX) + 'px';
    textBox.style.top = (y / scaleY) + 'px';
    textBox.contentEditable = true;
    textBox.textContent = '텍스트 입력';
    textBox.dataset.id = textBoxCounter++;
    textBox.dataset.x = x;
    textBox.dataset.y = y;
    
    // 클릭 시 "텍스트 입력" 문구 제거
    textBox.addEventListener('click', function(e) {
        if (this.textContent === '텍스트 입력') {
            this.textContent = '';
        }
    }, { once: true });
    
    // 포커스 시에도 문구 제거
    textBox.addEventListener('focus', function() {
        if (this.textContent === '텍스트 입력') {
            this.textContent = '';
        }
    });
    
    // 드래그 가능하게
    makeDraggable(textBox);
    
    container.appendChild(textBox);
    
    // 텍스트 상자 추가 후 상태 저장
    saveCanvasState();
    
    // 포커스 설정
    setTimeout(() => {
        textBox.focus();
        const range = document.createRange();
        range.selectNodeContents(textBox);
        range.collapse(false);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
    }, 0);
}

function makeDraggable(element) {
    let isDragging = false;
    let currentX, currentY, initialX, initialY;
    
    element.addEventListener('mousedown', (e) => {
        if (e.target === element || element.contains(e.target)) {
            isDragging = true;
            initialX = e.clientX - element.offsetLeft;
            initialY = e.clientY - element.offsetTop;
        }
    });
    
    document.addEventListener('mousemove', (e) => {
        if (isDragging) {
            e.preventDefault();
            currentX = e.clientX - initialX;
            currentY = e.clientY - initialY;
            element.style.left = currentX + 'px';
            element.style.top = currentY + 'px';
        }
    });
    
    document.addEventListener('mouseup', () => {
        isDragging = false;
    });
}

// 텍스트 입력 영역 Undo 기능
let textHistory = []; // 텍스트 상태 히스토리
let textHistoryIndex = -1; // 현재 텍스트 히스토리 인덱스
let isTextChanging = false; // 텍스트 변경 중 플래그 (무한 루프 방지)

function saveTextState() {
    if (isTextChanging) return; // 변경 중이면 저장하지 않음
    
    const lessonText = document.getElementById('lessonText');
    const currentState = lessonText.innerHTML;
    
    // 현재 인덱스 이후의 히스토리 제거
    textHistory = textHistory.slice(0, textHistoryIndex + 1);
    
    // 새 상태 추가
    textHistory.push(currentState);
    textHistoryIndex = textHistory.length - 1;
    
    // 히스토리가 너무 많이 쌓이지 않도록 제한 (최대 50개)
    if (textHistory.length > 50) {
        textHistory.shift();
        textHistoryIndex--;
    }
    
    updateTextUndoButton();
}

function undoText() {
    if (textHistoryIndex > 0) {
        isTextChanging = true;
        textHistoryIndex--;
        const lessonText = document.getElementById('lessonText');
        lessonText.innerHTML = textHistory[textHistoryIndex];
        updateTextUndoButton();
        setTimeout(() => {
            isTextChanging = false;
        }, 100);
    }
}

function updateTextUndoButton() {
    const undoBtn = document.getElementById('textUndoBtn');
    if (undoBtn) {
        undoBtn.disabled = textHistoryIndex <= 0;
    }
}

// 텍스트 입력 영역 초기화 및 이벤트 리스너 설정
const lessonTextElement = document.getElementById('lessonText');
if (lessonTextElement) {
    // 초기 상태 저장
    saveTextState();
    
    // 텍스트 변경 감지 (입력, 삭제, 포맷 변경 등)
    lessonTextElement.addEventListener('input', () => {
        // 약간의 지연을 두어 연속된 변경을 하나로 묶음
        clearTimeout(window.textSaveTimeout);
        window.textSaveTimeout = setTimeout(() => {
            saveTextState();
        }, 500);
    });
    
    // 포맷 변경 감지
    lessonTextElement.addEventListener('keyup', () => {
        clearTimeout(window.textSaveTimeout);
        window.textSaveTimeout = setTimeout(() => {
            saveTextState();
        }, 500);
    });
    
    // 붙여넣기 감지
    lessonTextElement.addEventListener('paste', () => {
        setTimeout(() => {
            saveTextState();
        }, 100);
    });
}

// Undo 버튼 이벤트
document.getElementById('textUndoBtn').addEventListener('click', () => {
    undoText();
});

// 리치 텍스트 에디터 포맷 기능
document.getElementById('boldBtn').addEventListener('click', () => {
    const selection = window.getSelection();
    if (selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);
        const selectedText = range.toString();
        
        if (selectedText) {
            // 기존 스타일을 유지하면서 볼드 적용
            const span = document.createElement('span');
            span.style.fontWeight = 'bold';
            
            // 부모 요소에서 기존 스타일 복사
            const parent = range.commonAncestorContainer.nodeType === 3 
                ? range.commonAncestorContainer.parentElement 
                : range.commonAncestorContainer;
            
            if (parent && parent !== document.getElementById('lessonText')) {
                if (parent.style.fontSize) span.style.fontSize = parent.style.fontSize;
                if (parent.style.textDecoration) span.style.textDecoration = parent.style.textDecoration;
                if (parent.style.backgroundColor) span.style.backgroundColor = parent.style.backgroundColor;
            }
            
            span.textContent = selectedText;
            range.deleteContents();
            range.insertNode(span);
        } else {
            document.execCommand('bold', false, null);
        }
    }
    updateFormatButtons();
});

document.getElementById('underlineBtn').addEventListener('click', () => {
    const selection = window.getSelection();
    if (selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);
        const selectedText = range.toString();
        
        if (selectedText) {
            // 기존 스타일을 유지하면서 밑줄 적용
            const span = document.createElement('span');
            span.style.textDecoration = 'underline';
            
            // 부모 요소에서 기존 스타일 복사
            const parent = range.commonAncestorContainer.nodeType === 3 
                ? range.commonAncestorContainer.parentElement 
                : range.commonAncestorContainer;
            
            if (parent && parent !== document.getElementById('lessonText')) {
                if (parent.style.fontSize) span.style.fontSize = parent.style.fontSize;
                if (parent.style.fontWeight) span.style.fontWeight = parent.style.fontWeight;
                if (parent.style.backgroundColor) span.style.backgroundColor = parent.style.backgroundColor;
            }
            
            span.textContent = selectedText;
            range.deleteContents();
            range.insertNode(span);
        } else {
            document.execCommand('underline', false, null);
        }
    }
    updateFormatButtons();
});

document.getElementById('highlightBtn').addEventListener('click', () => {
    const selection = window.getSelection();
    if (selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);
        const selectedText = range.toString();
        
        if (selectedText) {
            // 기존 스타일을 유지하면서 형광펜 효과 추가
            const span = document.createElement('span');
            span.style.backgroundColor = '#ffff00'; // 노란색 형광펜
            
            // 선택된 텍스트의 부모 요소에서 기존 스타일 복사
            const parent = range.commonAncestorContainer.nodeType === 3 
                ? range.commonAncestorContainer.parentElement 
                : range.commonAncestorContainer;
            
            if (parent && parent !== document.getElementById('lessonText')) {
                // 기존 스타일 복사
                if (parent.style.fontSize) span.style.fontSize = parent.style.fontSize;
                if (parent.style.fontWeight) span.style.fontWeight = parent.style.fontWeight;
                if (parent.style.textDecoration) span.style.textDecoration = parent.style.textDecoration;
                if (parent.style.backgroundColor) {
                    // 이미 배경색이 있으면 유지
                    span.style.backgroundColor = parent.style.backgroundColor;
                }
            }
            
            span.textContent = selectedText;
            range.deleteContents();
            range.insertNode(span);
        } else {
            // 선택된 텍스트가 없으면 배경색 적용
            document.execCommand('backColor', false, '#ffff00');
        }
    }
    updateFormatButtons();
});

document.getElementById('fontSizeSmallBtn').addEventListener('click', () => {
    applyFontSize('14px');
    updateFormatButtons();
    document.getElementById('fontSizeSmallBtn').classList.add('active');
});

document.getElementById('fontSizeNormalBtn').addEventListener('click', () => {
    applyFontSize('16px');
    updateFormatButtons();
    document.getElementById('fontSizeNormalBtn').classList.add('active');
});

document.getElementById('fontSizeLargeBtn').addEventListener('click', () => {
    applyFontSize('18px');
    updateFormatButtons();
    document.getElementById('fontSizeLargeBtn').classList.add('active');
});

document.getElementById('fontSizeXLargeBtn').addEventListener('click', () => {
    applyFontSize('20px');
    updateFormatButtons();
    document.getElementById('fontSizeXLargeBtn').classList.add('active');
});

function applyFontSize(size) {
    const selection = window.getSelection();
    if (selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);
        const selectedText = range.toString();
        
        if (selectedText) {
            // 기존 스타일을 유지하면서 폰트 크기 적용
            const span = document.createElement('span');
            span.style.fontSize = size;
            
            // 부모 요소에서 기존 스타일 복사
            const parent = range.commonAncestorContainer.nodeType === 3 
                ? range.commonAncestorContainer.parentElement 
                : range.commonAncestorContainer;
            
            if (parent && parent !== document.getElementById('lessonText')) {
                if (parent.style.fontWeight) span.style.fontWeight = parent.style.fontWeight;
                if (parent.style.textDecoration) span.style.textDecoration = parent.style.textDecoration;
                if (parent.style.backgroundColor) span.style.backgroundColor = parent.style.backgroundColor;
            }
            
            span.textContent = selectedText;
            range.deleteContents();
            range.insertNode(span);
        } else {
            // 선택된 텍스트가 없으면 현재 위치에 스타일 적용
            document.execCommand('fontSize', false, '7'); // 임시로 fontSize 사용
            const elements = document.querySelectorAll('#lessonText font[size="7"]');
            elements.forEach(el => {
                el.style.fontSize = size;
                el.removeAttribute('size');
            });
        }
    }
}

function updateFormatButtons() {
    // 선택 영역의 포맷 상태에 따라 버튼 상태 업데이트
    const selection = window.getSelection();
    if (selection.rangeCount > 0) {
        // 굵기 확인
        const isBold = document.queryCommandState('bold');
        if (isBold) {
            document.getElementById('boldBtn').classList.add('active');
        } else {
            document.getElementById('boldBtn').classList.remove('active');
        }
        
        // 밑줄 확인
        const isUnderline = document.queryCommandState('underline');
        if (isUnderline) {
            document.getElementById('underlineBtn').classList.add('active');
        } else {
            document.getElementById('underlineBtn').classList.remove('active');
        }
        
        // 폰트 크기 확인
        document.querySelectorAll('.format-tool-btn').forEach(btn => {
            if (btn.id.includes('fontSize')) {
                btn.classList.remove('active');
            }
        });
    }
}

// 리치 텍스트 에디터에서 선택 변경 시 버튼 상태 업데이트
document.getElementById('lessonText').addEventListener('mouseup', updateFormatButtons);
document.getElementById('lessonText').addEventListener('keyup', updateFormatButtons);

// 수업 내용 저장
document.getElementById('saveLessonBtn').addEventListener('click', async () => {
    const selectedPeriods = Array.from(document.querySelectorAll('.period-checkboxes input:checked')).map(cb => cb.value);
    const subject = document.getElementById('subjectSelect').value;
    const lessonTopic = document.getElementById('lessonTopic').value;
    
    if (selectedPeriods.length === 0 || !subject) {
        alert('교시와 과목을 선택해주세요.');
        return;
    }
    
    // 텍스트, 도식, 사진 모두 확인
    const textActive = document.getElementById('textInputArea').classList.contains('active');
    const drawingActive = document.getElementById('drawingArea').classList.contains('active');
    const photoActive = document.getElementById('photoInputArea')?.style.display === 'block';
    
    let textContent = '';
    let drawingContent = '';
    let photoUrl = '';
    let recordType = '';
    
    // 텍스트 내용 저장
    if (textActive) {
        textContent = document.getElementById('lessonText').innerHTML;
    }
    
    // 도식 내용 저장 (크롭 적용)
    if (drawingActive) {
        const canvas = document.getElementById('drawingCanvas');
        const ctx = canvas.getContext('2d');
        
        // 그린 부분만 감지하여 크롭
        const croppedData = cropCanvas(canvas);
        
        const textBoxes = Array.from(document.querySelectorAll('.text-box')).map(box => {
            const boxRect = box.getBoundingClientRect();
            const canvasRect = canvas.getBoundingClientRect();
            const scaleX = canvas.width / canvasRect.width;
            const scaleY = canvas.height / canvasRect.height;
            
            // 크롭 오프셋 고려하여 좌표 조정
            const boxX = (parseFloat(box.style.left) * scaleX) - croppedData.offsetX;
            const boxY = (parseFloat(box.style.top) * scaleY) - croppedData.offsetY;
            
            return {
                id: box.dataset.id,
                x: boxX,
                y: boxY,
                displayX: box.style.left,
                displayY: box.style.top,
                text: box.textContent === '텍스트 입력' ? '' : box.textContent
            };
        }).filter(box => box.x >= 0 && box.y >= 0 && box.x < croppedData.width && box.y < croppedData.height);
        
        drawingContent = JSON.stringify({ 
            canvas: croppedData.dataUrl, 
            textBoxes,
            originalWidth: canvas.width,
            originalHeight: canvas.height,
            cropOffsetX: croppedData.offsetX,
            cropOffsetY: croppedData.offsetY,
            cropWidth: croppedData.width,
            cropHeight: croppedData.height
        });
    }
    
    // 사진 업로드
    if (photoActive && uploadedPhoto) {
        try {
            const today = format(new Date(), 'yyyy-MM-dd');
            const timestamp = Date.now();
            const photoRef = ref(storage, `students/${currentUser.uid}/lessons/${today}_${timestamp}_photo.jpg`);
            await uploadBytes(photoRef, uploadedPhoto);
            photoUrl = await getDownloadURL(photoRef);
        } catch (error) {
            console.error('사진 업로드 오류:', error);
            alert('사진 업로드 중 오류가 발생했습니다.');
            return;
        }
    }
    
    // 기록 타입 결정
    const activeTypes = [];
    if (textActive) activeTypes.push('text');
    if (drawingActive) activeTypes.push('drawing');
    if (photoActive) activeTypes.push('photo');
    
    if (activeTypes.length === 0) {
        alert('텍스트, 도식, 사진 중 하나 이상을 선택해주세요.');
        return;
    }
    
    recordType = activeTypes.join('_');
    
    // 통합 콘텐츠 생성
    const content = JSON.stringify({
        text: textContent,
        drawing: drawingContent,
        photo: photoUrl,
        hasText: textActive,
        hasDrawing: drawingActive,
        hasPhoto: photoActive
    });
    
    const today = format(new Date(), 'yyyy-MM-dd');
    
    for (const period of selectedPeriods) {
        const lessonRef = doc(db, 'students', currentUser.uid, 'lessons', `${today}_${period}`);
        const lessonData = {
            date: today,
            period: parseInt(period),
            subject: subject,
            topic: lessonTopic,
            content: content,
            recordType: recordType,
            timestamp: new Date(),
            updatedAt: new Date()
        };
        if (photoUrl) {
            lessonData.photoUrl = photoUrl;
        }
        await setDoc(lessonRef, lessonData, { merge: true });
    }
    
    // 저장 후 초기화
    if (photoActive) {
        uploadedPhoto = null;
        const previewContainer = document.getElementById('photoPreviewContainer');
        if (previewContainer) {
            previewContainer.innerHTML = '';
        }
        document.getElementById('photoFileInput').value = '';
        document.querySelector('.record-type-btn[data-type="photo"]')?.classList.remove('active');
        document.getElementById('photoInputArea').style.display = 'none';
    }
    
    console.log('저장 완료:', selectedPeriods, subject, recordType);
    
    // 폼 초기화
    resetLessonForm();
    
    // 축하 효과 및 메시지 표시
    showSuccessMessage();
    
    // 저장 후 확인 탭으로 자동 전환
    setTimeout(() => {
        const reviewBtn = document.querySelector('.lesson-tab-btn[data-lesson-tab="review"]');
        if (reviewBtn) {
            reviewBtn.click();
            // 탭 전환 후 데이터 로드 확인
            setTimeout(() => {
                loadReviewLessons();
            }, 200);
        }
    }, 2500); // 축하 메시지가 사라진 후 전환
});

// 배움공책 폼 초기화 함수
function resetLessonForm() {
    // 교시 선택 초기화
    document.querySelectorAll('.period-checkboxes input[type="checkbox"]').forEach(cb => {
        cb.checked = false;
    });
    
    // 과목 선택 초기화
    document.getElementById('subjectSelect').value = '';
    
    // 배움 주제 초기화
    document.getElementById('lessonTopic').value = '';
    
    // 텍스트 입력 영역 초기화
    const lessonText = document.getElementById('lessonText');
    lessonText.innerHTML = '';
    textHistory = [];
    textHistoryIndex = -1;
    saveTextState(); // 빈 상태 저장
    updateTextUndoButton();
    
    // 도식 영역 초기화
    const canvas = document.getElementById('drawingCanvas');
    if (canvas) {
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
    
    // 사진 영역 초기화
    uploadedPhoto = null;
    const photoPreviewContainer = document.getElementById('photoPreviewContainer');
    if (photoPreviewContainer) {
        photoPreviewContainer.innerHTML = '';
    }
    const photoFileInput = document.getElementById('photoFileInput');
    if (photoFileInput) {
        photoFileInput.value = '';
    }
    document.querySelector('.record-type-btn[data-type="photo"]')?.classList.remove('active');
    const photoInputArea = document.getElementById('photoInputArea');
    if (photoInputArea) {
        photoInputArea.style.display = 'none';
    }
    
    // 텍스트 상자 제거
    const textBoxes = document.getElementById('textBoxes');
    if (textBoxes) {
        textBoxes.innerHTML = '';
    }
    
    // 도식 히스토리 초기화
    canvasHistory = [];
    historyIndex = -1;
    maxHistoryIndex = -1;
    if (canvasInitialized) {
        saveCanvasState();
        updateUndoButton();
        updateRedoButton();
    }
    
    // 기록 방식 버튼 초기화
    document.querySelectorAll('.record-type-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    
    // 입력 영역 비활성화
    document.getElementById('textInputArea').classList.remove('active');
    document.getElementById('drawingArea').classList.remove('active');
}

// 종례 감정일기
const closingChatMessages = [];
const closingSystemMessage = "너는 초등학생 친구와 하루를 마무리하면서 이야기를 들어 주는 따뜻한 감정 상담 챗봇이야. 항상 반말을 쓰고, 친구처럼 편하게 이야기해 줘. 학생의 아침 감정과 지금 감정을 함께 돌아보면서, 부담스럽지 않게 긍정적인 관점을 보여 줘. 문장은 너무 길지 않게, 한두 문장 정도로 짧고 자연스럽게 답해.";
let closingTabInitialized = false; // 종례 탭 초기화 여부

document.getElementById('sendClosingChatBtn').addEventListener('click', sendClosingMessage);
const closingChatInputEl = document.getElementById('closingChatInput');
if (closingChatInputEl) {
    closingChatInputEl.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            // 정리 문장 입력 단계에서는 Enter 키로 전송하지 않음
            if (!closingSummaryRequested) {
                sendClosingMessage();
            }
        }
    });
    
    // 정리 문장 입력 단계에서 입력창 값이 변경될 때마다 실시간으로 저장
    closingChatInputEl.addEventListener('input', () => {
        if (closingSummaryRequested) {
            closingSummaryText = closingChatInputEl.value.trim();
            // 전송 버튼 표시 상태 업데이트
            updateClosingSubmitButtonVisibility();
        }
    });
    
    // 정리 문장 입력 단계에서 입력창 클릭 시 이전 내용 제거
    closingChatInputEl.addEventListener('focus', () => {
        if (closingSummaryRequested && closingChatInputEl.value === closingSummaryText) {
            closingChatInputEl.value = '';
            closingSummaryText = '';
        }
    });
}

// 종례시간 탭 초기화
async function initClosingTab() {
    // 이미 초기화되었거나 채팅이 시작된 경우 다시 초기화하지 않음
    if (closingTabInitialized || closingChatMessages.length > 0) {
        return;
    }
    
    // 아침 감정 데이터 불러오기
    if (!currentUser) return;
    
    const today = format(new Date(), 'yyyy-MM-dd');
    const emotionRef = doc(db, 'students', currentUser.uid, 'emotions', today);
    const emotionSnap = await getDoc(emotionRef);
    
    let morningEmotionData = null;
    let morningChatData = [];
    
    let morningSummary = '';
    if (emotionSnap.exists()) {
        const data = emotionSnap.data();
        if (data.morningEmotion && data.morningRecorded) {
            morningEmotionData = data.morningEmotion;
            morningChatData = data.morningChat || [];
            morningEmotion = data.morningEmotion;
            morningSummary = data.morningSummary || '';
        }
    }
    
    // 아침 감정이 있으면 챗봇이 먼저 질문
    if (emotionSnap.exists()) {
        const emotionData = emotionSnap.data();
        morningSummary = emotionData.morningSummary || ''; // 아침 정리 문장
        
        let greetingMessage = '';
        
        // 아침 정리 문장이 있으면 직접 인용해서 물어보기 (여러 패턴 중 랜덤)
        if (morningSummary) {
            const summaryGreetings = [
                `아침에 "${morningSummary}"라고 말했었잖아! 지금은 기분이 좀 달라졌어? 😊`,
                `오늘 아침에는 "${morningSummary}"라고 정리했는데, 하루를 보내보니 지금 마음은 어때? 😄`,
                `"${morningSummary}" 이런 기분으로 시작했었지? 지금은 그때랑 비교하면 어때 보여? 🤔`,
                `아침에 "${morningSummary}"라고 했던 거 기억나? 지금 마음을 한 번 더 이야기해 줄래? 💭`,
                `"${morningSummary}"로 하루를 열었는데, 지금 네 마음 날씨는 어떤지 궁금하다! 🌤️`
            ];
            greetingMessage = summaryGreetings[Math.floor(Math.random() * summaryGreetings.length)];
        } else if (morningEmotionData) {
            // 정리 문장이 없고 이모지만 있는 경우
            const emojiGreetings = [
                `아침에는 ${morningEmotionData} 이런 느낌이었지? 지금은 기분이 어떻게 바뀌었어? 😊`,
                `오늘 아침 기분이 ${morningEmotionData}였는데, 지금은 어떤 기분이야? 😄`,
                `아침엔 ${morningEmotionData} 느낌이었다면, 지금 마음은 조금 달라졌을까? 🤔`,
                `하루를 보내보니까, 아침의 ${morningEmotionData} 기분이랑 지금 기분이랑 뭐가 제일 다른 것 같아? 💭`,
                `아침에 느꼈던 ${morningEmotionData} 기분, 지금 생각하면 어때 보여? 🌈`
            ];
            greetingMessage = emojiGreetings[Math.floor(Math.random() * emojiGreetings.length)];
        }
        
        if (greetingMessage) {
            // 챗봇 메시지를 채팅 히스토리에 추가하고 화면에 표시
            closingChatMessages.push({ role: 'assistant', content: greetingMessage });
            addChatMessage('assistant', greetingMessage, 'closingChatMessages', true);
        }
        
        closingTabInitialized = true;
    } else {
        // 아침 감정이 없으면 기본 인사 (친구처럼 여러 패턴 중 랜덤)
        const defaultGreetings = [
            '오늘 하루는 어땠어? 기억에 남는 순간 하나만 들려줄래? 😊',
            '안녕! 오늘 하루를 그림으로 그리면 어떤 느낌일까? 말로 한번 표현해볼래? 🎨',
            '지금 딱 떠오르는 오늘의 기분 한 가지를 말해본다면 뭐야? 😄',
            '하루를 쭉 돌아봤을 때, 제일 먼저 생각나는 장면은 뭐야? 거기서 기분이 어땠는지도 궁금해! 🤔',
            '오늘 네 마음속에 가장 오래 남아 있는 기분은 어떤 거야? 편하게 말해줘! 💬'
        ];
        const greetingMessage = defaultGreetings[Math.floor(Math.random() * defaultGreetings.length)];
        closingChatMessages.push({ role: 'assistant', content: greetingMessage });
        addChatMessage('assistant', greetingMessage, 'closingChatMessages', true);
        closingTabInitialized = true;
    }
}

async function sendClosingMessage() {
    const input = document.getElementById('closingChatInput');
    const message = input.value.trim();
    if (!message) return;

    // 정리 문장 요청 후에는 채팅에 표시하지 않고 문장만 저장
    if (closingSummaryRequested) {
        closingSummaryText = message; // 학생이 작성한 정리 문장 저장 (채팅창에 표시 안 함)
        
        // 입력창은 그대로 유지 (학생이 계속 수정할 수 있도록)
        
        // 전송 버튼 표시 상태 업데이트
        updateClosingSubmitButtonVisibility();
        
        return; // 챗봇 응답 없음
    }

    // 일반 대화: 채팅에 메시지 표시
    // 메시지를 먼저 배열에 추가한 후 화면에 표시
    closingChatMessages.push({ role: 'user', content: message });
    addChatMessage('user', message, 'closingChatMessages');
    input.value = '';
    closingChatCount++;

    // 아침 감정 정보 포함
    let currentSystemMessage = closingSystemMessage;
    if (morningEmotion) {
        currentSystemMessage += ` 학생의 아침 감정은 ${morningEmotion}이었습니다.`;
    }
    
    // 대화 턴수에 따라 system message 동적 조정
    if (closingChatCount === 1 || closingChatCount === 2) {
        // 1-2턴: 학생이 더 자세히 이야기할 수 있도록 질문으로 끝나도록 유도
        currentSystemMessage = currentSystemMessage + " 중요: 너의 응답은 반드시 질문으로 끝나야 해. 학생이 자신의 현재 감정에 대해 더 자세히 이야기할 수 있도록 구체적이고 따뜻한 질문을 던져줘. 예: '그 기분이 어떤 느낌이었어?', '그때 뭐가 가장 기억에 남아?', '그 일이 너에게 어떤 의미였어?' 같은 식으로.";
    } else if (closingChatCount === 3) {
        // 3턴: 학생의 감정을 요약하고 정리 문장을 유도
        currentSystemMessage = currentSystemMessage + " 중요: 학생이 지금까지 이야기한 감정을 요약해주고, 학생이 스스로 감정을 한 문장으로 정리할 수 있도록 안내해줘. 질문 형태가 아닌 요약과 안내 문장으로 끝내야 해. 예: '지금까지 너가 말한 걸 정리해보면... 이제 너의 기분을 한 문장으로 정리해볼래?'";
    }

    // 로딩 표시 없이 바로 응답 표시
    try {
        const response = await callChatGPT(closingChatMessages, currentSystemMessage);
        closingChatMessages.push({ role: 'assistant', content: response });
        
        addChatMessage('assistant', response, 'closingChatMessages', true);

        // 3턴일 때: 응답 후 추가로 이모지 요청 (문장 요약은 이미 system message에서 유도됨)
        if (closingChatCount === 3 && !closingSummaryRequested) {
            const responseLength = response.length;
            const typingDelay = responseLength * 30; // 타이핑 시간 계산
            
            setTimeout(() => {
                const emojiMessages = [
                    '이제 그 기분을 이모티콘으로 표현해볼래? 😊',
                    '지금 기분을 나타내는 이모티콘 하나 골라줄래? 😄',
                    '이 기분을 이모티콘으로 보여줄 수 있을까? 🤔',
                    '딱 맞는 이모티콘 하나 골라서 표현해봐! 💭',
                    '어울리는 이모티콘 하나 찍어줄래? ✨',
                    '지금 이 마음을 이모티콘으로 보여줘! 🎨'
                ];
                const emojiMessage = emojiMessages[Math.floor(Math.random() * emojiMessages.length)];
                closingChatMessages.push({ role: 'assistant', content: emojiMessage });
                addChatMessage('assistant', emojiMessage, 'closingChatMessages', true);
                closingSummaryRequested = true;
                
                // 정리 문장 요청 후 이모지 선택 화면 표시
                setTimeout(() => {
                    const closingEmotionSelection = document.getElementById('closingEmotionSelection');
                    if (closingEmotionSelection) {
                        closingEmotionSelection.style.display = 'block';
                    }
                    
                    // 입력창 placeholder 변경
                    const closingChatInput = document.getElementById('closingChatInput');
                    if (closingChatInput) {
                        closingChatInput.placeholder = '나의 감정을 한 문장으로 정리해보세요';
                    }
                    
                    // 일반 전송 버튼 숨기기
                    const sendClosingChatBtn = document.getElementById('sendClosingChatBtn');
                    if (sendClosingChatBtn) {
                        sendClosingChatBtn.style.display = 'none';
                    }
                    
                    // 전송 버튼 표시 상태 업데이트
                    updateClosingSubmitButtonVisibility();
                }, 2000);
            }, typingDelay + 500);
        }
    } catch (error) {
        addChatMessage('assistant', '미안, 뭔가 오류가 난 것 같아. 잠시 후에 다시 한 번 시도해 줄래?', 'closingChatMessages', true);
        console.error(error);
    }
}

// 종례 전송 버튼 표시 상태 업데이트 함수
function updateClosingSubmitButtonVisibility() {
    const submitBtn = document.getElementById('submitBtn');
    if (!submitBtn) return;
    
    // 입력창의 값도 확인
    const closingChatInput = document.getElementById('closingChatInput');
    const inputValue = closingChatInput ? closingChatInput.value.trim() : '';
    
    // 문장과 이모티콘이 모두 있는지 확인 (입력창 값 또는 저장된 값)
    const hasSummary = (closingSummaryText && closingSummaryText.trim().length > 0) || inputValue.length > 0;
    const hasEmotion = closingEmotion && closingEmotion.length > 0;
    
    if (hasSummary && hasEmotion) {
        submitBtn.style.display = 'block';
    } else {
        submitBtn.style.display = 'none';
    }
}

// 종례 이모지 선택 설정
function setupClosingEmojiButtons() {
    document.querySelectorAll('#closingEmotionSelection .emoji-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            closingEmotion = btn.dataset.emoji;
            document.querySelectorAll('#closingEmotionSelection .emoji-btn').forEach(b => b.classList.remove('selected'));
            btn.classList.add('selected');
            
            // 전송 버튼 표시 상태 업데이트
            updateClosingSubmitButtonVisibility();
        });
    });
}

// 초기 종례 이모지 버튼 설정
setupClosingEmojiButtons();

// 종례 커스텀 이모지 추가
document.getElementById('addCustomClosingEmojiBtn').addEventListener('click', () => {
    const customInput = document.getElementById('customClosingEmojiInput');
    const customEmoji = customInput.value.trim();
    
    if (customEmoji && customEmoji.length <= 2) {
        // 이미 존재하는지 확인
        const existingBtn = Array.from(document.querySelectorAll('#closingEmotionSelection .emoji-btn'))
            .find(btn => btn.dataset.emoji === customEmoji);
        
        if (!existingBtn) {
            // 새로운 이모지 버튼 생성
            const emojiContainer = document.querySelector('#closingEmotionSelection .emotion-emoji');
            const newBtn = document.createElement('button');
            newBtn.className = 'emoji-btn';
            newBtn.dataset.emoji = customEmoji;
            newBtn.textContent = customEmoji;
            emojiContainer.appendChild(newBtn);
            
            // 이벤트 리스너 추가
            newBtn.addEventListener('click', () => {
                closingEmotion = newBtn.dataset.emoji;
                document.querySelectorAll('#closingEmotionSelection .emoji-btn').forEach(b => b.classList.remove('selected'));
                newBtn.classList.add('selected');
                
                updateClosingSubmitButtonVisibility();
            });
        } else {
            // 이미 존재하면 선택
            existingBtn.click();
        }
        
        customInput.value = '';
    } else {
        alert('올바른 이모지를 입력해주세요.');
    }
});

// Enter 키로도 추가 가능
document.getElementById('customClosingEmojiInput').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        document.getElementById('addCustomClosingEmojiBtn').click();
    }
});

// 배움공책 제출 (종례시간에만 가능)
document.getElementById('submitBtn').addEventListener('click', async () => {
    // 중복 제출 방지
    if (closingSubmitted) {
        return;
    }
    
    // 입력창의 최종 값을 확인하여 저장
    const closingChatInput = document.getElementById('closingChatInput');
    if (closingChatInput && closingChatInput.value.trim()) {
        closingSummaryText = closingChatInput.value.trim();
    }
    
    if (!closingEmotion || !closingSummaryText) {
        alert('감정 문장과 이모티콘을 모두 선택해주세요.');
        return;
    }
    
    // 제출 시작 플래그 설정 (중복 방지)
    closingSubmitted = true;
    
    // 학생이 입력한 문장과 이모티콘을 챗봇 화면에 표시 및 메시지 배열에 추가
    const summaryWithEmoji = `${closingSummaryText} ${closingEmotion}`;
    addChatMessage('user', summaryWithEmoji, 'closingChatMessages');
    closingChatMessages.push({ role: 'user', content: summaryWithEmoji });
    
    const today = format(new Date(), 'yyyy-MM-dd');
    
    // 종례 감정 저장
    const emotionRef = doc(db, 'students', currentUser.uid, 'emotions', today);
    await setDoc(emotionRef, {
        closingEmotion: closingEmotion,
        closingSummary: closingSummaryText,
        closingChat: closingChatMessages,
        submitted: true,
        submittedAt: new Date()
    }, { merge: true });
    
    // 제출 상태 저장
    const submissionRef = doc(db, 'submissions', `${currentUser.uid}_${today}`);
    await setDoc(submissionRef, {
        studentId: currentUser.uid,
        studentName: currentUser.displayName || currentUser.email,
        date: today,
        submittedAt: new Date(),
        status: 'pending'
    });
    
    // 팡파레 효과 표시
    createConfetti();
    
    // 성공 메시지 표시 (이미 존재하는 경우 제거)
    const existingMessage = document.getElementById('submitSuccessMessage');
    if (existingMessage) {
        existingMessage.remove();
    }
    
    const successMessage = document.createElement('div');
    successMessage.id = 'submitSuccessMessage';
    successMessage.className = 'success-message animate__animated animate__zoomIn';
    successMessage.innerHTML = `
        <div class="success-content animate__animated animate__pulse animate__infinite">
            <div class="success-icon animate__animated animate__bounce animate__infinite">🎉</div>
            <div class="success-text">배움공책이 제출되었어요!</div>
            <div class="celebration-subtext">선생님의 피드백을 기다려주세요! 💫</div>
        </div>
    `;
    document.body.appendChild(successMessage);
    
    setTimeout(() => {
        successMessage.classList.add('show');
    }, 10);
    
    setTimeout(() => {
        successMessage.classList.remove('show');
        setTimeout(() => {
            successMessage.remove();
        }, 500);
    }, 3000);
    
    // 제출 후 버튼 비활성화
    document.getElementById('submitBtn').style.display = 'none';
});

// 포도 송이 렌더링
async function renderGrapeClusters() {
    if (!currentUser) return;
    
    const container = document.getElementById('grapeClusters');
    container.innerHTML = '<p class="loading">포도알을 불러오는 중...</p>';
    
    try {
        // 모든 감정 기록 가져오기 (교사 피드백이 있는 것만)
        const emotionsRef = collection(db, 'students', currentUser.uid, 'emotions');
        const emotionsSnapshot = await getDocs(emotionsRef);
        
        const grapesWithFeedback = [];
        
        for (const docSnap of emotionsSnapshot.docs) {
            const data = docSnap.data();
            if (!data.date) continue;

            // 새 구조: feedbacks 배열에 여러 개의 피드백이 들어있는 경우
            if (Array.isArray(data.feedbacks) && data.feedbacks.length > 0) {
                data.feedbacks.forEach(feedback => {
                    if (!feedback || !feedback.emoji) return;
                    grapesWithFeedback.push({
                        date: data.date,
                        emoji: feedback.emoji,
                        feedback: feedback.text || null,
                        evaluatedAt: feedback.createdAt || data.evaluatedAt || null
                    });
                });
            } else if (data.teacherEmoji) {
                // 기존 구조(단일 teacherEmoji/teacherFeedback)도 그대로 지원
                grapesWithFeedback.push({
                    date: data.date,
                    emoji: data.teacherEmoji,
                    feedback: data.teacherFeedback || null,
                    evaluatedAt: data.evaluatedAt || null
                });
            }
        }
        
        // 날짜 순으로 정렬
        grapesWithFeedback.sort((a, b) => a.date.localeCompare(b.date));
        
        const totalGrapes = grapesWithFeedback.length;
        const completedClusters = Math.floor(totalGrapes / 30);
        const currentClusterGrapes = totalGrapes % 30;
        
        // 통계 업데이트
        document.getElementById('grapeCount').textContent = totalGrapes;
        document.getElementById('clusterCount').textContent = completedClusters;
        
        container.innerHTML = '';
        
        // 완성된 송이들 표시
        for (let i = 0; i < completedClusters; i++) {
            const clusterStart = i * 30;
            const clusterEnd = (i + 1) * 30;
            const clusterGrapes = grapesWithFeedback.slice(clusterStart, clusterEnd);
            const cluster = createGrapeCluster(clusterGrapes, i + 1, true);
            container.appendChild(cluster);
        }
        
        // 현재 진행 중인 송이 표시
        if (currentClusterGrapes > 0) {
            const currentClusterGrapes = grapesWithFeedback.slice(completedClusters * 30);
            const cluster = createGrapeCluster(currentClusterGrapes, completedClusters + 1, false);
            container.appendChild(cluster);
        }
        
        // 완성된 송이가 있으면 효과 표시
        if (completedClusters > 0) {
            showClusterCompletionEffect(completedClusters);
        }
        
    } catch (error) {
        console.error('포도알 로드 오류:', error);
        container.innerHTML = '<p class="error-message">포도알을 불러오는 중 오류가 발생했습니다.</p>';
    }
}

// 숫자를 한글 서수로 변환하는 함수
function getKoreanOrdinal(number) {
    const ordinals = ['', '첫', '두', '세', '네', '다섯', '여섯', '일곱', '여덟', '아홉', '열'];
    if (number <= 10) {
        return ordinals[number];
    } else {
        return number + '번째';
    }
}

function createGrapeCluster(grapes, clusterNumber, isComplete) {
    const clusterDiv = document.createElement('div');
    clusterDiv.className = `grape-cluster ${isComplete ? 'complete' : 'in-progress'}`;
    
    const koreanOrdinal = getKoreanOrdinal(clusterNumber);
    const clusterHeader = document.createElement('div');
    clusterHeader.className = 'cluster-header';
    clusterHeader.innerHTML = `
        <h3>${isComplete ? '🍇' : '🍇'} ${koreanOrdinal} 번째 송이 ${isComplete ? '완성한 포도송이' : `(${grapes.length}/30)`}</h3>
    `;
    clusterDiv.appendChild(clusterHeader);
    
    const grapesContainer = document.createElement('div');
    grapesContainer.className = 'grapes-container';
    
    // 포도 송이 형태: 위에서 아래로 갈수록 좁아지는 형태
    // 맨 윗줄부터 6알, 5알, 5알, 4알, 4알, 3알, 2알, 1알 순서
    const rowPattern = [6, 5, 5, 4, 4, 3, 2, 1]; // 각 행의 포도알 수
    const totalSlots = 30; // 총 30개 슬롯
    
    grapes.forEach((grape, index) => {
        const grapeDiv = document.createElement('div');
        grapeDiv.className = 'grape-item';
        grapeDiv.dataset.date = grape.date;
        
        // 행과 열 계산
        let row = 0;
        let col = 0;
        let grapesSoFar = 0;
        
        for (let r = 0; r < rowPattern.length; r++) {
            const grapesInRow = rowPattern[r];
            if (grapesSoFar + grapesInRow > index) {
                row = r;
                col = index - grapesSoFar;
                break;
            }
            grapesSoFar += grapesInRow;
        }
        
        // 행의 중심을 기준으로 배치 (위쪽이 넓고 아래쪽이 좁게)
        const grapesInRow = rowPattern[row];
        const colOffset = (col - (grapesInRow - 1) / 2) * 105; // 포도알 간격 (더 크게, 포도알 확대)
        
        // 포도 송이 형태: 위에서 아래로
        const baseX = colOffset;
        const baseY = row * 105; // 행 간격 (더 크게, 포도알 확대)
        
        // 자연스러운 중첩 효과를 위한 랜덤 오프셋 (더 크게)
        const offsetX = baseX + (Math.random() - 0.5) * 50; // -25 ~ 25px (중첩감 증가)
        const offsetY = baseY + (Math.random() - 0.5) * 50; // -25 ~ 25px
        const rotation = (Math.random() - 0.5) * 35; // -17.5 ~ 17.5도
        const scale = 1.1 + Math.random() * 0.25; // 1.1 ~ 1.35 (포도알 더 크게)
        
        // z-index: 위쪽 포도알이 아래쪽 포도알 위에 오도록
        const zIndex = (rowPattern.length - row) * 10 + Math.floor(Math.random() * 10);
        
        grapeDiv.style.position = 'absolute';
        grapeDiv.style.left = `calc(50% + ${offsetX}px)`;
        grapeDiv.style.top = `${offsetY + 40}px`; // 헤더 공간 확보
        grapeDiv.style.transform = `translate(-50%, -50%) rotate(${rotation}deg) scale(${scale})`;
        grapeDiv.style.zIndex = zIndex;
        
        grapeDiv.innerHTML = `
            <div class="grape-emoji">${grape.emoji}</div>
            <div class="grape-date">${format(new Date(grape.date), 'M/d')}</div>
            ${grape.feedback ? `<div class="grape-feedback-bubble" title="${grape.feedback}">💬</div>` : ''}
        `;
        
        // 클릭 이벤트
        grapeDiv.addEventListener('click', () => showGrapeDetail(grape.date, grape.emoji, grape.feedback));
        
        grapesContainer.appendChild(grapeDiv);
    });
    
    // 빈 포도알 자리 표시 (30개 미만인 경우) - 연한 테두리로 표시
    if (!isComplete) {
        const emptySlots = 30 - grapes.length;
        const rowPattern = [6, 5, 5, 4, 4, 3, 2, 1]; // 각 행의 포도알 수
        
        for (let i = 0; i < emptySlots; i++) {
            const emptyIndex = grapes.length + i; // 빈 슬롯의 전체 인덱스
            
            // 포도 송이 형태로 빈 슬롯도 배치
            let row = 0;
            let col = 0;
            let grapesSoFar = 0;
            
            for (let r = 0; r < rowPattern.length; r++) {
                const grapesInRow = rowPattern[r];
                if (grapesSoFar + grapesInRow > emptyIndex) {
                    row = r;
                    col = emptyIndex - grapesSoFar;
                    break;
                }
                grapesSoFar += grapesInRow;
            }
            
            // 행의 중심을 기준으로 배치
            const grapesInRow = rowPattern[row];
            const colOffset = (col - (grapesInRow - 1) / 2) * 105;
            
            const baseX = colOffset;
            const baseY = row * 105;
            
            // 빈 포도알은 약간의 오프셋만 적용 (너무 랜덤하지 않게)
            const offsetX = baseX + (Math.random() - 0.5) * 45;
            const offsetY = baseY + (Math.random() - 0.5) * 45;
            const rotation = (Math.random() - 0.5) * 25;
            const scale = 1.0 + Math.random() * 0.2;
            
            const zIndex = (rowPattern.length - row) * 10 + Math.floor(Math.random() * 8);
            
            const emptyGrape = document.createElement('div');
            emptyGrape.className = 'grape-item empty';
            emptyGrape.style.position = 'absolute';
            emptyGrape.style.left = `calc(50% + ${offsetX}px)`;
            emptyGrape.style.top = `${offsetY + 40}px`;
            emptyGrape.style.transform = `translate(-50%, -50%) rotate(${rotation}deg) scale(${scale})`;
            emptyGrape.style.zIndex = zIndex;
            emptyGrape.innerHTML = '<div class="grape-emoji empty-emoji">○</div>';
            grapesContainer.appendChild(emptyGrape);
        }
    }
    
    clusterDiv.appendChild(grapesContainer);
    return clusterDiv;
}

async function showGrapeDetail(dateStr, emoji, feedbackText = null) {
    if (!currentUser) return;
    
    const modal = document.getElementById('grapeDetailModal');
    const dateElement = document.getElementById('grapeDetailDate');
    const contentElement = document.getElementById('grapeDetailContent');
    
    dateElement.textContent = format(new Date(dateStr), 'yyyy년 M월 d일');
    contentElement.innerHTML = '<p class="loading">로딩 중...</p>';
    modal.style.display = 'flex';
    
    try {
        // 감정 정보 가져오기
        const emotionRef = doc(db, 'students', currentUser.uid, 'emotions', dateStr);
        const emotionSnap = await getDoc(emotionRef);
        
        // 수업 기록 가져오기
        const lessonsRef = collection(db, 'students', currentUser.uid, 'lessons');
        const lessonsQuery = query(lessonsRef, where('date', '==', dateStr));
        const lessonsSnapshot = await getDocs(lessonsQuery);
        
        let html = '';
        
        // 교사 피드백 표시
        const emotionData = emotionSnap.exists() ? emotionSnap.data() : {};
        const feedback = feedbackText || emotionData.teacherFeedback || null;
        html += `
            <div class="grape-feedback-section">
                <h3>🎯 선생님 피드백</h3>
                <div class="teacher-feedback-emoji" style="font-size: 3em; text-align: center; margin: 15px 0;">${emoji}</div>
                ${feedback ? `
                    <div class="teacher-feedback-bubble">
                        <p>${feedback}</p>
                    </div>
                ` : ''}
                ${emotionData.evaluatedAt ? `<p class="feedback-date" style="text-align: center; color: #666; font-size: 0.9em; margin-top: 10px;">${format(emotionData.evaluatedAt.toDate(), 'yyyy년 M월 d일')}</p>` : ''}
            </div>
        `;
        
        // 아침 감정 + 정리 문장
        if (emotionSnap.exists() && emotionSnap.data().morningEmotion) {
            const morningData = emotionSnap.data();
            const morningSummary = morningData.morningSummary || '';
            html += `
                <div class="grape-detail-section">
                    <h4>🌅 아침 기분</h4>
                    <div class="emotion-summary-row">
                        <div class="emotion-display">${morningData.morningEmotion}</div>
                        ${morningSummary ? `
                            <div class="morning-summary-bubble">
                                “${morningSummary}”
                            </div>
                        ` : ''}
                    </div>
                </div>
            `;
        }
        
        // 수업 기록 (블럭타임 그룹화하여 표시)
        if (!lessonsSnapshot.empty) {
            html += '<div class="grape-detail-section"><h4>📝 수업 기록</h4>';
            
            // 데이터를 배열로 변환하고 교시 순서로 정렬
            const lessonsArray = [];
            lessonsSnapshot.forEach(doc => {
                const lesson = doc.data();
                lessonsArray.push(lesson);
            });
            
            lessonsArray.sort((a, b) => (a.period || 0) - (b.period || 0));
            
            // 연속된 교시를 그룹화 (같은 과목, 같은 내용)
            const groupedLessons = [];
            let currentGroup = null;
            
            lessonsArray.forEach(lesson => {
                const contentKey = lesson.content;
                const subjectKey = lesson.subject;
                
                if (currentGroup && 
                    currentGroup.subject === subjectKey && 
                    currentGroup.content === contentKey &&
                    currentGroup.periods[currentGroup.periods.length - 1] === lesson.period - 1) {
                    // 연속된 교시이고 같은 내용이면 그룹에 추가
                    currentGroup.periods.push(lesson.period);
                    currentGroup.lessons.push(lesson);
                } else {
                    // 새로운 그룹 생성
                    currentGroup = {
                        subject: subjectKey,
                        content: contentKey,
                        topic: lesson.topic,
                        periods: [lesson.period],
                        lessons: [lesson]
                    };
                    groupedLessons.push(currentGroup);
                }
            });
            
            // 그룹화된 수업 기록 표시
            groupedLessons.forEach(group => {
                const periodDisplay = group.periods.length > 1 
                    ? `${group.periods[0]}, ${group.periods[1]}교시` 
                    : `${group.periods[0]}교시`;
                
                const firstLesson = group.lessons[0];
                html += `
                    <div class="lesson-item" style="margin-bottom: 25px; padding: 15px; background: #f8f9fa; border-radius: 10px;">
                        <div class="lesson-header">
                            <span class="lesson-period" style="background: #a08bc8; color: white; padding: 4px 10px; border-radius: 5px; font-size: 0.9em; font-weight: bold;">${periodDisplay}</span>
                            <span class="lesson-subject" style="font-weight: bold; color: #333; margin-left: 10px;">${firstLesson.subject}</span>
                        </div>
                        ${firstLesson.topic ? `<div class="lesson-topic" style="margin-top: 8px; color: #666; font-size: 0.95em;"><strong>배움 주제:</strong> ${firstLesson.topic}</div>` : ''}
                        <div class="lesson-content" style="margin-top: 15px;">
                `;
                    
                    // 새로운 형식 (both, text, drawing) 처리
                    try {
                        const contentData = JSON.parse(firstLesson.content);
                        
                        // 새로운 형식인지 확인 (hasText, hasDrawing 속성 존재)
                        if (contentData.hasText !== undefined && contentData.hasDrawing !== undefined) {
                            // 텍스트 내용 표시
                            if (contentData.hasText && contentData.text) {
                                html += `<div style="line-height: 1.6; margin-bottom: 15px; padding: 10px; background: white; border-radius: 8px;">${contentData.text}</div>`;
                            }
                            
                            // 도식 내용 표시
                            if (contentData.hasDrawing && contentData.drawing) {
                                try {
                                    const drawingData = JSON.parse(contentData.drawing);
                                    html += `
                                        <div class="drawing-preview" style="position: relative; display: inline-block; margin-top: 10px;">
                                            <img src="${drawingData.canvas}" alt="도식" style="max-width: 100%; border: 1px solid #ddd; display: block; border-radius: 8px;" />
                                            ${drawingData.textBoxes ? drawingData.textBoxes.map(box => `
                                                <div class="text-box-preview" style="position: absolute; left: ${box.displayX || box.x}; top: ${box.displayY || box.y}; background: rgba(255,255,255,0.9); padding: 5px; border: 1px solid #a08bc8; border-radius: 3px; font-size: 0.9em;">
                                                    ${box.text}
                                                </div>
                                            `).join('') : ''}
                                        </div>
                                    `;
                                } catch (e) {
                                    html += `<p>도식 데이터를 불러올 수 없습니다.</p>`;
                                }
                            }
                        } else {
                            // 기존 형식 처리 (recordType 기반)
                            if (firstLesson.recordType === 'text' || firstLesson.recordType === 'both') {
                                html += `<div style="line-height: 1.6; padding: 10px; background: white; border-radius: 8px;">${firstLesson.content}</div>`;
                            }
                            
                            if (firstLesson.recordType === 'drawing' || firstLesson.recordType === 'both') {
                                // 도식 데이터 파싱
                                try {
                                    const drawingData = JSON.parse(firstLesson.content);
                                    html += `
                                        <div class="drawing-preview" style="position: relative; display: inline-block; margin-top: 10px;">
                                            <img src="${drawingData.canvas}" alt="도식" style="max-width: 100%; border: 1px solid #ddd; display: block; border-radius: 8px;" />
                                            ${drawingData.textBoxes ? drawingData.textBoxes.map(box => `
                                                <div class="text-box-preview" style="position: absolute; left: ${box.displayX || box.x}; top: ${box.displayY || box.y}; background: rgba(255,255,255,0.9); padding: 5px; border: 1px solid #a08bc8; border-radius: 3px; font-size: 0.9em;">
                                                    ${box.text}
                                                </div>
                                            `).join('') : ''}
                                        </div>
                                    `;
                                } catch (e) {
                                    html += `<p>도식 데이터를 불러올 수 없습니다.</p>`;
                                }
                            }
                        }
                    } catch (e) {
                        // JSON 파싱 실패 시 텍스트로 처리
                        html += `<div style="line-height: 1.6; padding: 10px; background: white; border-radius: 8px;">${firstLesson.content}</div>`;
                    }
                    
                    html += `</div></div>`;
                });
            
            html += '</div>';
        }
        
        // 종례 감정
        if (emotionSnap.exists() && emotionSnap.data().closingEmotion) {
            const emotionData = emotionSnap.data();
            html += `
                <div class="grape-detail-section">
                    <h4>🌙 종례 기분</h4>
                    <div class="emotion-display">${emotionData.closingEmotion}</div>
                </div>
            `;
        }
        
        contentElement.innerHTML = html || '<p>내용이 없습니다.</p>';
        
    } catch (error) {
        console.error('포도알 상세 정보 로드 오류:', error);
        contentElement.innerHTML = '<p class="error-message">정보를 불러오는 중 오류가 발생했습니다.</p>';
    }
}

function showClusterCompletionEffect(clusterCount) {
    // 완성 효과는 자동으로 표시되도록 설정
    // 첫 번째 완성 시에만 애니메이션 표시
    if (clusterCount === 1) {
        const celebration = document.createElement('div');
        celebration.className = 'cluster-celebration animate__animated animate__zoomIn';
        celebration.innerHTML = `
            <div class="celebration-content animate__animated animate__pulse animate__infinite">
                <div class="celebration-icon animate__animated animate__bounce animate__infinite">🍇</div>
                <div class="celebration-text">첫 번째 포도 송이 완성!</div>
                <div class="celebration-subtext">축하합니다! 🎉</div>
            </div>
        `;
        document.body.appendChild(celebration);
        
        setTimeout(() => {
            celebration.classList.add('show');
        }, 100);
        
        setTimeout(() => {
            celebration.classList.remove('show');
            setTimeout(() => celebration.remove(), 500);
        }, 3000);
    }
}

// 모달 닫기
document.getElementById('closeGrapeModal')?.addEventListener('click', () => {
    document.getElementById('grapeDetailModal').style.display = 'none';
});

// 모달 배경 클릭 시 닫기
document.getElementById('grapeDetailModal')?.addEventListener('click', (e) => {
    if (e.target.id === 'grapeDetailModal') {
        document.getElementById('grapeDetailModal').style.display = 'none';
    }
});

// 과목별 필터 변경 이벤트
const subjectFilter = document.getElementById('subjectFilter');
if (subjectFilter) {
    subjectFilter.addEventListener('change', async (e) => {
        const selectedSubject = e.target.value;
        if (!selectedSubject) {
            document.getElementById('subjectLessonsContainer').innerHTML = '<p class="empty-message">과목을 선택하면 해당 과목의 공책 내용을 모아서 볼 수 있어요!</p>';
            return;
        }
        
        await loadSubjectLessons(selectedSubject);
    });
}

// 과목별 공책 내용 로드
async function loadSubjectLessons(subject) {
    if (!currentUser) return;
    
    const container = document.getElementById('subjectLessonsContainer');
    if (!container) return;
    
    container.innerHTML = '<p class="loading">로딩 중...</p>';
    
    try {
        const lessonsRef = collection(db, 'students', currentUser.uid, 'lessons');
        const lessonsQuery = query(lessonsRef, where('subject', '==', subject));
        const lessonsSnapshot = await getDocs(lessonsQuery);
        
        if (lessonsSnapshot.empty) {
            container.innerHTML = `<p class="empty-message">${subject} 과목의 공책 내용이 없습니다.</p>`;
            return;
        }
        
        const lessonsByDate = {};
        lessonsSnapshot.forEach(doc => {
            const lesson = doc.data();
            if (!lessonsByDate[lesson.date]) {
                lessonsByDate[lesson.date] = [];
            }
            lessonsByDate[lesson.date].push(lesson);
        });
        
        // 날짜 순으로 정렬 (최신순)
        const sortedDates = Object.keys(lessonsByDate).sort((a, b) => b.localeCompare(a));
        
        let html = `<h3 style="margin-bottom: 20px; color: #a08bc8;">${subject} 공책 모음 (${lessonsSnapshot.size}개)</h3>`;
        
        sortedDates.forEach(date => {
            const lessons = lessonsByDate[date];
            html += `
                <div class="subject-lesson-date-section" style="margin-bottom: 30px; padding: 20px; background: #f8f9fa; border-radius: 12px;">
                    <h4 style="color: #333; margin-bottom: 15px; font-size: 1.2em;">${format(new Date(date), 'yyyy년 M월 d일')}</h4>
            `;
            
            // 교시 순서로 정렬
            const sortedLessons = lessons.sort((a, b) => (a.period || 0) - (b.period || 0));
            
            // 연속된 교시를 그룹화 (같은 과목, 같은 내용)
            const groupedLessons = [];
            let currentGroup = null;
            
            sortedLessons.forEach(lesson => {
                const contentKey = lesson.content;
                
                if (currentGroup && 
                    currentGroup.content === contentKey &&
                    currentGroup.periods[currentGroup.periods.length - 1] === lesson.period - 1) {
                    // 연속된 교시이고 같은 내용이면 그룹에 추가
                    currentGroup.periods.push(lesson.period);
                    currentGroup.lessons.push(lesson);
                } else {
                    // 새로운 그룹 생성
                    currentGroup = {
                        content: contentKey,
                        topic: lesson.topic,
                        periods: [lesson.period],
                        lessons: [lesson]
                    };
                    groupedLessons.push(currentGroup);
                }
            });
            
            // 그룹화된 수업 기록 표시
            groupedLessons.forEach(group => {
                const periodDisplay = group.periods.length > 1 
                    ? `${group.periods.join(', ')}교시` 
                    : `${group.periods[0]}교시`;
                
                const firstLesson = group.lessons[0];
                
                html += `
                    <div class="subject-lesson-item" style="margin-bottom: 20px; padding: 15px; background: white; border-radius: 10px; border-left: 4px solid #a08bc8;">
                        <div class="lesson-header" style="display: flex; gap: 10px; margin-bottom: 10px;">
                            <span class="lesson-period" style="background: #a08bc8; color: white; padding: 4px 10px; border-radius: 5px; font-size: 0.9em; font-weight: bold;">${periodDisplay}</span>
                            ${firstLesson.topic ? `<span style="font-weight: bold; color: #333;">${firstLesson.topic}</span>` : ''}
                        </div>
                        <div class="lesson-content" style="margin-top: 10px;">
                `;
                
                // 내용 표시 (교사 페이지와 동일한 로직)
                try {
                    const contentData = JSON.parse(firstLesson.content);
                    
                    if (contentData.hasText !== undefined && contentData.hasDrawing !== undefined) {
                        if (contentData.hasText && contentData.text) {
                            html += `<div style="line-height: 1.6; margin-bottom: 15px; padding: 10px; background: #fff5f0; border-radius: 8px;">${contentData.text}</div>`;
                        }
                        
                        if (contentData.hasDrawing && contentData.drawing) {
                            try {
                                const drawingData = JSON.parse(contentData.drawing);
                                html += `
                                    <div class="drawing-preview" style="position: relative; display: inline-block; margin-top: 10px;">
                                        <img src="${drawingData.canvas}" alt="도식" style="max-width: 100%; border: 1px solid #ddd; display: block; border-radius: 8px;" />
                                        ${drawingData.textBoxes ? drawingData.textBoxes.map(box => `
                                            <div class="text-box-preview" style="position: absolute; left: ${box.displayX || box.x}; top: ${box.displayY || box.y}; background: rgba(255,255,255,0.9); padding: 5px; border: 1px solid #ff6b35; border-radius: 3px; font-size: 0.9em;">
                                                ${box.text}
                                            </div>
                                        `).join('') : ''}
                                    </div>
                                `;
                            } catch (e) {
                                html += `<p>도식 데이터를 불러올 수 없습니다.</p>`;
                            }
                        }
                    } else {
                        if (firstLesson.recordType === 'text' || firstLesson.recordType === 'both') {
                            html += `<div style="line-height: 1.6; padding: 10px; background: #fff5f0; border-radius: 8px;">${firstLesson.content}</div>`;
                        }
                        
                        if (firstLesson.recordType === 'drawing' || firstLesson.recordType === 'both') {
                            try {
                                const drawingData = JSON.parse(firstLesson.content);
                                html += `
                                    <div class="drawing-preview" style="position: relative; display: inline-block; margin-top: 10px;">
                                        <img src="${drawingData.canvas}" alt="도식" style="max-width: 100%; border: 1px solid #ddd; display: block; border-radius: 8px;" />
                                        ${drawingData.textBoxes ? drawingData.textBoxes.map(box => `
                                            <div class="text-box-preview" style="position: absolute; left: ${box.displayX || box.x}; top: ${box.displayY || box.y}; background: rgba(255,255,255,0.9); padding: 5px; border: 1px solid #ff6b35; border-radius: 3px; font-size: 0.9em;">
                                                ${box.text}
                                            </div>
                                        `).join('') : ''}
                                    </div>
                                `;
                            } catch (e) {
                                html += `<p>도식 데이터를 불러올 수 없습니다.</p>`;
                            }
                        }
                    }
                } catch (e) {
                    html += `<div style="line-height: 1.6; padding: 10px; background: #fff5f0; border-radius: 8px;">${firstLesson.content}</div>`;
                }
                
                html += `</div></div>`;
            });
            
            html += `</div>`;
        });
        
        container.innerHTML = html;
        
    } catch (error) {
        console.error('과목별 공책 로드 오류:', error);
        container.innerHTML = '<p class="error-message">공책 내용을 불러오는 중 오류가 발생했습니다.</p>';
    }
}

// 유틸리티 함수
function addChatMessage(role, content, containerId, isTyping = false) {
    const container = document.getElementById(containerId);
    if (!container) {
        console.error(`Container not found: ${containerId}`);
        return null;
    }
    
    const messageWrapper = document.createElement('div');
    messageWrapper.className = `chat-message-wrapper ${role}`;
    
    const messageDiv = document.createElement('div');
    messageDiv.className = `chat-message ${role}`;
    
    const id = 'msg_' + Date.now();
    messageDiv.id = id;
    messageWrapper.appendChild(messageDiv);
    container.appendChild(messageWrapper);
    
    if (isTyping && role === 'assistant') {
        // 타이핑 효과로 표시
        typeMessage(messageDiv, content, container);
    } else {
        // 일반 메시지 (사용자 메시지)
        messageDiv.textContent = content;
        container.scrollTop = container.scrollHeight;
    }
    
    return id;
}

// 타이핑 효과 함수
function typeMessage(element, text, container) {
    let index = 0;
    element.textContent = '';
    
    const typingInterval = setInterval(() => {
        if (index < text.length) {
            element.textContent += text[index];
            index++;
            container.scrollTop = container.scrollHeight;
        } else {
            clearInterval(typingInterval);
        }
    }, 30); // 30ms마다 한 글자씩 (속도 조절 가능)
}

// 아침 감정 기록 상태 확인
async function checkMorningRecorded() {
    if (!currentUser) return;
    
    const today = format(new Date(), 'yyyy-MM-dd');
    const emotionRef = doc(db, 'students', currentUser.uid, 'emotions', today);
    const emotionSnap = await getDoc(emotionRef);
    
    if (emotionSnap.exists() && emotionSnap.data().morningRecorded) {
        showMorningRecorded();
    } else {
        document.getElementById('morningAlreadyRecorded').style.display = 'none';
        document.getElementById('morningChatContainer').style.display = 'block';
    }
}

// 수업 기록 확인하기
async function loadReviewLessons() {
    if (!currentUser) {
        console.error('currentUser가 없습니다.');
        return;
    }
    
    const today = format(new Date(), 'yyyy-MM-dd');
    const container = document.getElementById('reviewLessonsContainer');
    
    if (!container) {
        console.error('reviewLessonsContainer를 찾을 수 없습니다.');
        return;
    }
    
    container.innerHTML = '<p class="loading">로딩 중...</p>';
    
    try {
        const lessonsRef = collection(db, 'students', currentUser.uid, 'lessons');
        const lessonsQuery = query(lessonsRef, where('date', '==', today));
        const lessonsSnapshot = await getDocs(lessonsQuery);
        
        console.log('수업 기록 조회:', today, '결과 개수:', lessonsSnapshot.size);
        
        if (lessonsSnapshot.empty) {
            container.innerHTML = '<p class="empty-message">기록된 내용이 없습니다.</p>';
            return;
        }
        
        container.innerHTML = '';
        
        // 데이터를 배열로 변환하고 교시 순서로 정렬
        const lessonsArray = [];
        lessonsSnapshot.forEach(doc => {
            const lesson = doc.data();
            lessonsArray.push({ id: doc.id, ...lesson });
        });
        
        // 교시 순서로 정렬
        lessonsArray.sort((a, b) => (a.period || 0) - (b.period || 0));
        
        // 연속된 교시를 그룹화 (같은 과목, 같은 내용)
        const groupedLessons = [];
        let currentGroup = null;
        
        lessonsArray.forEach(lesson => {
            const contentKey = lesson.content; // 내용으로 그룹화
            const subjectKey = lesson.subject;
            
            if (currentGroup && 
                currentGroup.subject === subjectKey && 
                currentGroup.content === contentKey &&
                currentGroup.periods[currentGroup.periods.length - 1] === lesson.period - 1) {
                // 연속된 교시이고 같은 내용이면 그룹에 추가
                currentGroup.periods.push(lesson.period);
                currentGroup.lessons.push(lesson);
            } else {
                // 새로운 그룹 생성
                currentGroup = {
                    subject: subjectKey,
                    content: contentKey,
                    topic: lesson.topic,
                    periods: [lesson.period],
                    lessons: [lesson]
                };
                groupedLessons.push(currentGroup);
            }
        });
        
        // 그룹화된 수업 기록 표시
        groupedLessons.forEach(group => {
            console.log('그룹화된 수업 기록:', group);
            const lessonItem = document.createElement('div');
            lessonItem.className = 'review-lesson-item';
            
            // 첫 번째 레슨을 기준으로 내용 생성
            const firstLesson = group.lessons[0];
            let contentHtml = '';
            
            // 새로운 형식 (both) 또는 기존 형식 처리
            try {
                const contentData = JSON.parse(firstLesson.content);
                
                // 새로운 형식인지 확인
                if (contentData.hasText !== undefined && contentData.hasDrawing !== undefined) {
                    // 새로운 형식: 텍스트와 도식 모두 포함 가능
                    if (contentData.hasText && contentData.text) {
                        contentHtml += `<div class="review-lesson-content"><strong>텍스트:</strong><div style="margin-top: 10px;">${contentData.text}</div></div>`;
                    }
                    if (contentData.hasPhoto && (contentData.photo || firstLesson.photoUrl)) {
                        const photoUrl = contentData.photo || firstLesson.photoUrl;
                        contentHtml += `
                            <div class="review-lesson-content" style="margin-top: 15px;">
                                <strong>사진:</strong>
                                <div style="margin-top: 10px;">
                                    <img src="${photoUrl}" alt="업로드된 사진" style="max-width: 100%; max-height: 500px; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);" />
                                </div>
                            </div>
                        `;
                    }
                    if (contentData.hasDrawing && contentData.drawing) {
                        try {
                            const drawingData = JSON.parse(contentData.drawing);
                            contentHtml += `
                                <div class="review-lesson-content" style="margin-top: 15px;">
                                    <strong>도식:</strong>
                                    <div class="drawing-preview" style="position: relative; display: inline-block; margin-top: 10px;">
                                        <img src="${drawingData.canvas}" alt="도식" style="max-width: 100%; border: 1px solid #ddd; display: block;" />
                                        ${drawingData.textBoxes ? drawingData.textBoxes.map(box => `
                                            <div class="text-box-preview" style="position: absolute; left: ${box.displayX || box.x}; top: ${box.displayY || box.y}; background: rgba(255,255,255,0.9); padding: 5px; border-radius: 3px; font-size: 0.9em;">
                                                ${box.text}
                                            </div>
                                        `).join('') : ''}
                                    </div>
                                </div>
                            `;
                        } catch (e) {
                            contentHtml += '<div class="review-lesson-content">도식 데이터를 불러올 수 없습니다.</div>';
                        }
                    }
                } else {
                    // 기존 형식: 단일 타입
                    if (firstLesson.recordType === 'text') {
                        contentHtml = `<div class="review-lesson-content">${firstLesson.content}</div>`;
                    } else {
                        const drawingData = contentData;
                        contentHtml = `
                            <div class="review-lesson-content">
                                <div class="drawing-preview" style="position: relative; display: inline-block;">
                                    <img src="${drawingData.canvas}" alt="도식" style="max-width: 100%; border: 1px solid #ddd; display: block;" />
                                    ${drawingData.textBoxes ? drawingData.textBoxes.map(box => `
                                        <div class="text-box-preview" style="position: absolute; left: ${box.displayX || box.x}; top: ${box.displayY || box.y}; background: rgba(255,255,255,0.9); padding: 5px; border-radius: 3px; font-size: 0.9em;">
                                            ${box.text}
                                        </div>
                                    `).join('') : ''}
                                </div>
                            </div>
                        `;
                    }
                }
            } catch (e) {
                // JSON 파싱 실패 시 텍스트로 처리
                if (firstLesson.recordType === 'text') {
                    contentHtml = `<div class="review-lesson-content">${firstLesson.content}</div>`;
                } else {
                    contentHtml = '<div class="review-lesson-content">데이터를 불러올 수 없습니다.</div>';
                }
            }
            
            // 교시 표시 (연속된 경우 "1교시, 2교시" 형태)
            const periodDisplay = group.periods.length > 1 
                ? `${group.periods[0]}교시, ${group.periods[group.periods.length - 1]}교시`
                : `${group.periods[0]}교시`;
            
            lessonItem.innerHTML = `
                <div class="review-lesson-header">
  <div>
                        <span class="review-lesson-period">${periodDisplay}</span>
                        <span class="review-lesson-subject">${group.subject}</span>
    </div>
  </div>
                ${group.topic ? `<div class="review-lesson-topic"><strong>배움 주제:</strong> ${group.topic}</div>` : ''}
                ${contentHtml}
                <button class="edit-lesson-btn" data-period="${group.periods[0]}">수정하기</button>
            `;
            
            // 수정하기 버튼 이벤트
            const editBtn = lessonItem.querySelector('.edit-lesson-btn');
            if (editBtn) {
                editBtn.addEventListener('click', () => {
                    editLesson(group.periods[0]);
                });
            }
            
            container.appendChild(lessonItem);
        });
    } catch (error) {
        console.error('수업 기록 로드 오류:', error);
        container.innerHTML = '<p class="error-message">기록을 불러오는 중 오류가 발생했습니다: ' + error.message + '</p>';
    }
}

// 수업 기록 수정하기
async function editLesson(period) {
    // 기록하기 탭으로 전환
    document.querySelector('.lesson-tab-btn[data-lesson-tab="write"]').click();
    
    // 해당 교시 기록 불러오기
    if (!currentUser) return;
    
    const today = format(new Date(), 'yyyy-MM-dd');
    const lessonRef = doc(db, 'students', currentUser.uid, 'lessons', `${today}_${period}`);
    const lessonSnap = await getDoc(lessonRef);
    
    if (!lessonSnap.exists()) return;
    
    const lesson = lessonSnap.data();
    
    // 교시 체크
    document.querySelector(`.period-checkboxes input[value="${period}"]`).checked = true;
    
    // 과목 선택
    document.getElementById('subjectSelect').value = lesson.subject;
    
    // 배움 주제
    if (lesson.topic) {
        document.getElementById('lessonTopic').value = lesson.topic;
    }
    
    // 기록 방식 및 내용 (새로운 형식 지원)
    try {
        const contentData = JSON.parse(lesson.content);
        
        // 새로운 형식인지 확인
        if (contentData.hasText !== undefined || contentData.hasDrawing !== undefined || contentData.hasPhoto !== undefined) {
            // 새로운 형식: 텍스트, 도식, 사진 모두 포함 가능
            if (contentData.hasText && contentData.text) {
                document.querySelector('.record-type-btn[data-type="text"]').click();
                document.getElementById('lessonText').innerHTML = contentData.text;
            }
            
            if (contentData.hasDrawing && contentData.drawing) {
                document.querySelector('.record-type-btn[data-type="drawing"]').click();
                try {
                    const drawingData = JSON.parse(contentData.drawing);
                    const canvas = document.getElementById('drawingCanvas');
                    const ctx = canvas.getContext('2d');
                    const img = new Image();
                    img.onload = () => {
                        ctx.drawImage(img, 0, 0);
                        // 텍스트 상자 복원
                        if (drawingData.textBoxes) {
                            drawingData.textBoxes.forEach(box => {
                                const textBox = document.createElement('div');
                                textBox.className = 'text-box';
                                textBox.style.left = box.displayX || box.x;
                                textBox.style.top = box.displayY || box.y;
                                textBox.contentEditable = true;
                                textBox.textContent = box.text || '';
                                textBox.dataset.id = textBoxCounter++;
                                textBox.dataset.x = box.x;
                                textBox.dataset.y = box.y;
                                makeDraggable(textBox);
                                document.getElementById('textBoxes').appendChild(textBox);
                            });
                        }
                    };
                    img.src = drawingData.canvas;
                } catch (e) {
                    console.error('도식 데이터 로드 오류:', e);
                }
            }
            
            if (contentData.hasPhoto && (contentData.photo || lesson.photoUrl)) {
                document.querySelector('.record-type-btn[data-type="photo"]').click();
                const photoUrl = contentData.photo || lesson.photoUrl;
                const previewContainer = document.getElementById('photoPreviewContainer');
                if (previewContainer) {
                    previewContainer.innerHTML = `
                        <div style="position: relative; display: inline-block;">
                            <img src="${photoUrl}" alt="업로드된 사진" style="max-width: 100%; max-height: 400px; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);" />
                            <button id="removePhotoBtn" style="position: absolute; top: 5px; right: 5px; background: rgba(255,0,0,0.7); color: white; border: none; border-radius: 50%; width: 30px; height: 30px; cursor: pointer; font-size: 18px;">×</button>
                        </div>
                    `;
                    // 삭제 버튼 이벤트
                    document.getElementById('removePhotoBtn')?.addEventListener('click', () => {
                        uploadedPhoto = null;
                        previewContainer.innerHTML = '';
                        document.getElementById('photoFileInput').value = '';
                    });
                }
                // 업로드된 사진을 다시 업로드하기 위해 URL을 Blob으로 변환할 수도 있지만, 
                // 수정 시에는 기존 사진이 그대로 유지되도록 photoUrl을 저장
                if (lesson.photoUrl) {
                    // photoUrl이 있으면 수정 시에도 유지되도록 설정
                }
            }
        } else {
            // 기존 형식
            if (lesson.recordType === 'text') {
                document.querySelector('.record-type-btn[data-type="text"]').click();
                document.getElementById('lessonText').innerHTML = lesson.content;
            } else {
                document.querySelector('.record-type-btn[data-type="drawing"]').click();
                const drawingData = contentData;
                const canvas = document.getElementById('drawingCanvas');
                const ctx = canvas.getContext('2d');
                const img = new Image();
                img.onload = () => {
                    ctx.drawImage(img, 0, 0);
                    // 텍스트 상자 복원
                    if (drawingData.textBoxes) {
                        drawingData.textBoxes.forEach(box => {
                            const textBox = document.createElement('div');
                            textBox.className = 'text-box';
                            textBox.style.left = box.displayX || box.x;
                            textBox.style.top = box.displayY || box.y;
                            textBox.contentEditable = true;
                            textBox.textContent = box.text || '';
                            textBox.dataset.id = textBoxCounter++;
                            textBox.dataset.x = box.x;
                            textBox.dataset.y = box.y;
                            makeDraggable(textBox);
                            document.getElementById('textBoxes').appendChild(textBox);
                        });
                    }
                };
                img.src = drawingData.canvas;
            }
        }
    } catch (e) {
        // JSON 파싱 실패 시 텍스트로 처리
        if (lesson.recordType === 'text') {
            document.querySelector('.record-type-btn[data-type="text"]').click();
            document.getElementById('lessonText').innerHTML = lesson.content;
        } else {
            console.error('데이터 로드 오류:', e);
        }
    }
}

// 축하 효과 및 성공 메시지 표시
function showSuccessMessage() {
    // Confetti 효과 생성
    createConfetti();
    
    // 성공 메시지 표시
    const successMessage = document.createElement('div');
    successMessage.id = 'successMessage';
    successMessage.className = 'success-message animate__animated animate__zoomIn';
    successMessage.innerHTML = `
        <div class="success-content animate__animated animate__pulse animate__infinite">
            <div class="success-icon animate__animated animate__bounce animate__infinite">🎉</div>
            <div class="success-text">기록이 완료되었어요!</div>
        </div>
    `;
    document.body.appendChild(successMessage);
    
    // 애니메이션 시작
    setTimeout(() => {
        successMessage.classList.add('show');
    }, 10);
    
    // 2.5초 후 제거
    setTimeout(() => {
        successMessage.classList.remove('show');
        setTimeout(() => {
            successMessage.remove();
        }, 500);
    }, 2500);
}

// Confetti 효과 생성
function createConfetti() {
    const colors = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#FFA07A', '#98D8C8', '#F7DC6F', '#BB8FCE', '#85C1E2'];
    // 긍정적이고 귀여운 이모티콘 10개
    const emojis = ['🎉', '✨', '🌟', '💫', '🎊', '🌈', '🦄', '🌸', '⭐', '💖'];
    const confettiCount = 100;
    
    for (let i = 0; i < confettiCount; i++) {
        setTimeout(() => {
            const confetti = document.createElement('div');
            confetti.className = 'confetti';
            
            // 이모티콘 또는 색상 조각 중 랜덤 선택 (30% 확률로 이모티콘)
            const isEmoji = Math.random() < 0.3;
            
            if (isEmoji) {
                // 이모티콘 confetti
                confetti.textContent = emojis[Math.floor(Math.random() * emojis.length)];
                confetti.style.fontSize = (Math.random() * 20 + 20) + 'px'; // 20-40px
                confetti.style.backgroundColor = 'transparent';
                confetti.style.width = 'auto';
                confetti.style.height = 'auto';
                confetti.style.lineHeight = '1';
            } else {
                // 색상 조각 confetti
                const color = colors[Math.floor(Math.random() * colors.length)];
                confetti.style.backgroundColor = color;
                
                // 랜덤 크기 (5-15px)
                const size = Math.random() * 10 + 5;
                confetti.style.width = size + 'px';
                confetti.style.height = size + 'px';
            }
            
            // 랜덤 시작 위치
            confetti.style.left = Math.random() * 100 + '%';
            confetti.style.top = '-10px';
            
            // 랜덤 회전 및 애니메이션 지속 시간
            const rotation = Math.random() * 360;
            const duration = Math.random() * 2 + 2; // 2-4초
            const delay = Math.random() * 0.5;
            
            confetti.style.setProperty('--rotation', rotation + 'deg');
            confetti.style.setProperty('--duration', duration + 's');
            confetti.style.setProperty('--delay', delay + 's');
            
            // 랜덤 이동 거리
            const moveX = (Math.random() - 0.5) * 200; // -100 ~ 100px
            confetti.style.setProperty('--moveX', moveX + 'px');
            
            document.body.appendChild(confetti);
            
            // 애니메이션 종료 후 제거
            setTimeout(() => {
                confetti.remove();
            }, (duration + delay) * 1000);
        }, i * 10); // 약간씩 지연시켜서 자연스럽게
    }
}

async function loadUserData() {
    if (!currentUser) return;
    
    const today = format(new Date(), 'yyyy-MM-dd');
    
    // 아침 감정 로드
    const emotionRef = doc(db, 'students', currentUser.uid, 'emotions', today);
    const emotionSnap = await getDoc(emotionRef);
    
    if (emotionSnap.exists()) {
        const data = emotionSnap.data();
        if (data.morningEmotion && data.morningRecorded) {
            morningEmotion = data.morningEmotion;
            morningSummaryText = data.morningSummary || '';
            morningChatMessages.push(...(data.morningChat || []));
            morningChatCount = morningChatMessages.filter(m => m.role === 'user').length;

            // 저장된 아침 챗봇 대화 내역 다시 그리기
            if (Array.isArray(data.morningChat)) {
                data.morningChat.forEach(msg => {
                    const role = msg.role === 'user' ? 'user' : 'assistant';
                    addChatMessage(role, msg.content, 'chatMessages');
                });
            }

            // 저장된 정리 문장과 이모티콘을 화면에 표시 (아직 표시되지 않았다면)
            const morningSummary = data.morningSummary || '';
            if (morningSummary && morningEmotion) {
                // 이미 채팅 메시지에 포함되어 있는지 확인
                const chatMessagesEl = document.getElementById('chatMessages');
                if (chatMessagesEl) {
                    const hasSummary = Array.from(chatMessagesEl.children).some(el => {
                        const text = el.textContent || '';
                        return text.includes(morningSummary) && text.includes(morningEmotion);
                    });
                    if (!hasSummary) {
                        addChatMessage('user', `${morningSummary} ${morningEmotion}`, 'chatMessages');
                    }
                }
            }

            showMorningRecorded();
        } else {
            // 아직 아침 감정을 기록하지 않은 경우: 챗봇이 먼저 인사
            const chatContainer = document.getElementById('morningChatContainer');
            if (chatContainer) {
                chatContainer.style.display = 'block';
            }
            const morningGreetings = [
                '좋은 아침이야! 오늘 기분은 어때? 😊',
                '안녕! 눈 떴을 때 기분이 어땠는지 말해줄래? 😄',
                '오늘 아침, 제일 먼저 떠오른 기분은 뭐였어? 🤔',
                '일어나 보니까 마음이 어땠어? 두근두근? 편안? 😌',
                '오늘은 어떤 기분으로 하루를 시작했는지 궁금해! 🤗'
            ];
            const greeting = morningGreetings[Math.floor(Math.random() * morningGreetings.length)];
            morningChatMessages.push({ role: 'assistant', content: greeting });
            addChatMessage('assistant', greeting, 'chatMessages', true);
        }
        
        if (data.closingEmotion) {
            closingEmotion = data.closingEmotion;
            closingChatMessages.push(...(data.closingChat || []));
            closingChatCount = closingChatMessages.filter(m => m.role === 'user').length;
            closingTabInitialized = true; // 이미 채팅이 있으면 초기화 완료로 표시
            
            if (closingChatCount >= 3) {
                document.getElementById('closingEmotionSelection').style.display = 'block';
                const selectedBtn = Array.from(document.querySelectorAll('#closingEmotionSelection .emoji-btn'))
                    .find(btn => btn.dataset.emoji === closingEmotion);
                if (selectedBtn) selectedBtn.classList.add('selected');
            }
            
            if (data.submitted) {
                updateClosingSubmitButtonVisibility();
            }
            
            data.closingChat?.forEach(msg => {
                addChatMessage(msg.role === 'user' ? 'user' : 'assistant', msg.content, 'closingChatMessages');
            });
        }
    } else {
        // 오늘 감정 데이터 문서가 아직 없는 경우에도 아침 인사 먼저 보여주기
        const chatContainer = document.getElementById('morningChatContainer');
        if (chatContainer) {
            chatContainer.style.display = 'block';
        }
        const morningGreetings = [
            '좋은 아침이야! 오늘 기분은 어때? 😊',
            '안녕! 눈 떴을 때 기분이 어땠는지 말해줄래? 😄',
            '오늘 아침, 제일 먼저 떠오른 기분은 뭐였어? 🤔',
            '일어나 보니까 마음이 어땠어? 두근두근? 편안? 😌',
            '오늘은 어떤 기분으로 하루를 시작했는지 궁금해! 🤗'
        ];
        const greeting = morningGreetings[Math.floor(Math.random() * morningGreetings.length)];
        morningChatMessages.push({ role: 'assistant', content: greeting });
        addChatMessage('assistant', greeting, 'chatMessages', true);
    }
}
