# 주식투자 게임 — 배포 가이드

## 📁 파일 구조
```
stock-game-server/
├── server.js          ← Node.js 서버
├── package.json       ← 의존성 설정
├── README.md          ← 이 파일
└── public/
    ├── admin.html     ← 관리자 페이지
    └── player.html    ← 플레이어 페이지
```

---

## 🚀 Railway 무료 배포 (권장, 15분)

### 1단계 — GitHub 업로드

1. [github.com](https://github.com) 회원가입 (없으면)
2. **New repository** 클릭
3. 이름: `stock-game` → **Create repository**
4. 파일 전체 업로드:
   - `server.js`, `package.json` → 루트에
   - `admin.html`, `player.html` → `public/` 폴더 만들고 그 안에

### 2단계 — Railway 배포

1. [railway.app](https://railway.app) 접속 → **GitHub로 로그인**
2. **New Project** → **Deploy from GitHub repo**
3. 방금 만든 `stock-game` 저장소 선택
4. 자동 배포 시작! (2~3분)
5. **Settings → Networking → Generate Domain** 클릭
   - 예: `stock-game-production.up.railway.app`

### 3단계 — 접속 주소
```
관리자: https://your-app.up.railway.app/admin.html
플레이어: https://your-app.up.railway.app/player.html
```

> ✅ Railway 무료 플랜: 매달 $5 크레딧 제공 (소규모 게임 충분)

---

## 💻 로컬 실행 (테스트용)

### Node.js 설치
- [nodejs.org](https://nodejs.org) 에서 LTS 버전 다운로드 및 설치

### 실행
```bash
# 이 폴더에서 터미널 열고:
npm install
npm start
```

### 접속
```
관리자: http://localhost:3000/admin.html
플레이어: http://localhost:3000/player.html
```

> 같은 와이파이의 다른 기기에서 접속하려면:
> `http://내PC의IP주소:3000/player.html`
> (내 PC IP는 cmd에서 `ipconfig` 실행 후 IPv4 확인)

---

## 🎮 게임 진행 순서

1. **관리자** `admin.html` 접속 → 비밀번호: `admin1234`
2. **팀 관리** 탭에서 팀 생성 (팀명 + 코드 + 비밀번호)
3. 각 팀에게 접속 코드와 비밀번호 알려주기
4. 플레이어들 `player.html` 접속 → 코드+비밀번호 입력
5. 관리자가 **라운드 → 타이머 시작**
6. 라운드 종료 후 미니게임 진행
7. 5라운드 후 **결과 발표** 버튼 클릭

---

## ⚙️ 관리자 기본 비밀번호 변경

`server.js` 파일에서:
```javascript
adminPw: 'admin1234'  // 원하는 비밀번호로 변경
```
