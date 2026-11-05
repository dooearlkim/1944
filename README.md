# SKY ACE 1944

1940년대 공군 테마의 90년대 오락실풍 **세로 스크롤 슈팅게임**입니다.
순수 HTML5 Canvas + Vanilla JavaScript로 만들었고 외부 라이브러리, 빌드 도구, 이미지/사운드 파일이 없습니다.
그래픽은 모두 코드로 그리고(픽셀 배열 → 오프스크린 캔버스), 사운드는 Web Audio API로 합성합니다.
게임 이름, 기체, 보스, 음악, 로고는 모두 오리지널입니다.

## 파일 구성

| 파일 | 내용 |
|---|---|
| `index.html` | 캔버스, 모바일 CSS(safe-area, touch-action), 폭탄/일시정지 버튼 |
| `game.js` | 게임 전체 (스프라이트, 지형, 적, 보스, 사운드, 스테이지) |
| `manifest.json`, `sw.js`, `icons/` | PWA (홈 화면 추가, 전체화면, 오프라인 실행) |
| `serve.py` | 같은 와이파이의 휴대폰에서 접속할 수 있게 띄우는 개발 서버 |

## 조작법

| | 휴대폰 | 키보드 (PC 테스트용) |
|---|---|---|
| 이동 | 화면 아무 곳이나 드래그 (손가락 이동량만큼 기체가 움직임) | 방향키 / WASD |
| 사격 | 자동 연사 | 자동 연사 (Z도 동작) |
| 폭탄 | 오른쪽 아래 **BOMB** 버튼 | X |
| 일시정지 | 오른쪽 위 **II** 버튼 (앱 전환/화면 꺼짐 시 자동 일시정지) | P / Esc |
| 시작/컨티뉴 | 화면 탭 | Enter / Z / Space |

## 게임 규칙

- **P** 아이템: 샷 1→4단계 (최대일 땐 5000점). 죽으면 1단계가 내려가고 P를 떨어뜨립니다.
- **B** 아이템: 폭탄 +1 (최대 6개)
- **메달**: 연속으로 먹을수록 500 → 10000점까지 올라가고, 놓치면 처음 값으로 돌아갑니다.
- 폭탄은 화면 전체를 폭파하고, 적 탄을 지우고, 잠깐 무적이 됩니다.
- 피격 판정은 기체 중앙의 작은 점(반지름 2px)뿐입니다.
- 난이도는 스테이지가 진행될수록 올라갑니다. 1스테이지 초반 20초 동안은 적 전투기가 쏘지 않고, 보스 직전에 가장 어려워집니다. 2회차부터는 훨씬 어렵습니다.
- 목숨 3개. 100,000점과 250,000점에서 1UP, 그 뒤로는 250,000점마다 1UP을 줍니다.
- 스테이지: 1 태평양(보스: 전함 LEVIATHAN) → 2 남부 해안(보스: 거대 폭격기 HEAVEN'S ANVIL) → 3 사막 철도(보스: 열차포 GOLIATH). 클리어하면 더 어려운 2회차가 시작됩니다.
- 하이스코어는 브라우저(localStorage)에 저장됩니다.

## 1. PC에서 실행

`file://`로 열어도 동작하지만, 로컬 서버로 여는 쪽이 낫습니다.

```bash
python3 serve.py
```

브라우저에서 `http://localhost:8000` 을 엽니다. (Windows는 `python serve.py`)

## 2. 휴대폰에서 접속 (개발 중, 같은 와이파이)

1. PC와 휴대폰을 **같은 와이파이**에 연결합니다.
2. PC에서 서버를 실행합니다. `0.0.0.0`으로 열리고, 휴대폰용 주소가 출력됩니다.
   ```bash
   python3 serve.py
   ```
   ```
     PC      : http://localhost:8000
     Phone   : http://192.168.0.23:8000   <- open this on your phone (same Wi-Fi)
   ```
3. 휴대폰 브라우저에서 `Phone` 주소를 엽니다.
4. 접속이 안 되면 PC 방화벽에서 Python(또는 해당 포트)의 인바운드를 허용하세요.
   Windows는 처음 실행할 때 뜨는 "개인 네트워크 허용"을 체크하면 됩니다.

Node.js를 쓴다면 아래 명령도 됩니다. (IP는 `ipconfig` / `ifconfig`로 확인)

```bash
npx serve -l tcp://0.0.0.0:8000
```

> 참고: 서비스워커(오프라인/PWA)는 HTTPS나 localhost에서만 동작합니다.
> LAN IP(http)로 접속하면 PWA 캐시만 빠지고 게임은 정상 동작합니다.

## 3. GitHub Pages로 배포 (어디서나 HTTPS로 접속 + PWA)

1. GitHub에서 새 저장소를 만듭니다. 예: `1944` (Public)
2. 이 폴더를 올립니다.
   ```bash
   cd 1944
   git init
   git add .
   git commit -m "SKY ACE 1944"
   git branch -M main
   git remote add origin https://github.com/<내아이디>/1944.git
   git push -u origin main
   ```
   (git 없이 GitHub 웹에서 **Add file → Upload files**로 파일을 끌어다 놓아도 됩니다.)
3. 저장소의 **Settings → Pages**로 갑니다.
4. **Build and deployment → Source**를 `Deploy from a branch`로 두고,
   Branch는 `main`, 폴더는 `/ (root)`로 고른 뒤 **Save**를 누릅니다.
5. 1~2분 뒤 `https://<내아이디>.github.io/1944/` 에서 실행됩니다.
6. 코드를 고친 뒤 다시 push하면 자동으로 재배포됩니다.
   이때 `sw.js`의 `VERSION` 값(예: `skyace-v2`)을 올려야 휴대폰의 캐시도 갱신됩니다.

## 4. 홈 화면에 앱처럼 추가 (PWA)

GitHub Pages(HTTPS) 주소로 접속한 뒤 다음과 같이 추가합니다.

- **iPhone (Safari)**: 공유 버튼 → **홈 화면에 추가**
- **Android (Chrome)**: ⋮ 메뉴 → **홈 화면에 추가** (또는 **앱 설치**)

홈 화면 아이콘으로 실행하면 주소창 없이 전체화면 세로 모드로 열리고, 한 번 연 뒤에는 오프라인에서도 실행됩니다.

## 기술 메모

- 내부 해상도는 가로 240px 고정, 세로 320~400px(화면 비율에 맞춤)입니다. `image-rendering: pixelated`로 확대하며, 손실이 적으면 기기 픽셀 기준 정수배로 맞춥니다(devicePixelRatio 반영).
- `requestAnimationFrame` + 델타타임(최대 50ms로 제한)으로 갱신합니다.
- 총알, 적, 파티클, 폭발, 아이템은 미리 할당한 오브젝트 풀(swap-remove)을 써서 프레임 중 할당이 없습니다.
- 배경 지형은 시드 노이즈로 스테이지 시작 시 256px 청크 캔버스에 한 번 그려 두고, 프레임당 2~3번의 `drawImage`로 스크롤합니다. 파괴된 지상 적의 크레이터도 청크에 직접 새깁니다.
- 회전 스프라이트, 피격 시 흰색 번쩍임, 그림자는 시작할 때 미리 렌더링합니다.
- iOS 오디오 정책에 맞춰 첫 터치/키 입력에서 AudioContext를 생성하고 재개합니다.
