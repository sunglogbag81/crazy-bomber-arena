# Crazy Bomber Arena

크레이지 아케이드에서 영감을 받은 발표용 **실시간 온라인 폭탄 대전 웹게임**입니다.

## 기능

- 방 코드 기반 온라인 대전
- URL + 방 코드 공유로 외부 친구와 플레이
- Socket.IO 실시간 이동/폭탄 동기화
- 2~4인 플레이
- **솔로 테스트 모드**: 봇 2명과 바로 전투 가능
- 파괴 가능한 블록, 폭탄 연쇄 폭발, 체력/승패 처리
- 키보드와 모바일 터치 조작 지원
- Render/Docker 배포 준비 완료

## 로컬 실행

```bash
npm install
npm start
```

브라우저에서 `http://localhost:3000` 접속 후:

- `온라인 방 만들기`: 방 코드 생성
- `솔로 테스트`: 봇과 즉시 플레이
- `입장`: 다른 브라우저/기기에서 방 코드로 접속

## 조작

- 이동: WASD 또는 방향키
- 폭탄: Space
- 모바일: 화면 버튼

## 진짜 온라인으로 배포하기

### Render 추천

1. Render에서 `New Web Service` 선택
2. GitHub repo `crazy-bomber-arena` 연결
3. 설정은 `render.yaml`이 자동 인식합니다.
4. 배포된 URL을 친구에게 공유하고, 게임 안의 `초대 문구 복사` 버튼으로 방 코드를 보내면 됩니다.

### Docker

```bash
docker build -t crazy-bomber-arena .
docker run -p 3000:3000 crazy-bomber-arena
```

## 발표 포인트

1. 서버가 방 상태를 authoritative하게 관리합니다.
2. 클라이언트는 입력만 보내고, 서버가 매 tick마다 보드/플레이어/폭탄 상태를 브로드캐스트합니다.
3. 솔로 모드는 봇 AI가 이동/폭탄 설치를 해서 발표 리허설이 쉽습니다.
4. 배포 후에는 같은 URL에서 방 코드만 공유하면 실제 온라인 대전이 됩니다.
