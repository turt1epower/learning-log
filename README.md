# 배움공책 Web-App

초등학생을 위한 학습 기록 및 감정일기 웹 애플리케이션입니다.

## 주요 기능

1. **Google 로그인**: 학생과 교사 구분 로그인
2. **아침 감정일기**: ChatGPT 챗봇과 대화하며 아침 기분 기록
3. **교시별 학습 기록**: 텍스트 입력 또는 펜으로 도식 그리기
4. **종례 감정 기록**: 하루를 마무리하며 감정 기록 및 제출
5. **교사 모니터링**: 학생 제출 내용 확인 및 이모지 평가
6. **달력 뷰**: 교사 평가 이모지를 달력으로 확인

## 설치 및 실행

### 1. 의존성 설치

```bash
npm install
```

### 2. 환경 변수 설정

프로젝트 루트에 `.env` 파일을 생성하고 다음 내용을 추가하세요:

```
VITE_CHATGPT_API_KEY=your_chatgpt_api_key_here
```

OpenAI API 키는 [OpenAI Platform](https://platform.openai.com/)에서 발급받을 수 있습니다.

### 3. Firebase 설정

`src/firebaseConfig.js` 파일에서 Firebase 프로젝트 설정을 입력하세요:

```javascript
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_AUTH_DOMAIN",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_STORAGE_BUCKET",
  messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
  appId: "YOUR_APP_ID"
};
```

Firebase 프로젝트는 [Firebase Console](https://console.firebase.google.com/)에서 생성할 수 있습니다.

필요한 Firebase 서비스:
- Authentication (Google 로그인 활성화)
- Firestore Database

### 4. 개발 서버 실행

```bash
npm run dev
```

### 5. 빌드

```bash
npm run build
```

## 사용 방법

### 학생

1. 메인 페이지에서 "학생으로 시작하기" 클릭
2. Google 계정으로 로그인
3. 아침시간 탭에서 챗봇과 대화하며 감정 기록 (최소 3턴 이상)
4. 수업 기록 탭에서 교시와 과목 선택 후 학습 내용 기록
   - 텍스트로 기록: 텍스트 입력
   - 도식으로 기록: 펜으로 그리기 + 텍스트 상자 추가
5. 종례시간 탭에서 하루 감정 기록 및 제출

### 교사

1. 메인 페이지에서 "교사로 시작하기" 클릭
2. Google 계정으로 로그인
3. 날짜 선택 후 제출된 배움공책 확인
4. 각 학생의 내용을 확인하고 이모지로 평가 전송

## 프로젝트 구조

```
learning-log/
├── index.html              # 메인 로그인 페이지
├── student.html            # 학생 활동 페이지
├── teacherMonitor.html     # 교사 모니터링 페이지
├── src/
│   ├── firebaseConfig.js   # Firebase 설정
│   ├── index.js            # 로그인 관리
│   ├── main.js             # 학생 활동 관리
│   ├── admin.js            # 교사 모니터링
│   └── style.css           # 스타일
└── package.json
```

## 기술 스택

- **Frontend**: HTML, CSS, JavaScript (ES6+)
- **Build Tool**: Vite
- **Backend**: Firebase (Authentication, Firestore)
- **AI**: OpenAI ChatGPT API
- **Date Library**: date-fns

## 주의사항

- `.env` 파일은 Git에 커밋하지 마세요 (이미 .gitignore에 포함됨)
- Firebase 보안 규칙을 적절히 설정하세요
- ChatGPT API 사용량에 주의하세요 (과금 발생 가능)

