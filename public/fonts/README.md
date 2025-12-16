# 폰트 파일 업로드 폴더

이 폴더에 폰트 파일을 넣으면 웹앱에 자동으로 적용됩니다.

## 사용 방법

### 방법 1: 설정 파일 사용 (권장)

1. 이 폴더에 폰트 파일을 복사하세요 (예: `MyFont.ttf`)
2. `fonts.json.example` 파일을 복사하여 `fonts.json`으로 이름을 변경하세요
3. `fonts.json` 파일을 열어서 폰트 정보를 수정하세요:
   ```json
   {
     "fonts": [
       {
         "name": "내 폰트 이름",
         "file": "MyFont.ttf"
       }
     ]
   }
   ```
4. 웹앱을 실행하면 자동으로 폰트가 적용됩니다

### 방법 2: 자동 감지

1. 이 폴더에 폰트 파일을 복사하세요
2. 다음 이름 중 하나로 파일명을 변경하세요:
   - `NanumGothic.ttf`
   - `NotoSansKR.ttf`
   - `Pretendard.ttf`
   - `font.ttf` 또는 `custom-font.ttf` (일반적인 이름)
3. 웹앱을 실행하면 자동으로 폰트가 적용됩니다

## 지원 형식

- `.ttf` (TrueType)
- `.otf` (OpenType)
- `.woff` (Web Open Font Format)
- `.woff2` (Web Open Font Format 2.0)

## 예시

### 설정 파일 사용 예시
```json
{
  "fonts": [
    {
      "name": "나눔고딕",
      "file": "NanumGothic.ttf"
    }
  ]
}
```

### 자동 감지 예시
- `NanumGothic.ttf` → 자동으로 "NanumGothic" 폰트로 적용
- `NotoSansKR.otf` → 자동으로 "NotoSansKR" 폰트로 적용
- `font.ttf` → 자동으로 "font" 폰트로 적용

## 주의사항

- 파일명이 폰트 이름으로 사용됩니다 (확장자 제외)
- 여러 폰트 파일을 넣으면 첫 번째로 발견된 파일이 적용됩니다
- 웹앱 내 폰트 설정(🔤 버튼)에서도 업로드 가능합니다
- 설정 파일(`fonts.json`)을 사용하면 더 정확하게 폰트 이름을 지정할 수 있습니다
