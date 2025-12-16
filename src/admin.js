import { auth, db } from './firebaseConfig.js';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { collection, doc, getDocs, getDoc, query, where, updateDoc, setDoc } from 'firebase/firestore';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, getDay, addMonths, subMonths } from 'date-fns';

let currentUser = null;
let currentMonth = new Date();
let selectedDate = null;
let submissionsByDate = {}; // 날짜별 제출 데이터 캐시

// 인증 상태 확인
onAuthStateChanged(auth, async (user) => {
    if (user) {
        try {
            // 교사 권한 확인
            const userRef = doc(db, 'users', user.uid);
            const userSnap = await getDoc(userRef);
            
            if (userSnap.exists()) {
                const userData = userSnap.data();
                
                // 역할이 없거나 student인 경우 index.html로 리다이렉트
                if (!userData.role || userData.role !== 'teacher') {
                    console.log('교사 권한이 없습니다. 역할:', userData.role);
                    alert('교사 권한이 없습니다. 역할을 확인하거나 다시 로그인해주세요.');
                    window.location.href = '/index.html';
                    return;
                }
                
                // 교사 권한이 있는 경우
                currentUser = user;
                const teacherNameEl = document.getElementById('teacherName');
                if (teacherNameEl) {
                    teacherNameEl.textContent = user.displayName || user.email;
                }
                
                // 폰트 로드
                loadProjectFonts();
            } else {
                // Firestore에 사용자 정보가 없는 경우
                console.log('Firestore에 사용자 정보가 없습니다.');
                alert('사용자 정보를 찾을 수 없습니다. 다시 로그인해주세요.');
                window.location.href = '/index.html';
            }
        } catch (error) {
            console.error('인증 확인 오류:', error);
            alert('인증 확인 중 오류가 발생했습니다: ' + error.message);
            window.location.href = '/index.html';
        }
    } else {
        // 로그인되지 않은 경우
        window.location.href = '/index.html';
    }
});

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

// 프로젝트 폰트 적용 함수 (URL 방식)
async function applyProjectFont(fontPath, fontName, fontType) {
    console.log('applyProjectFont 호출:', fontPath, fontName, fontType);
    
    // 기존 폰트 스타일 제거
    const existingStyle = document.getElementById('projectFontStyle');
    if (existingStyle) {
        existingStyle.remove();
    }
    
    // 폰트 이름을 안전하게 처리
    const safeFontName = fontName.replace(/'/g, "\\'").replace(/"/g, '\\"');
    
    // FontFace API 사용 시도
    if (window.FontFace) {
        try {
            const fontFace = new FontFace(safeFontName, `url('${fontPath}')`);
            
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
            return;
        } catch (error) {
            console.warn('⚠️ FontFace API 로드 실패, @font-face로 시도:', error.message);
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
    
    style.textContent = `
        @font-face {
            font-family: '${safeFontName}';
            src: url('${fontPath}') format('${fontFormat}');
            font-display: swap;
        }
        
        body, * {
            font-family: '${safeFontName}', 'Malgun Gothic', 'Apple SD Gothic Neo', sans-serif !important;
        }
    `;
    
    document.head.appendChild(style);
    console.log('✅ @font-face로 폰트 로드 성공:', safeFontName);
}

// 프로젝트 폰트 적용 함수 (Base64 방식)
async function applyProjectFontBase64(fontBase64, fontName, fontType) {
    // 기존 폰트 스타일 제거
    const existingStyle = document.getElementById('projectFontStyle');
    if (existingStyle) {
        existingStyle.remove();
    }
    
    // 폰트 이름을 안전하게 처리
    const safeFontName = fontName.replace(/'/g, "\\'").replace(/"/g, '\\"');
    
    // FontFace API 사용
    if (window.FontFace) {
        try {
            // Base64 데이터를 ArrayBuffer로 변환 후 Blob URL 생성
            const base64Data = fontBase64.split(',')[1];
            const binaryString = atob(base64Data);
            const bytes = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) {
                bytes[i] = binaryString.charCodeAt(i);
            }
            const fontBlob = new Blob([bytes], { type: `font/${fontType}` });
            const fontUrl = URL.createObjectURL(fontBlob);
            
            const fontFace = new FontFace(safeFontName, `url(${fontUrl})`);
            await fontFace.load();
            document.fonts.add(fontFace);
            
            URL.revokeObjectURL(fontUrl);
            
            console.log('✅ FontFace API로 폰트 로드 성공:', safeFontName);
        } catch (error) {
            console.warn('⚠️ FontFace API 로드 실패 (CSS @font-face는 적용됨):', error.message);
        }
    }
    
    // CSS @font-face도 추가
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
    
    const style = document.createElement('style');
    style.id = 'projectFontStyle';
    style.textContent = `
        @font-face {
            font-family: '${safeFontName}';
            src: url('${fontBase64}') format('${fontFormat}');
            font-display: swap;
        }
        
        body, * {
            font-family: '${safeFontName}', 'Malgun Gothic', 'Apple SD Gothic Neo', sans-serif !important;
        }
    `;
    
    document.head.appendChild(style);
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
        
        // 설정 파일이 없으면 fonts 폴더의 일반적인 폰트 파일 시도 (WOFF2 우선)
        const fontExtensions = ['woff2', 'woff', 'ttf', 'otf'];
        const fontFiles = [];
        
        const commonFontNames = [
            'NanumGothic', 'NanumBarunGothic', 'NanumPen', 'NanumBrush',
            'NotoSansKR', 'NotoSerifKR',
            'Pretendard', 'GmarketSans',
            'Cafe24', 'Cafe24Onepretty', 'Cafe24Ssurround',
            'font', 'custom-font', 'main-font',
            'GangwonEduHyunok', 'GangwonEduModuBold', 'GangwonEduModuLight', 'GangwonEduSaeum'
        ];
        
        for (const fontName of commonFontNames) {
            for (const ext of fontExtensions) {
                const fontPath = `/fonts/${fontName}.${ext}`;
                try {
                    const response = await fetch(fontPath, { method: 'HEAD' });
                    if (response.ok) {
                        fontFiles.push({ name: fontName, path: fontPath, type: ext });
                        break;
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
        }
    } catch (error) {
        console.log('프로젝트 폰트 로드 실패:', error);
    }
}

// DOM이 로드된 후 실행
window.addEventListener('DOMContentLoaded', () => {
    // 로그아웃
    const logoutBtn = document.getElementById('teacherLogoutBtn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', async () => {
            await signOut(auth);
            window.location.href = '/index.html';
        });
    }

    // 달력 초기화
    renderCalendar();
    
    // 달력 네비게이션
    document.getElementById('prevMonthBtn').addEventListener('click', () => {
        currentMonth = subMonths(currentMonth, 1);
        renderCalendar();
    });
    
    document.getElementById('nextMonthBtn').addEventListener('click', () => {
        currentMonth = addMonths(currentMonth, 1);
        renderCalendar();
    });
    
    // 달력 렌더링 후 오늘 날짜 선택
    setTimeout(async () => {
        await updateCalendarWithSubmissions();
        const today = format(new Date(), 'yyyy-MM-dd');
        const todayCell = document.querySelector(`.calendar-day[data-date="${today}"]:not(.other-month)`);
        if (todayCell) {
            todayCell.click();
        } else {
            loadSubmissionsForDate(today);
        }
    }, 200);
});

// 달력 렌더링
async function renderCalendar() {
    const calendar = document.getElementById('calendar');
    const monthTitle = document.getElementById('calendarMonthTitle');
    
    // 월 제목 표시
    monthTitle.textContent = format(currentMonth, 'yyyy년 M월');
    
    // 달력 초기화
    calendar.innerHTML = '';
    
    // 요일 헤더
    const weekdays = ['일', '월', '화', '수', '목', '금', '토'];
    const weekdaysRow = document.createElement('div');
    weekdaysRow.className = 'calendar-weekdays';
    weekdays.forEach(day => {
        const dayCell = document.createElement('div');
        dayCell.className = 'calendar-weekday';
        dayCell.textContent = day;
        weekdaysRow.appendChild(dayCell);
    });
    calendar.appendChild(weekdaysRow);
    
    // 월의 시작일과 종료일
    const monthStart = startOfMonth(currentMonth);
    const monthEnd = endOfMonth(currentMonth);
    const daysInMonth = eachDayOfInterval({ start: monthStart, end: monthEnd });
    
    // 첫 주 시작일 계산 (일요일부터 시작)
    const firstDayOfWeek = getDay(monthStart);
    const calendarStart = new Date(monthStart);
    calendarStart.setDate(calendarStart.getDate() - firstDayOfWeek);
    
    // 달력 그리드 시작
    const calendarDays = document.createElement('div');
    calendarDays.className = 'calendar-days';
    
    // 이전 달 말일들
    const currentDate = new Date(calendarStart);
    for (let i = 0; i < firstDayOfWeek; i++) {
        const dayCell = createDayCell(currentDate, true);
        calendarDays.appendChild(dayCell);
        currentDate.setDate(currentDate.getDate() + 1);
    }
    
    // 이번 달 날짜들
    daysInMonth.forEach(day => {
        const dayCell = createDayCell(day, false);
        calendarDays.appendChild(dayCell);
    });
    
    // 다음 달 초일들 (6주를 채우기 위해)
    const remainingDays = 42 - (firstDayOfWeek + daysInMonth.length);
    for (let i = 0; i < remainingDays; i++) {
        const dayCell = createDayCell(currentDate, true);
        calendarDays.appendChild(dayCell);
        currentDate.setDate(currentDate.getDate() + 1);
    }
    
    calendar.appendChild(calendarDays);
    
    // 제출 데이터가 있는 날짜 표시
    await updateCalendarWithSubmissions();
}

// 날짜 셀 생성
function createDayCell(date, isOtherMonth) {
    const dayCell = document.createElement('div');
    dayCell.className = `calendar-day ${isOtherMonth ? 'other-month' : ''}`;
    
    const dateStr = format(date, 'yyyy-MM-dd');
    dayCell.dataset.date = dateStr;
    
    const dayNumber = document.createElement('div');
    dayNumber.className = 'day-number';
    dayNumber.textContent = format(date, 'd');
    dayCell.appendChild(dayNumber);
    
    // 클릭 이벤트
    if (!isOtherMonth) {
        dayCell.addEventListener('click', () => {
            // 이전 선택 해제
            document.querySelectorAll('.calendar-day.selected').forEach(cell => {
                cell.classList.remove('selected');
            });
            
            // 새 선택
            dayCell.classList.add('selected');
            selectedDate = dateStr;
            
            // 학생 목록 로드
            loadSubmissionsForDate(dateStr);
            
            // 배움공책 내용 초기화
            document.getElementById('submissionDetail').innerHTML = '<p class="empty-message">학생을 선택해주세요.</p>';
        });
    }
    
    return dayCell;
}

// 달력에 제출 데이터 표시
async function updateCalendarWithSubmissions() {
    try {
        // 현재 달의 모든 제출 데이터 가져오기
        const monthStart = startOfMonth(currentMonth);
        const monthEnd = endOfMonth(currentMonth);
        const startDateStr = format(monthStart, 'yyyy-MM-dd');
        const endDateStr = format(monthEnd, 'yyyy-MM-dd');
        
        // Firestore에서 모든 제출 데이터 가져온 후 필터링
        const submissionsRef = collection(db, 'submissions');
        const querySnapshot = await getDocs(submissionsRef);
        
        // 날짜별 제출 학생 수 집계 (현재 월만 필터링)
        const submissionsByDate = {};
        querySnapshot.forEach(doc => {
            const submission = doc.data();
            const date = submission.date;
            // 현재 월의 날짜만 포함
            if (date >= startDateStr && date <= endDateStr) {
                if (!submissionsByDate[date]) {
                    submissionsByDate[date] = [];
                }
                submissionsByDate[date].push(submission.studentId);
            }
        });
        
        // 달력에 표시
        document.querySelectorAll('.calendar-day:not(.other-month)').forEach(dayCell => {
            const dateStr = dayCell.dataset.date;
            const count = submissionsByDate[dateStr] ? new Set(submissionsByDate[dateStr]).size : 0;
            
            // 기존 표시 제거
            const existingIndicator = dayCell.querySelector('.submission-indicator');
            if (existingIndicator) {
                existingIndicator.remove();
            }
            
            if (count > 0) {
                const indicator = document.createElement('div');
                indicator.className = 'submission-indicator';
                indicator.textContent = count;
                indicator.title = `${count}명의 학생이 제출함`;
                dayCell.appendChild(indicator);
            }
        });
    } catch (error) {
        console.error('제출 데이터 로드 오류:', error);
    }
}

// 특정 날짜의 학생 목록 로드
async function loadSubmissionsForDate(dateStr) {
    const studentsList = document.getElementById('studentsList');
    const studentsListTitle = document.getElementById('studentsListTitle');
    
    studentsList.innerHTML = '<p class="loading">로딩 중...</p>';
    studentsListTitle.textContent = `${format(new Date(dateStr), 'M월 d일')} 제출 학생`;
    
    try {
        const submissionsRef = collection(db, 'submissions');
        const q = query(submissionsRef, where('date', '==', dateStr));
        const querySnapshot = await getDocs(q);

        if (querySnapshot.empty) {
            studentsList.innerHTML = '<p class="empty-message">해당 날짜에 제출된 배움공책이 없습니다.</p>';
            return;
        }

        // 학생 정보 수집
        const studentSubmissions = [];
        for (const submissionDoc of querySnapshot.docs) {
            const submission = submissionDoc.data();
            const userRef = doc(db, 'users', submission.studentId);
            const userSnap = await getDoc(userRef);
            
            if (userSnap.exists()) {
                const userData = userSnap.data();
                studentSubmissions.push({
                    studentId: submission.studentId,
                    studentName: userData.customName || userData.displayName || userData.email || '알 수 없음',
                    profileEmoji: userData.profileEmoji || '🍇',
                    submittedAt: submission.submittedAt
                });
            }
        }
        
        // 이름 순으로 정렬
        studentSubmissions.sort((a, b) => a.studentName.localeCompare(b.studentName));
        
        // 학생 목록 표시
        studentsList.innerHTML = '';
        studentSubmissions.forEach((student, index) => {
            const studentItem = document.createElement('div');
            studentItem.className = 'student-list-item';
            studentItem.dataset.studentId = student.studentId;
            studentItem.innerHTML = `
                <div class="student-list-emoji">${student.profileEmoji}</div>
                <div class="student-list-name">${student.studentName}</div>
            `;
            
            studentItem.addEventListener('click', () => {
                // 이전 선택 해제
                document.querySelectorAll('.student-list-item.selected').forEach(item => {
                    item.classList.remove('selected');
                });
                
                // 새 선택
                studentItem.classList.add('selected');
                
                // 배움공책 내용 표시
                renderStudentSubmission(student.studentId, dateStr, document.getElementById('submissionDetail'));
            });
            
            studentsList.appendChild(studentItem);
        });
        
    } catch (error) {
        console.error('제출 목록 조회 오류:', error);
        studentsList.innerHTML = '<p class="error-message">오류가 발생했습니다.</p>';
    }
}

async function renderStudentSubmission(studentId, date, container) {
    container.innerHTML = '<p class="loading">로딩 중...</p>';
    try {
        // 학생 정보 가져오기
        const userRef = doc(db, 'users', studentId);
        const userSnap = await getDoc(userRef);
        const userData = userSnap.exists() ? userSnap.data() : {};
        const studentName = userData.customName || userData.displayName || userData.email || '알 수 없음';
        const profileEmoji = userData.profileEmoji || '🍇';

        // 감정 정보 가져오기
        const emotionRef = doc(db, 'students', studentId, 'emotions', date);
        const emotionSnap = await getDoc(emotionRef);

        // 수업 기록 가져오기
        const lessonsRef = collection(db, 'students', studentId, 'lessons');
        const lessonsQuery = query(lessonsRef, where('date', '==', date));
        const lessonsSnapshot = await getDocs(lessonsQuery);

        const submissionCard = document.createElement('div');
        submissionCard.className = 'submission-card';

        let html = `
            <div class="student-header-card">
                <div style="display: flex; align-items: center; gap: 15px;">
                    <div style="font-size: 2.5em;">${profileEmoji}</div>
                    <div>
                        <h3 style="margin: 0 0 5px 0;">${studentName}</h3>
                        <span class="submission-date">${format(new Date(date), 'yyyy년 M월 d일')}</span>
                    </div>
                </div>
            </div>
        `;

        // 아침 감정 + 정리 문장
        if (emotionSnap.exists() && emotionSnap.data().morningEmotion) {
            const emotionData = emotionSnap.data();
            const morningSummary = emotionData.morningSummary || '';
            html += `
                <div class="emotion-section">
                    <h4>🌅 아침 기분</h4>
                    <div class="emotion-display">${emotionData.morningEmotion}</div>
                    ${morningSummary ? `
                        <div class="morning-summary-bubble">
                            “${morningSummary}”
                        </div>
                    ` : ''}
                    ${emotionData.morningChat ? `
                        <details class="chat-details">
                            <summary>챗봇 대화 보기</summary>
                            <div class="chat-history">
                                ${emotionData.morningChat.map(msg => `
                                    <div class="chat-msg ${msg.role}">
                                        <strong>${msg.role === 'user' ? '학생' : '챗봇'}:</strong> ${msg.content}
                                    </div>
                                `).join('')}
                            </div>
                        </details>
                    ` : ''}
                </div>
            `;
        }

        // 수업 기록
        if (!lessonsSnapshot.empty) {
            html += '<div class="lessons-section"><h4>📝 수업 기록</h4>';
            
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
                // 교시 표시 (연속된 경우 "1교시, 2교시" 형태)
                const periodDisplay = group.periods.length > 1 
                    ? `${group.periods[0]}교시, ${group.periods[group.periods.length - 1]}교시`
                    : `${group.periods[0]}교시`;
                
                // 첫 번째 레슨을 기준으로 내용 생성
                const firstLesson = group.lessons[0];
                
                html += `
                    <div class="lesson-item">
                        <div class="lesson-header">
                            <span class="lesson-period">${periodDisplay}</span>
                            <span class="lesson-subject">${group.subject}</span>
                        </div>
                        ${group.topic ? `<div class="lesson-topic"><strong>배움 주제:</strong> ${group.topic}</div>` : ''}
                        <div class="lesson-content">
                `;
                
                // 새로운 형식 (both, text, drawing) 처리
                try {
                    const contentData = JSON.parse(firstLesson.content);
                    
                    // 새로운 형식인지 확인 (hasText, hasDrawing 속성 존재)
                    if (contentData.hasText !== undefined && contentData.hasDrawing !== undefined) {
                        // 텍스트 내용 표시
                        if (contentData.hasText && contentData.text) {
                            html += `<div style="line-height: 1.6; margin-bottom: 15px;">${contentData.text}</div>`;
                        }
                        
                        // 사진 내용 표시
                        if (contentData.hasPhoto && (contentData.photo || firstLesson.photoUrl)) {
                            const photoUrl = contentData.photo || firstLesson.photoUrl;
                            html += `
                                <div style="margin-top: 15px;">
                                    <img src="${photoUrl}" alt="업로드된 사진" style="max-width: 100%; max-height: 500px; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);" />
                                </div>
                            `;
                        }
                        
                        // 도식 내용 표시 (합성 이미지만 출력)
                        if (contentData.hasDrawing && contentData.drawing) {
                            try {
                                const drawingData = JSON.parse(contentData.drawing);
                                html += `
                                    <div class="drawing-preview" style="position: relative; display: inline-block; margin-top: 10px;">
                                        <img src="${drawingData.canvas}" alt="도식" style="max-width: 100%; border: 1px solid #ddd; display: block;" />
                                    </div>
                                `;
                            } catch (e) {
                                html += `<p>도식 데이터를 불러올 수 없습니다.</p>`;
                            }
                        }
                    } else {
                        // 기존 형식 처리 (recordType 기반)
                        if (firstLesson.recordType === 'text' || firstLesson.recordType === 'both') {
                            html += `<div style="line-height: 1.6;">${firstLesson.content}</div>`;
                        }
                        
                        if (firstLesson.recordType === 'drawing' || firstLesson.recordType === 'both') {
                            // 도식 데이터 파싱 (합성 이미지만 출력)
                            try {
                                const drawingData = contentData;
                                html += `
                                    <div class="drawing-preview" style="position: relative; display: inline-block; margin-top: 10px;">
                                        <img src="${drawingData.canvas}" alt="도식" style="max-width: 100%; border: 1px solid #ddd; display: block;" />
                                    </div>
                                `;
                            } catch (e) {
                                html += `<p>도식 데이터를 불러올 수 없습니다.</p>`;
                            }
                        }
                    }
                } catch (e) {
                    // JSON 파싱 실패 시 텍스트로 처리
                    if (firstLesson.recordType === 'text') {
                        html += `<div style="line-height: 1.6;">${firstLesson.content}</div>`;
                    } else {
                        html += '<div class="lesson-content">데이터를 불러올 수 없습니다.</div>';
                    }
                }
                
                html += `</div></div>`;
            });
            
            html += '</div>';
        }

        // 종례 감정
        if (emotionSnap.exists() && emotionSnap.data().closingEmotion) {
            const emotionData = emotionSnap.data();
            html += `
                <div class="emotion-section">
                    <h4>🌙 종례 기분</h4>
                    <div class="emotion-display">${emotionData.closingEmotion}</div>
                    ${emotionData.closingChat ? `
                        <details class="chat-details">
                            <summary>챗봇 대화 보기</summary>
                            <div class="chat-history">
                                ${emotionData.closingChat.map(msg => `
                                    <div class="chat-msg ${msg.role}">
                                        <strong>${msg.role === 'user' ? '학생' : '챗봇'}:</strong> ${msg.content}
                                    </div>
                                `).join('')}
                            </div>
                        </details>
                    ` : ''}
                </div>
            `;
        }

        // 기존에 보낸 피드백 표시 (있을 경우 - 여러 개)
        const emotionData = emotionSnap.exists() ? emotionSnap.data() : {};
        let feedbackList = [];

        if (Array.isArray(emotionData.feedbacks)) {
            feedbackList = [...emotionData.feedbacks];
        }

        // 예전 구조(teacherEmoji / teacherFeedback)만 있는 경우도 마지막에 1개로 포함
        if ((!feedbackList || feedbackList.length === 0) && (emotionData.teacherEmoji || emotionData.teacherFeedback)) {
            feedbackList.push({
                emoji: emotionData.teacherEmoji || '💬',
                text: emotionData.teacherFeedback || '',
                createdAt: emotionData.evaluatedAt || null,
                teacherId: emotionData.evaluatedBy || null
            });
        }

        if (feedbackList && feedbackList.length > 0) {
            html += `
                <div class="evaluation-section">
                    <h4>이미 보낸 피드백</h4>
                    <div class="teacher-feedback-list">
                        ${feedbackList.map(fb => {
                            const created = fb.createdAt
                                ? (fb.createdAt.toDate ? fb.createdAt.toDate() : new Date(fb.createdAt))
                                : null;
                            const timeLabel = created ? format(created, 'a h시 m분').replace('AM', '오전').replace('PM', '오후') : '';
                            const safeEmoji = fb.emoji || '💬';
                            const safeText = fb.text || '';
                            return `
                                <div class="teacher-feedback-item">
                                    <div class="teacher-feedback-emoji" style="font-size: 2.4em; text-align: center; margin: 10px 0;">${safeEmoji}</div>
                                    ${safeText ? `
                                        <div class="teacher-feedback-bubble">
                                            <p>${safeText}</p>
                                            ${timeLabel ? `<div class="teacher-feedback-time">${timeLabel}</div>` : ''}
                                        </div>
                                    ` : ''}
                                </div>
                            `;
                        }).join('')}
                    </div>
                    <button class="recall-eval-btn" data-student-id="${studentId}" data-date="${date}" style="margin-top: 10px; background: #e0e0e0; color: #333;">이 날짜의 피드백 모두 회수하기</button>
                </div>
            `;
        }

        // 평가 섹션 (새 피드백 입력용 - 항상 빈 상태로 시작)
        html += `
            <div class="evaluation-section">
                <h4>평가하기</h4>
                <div class="emoji-selection">
                    <button class="eval-emoji-btn" data-emoji="⭐">⭐</button>
                    <button class="eval-emoji-btn" data-emoji="👍">👍</button>
                    <button class="eval-emoji-btn" data-emoji="💯">💯</button>
                    <button class="eval-emoji-btn" data-emoji="🎉">🎉</button>
                    <button class="eval-emoji-btn" data-emoji="🌟">🌟</button>
                    <button class="eval-emoji-btn" data-emoji="💪">💪</button>
                    <button class="eval-emoji-btn" data-emoji="✨">✨</button>
                    <button class="eval-emoji-btn" data-emoji="🎯">🎯</button>
                    <button class="eval-emoji-btn" data-emoji="👏">👏</button>
                    <button class="eval-emoji-btn" data-emoji="🔥">🔥</button>
                    <button class="eval-emoji-btn" data-emoji="💖">💖</button>
                    <button class="eval-emoji-btn" data-emoji="🎊">🎊</button>
                    <button class="eval-emoji-btn" data-emoji="💫">💫</button>
                    <button class="eval-emoji-btn" data-emoji="🌈">🌈</button>
                    <button class="eval-emoji-btn" data-emoji="☀️">☀️</button>
                    <button class="eval-emoji-btn" data-emoji="🌺">🌺</button>
                    <button class="eval-emoji-btn" data-emoji="🏆">🏆</button>
                </div>
                <div class="custom-emoji-input" style="margin-top: 15px;">
                    <label>직접 입력하기:</label>
                    <input type="text" class="custom-eval-emoji-input" placeholder="원하는 이모지를 입력하세요 (예: 😊)" maxlength="2" style="margin: 0 10px; padding: 5px;" />
                    <button class="add-custom-eval-emoji-btn" style="padding: 5px 15px; background: #8b6bb8; color: white; border: none; border-radius: 5px; cursor: pointer;">추가</button>
                </div>
                <div class="feedback-text-input" style="margin-top: 15px;">
                    <label style="display: block; margin-bottom: 8px; font-weight: bold;">피드백 문구:</label>
                    <textarea class="feedback-textarea" placeholder="학생에게 전달할 피드백 문구를 입력하세요" style="width: 100%; min-height: 80px; padding: 10px; border: 2px solid #e0e0e0; border-radius: 8px; font-size: 1em; resize: vertical;"></textarea>
                </div>
                <button class="submit-eval-btn" data-student-id="${studentId}" data-date="${date}" style="margin-top: 15px;">평가 전송하기</button>
            </div>
        `;

        submissionCard.innerHTML = html;
        container.innerHTML = '';
        container.appendChild(submissionCard);

        // 평가 이모지 선택 이벤트
        submissionCard.querySelectorAll('.eval-emoji-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                submissionCard.querySelectorAll('.eval-emoji-btn').forEach(b => b.classList.remove('selected'));
                btn.classList.add('selected');
            });
        });
        
        // 커스텀 이모지 추가 이벤트
        const customEvalInput = submissionCard.querySelector('.custom-eval-emoji-input');
        const addCustomEvalBtn = submissionCard.querySelector('.add-custom-eval-emoji-btn');
        
        addCustomEvalBtn.addEventListener('click', () => {
            const customEmoji = customEvalInput.value.trim();
            
            if (customEmoji && customEmoji.length <= 2) {
                // 이미 존재하는지 확인
                const existingBtn = Array.from(submissionCard.querySelectorAll('.eval-emoji-btn'))
                    .find(btn => btn.dataset.emoji === customEmoji);
                
                if (!existingBtn) {
                    const emojiContainer = submissionCard.querySelector('.emoji-selection');
                    const newBtn = document.createElement('button');
                    newBtn.className = 'eval-emoji-btn';
                    newBtn.dataset.emoji = customEmoji;
                    newBtn.textContent = customEmoji;
                    
                    newBtn.addEventListener('click', () => {
                        submissionCard.querySelectorAll('.eval-emoji-btn').forEach(b => b.classList.remove('selected'));
                        newBtn.classList.add('selected');
                    });
                    
                    emojiContainer.appendChild(newBtn);
                } else {
                    // 이미 존재하면 선택
                    existingBtn.click();
                }
                
                customEvalInput.value = '';
            } else {
                alert('올바른 이모지를 입력해주세요.');
            }
        });
        
        // Enter 키로도 추가 가능
        customEvalInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                addCustomEvalBtn.click();
            }
        });

        // 평가 전송 이벤트
        submissionCard.querySelector('.submit-eval-btn').addEventListener('click', async (e) => {
            const selectedEmoji = submissionCard.querySelector('.eval-emoji-btn.selected');
            if (!selectedEmoji) {
                alert('평가 이모지를 선택해주세요.');
                return;
            }

            const emoji = selectedEmoji.dataset.emoji;
            const feedbackText = submissionCard.querySelector('.feedback-textarea').value.trim();
            const studentId = e.target.dataset.studentId;
            const date = e.target.dataset.date;

            try {
                const emotionRef = doc(db, 'students', studentId, 'emotions', date);
                
                // 기존 문서를 읽어서 이전 피드백들을 배열로 모으기
                let feedbacks = [];
                const existingSnap = await getDoc(emotionRef);
                if (existingSnap.exists()) {
                    const existingData = existingSnap.data();
                    
                    // 이미 feedbacks 배열이 있으면 그대로 복사
                    if (Array.isArray(existingData.feedbacks)) {
                        feedbacks = [...existingData.feedbacks];
                    } else if (existingData.teacherEmoji) {
                        // 예전 구조(단일 teacherEmoji/teacherFeedback)만 있고 배열이 없던 경우
                        feedbacks.push({
                            emoji: existingData.teacherEmoji,
                            text: existingData.teacherFeedback || '',
                            createdAt: existingData.evaluatedAt || new Date(),
                            teacherId: existingData.evaluatedBy || currentUser.uid
                        });
                    }
                }

                // 이번에 보낸 피드백 추가
                feedbacks.push({
                    emoji,
                    text: feedbackText || '',
                    createdAt: new Date(),
                    teacherId: currentUser.uid
                });

                await setDoc(emotionRef, {
                    date,
                    studentId,
                    // 하루에 여러 개의 피드백을 쌓는 배열
                    feedbacks,
                    // 최신 피드백을 단일 필드에도 저장 (하위 호환용)
                    teacherEmoji: emoji,
                    teacherFeedback: feedbackText || null,
                    evaluatedAt: new Date(),
                    evaluatedBy: currentUser.uid
                }, { merge: true });

                alert('평가가 전송되었습니다!');
                // 최신 상태로 다시 렌더링 (입력창 초기화 + 갱신된 피드백 표시)
                await renderStudentSubmission(studentId, date, container);
            } catch (error) {
                console.error('평가 전송 오류:', error);
                alert('평가 전송에 실패했습니다.');
            }
        });

        // 기존 피드백이 있는 경우 회수 버튼 이벤트
        const recallBtn = submissionCard.querySelector('.recall-eval-btn');
        if (recallBtn) {
            recallBtn.addEventListener('click', async () => {
                const confirmRecall = confirm('이미 보낸 피드백을 회수하시겠어요? 학생 포도통장에서 이 피드백이 사라집니다.');
                if (!confirmRecall) return;

                try {
                    const emotionRef = doc(db, 'students', studentId, 'emotions', date);
                    await setDoc(emotionRef, {
                        // 해당 날짜의 모든 피드백 제거
                        feedbacks: [],
                        teacherEmoji: null,
                        teacherFeedback: null,
                        evaluatedAt: null,
                        evaluatedBy: null
                    }, { merge: true });

                    alert('피드백이 회수되었습니다.');
                    await renderStudentSubmission(studentId, date, container);
                } catch (error) {
                    console.error('피드백 회수 오류:', error);
                    alert('피드백 회수에 실패했습니다.');
                }
            });
        }

    } catch (error) {
        console.error('학생 제출 내용 로드 오류:', error);
    }
}

