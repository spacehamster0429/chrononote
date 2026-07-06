# ChronoNote

Markdown/Git 원본 중심의 하이브리드 메모 서비스 MVP입니다. 설계서의 핵심 흐름을 Node 내장 HTTP 서버와 `better-sqlite3` 기반 저장 계층으로 구현했습니다.

운영 주소: [note.serika.duckdns.org](https://note.serika.duckdns.org) · [이용약관](https://note.serika.duckdns.org/terms/) · [개인정보 처리방침](https://note.serika.duckdns.org/privacy/)

## 실행

```bash
npm install
npm run start:local
```

브라우저에서 `http://localhost:3030`을 엽니다.

외부 접속이 필요한 `npm start`는 `0.0.0.0:3030`에 바인딩됩니다. 이때는 `CHRONONOTE_SECRET`, `CHRONONOTE_JWT_SECRET`을 32자 이상의 서로 다른 랜덤 문자열로 설정해야 서버가 시작됩니다.

```bash
CHRONONOTE_SECRET="$(openssl rand -hex 32)" \
CHRONONOTE_JWT_SECRET="$(openssl rand -hex 32)" \
npm start
```

집 밖이나 다른 네트워크에서 접속하려면 OS 방화벽에서 3030 포트를 허용하고, 공유기/클라우드 환경에서 포트 포워딩 또는 보안 그룹을 열어야 합니다.

## Docker 실행

```bash
docker compose up --build
```

브라우저에서 `http://localhost:3030`을 엽니다. Docker 실행 시 포트는 호스트의 `127.0.0.1`에만 열리고, 데이터는 `./server-data`에 저장됩니다. 외부 공개는 HTTPS 리버스 프록시를 권장합니다.

Podman에서는 같은 compose 파일로 실행할 수 있습니다.

```bash
podman compose up --build -d
```

SELinux가 켜진 rootless Podman 환경에서도 `./server-data`에 쓸 수 있도록 볼륨에는 `:Z` 옵션을 붙여두었습니다.

## 포함된 기능

- JWT 쿠키 세션과 비로그인/로그인 상태 분리
- 이메일/비밀번호 회원가입, 로그인, 로그아웃
- 회원가입 시 이용약관·개인정보 수집 및 이용 동의와 만 14세 이상 확인 기록
- Google로 시작한 계정의 비밀번호 등록과 이메일 계정의 Google 연동
- 회원탈퇴 후 48시간 복구 유예와 만료 계정 데이터 삭제
- 로그아웃 시 기존 세션 즉시 무효화
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` 설정 시 Google OAuth 로그인
- 사용자별 `server-data/users/{user_id}` 격리 작업공간 생성
- 글로벌 계정 DB `server-data/global_db/auth.sqlite`
- 사용자 전용 검색 DB `personal_index.sqlite`
- Frontmatter 기반 `.md` 원본 파일 저장
- 3초 디바운스 자동 저장과 복구 배너
- 계정별 자동 저장 ON/OFF
- 명시 저장 시 파일 단위 Git 커밋
- 메모별 Git 히스토리 조회와 과거 버전 복원
- Markdown 미리보기에서 안전한 HTML/인라인 CSS와 KaTeX LaTeX 수식 표시
- 이미지 붙여넣기/업로드 후 상대 경로 Markdown 삽입
- JPEG/PNG/WebP는 WebP로 최적화, GIF/APNG는 MP4로 변환해 반복 재생
- SVG sanitize 후 같은 origin 첨부로 표시
- AES-256-GCM으로 저장되는 GitHub PAT와 수동 원격 동기화
- 기본 ZIP 내보내기는 메모와 첨부 중심이며, `include_history=1` 쿼리로 Git 히스토리를 포함할 수 있습니다
- 20MB 제한의 다중 텍스트 파일 가져오기
- 접을 수 있는 좌측 사이드바/우측 미리보기 히스토리 패널
- 모바일 작성 중 사이드바 자동 숨김과 오른쪽 패널 오프캔버스 표시
- 계정에 저장되는 라이트/다크 모드
- 시작 가이드와 설정에서 다시 열 수 있는 튜토리얼

## 환경 변수

```bash
CHRONONOTE_SECRET="openssl-rand-hex-32 같은 긴 랜덤 문자열"
CHRONONOTE_JWT_SECRET="CHRONONOTE_SECRET과 다른 긴 랜덤 문자열"
CHRONONOTE_DATA_DIR="./server-data"
CHRONONOTE_SECURE_COOKIES="auto"
CHRONONOTE_TRUST_PROXY="false"
GOOGLE_CLIENT_ID="..."
GOOGLE_CLIENT_SECRET="..."
GOOGLE_REDIRECT_URI="http://127.0.0.1:3030/api/auth/google/callback"
CHRONONOTE_MAX_USERS="64"
CHRONONOTE_WORKSPACE_QUOTA_BYTES="268435456"
CHRONONOTE_MAX_MEMOS_PER_USER="5000"
```

`NODE_ENV=production` 또는 Docker 실행에서는 쿠키에 `Secure`가 자동 적용됩니다. HTTPS 리버스 프록시 뒤가 아니라 HTTP LAN으로 직접 로그인 테스트를 해야 하면 `CHRONONOTE_SECURE_COOKIES=false`를 명시하세요.

Google 로그인은 Google Cloud Console의 OAuth Client에서 승인된 리디렉션 URI를 `GOOGLE_REDIRECT_URI`와 동일하게 맞추면 계정 패널의 `Google로 계속` 버튼으로 사용할 수 있습니다. 예: `http://127.0.0.1:3030/api/auth/google/callback`

GitHub 동기화는 앱 안의 계정 패널에서 `owner/repo`와 PAT를 저장한 뒤 `GitHub 동기화` 버튼으로 실행합니다. PAT는 글로벌 계정 DB에 암호화되어 저장되고, 원격 URL에는 토큰을 남기지 않습니다.

## 검증

```bash
npm run check
npm audit
```

## 구현 메모

설계서에는 Express, React/Vite 확장이 제안되어 있지만, 이 구현은 현재 Node 24 내장 HTTP 서버와 `better-sqlite3`로 동일한 저장 모델을 구성했습니다. 데이터 구조와 API 흐름은 추후 Express/React/Vite로 옮기기 쉽게 모듈을 나누었습니다.

## 라이선스

Apache License 2.0 · Copyright 2026 우주햄찌. 자세한 내용은 [LICENSE](LICENSE)와 [NOTICE](NOTICE)를 확인하세요.
