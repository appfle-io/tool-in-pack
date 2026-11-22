# TIP · TOOL-IN-PACK — 개발 히스토리

작은 도구들을 한곳에 모은 모듈형 오프라인 유틸리티 PWA.
라이브: <https://appfle-io.github.io/tool-in-pack/> · 저장소: <https://github.com/appfle-io/tool-in-pack>

이 문서는 **다른 AI 작업자와 개발자가 이어서 작업할 수 있도록** 남기는 기록입니다.

---

## 0. 히스토리 작성 요령 (다른 AI 작업자용)

새 모듈을 추가하거나 기존 기능을 고칠 때마다 **§3 버전 기록의 맨 위**에 아래 형식으로 한 블록을 추가합니다.
(가장 최근 작업이 가장 위에 오도록 쌓습니다.)

### 반드시 기록할 항목

| 항목 | 적을 내용 |
| --- | --- |
| **작성자** | 유동규(기획·요청·검수) + 실제 구현한 AI의 이름 (예: Pickle / Claude / GPT …). AI가 바꾼 부분과 사람이 직접 바꾼 부분을 구분해서 적는다. |
| **일시** | `YYYY-MM-DD HH:MM (KST)` — 커밋 시각 기준 |
| **버전** | `sw.js`의 `CACHE_VERSION`(예: `tip-v1.5.0`)과 커밋 해시 |
| **개발 내용** | 추가·수정한 **파일 경로**와 **기능 상세**. 새 모듈이면 id, 화면 구성, 입력/출력, 저장 형식까지 |
| **사용한 언어·라이브러리·세팅** | Vanilla HTML/CSS/ES Modules, 새로 넣은 `vendor/` 라이브러리와 버전·출처·패치 여부, 로컬 실행·테스트 방법 |
| **주의·제약** | 브라우저별 제약, 알려진 한계, 남은 일·다음 예정 작업 |

### 프로젝트 개발 원칙 (요약)

1. **빌드 도구 없음** — 순수 Vanilla HTML + CSS + ES Modules. 번들러·프레임워크·npm 런타임 의존 없이 `index.html`을 그대로 올리면 동작한다.
2. **CDN 의존 금지** — 모든 라이브러리는 `vendor/`에 셀프호스팅하고 버전을 고정한다. 오프라인에서도 그대로 동작해야 한다.
3. **모듈 추가는 두 곳** — `modules/<name>/module.js`(default export에 `id·name·subtitle·description·icon·mount`) + `modules/registry.js` 한 줄 등록. 홈 카드·라우팅·사용/고정 토글은 자동으로 붙는다.
4. **배포마다 `sw.js` 갱신** — `CACHE_VERSION`을 올리고 새 모듈·벤더 파일을 프리캐시 목록에 추가한다. (빠뜨리면 기존 사용자에게 옛 파일이 남는다.)
5. **GitHub Pages 제약** — GitHub Pages는 `COOP`/`COEP` 헤더를 보내지 않으므로 `SharedArrayBuffer`를 쓸 수 없다. 멀티스레드 `ffmpeg.wasm` 같은 방식은 라이브에서 실패한다.
6. **모바일 + 데스크톱 동시 대응** — 390px(iPhone)과 1280px(데스크톱·Mac 예정) 모두에서 확인한다. Mac 배포가 예정되어 있어 파일 드래그앤드롭·마우스 드래그·넓은 화면 레이아웃을 함께 본다.
7. **사용자 문서 동시 갱신** — 새 모듈은 `README.md`(사용자용 설명서)에 기능과 사용법을 반드시 추가한다. (`AGENT.md` 1번 지침)
8. **푸시 전·후 검증** — 로컬 정적 서버 + 헤드리스 브라우저로 실제 파일을 넣어 결과 바이트까지 확인한 뒤 푸시하고, 푸시 후 라이브 URL에서 다시 확인한다.

---

## 1. 프로젝트 개요

| 항목 | 내용 |
| --- | --- |
| 이름 | TIP — TOOL-IN-PACK |
| 한 줄 설명 | 서버로 아무것도 보내지 않고 브라우저(기기) 안에서만 도는 PowerToys 스타일 오프라인 유틸리티 PWA |
| 라이브 | <https://appfle-io.github.io/tool-in-pack/> (GitHub Pages, `/tool-in-pack/` 서브 경로) |
| 저장소 | <https://github.com/appfle-io/tool-in-pack> (public, `main` 브랜치가 곧 배포본) |
| 소유·기획 | 유동규 (@papaleo / GitHub @appfle-io) |
| 현재 버전 | **v1.9.0** (`sw.js` → `CACHE_VERSION = 'tip-v1.9.0'`) · 모듈 17종 · macOS 앱 포함 |
| 라이선스 | MIT (본 저장소 코드) + 서드파티 라이브러리는 각 라이선스 (LICENSE 참고) |

### 모듈 목록 (v1.9.0 기준) · 기본 순서 = 홈 섹션 순서 = 반원 퀵바 기본 순서

| # | id | 이름 | `category` (홈 섹션) | 한 줄 기능 |
| --- | --- | --- | --- | --- |
| 1 | `doc-reader` | 문서 리더 | `docs` (문서) | PDF · HWP · HWPX 열람 (페이지 이동·확대·회전) |
| 2 | `img-converter` | 이미지 컨버터 | `media` (미디어) | 이미지 포맷 변환·리사이즈 (9종 입력 → 6종 출력) |
| 3 | `pdf-tools` | PDF 합치기 · 페이지 추출 | `docs` (문서) | PDF 병합(순서 변경) · 페이지 범위 추출 |
| 4 | `photo-privacy` | 모자이크 · 위치정보 제거 | `media` (미디어) | EXIF/GPS 확인 → 모자이크·블러 → 메타데이터 삭제 저장 |
| 5 | `qr-gen` | QR 생성기 | `utility` (유틸리티) | URL · 텍스트 · 와이파이 QR → PNG/SVG |
| 6 | `video-gif` | 동영상 자르기 · GIF | `media` (미디어) | 구간 잘라 GIF 변환 / 클립 저장 |
| 7 | `dev-tools` | 개발자 툴팩 | `utility` (유틸리티) | JSON 정렬·압축·검증 · Base64/URL · JWT 디코드 · 타임스탬프 · UUID v4 |
| 8 | `text-diff` | 텍스트 비교 · 정리 | `utility` (유틸리티) | 줄 단위 LCS diff · 글자/단어/줄/바이트 통계 · 빈 줄·중복 줄 정리 |
| 9 | `regex-tester` | 정규식 테스터 | `utility` (유틸리티) | 실시간 매치 하이라이트 · 캡처 그룹 · 프리셋 6종 |
| 10 | `color-tools` | 색상 · 대비 체크 | `utility` (유틸리티) | HEX/RGB/HSL 변환 · WCAG 대비율·AA/AAA 배지 · 스포이드(지원 시) |
| 11 | `icon-gen` | 앱 아이콘 생성기 | `utility` (유틸리티) | 16~1024px PNG 7종 + manifest 스니펫 ZIP |
| 12 | `ocr-reader` | 이미지 텍스트 추출 | `utility` (유틸리티) | OCR(한국어·영어) · 진행률 · 편집/복사/TXT 저장 |
| 13 | `md-editor` | 마크다운 편집기 | `docs` (문서) | GFM 표·체크박스·코드 미리보기 · .md/.html 저장 · 인쇄 · 자동 임시 저장 |
| 14 | `video-mosaic` | 영상 모자이크 | `media` (미디어) | 드래그 사각 영역 모자이크/블러 · MediaRecorder 실시간 인코딩(오디오 포함) |
| 15 | `file-compress` | 파일 압축 · ZIP | `utility` (유틸리티) | 이미지 압축 · PDF 래스터라이즈 축소 · ZIP 묶기/풀기 |
| 16 | `unit-converter` | 단위 변환기 | `utility` (유틸리티) | 길이·무게·속도·온도·넓이(평)·부피·데이터 7종 즉시 변환 |
| 17 | `currency-calc` | 환율 계산기 | `utility` (유틸리티) | 12개 통화 · 공개 환율표 캐시 · 수동 환율 · 오프라인 폴백 |

홈 표시 순서는 `registry` 배열 순서를 따르며, v1.7.0부터 **꺼진 모듈은 원래 묶음에서 빠져 맨 아래 '꺼진 모듈' 한 섹션**에 모인다(0개면 숨김). `modules/registry.js`가 홈 섹션 순서를 정한다: `CATEGORIES = [docs 문서, media 미디어, utility 유틸리티]` → 홈은 **고정됨 → 문서 → 미디어 → 유틸리티** 순서로 그린다. `category`가 없거나 모르는 값이면 `FALLBACK_CATEGORY`(`utility`)로 모인다.

v1.8.0부터 사용자가 **카드 왼쪽 핸들(⋮⋮)을 끌어 같은 섹션 안 순서를 바꿀 수 있고**, 그 순서가 `localStorage` `tip.order.v1`(섹션별 module id 배열)에 저장된다. 저장된 배열에 없는 모듈(새로 추가된 모듈)은 원래 순서대로 뒤에 붙고, 꺼진 모듈은 순서를 바꾸지 않는다.

---

## 2. 개발 환경 · 구조 · 실행 · 테스트

### 언어와 런타임

- **HTML5 + CSS3 + JavaScript(ES2020+, ES Modules)**. TypeScript·JSX·번들러 없음.
- 프레임워크 없음. DOM은 `js/ui.js`의 `el()` 헬퍼와 템플릿 문자열로 만든다.
- 실행 환경: iOS Safari 16+, macOS/iPadOS Safari, Chrome/Edge 최신, Android Chrome.
- 라이브러리는 전부 브라우저에서 직접 로드(`<script>` 또는 ESM `import`)하며, Node.js는 **개발·테스트용으로만** 쓴다.

### 디렉토리 구조

```
index.html                앱 셸 (PWA 메타 태그, 테마 프리페인트 스크립트, 벤더 스크립트 로드)
manifest.json             PWA 매니페스트 (이름·아이콘·start_url·shortcuts)
sw.js                     서비스 워커 — 앱 셸 프리캐시 (배포 시 CACHE_VERSION 갱신)
radial.html               Mac 메뉴 막대 반원 퀵바 창 (투명 창 · 580×260)
css/radial.css            반원 판(clip-path)·타일·위쪽 컨트롤 스타일
js/radial.js              반원 퀵바 렌더·회전(휠/화살표)·모듈 열기·테마 실시간 동기화
js/quickbar.js            퀵바 순서 계산 (기본값 = 홈 순서, 사용자 지정 = tip.radialOrder.v1)
mac/                      macOS 앱 (Tauri 2) — 아래 'macOS 앱' 절 참고
.nojekyll                 GitHub Pages Jekyll 처리 비활성
css/app.css               전체 스타일 (모바일 퍼스트 + Safe Area + 라이트/다크 + 데스크톱 미디어쿼리)
js/app.js                 해시 라우터(#/<module-id>), 홈 허브(고정됨·카테고리 섹션), ⚙️ 환경설정 시트, SW 등록
js/ui.js                  DOM 헬퍼(el, toast, formatBytes), 공용 아이콘 SVG
js/store.js               localStorage 설정 (모듈 enabled/pinned, 테마, 액센트)
modules/registry.js       모듈 레지스트리 + CATEGORIES(홈 섹션 순서) — 새 모듈은 여기 한 줄 + import 한 줄
modules/doc-reader/       문서 리더 (module.js, pdf-viewer.js, hwp.js, hwpx.js, renderers.js)
modules/img-converter/    이미지 컨버터 (module.js, encoders.js — BMP/ICO/PDF 인코더)
modules/pdf-tools/        PDF 합치기·페이지 추출 (module.js)
modules/photo-privacy/    모자이크·EXIF 제거 (module.js, exif.js — EXIF/GPS 파서)
modules/qr-gen/           QR 생성기 (module.js)
modules/video-gif/        동영상 자르기·GIF (module.js)
modules/dev-tools/        개발자 툴팩 — JSON·Base64/URL·JWT·타임스탬프·UUID (module.js)
modules/text-diff/        텍스트 비교·정리 — LCS diff·통계·정리 (module.js)
modules/regex-tester/     정규식 테스터 — 매치 하이라이트·캡처 그룹 (module.js)
modules/color-tools/      색상·대비 체크 — HEX/RGB/HSL·WCAG (module.js)
modules/icon-gen/         앱 아이콘 생성기 — Canvas 리사이즈·JSZip (module.js)
modules/ocr-reader/       이미지 텍스트 추출 — tesseract.js (module.js)
vendor/                   셀프호스팅 라이브러리 (아래 표)
icons/                    PWA 아이콘 (1024 마스터 / 512 / maskable / 192 / apple-touch / favicon·32)
tools/make-icons.py       아이콘 재생성 스크립트 (Python + Pillow)
tools/make-mac-icons.py   macOS .icns·메뉴 막대 템플릿 아이콘 재생성 (Python + Pillow)
.github/workflows/build-mac.yml  macOS Universal .dmg 자동 빌드(서명·공증 분기)
samples/                  테스트용 샘플 문서·이미지 (PDF/HWPX/이미지 자체 생성, HWP는 공개 픽스처)
README.md                 사용자용 설명서
AGENT.md                  AI/개발자용 작업 지침
HISTORY.md                이 문서
LICENSE                   MIT + 서드파티 라이선스 목록
```

### macOS 앱 (`mac/`, Tauri 2)

```
mac/package.json                    Tauri CLI devDependency(^2), 스크립트(dev/build/collect)
mac/scripts/collect-web.sh          루트 정적 파일(index.html·radial.html·css·js·modules·vendor·icons)을 mac/dist-web 로 복사
mac/src-tauri/tauri.conf.json       productName TIP · identifier io.appfle.tip · frontendDist ../dist-web · windows[main 1040×760, min 420×700]
mac/src-tauri/Cargo.toml            tauri 2 (features: tray-icon, image-png, macos-private-api)
mac/src-tauri/src/lib.rs            트레이·퀵바·컴팩트 창·메인 창 동작과 명령(hide_radial, open_main, open_tool)
mac/src-tauri/src/main.rs           tip_lib::run() 진입점
mac/src-tauri/capabilities/default.json  창 3종(main·quickbar·tool)의 core:default 권한
mac/src-tauri/icons/                icon.icns, trayTemplate.png(22), trayTemplate@2x.png(44) — tools/make-mac-icons.py 로 생성
mac/src-tauri/gen/                  tauri-build 자동 생성 (git 제외)
mac/dist-web/                       collect-web.sh 결과 (git 제외, tauri build 전 자동 실행)
```

- 웹 자산은 **복사**해서 쓴다. `dist-web` 은 산출물이라 커밋하지 않고, `beforeBuildCommand` 가 매 빌드마다 새로 만든다.
- 창 3종의 관계: `main`(전체 창) · `quickbar`(메뉴 막대 반원, 투명·무테두리·always on top·포커스 아웃 시 hide) · `tool`(모듈별 420×680 컴팩트 창, `index.html?module=<id>` 로 열린다).
- 세 창은 같은 origin(`tauri://localhost`)이라 `localStorage` 설정을 공유한다. 메인 창에서 순서를 바꾸면 퀵바가 `storage` 이벤트 + 700ms 폴링으로 따라간다.
- `withGlobalTauri: true` 라 프런트엔드는 번들러 없이 `window.__TAURI__.core.invoke(...)`·`window.__TAURI__.event.listen(...)` 만 쓴다(웹 빌드 도구 금지 원칙 유지).

### 셀프호스팅 라이브러리 (`vendor/`)

| 파일 | 라이브러리 | 버전 | 라이선스 | 쓰는 곳 | 패치 |
| --- | --- | --- | --- | --- | --- |
| `vendor/pdfjs/pdf.min.js`, `pdf.worker.min.js` | PDF.js | 3.11.174 | Apache-2.0 | 문서 리더 PDF 렌더 | 없음 (worker 경로만 코드에서 지정) |
| `vendor/jszip/jszip.min.js` | JSZip | 3.10.1 | MIT / GPL-3.0 | HWPX(zip) 해제 | 없음 |
| `vendor/hwpjs/hwp.esm.js` | hwp.js | 0.0.3 | Apache-2.0 | HWP 5.x 바이너리 파싱 | **있음** ① Node 전용 `fs` import를 스텁으로 교체 ② `cfb.read`가 `Uint8Array`를 받으면 base64 변환 없이 바로 `parse()`로 넘기도록 수정 (`TIP patch` 주석 참고) |
| `vendor/heic2any.min.js` | heic2any | 0.0.4 | MIT | HEIC/HEIF 디코딩 (브라우저가 못 읽을 때) | 없음 (지연 로드) |
| `vendor/pdf-lib/pdf-lib.min.js` | pdf-lib | 1.17.1 | MIT | PDF 병합·페이지 추출 | 없음 (UMD, `window.PDFLib` 사용) |
| `vendor/qrcode/qrcode.mjs` | qrcode-generator | 2.0.4 | MIT | QR 모듈 생성 | 없음 (ESM 그대로) |
| `vendor/gifenc/gifenc.esm.js` | gifenc | 1.0.3 | MIT | GIF 인코딩(양자화·LZW) | `sourceMappingURL` 주석만 제거 |
| `vendor/tesseract/tesseract.min.js`, `worker.min.js` | tesseract.js | 6.0.1 | Apache-2.0 | OCR 메인 스레드·워커 | 없음 (지연 로드, `window.Tesseract`) |
| `vendor/tesseract/core/tesseract-core-{simd-,}lstm.wasm.js` | tesseract.js-core | 6.0.0 | Apache-2.0 | Tesseract WASM(LSTM 전용, wasm 내장 단일 파일) | 없음 (SIMD 지원 여부로 파일 선택, 프리캐시 제외) |
| `vendor/tesseract/lang/kor.traineddata.gz`, `eng.traineddata.gz` | tessdata_fast | 4.x(2026-07 배포본) | Apache-2.0 | OCR 한국어·영어 학습 데이터 | gzip -9 재압축만 (프리캐시 제외) |
| `vendor/fonts/PretendardVariable.woff2` | Pretendard | Variable | SIL OFL 1.1 | 전체 UI 폰트 | 없음 |

라이브러리를 새로 넣을 때: `npm pack`/`npm i`로 받아 **minified 배포본만** `vendor/<이름>/`에 복사하고, 라이선스 파일을 함께 두고, `LICENSE`의 서드파티 목록에 한 줄 추가하고, `sw.js` 프리캐시 목록에 경로를 넣는다.

### 로컬 실행

빌드 과정이 없으므로 정적 서버만 있으면 된다. (ES Modules + 서비스 워커 때문에 `file://`로는 동작하지 않는다.)

```bash
cd work/tip
python3 -m http.server 8000
# 브라우저에서 http://127.0.0.1:8000/ 열기
```

### 테스트 방법

서비스 워커가 캐시를 물고 있으므로 **검증은 항상 새 브라우저 컨텍스트**(시크릿 창 또는 새 프로필)에서 한다.

1. **수동 확인** — 홈에서 12개 카드 → 각 모듈을 실제 파일로 실행. 모바일 390×844, 데스크톱 1280×800 두 크기에서 확인.
2. **헤드리스 자동 검증(v1.6.0 때 사용)** — `work/v16/`(저장소 밖)에 Python + Playwright 하네스가 있다. `harness.py`가 `work/tip`을 정적 서빙하고 `chrome-linux64`를 띄운다. `test_func.py`(유틸리티 5종 실데이터 56항목), `test_ocr.py`·`test_ocr2.py`(OCR 31항목, 오프라인 콜드 스타트 포함), `shots_all.py`(390·1280 × 라이트/다크 스크린샷·넘침·콘솔), `test_lang.py`(언어 3종). 결과 JSON은 `work/v16/results-*.json`, 스크린샷은 `work/v16/shots/v160-*.png`.
3. **헤드리스 자동 검증(v1.4.0 때 사용)** — 이 개발 환경(워크스페이스)의 `work/tipv14/`에 하네스가 있다(저장소에는 넣지 않음).
   - `static-server.js` — 저장소 루트를 서빙하는 최소 Node 정적 서버
   - `make-pdfs.js` — pdf-lib로 페이지 크기가 다른 테스트 PDF 생성 (병합 순서 검증용)
   - `make-exif-photo.py` — Pillow + 직접 작성한 APP1(TIFF)으로 GPS 포함 EXIF JPEG 생성, Pillow로 재검증
   - `test-v14.js` — Playwright(헤드리스 Chromium)로 58개 항목 검증: PDF 병합/추출 바이트·페이지 수, EXIF 표시·모자이크 픽셀 변화·저장 파일 EXIF 0건, QR PNG 치수·SVG, GIF 헤더/프레임 수/지연, 클립 길이·해상도, 드래그앤드롭, 데스크톱 2열 레이아웃, 가로 넘침, 콘솔/페이지 에러 0건, 404 0건, SW 캐시 버전
   - 테스트 영상은 브라우저 안에서 `canvas.captureStream()` + `MediaRecorder`로 생성한다(외부 툴 불필요).
4. **헤드리스 자동 검증(v1.7.0 때 사용)** — `work/tip-verify/v17/`(저장소 밖).
   - `server.cjs` 정적 서버 + `/__fixtures/` 매핑, `gen-video.cjs`가 브라우저 안에서 테스트 클립(MP4)을 만든다.
   - `verify-a.cjs`(51항목): 홈 17카드·섹션 구성, 스위치 OFF→'꺼진 모듈' 이동/ON 복귀/고정 모듈 복귀, 단위 변환 정확도(길이·평·온도·SI/IEC·기준 전환·복사), 환율(오프라인 폴백·수동 환율·mock API 갱신·캐시 재사용·금액 미전송 검증), 마크다운(GFM 표/체크박스/코드/인용, XSS 새니타이즈, 탭 전환, .md/.html 저장, 데스크톱 2단).
   - `verify-b.cjs`(24항목): 이미지 2장 압축 결과 바이트·PIL 재검사·ZIP 엔트리, PDF 3페이지 축소(pypdf 페이지/크기, pypdfium2 렌더 확인), ZIP 묶기/풀기 엔트리·개별 저장.
   - `verify-c.cjs`(20항목): 영상 로드·드래그 영역·실행취소/삭제·모드 전환, MediaRecorder 산출물 길이/해상도, 원본 대비 모자이크 영역 디테일(색 수 48→16, 가장자리 에너지 3.87→2.08)과 바깥 영역 보존, 오디오 트랙(`webkitAudioDecodedByteCount` 20,139B).
   - `verify-d.cjs`(9항목): 서비스 워커 `tip-v1.7.0` 프리캐시 50개, 오프라인 재로드로 홈 17카드·마크다운(표/체크박스)·환율(내장 참고)·영상·압축 화면 동작.
   - 합계 **104항목 전부 통과**. 결과 JSON `results-a/b/c/d.json`, 스크린샷 `work/tip-mockups/tip-v17-*.png`(390·1280, 라이트/다크·상태별).
5. **헤드리스 자동 검증(v1.8.0 때 사용)** — `work/tip-verify/v18/`(저장소 밖).
   - `verify-v18.cjs`(46항목, Playwright + chrome-headless-shell 대신 `work/chrome`): 390×844 터치는 **CDP `Input.dispatchTouchEvent`**(진짜 터치 → `pointerType: 'touch'`), 1280×800 은 마우스(`page.mouse`)로 끈다.
   - 검사: 핸들 개수·터치 영역(24×44)·`touch-action`·`tip.order.v1` 저장, 문서/미디어/유틸리티/고정됨 섹션 안 이동, 2열 그리드 좌우 교환, 같은 섹션 밖으로 나가지 않음, 끄는 중 자리표시·`position:fixed`·카드가 `body`로 이동, 새로고침 유지, OFF→ON 유지, 키보드 ↑↓ 이동·초점 유지·안내 토스트, 아래 가장자리 자동 스크롤, 새 모듈 뒤 붙임·없는 id·중복 무시, 설정 시트 순서 초기화(`tip.order.v1`만 삭제), 스위치·핀·실행 회귀, 콘솔 에러 0·404 0·가로 넘침 0.
   - 결과 JSON `results.json`, 스크린샷 `work/tip-verify/v18/shots/`(390·1280, 라이트/다크, 끄는 중 포함).
6. **푸시 후 라이브 확인** — GitHub Pages 반영(보통 30~90초)을 `sw.js`의 `CACHE_VERSION`으로 확인하고, 라이브 URL에서 홈 6개 카드와 신규 모듈을 실제 파일로 다시 실행한다. 기존 방문자는 서비스 워커 때문에 **한 번 새로고침**해야 새 버전으로 바뀐다(설계된 동작: `skipWaiting` + `clients.claim`).

### 배포 절차

```bash
cd work/tip
git add -A
git commit -m "v1.x.0: ..."
git push origin main          # → GitHub Pages 자동 배포
curl -s https://appfle-io.github.io/tool-in-pack/sw.js | head -3   # CACHE_VERSION 확인
```

---

## 3. 버전 기록 (최신이 위)

### v1.9.0 — 2026-11-23 (KST) · `tip-v1.9.0` · macOS 앱 + 반원 퀵바

- **작성자**: 유동규(기획·반원 퀵바 컨셉·퀵바 전용 순서 요청·검수) + Pickle(AI) 구현
- **개발 내용** (macOS 앱 신규 + 웹에 퀵바 순서 설정 추가 — 모듈 17종 그대로)
  - `radial.html` — 메뉴 막대 반원 퀵바 창. 흰/어두운 유리 판 위에 위쪽 `앱 열기` 버튼, 그 아래 반원 호를 따라 켜 둔 모듈 타일. 테마·색상은 `index.html` 과 같은 프리페인트 스크립트로 첫 페인트 전에 적용한다. `?bg=1` 은 미리보기용 배경(스크린샷 전용).
  - `js/radial.js` — 반원 기하 상수(`G`: 타원 중심 92, 반지름 210×58, 칸 간격 21°, 판 여유 34×22, 판 최대 각 112°)로 **판 테두리(clip-path)와 타일 좌표를 같은 식**으로 만든다. 한 화면 7칸, 넘치는 모듈은 **휠·트랙패드(deltaX/Y)·←→·‹› 버튼**으로 호를 따라 회전(연속 `pos` → 0.3 이징 rAF). 가장자리에 걸친 타일은 먼저 가운데로 끌어오고, 가운데 타일을 누르면 `open_tool`(Tauri) 또는 `index.html?module=<id>`(웹). `Esc`·바깥 클릭은 창을 숨긴다. 테마·순서·켜기/끄기는 `storage` + 포커스 + 700ms 폴링으로 실시간 동기화.
  - `css/radial.css` — 투명 창 배경, `filter: drop-shadow` 를 건 래퍼 안에 `clip-path` 유리판, 타일 52px 원형 + 10.5px 라벨(말줄임), 액센트 hover, `prefers-reduced-motion` 대응.
  - `js/quickbar.js` (신규) — 퀵바 순서 계산. 기본값은 홈과 같은 `고정됨 → 문서 → 미디어 → 유틸리티`(각 섹션은 `tip.order.v1`), 사용자가 바꾼 `tip.radialOrder.v1` 이 있으면 그것이 우선. `saveQuickOrder(onIds)` 는 **꺼 둔 모듈의 자리를 지킨 채** 켜 둔 모듈만 새 순서로 치환한다.
  - `js/store.js` — `tip.radialOrder.v1` 읽기/쓰기/초기화(`getRadialOrder`·`setRadialOrder`·`hasRadialOrder`·`resetRadialOrder`), 창 사이 동기화용 `syncStore()`(캐시 비우기)와 `storage` 이벤트 처리. 기존 키는 그대로.
  - `js/app.js` — ⚙️ 환경설정 시트에 **반원 퀵바 순서** 섹션(켜 둔 모듈 목록, `⋮⋮` PointerEvent 드래그 + ↑↓ 버튼, `메인 순서 따르기` 초기화). 드래그는 줄을 DOM 안에서 옮기면 핸들의 포인터 캡처가 풀리므로 **window 에 pointermove/pointerup** 을 걸었고, 시트 가장자리에서 자동 스크롤한다. `index.html?module=<id>` 딥링크(컴팩트 창), Tauri 이벤트(`tip://open-module`) 수신, Tauri 안에서는 서비스 워커를 등록하지 않는다.
  - `css/app.css` — v1.9.0 섹션: `.sheet` 최대 높이 88vh + 스크롤, `.qb-*` (목록·행·핸들·아이콘·이름·↑↓ 버튼) 스타일.
  - `mac/` — Tauri 2 프로젝트(위 구조 절 참고). 트레이 템플릿 아이콘, 좌클릭 토글, 포커스 아웃 자동 숨김, 메뉴(앱 열기·퀵바·종료), 메인 창 X = 숨김, Dock 재오픈, `open_tool` 은 컴팩트 창 재사용.
  - `.github/workflows/build-mac.yml` — `macos-latest` 에서 Universal(`aarch64`+`x86_64`) `.app`/`.dmg` 빌드. Secrets 가 있으면 Developer ID 서명 + 공증, 없으면 Ad-hoc(`APPLE_SIGNING_IDENTITY=-`). 빌드 후 **lipo(arm64+x86_64)·Info.plist 버전·codesign·hdiutil verify·DMG 내부 앱**을 검사하고, `.dmg` · `.app.tar.gz` · `SHA256SUMS.txt` 를 아티팩트로 올린다(태그면 Release 첨부).
  - `tools/make-mac-icons.py` — `icons/icon-1024.png` → `icon.icns`(7종 크기), 메뉴 막대 템플릿 PNG(22/44, 라운드 사각 + 2×2 그리드).
  - `sw.js` — `tip-v1.9.0`, 프리캐시에 `radial.html`·`css/radial.css`·`js/radial.js`·`js/quickbar.js` 추가.
  - `.gitignore` — `mac/dist-web/`·`node_modules/`·`target/`·`gen/`.
- **사용한 언어·라이브러리·세팅**: 프런트엔드는 그대로 Vanilla(빌드 없음) + Tauri 2 `withGlobalTauri`(npm 프런트엔드 빌드 없음). Rust `tauri 2`(tray-icon, image-png, macos-private-api), CLI `@tauri-apps/cli 2.12.6`(mac/package-lock.json 고정). 아이콘은 Python Pillow.
- **검증**: 아래 '검증 결과' 참고(로컬 웹 32항목 + GitHub Actions macos-latest 빌드).
- **주의·제약**:
  - 서명 Secrets 가 없으면 Ad-hoc 서명이라 첫 실행에 Finder 우클릭 → 열기(또는 `xattr -dr com.apple.quarantine`)가 필요하다.
  - 반원 창은 **포커스 아웃 시 자동으로 숨는다.** 컴팩트 창은 파일 선택 대화상자를 써도 닫히지 않게 일반 창(타이틀바 있음)으로 띄운다.
  - 퀵바 순서는 웹 `localStorage` 에만 저장된다(계정·서버 없음). 웹과 Mac 앱은 서로 다른 origin 이므로 **각각 따로** 저장된다(웹 브라우저 ↔ Mac 앱 사이 동기화는 없음).
  - DMG/앱은 Universal 이지만, CI 는 실제 실행 테스트를 하지 않는다(빌드·서명·번들 구조 검사까지).

### v1.8.0 — 2026-11-23 00:38 (KST) · 커밋 `8ee58b7` · `tip-v1.8.0`

- **작성자**: 유동규(기획·드래그 순서 변경 요청·검수) + Pickle(AI) 구현
- **개발 내용** (기능 추가 — 홈 카드 순서 바꾸기, 모듈 17종 그대로)
  - `js/store.js` — `tip.order.v1` 추가. `getSectionOrder(sectionId)` / `setSectionOrder(sectionId, ids)` / `hasSectionOrder()` / `resetSectionOrder()`. 값은 `{ pinned: [], docs: [], media: [], utility: [] }` 모양의 **섹션별 module id 배열**이며, 읽을 때 없는 섹션·문자열이 아닌 값은 버리고 중복은 제거한다(망가진 값이 섞여도 홈이 그려진다). 기존 키(`tip.settings.v1`·`tip.theme`·`tip.accent`)는 건드리지 않는다.
  - `js/app.js` — 홈 허브
    - `ordered(entries, sectionId)`: 섹션 항목을 저장된 id 순서로 정렬. 배열에 없는 모듈은 `Number.MAX_SAFE_INTEGER`로 밀려 **원래(레지스트리) 순서대로 뒤에** 붙는다(안정 정렬). 꺼진 모듈(`off`)은 정렬하지 않는다.
    - `dragHandle(row, mod, sectionId)`: 카드 왼쪽 여백에 놓는 **⋮⋮ 핸들 버튼**(`data-control="drag"`, `aria-label="<모듈> 순서 바꾸기"`). 카드가 `role="button"`이므로 핸들 클릭은 `stopPropagation`으로 모듈 열기를 막는다.
    - **Pointer Events 드래그**: `startDrag()`가 `pointerdown`에서 `setPointerCapture`로 포인터를 잡고, 카드를 `position: fixed`로 `document.body`로 옮긴 뒤 원래 자리에 점선 `.drag-placeholder`를 남긴다. `onDragMove()`는 카드를 포인터에 붙여 따라오게 하고(가로는 화면 밖으로 나가지 않게 클램프), `placePlaceholder()`가 **가장 가까운 카드 중심**을 찾아 그 앞/뒤에 자리표시를 옮긴다. 한 줄이면 y, 2열 그리드(`grid-template-columns` 개수로 판별)면 같은 줄에서는 x로 앞/뒤를 정한다. `onDragEnd()`는 자리표시 자리에 카드를 되돌리고 **DOM 순서 그대로** `setSectionOrder()`로 저장 → 토스트 `카드 순서를 저장했습니다`. 실제로 자리가 바뀌지 않았으면 저장·토스트 없음. `pointercancel`이면 저장값 그대로 다시 그린다.
    - `autoScroll()`: 끄는 동안 화면 위·아래 76px 안에 들어오면 `requestAnimationFrame`으로 페이지를 따라 스크롤한다(최대 16px/프레임).
    - `moveByKeyboard()`: 핸들에서 ↑↓(한 줄은 ±1, 2열은 ±열 수)·←→(2열에서 ±1)로 한 칸 이동, 저장 후 토스트 `<모듈>을(를) n번째로 옮겼습니다 (n/총)`, 맨 앞·맨 뒤에서는 `이미 맨 앞입니다`/`이미 맨 뒤입니다`. 이동 후에도 핸들 초점 유지.
    - 설정 시트에 **홈 화면 — 카드 순서 초기화** 버튼(`.sheet-reset`): 순서를 바꾼 적이 있을 때(`hasSectionOrder()`)만 보이고, `resetSectionOrder()` → 홈을 다시 그린다.
  - `css/app.css` — v1.8.0 섹션. `.module-card.has-drag { position: relative; padding-left: 24px; }`로 핸들을 카드 왼쪽 여백에 **절대 배치**해 제목 폭 손실을 10px로 줄였다(390px에서 제목이 두 줄로 끌어지지 않음). `.drag-handle` 24×44px, `touch-action: none`, `user-select`/`touch-callout`/`tap-highlight` 차단, `:focus-visible` 윤곽. `.module-card.is-dragging`(fixed·z-index 70·액센트 보더), `.is-lifted`(scale 1.015), `.drag-placeholder`(액센트 점선 + `--accent-soft`), `body.is-dragging`, `prefers-reduced-motion`에서 확대 해제.
  - `sw.js` — `CACHE_VERSION = 'tip-v1.8.0'` (새 파일 없어서 `APP_SHELL` 변경 없음).
  - `README.md` — §1 홈 화면에 **드래그로 순서 바꾸기**·**키보드로 순서 바꾸기** 항목, §3 환경설정에 **카드 순서 초기화**, §5 제한사항에 순서 범위·기기 저장 안내, §7 버전 표 `v1.8.0`.
  - `AGENT.md` — 현재 버전 `1.8.0`, 구조도의 `js/store.js` 설명에 `tip.order.v1`, **§3 "홈 카드 순서(`tip.order.v1`) 관례"** 절(새 모듈은 뒤에 자동으로 붙음, 섹션 간 이동 금지, Pointer Events 유지·HTML5 `draggable` 금지), §6에 `tip.order.v1` 키 보호 추가.
- **사용한 언어·라이브러리·세팅**: Vanilla HTML/CSS/ES Modules(빌드 없음). 새 라이브러리 없음 — 브라우저 기본 **Pointer Events API**만 사용(iOS Safari 16+·Chrome/Edge/Safari 최신). 검증은 `work/tip-verify/v18/verify-v18.cjs`(Playwright + `work/chrome/chrome-linux64/chrome`, 터치는 CDP `Input.dispatchTouchEvent`).
- **검증** (2026-11-23 00:37 KST, 로컬 — `work/tip-verify/v18/`): 390×844 터치(CDP `Input.dispatchTouchEvent`)·1280×800 마우스로 **46항목 전부 통과**, 콘솔 에러 0·404 0·가로 넘침 0. 서비스 워커 `tip-v1.8.0` 프리캐시 50개, 오프라인 재로드에서도 홈 17카드·핸들 17개 정상.
- **라이브 검증** (2026-11-23 00:40 KST, <https://appfle-io.github.io/tool-in-pack/>): `sw.js`가 `tip-v1.8.0`을 서빙, 홈 17카드·섹션(고정됨 1 · 문서 2 · 미디어 4 · 유틸리티 10)·핸들 17개, SW 캐시 `tip-v1.8.0`. 390 터치 드래그로 미디어 순서 변경(`img-converter…` → `video-mosaic,img-converter,…`) 후 `tip.order.v1` 저장 → 새로고침·스위치 OFF→ON 모두 유지, 키보드 ↑ 이동, 설정 초기화로 `tip.order.v1`만 삭제되고 기본 순서 복귀, 1280 2열 그리드 마우스 드래그·새로고침 유지, 카드 실행 회귀 없음 — **20항목 전부 통과**(콘솔·404·넘침 0). 스크린샷 8장 `work/tip-mockups/tip-v18-live-*.png`(390·1280, 라이트/다크, 끄는 중·변경 후·설정 시트).
- **주의·제약**:
  - 순서는 **같은 섹션 안에서만** 바뀐다(요청 사항). 다른 섹션으로 옮기려면 **핀**(고정됨)을 쓴다.
  - 순서는 **그 기기 브라우저의 `localStorage`에만** 저장된다(서버·계정 없음, 다른 기기와 공유되지 않음). 시크릿 모드에서는 저장되지 않을 수 있다.
  - 손가락으로 끄는 동안 페이지 스크롤은 핸들 위에서 멈춘다(`touch-action: none`). 카드 본문을 끌면 스크롤된다(카드 열기와 충돌 없음).
  - iOS Safari는 Pointer Events를 지원하므로 HTML5 `draggable` 대신 이 방식을 썼다. 옛 iOS(13 미만)에서는 드래그가 되지 않지만 키보드·핀으로 대체 가능하다.
  - `:has()` 대신 JS가 붙이는 `.has-drag` 클래스를 썼다(구형 브라우저에서도 레이아웃이 깨지지 않게).

### v1.7.0 — 2026-11-23 00:21 (KST) · 커밋 `79768b1` · `tip-v1.7.0`

- **작성자**: 유동규(기획·신규 5종 지정·홈 '꺼진 모듈' UX 요청·검수) + Pickle(AI) 구현
- **개발 내용** (모듈 5종 추가 · 12종 → 17종 + 홈 섹션 개편)
  - `js/app.js` — `renderHome()`이 **켜진 모듈만** 고정됨 → 문서 → 미디어 → 유틸리티에 그리고, **꺼진 모듈은 맨 아래 `꺼진 모듈` 한 섹션**으로 모은다(0개면 섹션 없음). 스위치를 켜면 원래 묶음(고정했던 모듈은 고정됨)으로 즉시 복귀하며, 다시 그린 뒤 방금 누른 컨트롤로 초점을 되돌리는 기존 `rerenderHome(focus)` 동작은 그대로 유지.
  - `css/app.css` — `.home-section[data-section='off']`: 위쪽 헤어라인, 점선 카드, 아이콘·제목 톤 다운.
  - `modules/file-compress/module.js` — **파일 압축 · ZIP**(`utility`). 탭 3개.
    - 이미지: `createImageBitmap`(실패 시 `<img>`) → 최대 가로폭으로 축소 → `canvas.toBlob`(JPG q0.4~0.95 / WebP / PNG). 파일별 `원본 → 결과 · % 감소`, 합계 카드, 개별 저장, 2장 이상은 `window.JSZip`(STORE)로 `compressed-images.zip`. **결과가 원본보다 크면 원본을 그대로** 쓰고 "원본 유지"로 표시(용량을 늘리지 않음).
    - PDF: `pdfjsLib`(worker `./vendor/pdfjs/pdf.worker.min.js`)로 96/144/200dpi 래스터라이즈(최대 변 4096px) → JPEG(q0.5~0.9) → `pdf-lib` `embedJpg`로 원본 페이지 크기(pt)에 다시 배치. 진행률 %, 페이지 수·전/후 용량, "글자 선택 불가" 안내. 암호 PDF는 오류 안내.
    - ZIP: 파일 묶기(DEFLATE 6) + `.zip` 목록(`JSZip.loadAsync`)·개별/전체(순차) 저장.
  - `modules/video-mosaic/module.js` — **영상 모자이크**(`media`). `<video>` → 캔버스(최대 1280px) rAF 미리보기, 포인터 드래그로 정규화 사각형 여러 개(실행취소·전체 삭제), 모자이크(블록 다운스케일, `imageSmoothingEnabled=false`)/블러(`ctx.filter`), 강도 6~48은 **640px 기준 픽셀 값을 캔버스 폭에 비례**해 키운다. `canvas.captureStream(30)` + `MediaRecorder`(MP4 우선, WebM 폴백, 5Mbps)로 재생 구간을 실시간 인코딩, 오디오는 `video.captureStream()` 트랙 우선·없으면 `AudioContext.createMediaElementSource → MediaStreamDestination`. 녹화 중에는 편집 보조선을 그리지 않아 결과에 선이 남지 않는다. 진행률·결과 미리보기·저장, 60초 초과 경고.
  - `modules/md-editor/module.js` — **마크다운 편집기**(`docs`). `marked`(ESM) + `DOMPurify` 새니타이즈, GFM 표·체크박스·코드·인용. 데스크톱 ≥960px 좌우 2단, 모바일 편집/미리보기 탭. 툴바 12종(B/I/S, H1/H2, 목록, 체크박스, 인용, 코드, 링크, 표)과 Ctrl/Cmd+B·I. `.md` 열기/저장, `.html` 독립 문서 저장, iframe 인쇄, 500ms 디바운스 `localStorage`(`tip.mdx.v1`) 임시 저장.
  - `modules/unit-converter/module.js` — **단위 변환기**(`utility`). 길이·무게·속도·온도·넓이(평 = 400/121 m²)·부피·데이터(SI/IEC) 7종. `toBase/fromBase` 정의로 선형·온도(섭씨 기준) 모두 처리, 입력 즉시 모든 단위 표시, 행의 **기준** 버튼으로 기준 단위 전환(값 환산), 값/복사 버튼으로 클립보드. 100% 오프라인.
  - `modules/currency-calc/module.js` — **환율 계산기**(`utility`). 12개 통화(KRW·USD·JPY·EUR·CNY·GBP·VND·THB·TWD·AUD·CAD·SGD). **하이브리드**: 캐시가 없고 온라인일 때 1회 자동, 이후 **환율 갱신** 버튼으로 `open.er-api.com/v6/latest/KRW` → 실패 시 `api.frankfurter.app/latest?from=KRW`(부분 통화는 기존 표에 병합) → `localStorage`(`tip.fx.v1`, `fetchedAt`·`rateDate`·`source`) 저장. 없으면 **내장 참고 환율**(“기준일 미갱신”), 있으면 마지막 캐시. `⇅`, 12개 통화 비교표, **수동 환율**(`tip.fx.manual.v1`, 쌍 단위·역방향 자동, 해제 버튼), 갱신 시각 KST 표시. 실패 문구는 사람이 읽는 문장으로만(기술 오류는 `console.error`).
  - `modules/registry.js` — import 6줄 + 배열 항목 6개(md-editor는 docs, video-mosaic은 media, 나머지 utility).
  - `vendor/marked/marked.esm.js` 18.2.1(MIT)·`LICENSE`, `vendor/dompurify/purify.min.js` 3.5.0(Apache-2.0/MPL-2.0)·`LICENSE`, `index.html`에 DOMPurify `<script defer>`, `LICENSE` 서드파티 목록, `sw.js` `APP_SHELL` 추가.
  - `sw.js` — `CACHE_VERSION = 'tip-v1.7.0'`, 신규 모듈 5개 + marked/DOMPurify 프리캐시.
  - `css/app.css` — v1.7.0 섹션(위 5개 모듈 + 꺼진 모듈 섹션), 데스크톱에서 `.fc/.uc/.fx`는 780px 가운데 정렬, `.mdx` 2단, `.vm` 2열.
  - `README.md`(모듈 표 17종·13~17번 사용법·꺼진 모듈·프라이버시 예외·제한사항·버전 표), `AGENT.md`(현재 버전 1.7.0), `LICENSE`.
- **사용한 언어·라이브러리·세팅**: Vanilla HTML/CSS/ES Modules(빌드 없음). 신규 벤더 2종 — marked 18.2.1(MIT, `marked.esm.js` 그대로, 패치 없음), DOMPurify 3.5.0(클래식 UMD `window.DOMPurify`, 패치 없음). PDF/이미지/ZIP은 기존 `vendor/pdfjs`·`pdf-lib`·`jszip` 재사용. 검증은 `work/tip-verify/v17/`의 Playwright + chrome-headless-shell(`LD_LIBRARY_PATH=work/sysroot/usr/lib/x86_64-linux-gnu`) 하네스로 95항목.
- **주의·제약**:
  - **환율 API가 이 앱의 유일한 외부 호출**이다(기존 "외부 API 호출 금지" 원칙의 명시적 예외 — 유동규 님 요청). 환율표만 받고 금액·파일은 보내지 않으며, 화면과 README에 이 예외를 적었다.
  - 영상 인코딩은 `SharedArrayBuffer` 없이 `MediaRecorder` 실시간 방식이라 **영상 길이만큼 시간이 걸린다**. 결과 형식은 브라우저 지원에 따른다(Chrome MP4, 미지원 시 WebM).
  - PDF 축소는 페이지를 그림으로 다시 그리므로 **텍스트 선택·검색 불가**(용량 우선). 암호 PDF 미지원.
  - 이미지 재압축이 원본보다 커지면 원본을 유지한다(PNG 등).
  - `localStorage` 키는 기존(`tip.settings.v1`·`tip.theme`·`tip.accent`)을 건드리지 않고 `tip.mdx.v1`·`tip.fx.v1`·`tip.fx.manual.v1`만 추가.
- **라이브 검증** (2026-11-23 00:26 KST, <https://appfle-io.github.io/tool-in-pack/>): `sw.js`가 `tip-v1.7.0`을 서빙, 홈 17카드·섹션(고정됨 1 · 문서 2 · 미디어 4 · 유틸리티 10), '꺼진 모듈' 이동/복귀, 17개 모듈 모두 열림, 단위 1 m → 100 cm, 환율 실제 API 갱신(1 USD = 1,342.28 KRW · 2026-11-22 09:02 기준), 마크다운 GFM 표/체크박스/코드, 이미지 1.1 MB → 363 KB(68%), 영상 모자이크 MP4 722 KB · 640×360 인코딩, 390·1280 가로 넘침 0, 콘솔·404 0, SW 캐시 51개·오프라인 재로드 정상 — **23항목 전부 통과**. 스크린샷 12장 `work/tip-mockups/tip-v17-live-*.png`.

### v1.6.0 — 2026-11-22 23:43 (KST) · 커밋 `2e09ce0` · `tip-v1.6.0`

- **작성자**: 유동규(기획·6종 기능 지정·검수) + Pickle(AI) 구현
- **개발 내용** (Mac·개발자용 유틸리티 모듈 6종 추가 · 모듈 6종 → 12종)
  - `modules/dev-tools/module.js` — **개발자 툴팩**(`utility`). 상단 탭 5개, 탭은 `role="tablist"` + 좌우 화살표 키 이동.
    - **JSON**: 정렬 2칸 / 4칸 / 압축 / 검증. 결과는 아래 결과 칸에 따로 쓰고, 상태 줄에 `객체 · 키 12개 · 1.2 KB`처럼 종류·크기를 표시. 오류는 `JSON 문법 오류 — <메시지> (3번째 줄 12번째 글자 부근)`. 최신 V8은 `position` 대신 문제 구간만 알려 주므로(`"{"a":}" is not valid JSON`) 그 구간을 원문에서 찾아 줄·칸을 계산하고, 계산할 수 없으면 메시지만 보여 준다.
    - **Base64 · URL**: UTF-8 안전(TextEncoder → 32KB 청크 `btoa`), 디코딩은 `atob` → `TextDecoder`. Base64url(`-_`)도 디코딩. `결과를 입력으로` 버튼으로 연쇄 변환.
    - **JWT**: Header/Payload를 `JSON.parse`로 펼쳐 복사 버튼과 함께 표시. `iat`·`nbf`·`exp`는 **KST(고정 +9h, 서머타임 없음)** 로 변환하고 `exp`는 `만료까지 3시간 12분` / `만료됨 (1103일 15시간 전)` 형태로 덧붙인다. 서명은 길이만 표시하고 **검증하지 않는다**고 화면에 명시.
    - **타임스탬프**: 10자리는 초, 13자리는 밀리초로 읽는다(`toMs`). 출력은 한국 시간·ISO 8601·Unix 초·Unix 밀리초 4줄, 각 줄 복사 버튼. `datetime-local` 입력은 KST로 해석해 `Date.UTC(...) - 9h`로 초를 계산.
    - **UUID**: `crypto.randomUUID()` 우선, 없으면 `getRandomValues`로 v4 직접 생성(비보안 컨텍스트 대비). 1·5·10개 생성, 전체 복사.
  - `modules/text-diff/module.js` — **텍스트 비교 · 정리**(`utility`).
    - 비교: 줄 단위 **LCS DP**(`Int32Array`, `(n+1)*(m+1)`). 1,200줄×1,200줄(약 400만 칸) 초과 시 자리 기준 비교로 대체하고 `줄이 너무 많아 자리 기준으로 비교했습니다` 칩을 띄운다. 행은 `same/add/del` 클래스로 색을 나누고 양쪽 줄 번호를 함께 그린다.
    - 정리·통계: 글자수(공백 포함/제외)·단어·줄·UTF-8 바이트(TextEncoder). 앞뒤 공백 정리(3줄 이상 연속 빈 줄은 2줄로), 빈 줄 제거, 중복 줄 제거(앞뒤 공백 무시), 오름차순/내림차순(`localeCompare('ko')`), **1단계 되돌리기**.
  - `modules/regex-tester/module.js` — **정규식 테스터**(`utility`).
    - 오버레이 하이라이트: textarea는 글자를 투명하게 하고(`color: transparent; caret-color`) 같은 폰트·패딩의 `div`에 `<mark>`를 그린다. textarea는 내용에 맞춰 자동 높이(최대 420px)로 늘고 스크롤을 동기화한다.
    - `g`가 꺼져 있으면 첫 매치만 강조하고 전체 개수는 참고로 표시. 매치 목록에 값·위치·번호/이름 캡처 그룹. 빈 매치(`^`, ``)는 `lastIndex`를 강제로 넘겨 무한 루프를 막고 하이라이트에서는 제외. 최대 500매치.
    - 프리셋 6종(이메일·휴대폰·URL·IPv4·한글만·숫자만). 잘못된 패턴은 `new RegExp` 예외를 잡아 문법 오류 문구만 표시.
  - `modules/color-tools/module.js` — **색상 · 대비 체크**(`utility`).
    - HEX/RGB/HSL 세 칸이 서로를 갱신(입력 중인 칸은 건드리지 않고, blur에서 정규화). native `<input type=color>`와 동기화.
    - WCAG 상대 휘도(0.2126/0.7152/0.0722, sRGB 감마)로 대비율 계산 → `X.XX : 1`, 일반 AA(4.5)/AAA(7)/큰 텍스트 AA(3) 배지, 실제 색 미리보기(24px·14px). `글자 ↔ 배경` 맞바꾸기.
    - `window.EyeDropper`가 있을 때만 스포이드 버튼 노출(iPhone Safari에는 없음).
  - `modules/icon-gen/module.js` — **앱 아이콘 생성기**(`utility`).
    - `createImageBitmap(file, {imageOrientation:'from-image'})`(실패 시 `<img>` 폴백) → **정사각 크롭(cover)** 또는 **여백 맞춤(contain + 배경색)**으로 16·32·48·180·192·512·1024px 캔버스에 그려 PNG 생성(Canvas `toBlob`).
    - 미리보기 격자(클릭하면 그 크기 하나 저장). **ZIP 저장**은 `vendor/jszip`(`window.JSZip`)을 재사용해 `icons/icon-*.png` 7개 + `manifest-snippet.json`(icons 배열, `src: icons/icon-N.png`)을 `app-icons.zip`으로 묶는다(무압축 STORE — PNG 재압축은 의미 없음).
  - `modules/ocr-reader/module.js` — **이미지 텍스트 추출**(`utility`).
    - `tesseract.js 6.0.1`을 `vendor/tesseract/`에서 **지연 로드**(`<script>` 주입, `window.Tesseract`). `createWorker(lang, 1, {...})` with `workerBlobURL:false`(워커를 blob이 아닌 동일 출처 URL로 띄워 서비스 워커가 fetch를 가로챌 수 있게), `cacheMethod:'none'`(IndexedDB 중복 저장 없이 SW 캐시 사용), `gzip:true`.
    - `corePath`는 **WASM SIMD 지원을 1바이트 프로브(`WebAssembly.validate`)로 확인**해 `tesseract-core-simd-lstm.wasm.js` 또는 `tesseract-core-lstm.wasm.js`를 고른다(LSTM 전용이라 크기가 작다). `langPath`는 문서 기준 절대 URL.
    - **언어 데이터 캐시**: `CacheStorage('tip-ocr-lang-v1')`에 `kor/eng.traineddata.gz`를 최초 실행 때만 `fetch → cache.put`. `sw.js`의 `caches.match(request)`가 모든 캐시를 찾으므로 워커의 언어 데이터 요청도 오프라인에서 해결된다. **`APP_SHELL`에는 넣지 않았고**, `sw.js`는 이 경로를 런타임 캐시에도 저장하지 않는다(중복 방지). activate에서 `tip-ocr-lang-*` 캐시는 지우지 않는다(버전 업데이트 후 재다운로드 방지).
    - 언어 3종(`kor+eng`·`kor`·`eng`), 진행률 바 + 상태 문구 한국어 매핑(`loading tesseract core` → `인식 엔진 불러오는 중` 등), 완료 시 `완료 · 평균 신뢰도 94%`. 결과는 편집 가능한 textarea, 글자·바이트 수, 복사, `TXT 저장`(`원본이름-text.txt`).
  - `vendor/tesseract/` — tesseract.min.js(62KB)·worker.min.js(111KB)·LSTM 코어 2종(각 3.9MB, wasm 내장)·`lang/kor.traineddata.gz`(1.1MB)·`eng.traineddata.gz`(2.0MB)·LICENSE(tesseract.js, core, tessdata).
  - `sw.js` — `CACHE_VERSION = 'tip-v1.6.0'`. `APP_SHELL`에 새 모듈 6종·`vendor/tesseract/{tesseract.min.js, worker.min.js}` 추가(43항목). 언어 데이터·코어는 **프리캐시 제외**(설치 속도 보호, AGENT §2-5). `isOcrLang`으로 `.traineddata.gz`는 런타임 캐시에 넣지 않고, `KEPT_CACHES = /^tip-ocr-lang-/`로 activate 정리에서 제외.
  - `css/app.css` — v1.6.0 섹션 추가(약 460줄). 공용 부품 `.v16`·`.v16-tabs`·`.v16-panel`·`.v16-field`·`.v16-ta`·`.v16-btn`·`.v16-mini`·`.v16-status`·`.v16-kv`·`.v16-block`·`.v16-out`·`.v16-stats`·`.v16-note` + 모듈 접두사(`td-` `rx-` `ct-` `ig-` `ocr-`). diff 색은 라이트/다크 변수(`--diff-add-bg` 등)로 분리. 720px에서 통계 5열, 960px에서 비교·색상 2열.
  - `modules/registry.js` — import 6줄 + registry 6줄(유틸리티 섹션 7개).
  - `README.md` — 모듈 표 6줄, §2에 사용법 7)~12), 프라이버시(OCR 첫 다운로드·이미지 미전송), 제한사항(OCR 정확도·스포이드·정규식 문법), §7 버전 표 v1.6.0.
  - `LICENSE` — tesseract.js·tesseract.js-core·tessdata_fast·Pretendard 항목 추가. `AGENT.md` — 현재 버전 1.6.0.
- **사용한 언어·세팅**: Vanilla HTML/CSS/ES Modules 그대로(빌드 도구·프레임워크 없음). 새 라이브러리는 `vendor/tesseract/`에 셀프호스팅(tesseract.js 6.0.1, tesseract.js-core 6.0.0, tessdata_fast kor/eng — CDN 런타임 의존 없음). 검증은 Python + Playwright(헤드리스 Chrome 159) 하네스 `work/v16/`, 390×844 · 1280×800, 라이트/다크.
- **검증 결과**: 로컬 자동 검증 **122/122 통과**.
  - 유틸리티 5종 실데이터 56항목(`test_func.py`): JSON 정렬/압축/검증(오류 위치 포함), Base64·URL 왕복(한글·이모지), JWT payload·exp KST, 초/밀리초/KST→Unix, UUID v4 5개, diff 통계(추가2·삭제1·동일2·전체5), 정리 5종+되돌리기, 정규식 하이라이트 3개·캡처 그룹·프리셋 이메일 2건·문법 오류, 대비율 계산(#2E5E4E/#FFF 7.43, #777/#FFF 4.48 → 배지 미달2·통과1, 21.00, HSL→#FF0000, 맞바꾸기), 아이콘 7종 생성·192px 크롭 픽셀·**ZIP 내부 7 PNG IHDR 치수(16~1024)·manifest JSON 7항목**·여백 모드 배경 픽셀.
  - OCR 31항목(`test_ocr.py`·`test_ocr2.py`·`test_lang.py`): 실제 한글+영문 PNG(`assets/ocr-sample.png`, Pretendard로 렌더)에서 `TIP OCR 테스트 / Hello World 2026 / 가방에 챙길 것을 확인하세요`를 **평균 신뢰도 94%** 로 그대로 인식, `kor+eng`·`kor`·`eng` 언어 전환, TXT 저장 내용 일치, `tip-v1.6.0` 프리캐시에 traineddata 0건·코어 1건 런타임 캐시, `tip-ocr-lang-v1`에 kor·eng 저장, **오프라인 전환 후 새 문서 콜드 스타트에서도 동일 결과(1.4초)**, 콘솔·페이지 에러 0, 실패 요청 0.
  - 스크린샷·넘침 32항목(`shots_all.py`): 390·1280 × 라이트/다크에서 홈·6개 모듈 모두 **가로 넘침 0**, 콘솔 에러 0, HTTP 404 0. 스크린샷 `work/v16/shots/v160-*.png`.
  - 추가 확인 7항목(`test_extra.py`): 아이콘·OCR 모두 **끌어다 놓기**로 열려 인식까지 동작, 1,300줄 diff는 `compare()` 0.1초(1326행 렌더) — 체감 지연은 Playwright의 `fill` 자체 시간이었다(`test_perf.py`).
  - CDN 확인(`test_cdn.py`): OCR 1회 실행에서 발생한 요청 40건이 **전부 동일 출처**였고 외부 도메인 요청 0건. 번들 안의 `cdn.jsdelivr.net` 문자열은 경로(`workerPath`·`corePath`·`langPath`)를 항상 넘기므로 쓰이지 않는다.
  - **라이브 검증 31항목(`live.py`, `https://appfle-io.github.io/tool-in-pack/`)**: `CACHE_VERSION = 'tip-v1.6.0'` 서빙, 390 라이트/다크·1280 라이트에서 홈 12카드·섹션(고정됨1·문서1·미디어3·유틸리티7), SW 활성 캐시 43항목, 넘침 0·콘솔 에러 0·404 0. 라이브에서 JSON 정렬·JWT KST·UUID 5개, diff 통계, 정규식 매치 3개, 대비 4.48/배지, 아이콘 7종 + **ZIP 내부 7 PNG 치수·manifest**, **OCR 라이브 1.8초·신뢰도 94%** 모두 통과. 스크린샷 `work/tip-mockups/tip-v16-live-*.png`.
- **주의·제약**:
  - 언어 데이터(합 3.1MB)와 코어(3.9MB)는 **프리캐시 제외** → 첫 OCR 실행 때만 받는다. 그래서 설치 직후 오프라인에서는 OCR만 첫 실행이 불가능하고, 한 번 실행한 뒤에는 오프라인이 된다.
  - tesseract.js는 GPU/스레드 없이 단일 스레드 WASM으로 돈다(GitHub Pages에 COOP/COEP가 없어 `SharedArrayBuffer` 불가 — AGENT §2-5와 같은 이유). 900×420 이미지 기준 약 1초.
  - `kor`/`eng` 단독 선택은 다른 문자를 거의 읽지 못한다(설계된 동작, README에 안내).
  - `input[type=color]`·`EyeDropper`·`datetime-local`은 브라우저별 UI가 다르다(iPhone Safari는 스포이드 없음, 색 선택기는 iOS 전용 시트).
  - ZIP은 JSZip을 재사용하므로 `window.JSZip`이 없으면(스크립트 로드 실패) 안내 문구만 띄운다.
  - 기존 방문자는 **새로고침 1회** 후 v1.6.0을 받는다.

### v1.5.1 — 2026-11-22 23:33 (KST) · 커밋 `0cdb04f` · `tip-v1.5.1`

- **작성자**: 유동규(요청·아이콘 시안 1번 선택·검수) + Pickle(AI) 구현
- **개발 내용** (기본 딥그린을 팩인백 브랜드 컬러 #2E5E4E로 일치 + 앱 아이콘 교체)
  - `css/app.css` — 기본(딥그린) 액센트를 팩인백 실제 브랜드 값으로 교체.
    - 라이트: `--accent: #2E5E4E` / `--accent-soft: #E4EFEA` / `--accent-strong: #23483C`
    - 다크: `--accent: #4A8E77` / `--accent-soft: #142620` / `--accent-strong: #63A891`
    - `--accent-strong` **신설**(눌린 상태 색). 나머지 5종 액센트(blue·purple·orange·rose·slate)도 같은 규칙(라이트 −7.5% / 다크 +7.5% 명도)으로 값을 넣어 색이 섞이지 않게 했다.
    - `.primary-btn:active:not(.ghost)` · `.open-btn:active` 가 `opacity: 0.85` 대신 `background: var(--accent-strong)`을 쓴다(어두운 배경에서도 눌림이 분명해진다). `.primary-btn.ghost:active`는 `--card-2`로 기존 ghost 톤 유지.
    - `--accent-soft`를 rgba → 단색 hex로 변경(#E4EFEA / #142620). 카드 위 옅은 배경·테두리 용도는 그대로.
  - `js/app.js` — 설정 시트 스와치 `SWATCH_COLORS.green = ['#2E5E4E', '#4A8E77']`(라이트/다크 반반).
  - `js/store.js` — `applyTheme()`이 `theme-color`를 라이트/다크 배경색으로 덮어쓰던 코드 제거. 브랜드 딥그린 고정.
  - `index.html` — `<meta name="theme-color" content="#2E5E4E">`, 32px 파비콘 링크(`./icons/favicon-32.png`) 추가.
  - `manifest.json` — `theme_color`·`background_color` 모두 `#2E5E4E`(설치 스플래시 배경 포함).
  - `icons/` — 앱 아이콘 전면 교체(팩 + 4모듈 그리드, 배경 #2E5E4E).
    - 새 파일: `icon-1024.png`(마스터, 향후 Mac `.icns` 변환용) · `favicon-32.png`
    - 교체: `icon-512.png` · `icon-maskable-512.png` · `icon-192.png` · `apple-touch-icon-180.png` · `favicon.png`(64)
  - `tools/make-icons.py` — 생성형 원본 한 장에서 모든 사이즈를 만드는 스크립트로 교체(이전 파랑·보라 그라데이션 아이콘 코드는 폐기). `--source`로 새 시안을 넣으면 초록 배경을 #2E5E4E로 정규화해 `icons/icon-1024.png` 마스터를 만들고, 그 마스터에서 512 · maskable(가운데 80% 크롭으로 안전 영역 확보) · 192 · apple-touch(불투명 RGB) · favicon(64) · favicon-32을 파생한다.
  - `sw.js` — `CACHE_VERSION = 'tip-v1.5.1'`, `APP_SHELL`에 `./icons/favicon-32.png` 추가.
  - `README.md` — §3 기본 색상에 브랜드 컬러(#2E5E4E) 표기, §7 버전 표에 v1.5.1 줄 추가.
- **사용한 언어·세팅**: Vanilla HTML/CSS/ES Modules 그대로(빌드 도구·새 라이브러리 없음). 아이콘 생성은 Python + Pillow + numpy(`tools/make-icons.py`). 검증은 Node 22 + `chrome-headless-shell` CDP 스크립트(`work/tip-verify/verify.mjs`, 저장소 밖 작업 폴더), 390×844 · 1280×800, 라이트/다크.
- **검증 결과**: 로컬 자동 검증 **24/24 통과** — 라이트 `--accent #2E5E4E`·`soft #E4EFEA`·`strong #23483C`, 다크 `#4A8E77`·`#142620`·`#63A891`, TIP 배지 배경 rgb(46,94,78), `meta theme-color` #2E5E4E(다크에서도 유지), 딥그린 스와치 기본 선택, 누른 primary 버튼 rgb(35,72,60)(=#23483C), 아이콘 7종·`manifest.json`·`sw.js` 모두 200, `CACHE_VERSION = tip-v1.5.1`, 콘솔 에러 0 · 404 0, 가로 넘침 0(390·1280). 스크린샷 `work/tip-verify/shots/v151-01~06-*.png`.
- **주의·제약**: 아이콘 원본은 생성형 이미지라 배경이 #355F50 근처로 살짝 떠 있어, 초록 영역만 곱셈 보정으로 브랜드 값에 맞췄다(픽셀 오차 ±1, 미세한 조명 그라데이션·팩 그림자는 유지). `icons/icon-1024.png`는 런타임에서 쓰지 않아 `APP_SHELL` 프리캐시에 넣지 않았다(약 750KB). 사용자가 직접 고른 다른 액센트(블루 등)는 건드리지 않는다. 기존 방문자는 **새로고침 1회** 후 v1.5.1을 받는다(아이콘은 홈 화면에 다시 추가해야 갱신되는 경우가 있다).

### v1.5.0 — 2026-11-22 23:06 (KST) · 커밋 `fad7233` · `tip-v1.5.0`

- **작성자**: 유동규(기획·카테고리 구분 지시·버전/커밋 규칙 지시·검수) + Pickle(AI) 구현
- **개발 내용** (홈 화면 카테고리 섹션 + 카테고리 메타데이터 + 개발 지침 갱신)
  - `modules/*/module.js` (6개) — default export에 **`category`** 추가. 값은 `docs` / `media` / `utility` 세 가지.
    - `doc-reader` → `docs`, `pdf-tools` → `docs`
    - `img-converter` → `media`, `photo-privacy` → `media`, `video-gif` → `media`
    - `qr-gen` → `utility`
  - `modules/registry.js` — 홈 섹션 규칙을 한 곳에 모음.
    - `CATEGORIES = [{ id: 'docs', label: '문서' }, { id: 'media', label: '미디어' }, { id: 'utility', label: '유틸리티' }]` (배열 순서 = 홈 표시 순서)
    - `FALLBACK_CATEGORY = 'utility'` · `categoryOf(mod)` — `category`가 없거나 모르는 값이면 유틸리티로 모은다(카드가 사라지지 않게).
    - 새 모듈 추가 절차(import 1줄 + registry 1줄)는 그대로. `category`만 함께 적는다.
  - `js/app.js` — `renderHome()`이 카테고리 섹션을 그리도록 개편.
    - 구조: `<div class="home-sections">` 안에 `<section class="home-section" data-section="pinned|docs|media|utility">` + `<h2 class="home-section-title">라벨 <span class="home-section-count">n</span></h2>` + `<div class="module-list">카드들</div>`. (기존 `.module-list`를 섹션마다 재사용해 900px 이상 2열 그리드가 섹션별로 그대로 적용된다)
    - **고정됨**: `pinned` 모듈이 1개 이상일 때만 맨 위에 생성. 0개면 섹션 자체를 만들지 않는다.
    - **카테고리 섹션**: 고정되지 않은 모듈을 `CATEGORIES` 순서(문서 → 미디어 → 유틸리티)대로 묶고, 모듈이 없는 섹션은 만들지 않는다.
    - 카드 안 핀·스위치 버튼에 `data-module-id` / `data-control`(`pin` / `switch`) 부여. `rerenderHome({ id, control })`가 다시 그린 뒤 **방금 누른 컨트롤로 초점과 화면 위치를 되돌려** 카드가 다른 섹션으로 옮겨가도 사용자가 놓치지 않게 했다.
  - `css/app.css` — 끝에 v1.5.0 섹션 추가(약 40줄). `.home-sections`(flex, gap 22px / 720px 이상 20px), `.home-section-title`(13px·650·`--text`, 여백만), `.home-section-count`(11.5px·`--muted-2`, tabular-nums), `.home-section[data-section='pinned'] .home-section-title`만 `var(--accent)` 색. 배지·그라데이션·그림자 없음 → 6종 액센트와 라이트/다크 모두 그대로 어울린다.
  - `sw.js` — `CACHE_VERSION = 'tip-v1.5.0'`. 새 파일은 없어 `APP_SHELL` 변경 없음(기존 6개 모듈 파일이 이미 프리캐시 대상).
  - `AGENT.md` — 새 모듈 규칙에 `category` 반영.
    - §1에 **지침 3(버전 관리: MAJOR/MINOR/PATCH 기준, `sw.js`·`HISTORY.md`·`README.md` 세 곳 일치)** 과 **지침 4(커밋 메시지 `[vX.Y.Z] type: 내용`, type 6종: feat/fix·error/docs/style/refactor/chore)** 를 추가.
    - §2-3 모듈 default export 목록에 `category`, §3에 **카테고리 관례 표**(분류별 모듈·새 분류 추가 방법·`kind`와의 구분), §4 체크리스트 1·6·7·9번, §6 금지 항목에 버전·커밋 규칙 항목 추가.
  - `README.md` — 모듈 표에 **분류** 열 추가(문서/미디어/유틸리티), §1 "홈 화면(모듈 목록)"에 고정됨·문서·미디어·유틸리티 섹션과 핀 동작 설명, §7 버전 표에 v1.5.0 줄 추가.
- **사용한 언어·세팅**: Vanilla HTML/CSS/ES Modules 그대로(빌드 도구·새 라이브러리 없음). 로컬은 `python3 -m http.server 8901`, 검증은 Playwright + 헤드리스 Chromium(`work/headless-shell`) 390×844 / 1280×800, 라이트·다크·퍼플 액센트.
- **검증 결과**: 로컬 자동 검증 **27/27 통과** — 섹션 순서(고정됨→문서→미디어→유틸리티), 고정됨 1개 기본값(문서 리더), 핀 해제 시 고정됨 섹션 사라지고 문서 섹션으로 복귀, 핀 켜기 시 해당 카테고리에서 빠지고 고정됨으로 이동, 초점 유지, 2열 그리드(520px×2), 가로 넘침 0(390·1280 모두), 콘솔·페이지 에러 0·404 0. 스크린샷 `browser/tip-v15-01~09-*.png`(사본 `work/tip-mockups/`).
- **주의·제약**: `category`를 빠뜨린 모듈은 유틸리티 섹션으로 모인다(사라지지 않지만 분류가 틀어짐) → 새 모듈 체크리스트에서 반드시 지정. 기존 사용자의 `localStorage`(`tip.settings.v1`의 enabled/pinned)는 그대로라 업데이트 후에도 고정 상태가 유지된다. 기존 방문자는 새로고침 1회 후 v1.5.0을 받는다.

### v1.4.0 — 2026-11-22 22:47 (KST) · 커밋 `4eb0039` · `tip-v1.4.0`

- **작성자**: 유동규(기획·요청·검수·Mac 대응 지시·문서 요구) + Pickle(AI) 구현
- **개발 내용** (신규 모듈 4종 + 셸 보강)
  - `modules/pdf-tools/module.js` — **PDF 합치기 · 페이지 추출**. 모드 세그먼트 2개.
    - 합치기: PDF 여러 개 업로드/드래그 → 파일별 페이지 수·용량 표시, 위/아래 이동·목록에서 제거 → `pdf-lib`으로 페이지 복사 후 새 PDF. 결과 카드에 `n페이지 · 용량 · 병합 개수`와 저장 버튼. 2개 미만이면 실행 비활성.
    - 페이지 추출: PDF 1개 → 총 페이지 수 표시, `1, 3-5` 범위 입력과 페이지 번호 칩(토글) 양방향 동기화(선택을 `1-3, 5` 형태로 압축 표기), 전체 선택/해제, 선택 페이지만 새 PDF로 저장(`_extract4p.pdf`).
    - 암호화 PDF는 `ignoreEncryption`으로 열고 결과에 경고 표시. 파일명은 `_merged.pdf` / `_extractNp.pdf`.
  - `modules/photo-privacy/module.js` + `exif.js` — **모자이크 · EXIF 위치정보 제거**.
    - `exif.js`: 외부 라이브러리 없이 JPEG(APP1/TIFF)·PNG(eXIf 청크)·WebP(EXIF 청크)를 읽어 제조사·기기·소프트웨어·촬영 일시·노출·조리개·ISO·초점거리·렌즈·GPS(위경도 DMS→십진, 고도)를 표시. GPS가 있으면 붉은 경고.
    - 캔버스 위에서 **마우스/터치 드래그로 칠하기(붓)** 또는 **사각 지정**. 방식은 모자이크(픽셀화: 축소→확대, `imageSmoothingEnabled=false`) / 블러(순수 JS 박스 블러, Safari의 `ctx.filter` 미지원 회피). 강도 슬라이더(1~10), 붓 크기(화면 px 기준 → 이미지 px 변환), 실행 취소(연산 스택 재생), 초기화, 다른 사진.
    - 저장: 캔버스 재인코딩(PNG / JPG 흰 배경 합성) → **저장한 Blob을 다시 EXIF 파서로 검사**해 `저장 전 n항목 · GPS 포함 → 저장 후 0항목`과 "메타데이터 0건" 판정을 화면에 보여준다.
    - 사진은 긴 변 3200px로 자동 축소(편집 속도). HEIC는 `heic2any` 폴백.
  - `modules/qr-gen/module.js` — **QR 생성기**. URL / 텍스트 / 와이파이(`WIFI:T:WPA;S:…;P:…;;`, `\ ; , : "` 이스케이프, nopass 지원), 크기(256/512/1024)·여백(0~8 모듈)·오류정정(L/M/Q/H)·전경/배경색·색 바꾸기, 실시간 미리보기(입력 즉시), 담기는 내용 표시, **PNG(캔버스)**·**SVG(경로)** 저장. 용량 초과 시 안내.
  - `modules/video-gif/module.js` — **동영상 자르기 · GIF 변환**.
    - GIF: `<video>` seek → `<canvas>` 프레임 추출 → `gifenc`으로 100% 오프라인 인코딩. 시작/끝(0.05초 단위), FPS(5/10/15), 가로(320/480/640). 프레임 수·용량 표시, 최대 300프레임 제한.
    - 클립 자르기: `canvas.captureStream()` + `MediaRecorder`(실시간 재인코딩). Safari는 `video/mp4;codecs=avc1`, Chrome/Edge는 `video/webm`. 오디오는 `AudioContext` → `MediaStreamDestination`으로 받아 스피커 출력 없이 녹음(실패 시 무음 + 안내).
    - **`SharedArrayBuffer`·wasm 미사용** — GitHub Pages에 COOP/COEP가 없어 멀티스레드 ffmpeg.wasm이 깨지기 때문. 안내 문구 "iOS Safari는 30초 이내 짧은 클립에서 가장 안정적입니다".
    - `MediaRecorder`로 만든 WebM은 `duration=Infinity`인 경우가 많아, 그때는 아주 먼 곳으로 seek해 실제 길이를 얻는 폴백을 넣었다.
  - 셸·스타일·배포
    - `modules/registry.js` — 4개 import + registry 4줄 추가.
    - `index.html` — `vendor/pdf-lib/pdf-lib.min.js`를 `defer`로 추가(UMD → `window.PDFLib`).
    - `js/app.js` — 홈 카드가 `mod.shortName || mod.name`을 쓰도록 1줄 수정(긴 모듈 이름이 모바일 390px에서 두 줄로 깨지지 않게).
    - `css/app.css` — 새 모듈 스타일(약 520줄) + 데스크톱 대응: ≥900px 홈 2열 그리드, ≥960px `photo-privacy`·`video-gif`는 `캔버스/플레이어 + 340px 패널` 2열(sticky), `qr-gen`은 `head/preview/controls` 그리드 영역으로 2열, 드래그 하이라이트(`.module-screen.dr-over`), EXIF 목록 스크롤(208px).
    - `sw.js` — `CACHE_VERSION = 'tip-v1.4.0'`, 새 모듈 6개 파일과 벤더 3종을 프리캐시.
    - `README.md`, `LICENSE`(서드파티 4종 추가) 갱신.
  - **신규 벤더**: pdf-lib 1.17.1(MIT, UMD), qrcode-generator 2.0.4(MIT, ESM `qrcode.mjs`), gifenc 1.0.3(MIT, ESM). 모두 `npm`으로 받아 배포본만 복사, 라이선스 동봉.
- **사용한 언어·세팅**: Vanilla ES Modules. 로컬은 `python3 -m http.server`, 검증은 Playwright + 헤드리스 Chromium(`work/headless-shell`) 390×844 / 1280×800. 테스트 픽스처는 pdf-lib(Node)와 Pillow(Python)로 생성.
- **검증 결과**: 로컬 자동 검증 58/58 통과(콘솔·페이지 에러 0, 404 0), 라이브 반영 후 홈 6개 카드 + 4개 모듈 실동작 확인, 스크린샷 `browser/tip-v14-*.png`.
- **주의·제약**: 라이브 반영에 최대 1~2분, 기존 방문자는 새로고침 1회 필요(서비스 워커). iOS Safari는 `canvas.captureStream`/`MediaRecorder` 동작이 기기·버전에 따라 다르므로 GIF를 우선 안내. 큰 영상의 클립 자르기는 구간 길이만큼 실시간 소요.

### v1.3.0 — 2026-11-22 22:03 (KST) · 커밋 `e0e3805` · `tip-v1.3.0`

- **작성자**: 유동규(색상·설정 요구) + Pickle(AI) 구현
- **개발 내용**
  - 기본 액센트를 **딥그린(#166534 / 다크 #16A34A)** 으로 변경, `data-accent` 팔레트 6종(green·blue·purple·orange·rose·slate) 도입 (`css/app.css`, `js/store.js`의 `ACCENTS`/`getAccent`/`setAccent`).
  - ⚙️ **환경설정 바텀시트** (`js/app.js`): 화면 모드 라이트/다크 세그먼트(아이콘 포함), 기본 색상 스와치, 백드롭·ESC 닫기, `role="dialog"`.
  - 테마 프리페인트 스크립트(`index.html`)로 첫 페인트 전 `data-theme`/`data-accent` 적용, `meta theme-color` 동기화.
- **사용한 언어·세팅**: 동일(빌드리스). 모듈 없음.
- **주의**: `localStorage` 키는 `tip.settings.v1`, `tip.theme`, `tip.accent`.

### v1.2.0 — 2026-11-22 21:48~21:51 (KST) · 커밋 `116eee2`, `92b9174`, `e9ef916`, `50b7fe0` · `tip-v1.2.0`

- **작성자**: 유동규(요청·검수) + Pickle(AI) 구현
- **개발 내용**
  - `modules/img-converter/module.js` — **이미지 컨버터**. 입력 JPG/PNG/WebP/GIF/BMP/SVG/AVIF/ICO/HEIC, 출력 PNG/JPG/WebP/ICO/BMP/PDF. 여러 장 동시 처리, 품질·너비 옵션, 결과별 용량 증감 표시, 전체 저장.
  - `modules/img-converter/encoders.js` — BMP/ICO/PDF 인코더 직접 구현(캔버스 → 바이트).
  - HEIC는 브라우저 디코더 실패 시 `vendor/heic2any.min.js`로 폴백.
  - 결과 파일명 중복 시 `-2`, `-3` 접미사(`92b9174`), 부제 축약.
  - 무거운 테스트 픽스처(bmp/heic)를 저장소에서 제거(`e9ef916`).
- **주의**: WebP 출력은 브라우저 인코더에 의존 → Safari에서 안 되면 PNG로 안내.

### v1.1.0 — 2026-11-22 21:38 (KST) · 커밋 `04f7bdb` · `tip-v1.1.0`

- **작성자**: 유동규(디자인 리뷰 피드백) + Pickle(AI) 구현
- **개발 내용**: Pretendard Variable 셀프호스팅 폰트 적용, "플랫 중립" 톤으로 UI 전면 개편 — 헤어라인 카드, 그림자 제거, 알약형 버튼 제거, 단일 액센트, 라이트/다크 토큰 정리, Safe Area 대응, 아이콘 크기·간격 정리.
- **주의**: 이후 모든 모듈은 이 톤(12px/9px 라운드, `--line` 헤어라인, `--accent` 단일 색)을 유지한다.

### v1.0.0 — 2026-11-22 19:46 (KST) · 커밋 `ce0f96a` (+ 수정 `d0e9ab6`, `760102d`, `e769563`, `715e71c`, `37dc489`, `bac9c9a`)

- **작성자**: 유동규(기획·요구) + Pickle(AI) 구현
- **개발 내용**
  - **PWA 셸**: `index.html`(PWA 메타·테마 프리페인트), `manifest.json`, `sw.js`(프리캐시 + 내비게이션 network-first), `js/app.js`(해시 라우터 `#/<id>`, 홈 허브 카드, 사용/고정 토글, 아이콘·토스트), `js/store.js`(localStorage), `js/ui.js`(el/toast/formatBytes/아이콘).
  - **문서 리더 모듈**: `modules/doc-reader/`
    - `pdf-viewer.js` — PDF.js로 페이지 캔버스 렌더, 페이지 이동·확대/축소·맞춤·회전, iOS 핀치.
    - `hwp.js` — hwp.js 파서로 HWP 5.x 바이너리 → HTML(표·이미지 포함).
    - `hwpx.js` — JSZip으로 zip 해제 후 `section*.xml` 파싱 → HTML.
    - `renderers.js` — 공용 리더 UI(파일바, 툴바, 스테이지) 빌더.
  - 아이콘 5종은 `tools/make-icons.py`(Pillow)로 생성.
  - 초기 수정 이력: 모듈 import 경로 오류(`../../ui.js` → `../../js/ui.js`), `hidden` 속성 표시 문제, `escapeHtml` 미정의 컨텍스트 제거, **hwp.js 브라우저 패치**(Node `fs` 스텁 + `cfb.read`에 `Uint8Array` 직접 전달).
- **사용한 언어·세팅**: Vanilla ES Modules, `python3 -m http.server`로 확인, 샘플 문서는 `samples/`(직접 생성 PDF/HWPX + 공개 HWP 픽스처).
- **주의**: HWP는 공개 픽스처로만 검증. 암호가 걸린 PDF는 열리지 않을 수 있다.

---

## 4. 알려진 제한사항 (v1.4.0 기준)

| 영역 | 제한 | 대응 |
| --- | --- | --- |
| iOS Safari | WebP **인코딩** 미지원 | PNG로 저장하고 안내 문구 표시 |
| iOS Safari | HEIC 디코딩이 버전에 따라 불가 | `heic2any` 폴백 |
| iOS Safari | `MediaRecorder`/`captureStream` 동작이 기기·버전별로 다름 | GIF 변환 우선 안내, 30초 이내 짧은 클립 권장 |
| GitHub Pages | `COOP`/`COEP` 없음 → `SharedArrayBuffer` 불가 | wasm 멀티스레드(ffmpeg.wasm) 미사용, gifenc/MediaRecorder로 대체 |
| PDF | 암호화 PDF는 결과가 비어 있을 수 있음 | `ignoreEncryption` + 경고 |
| 사진 | 아주 큰 사진은 긴 변 3200px로 축소 | 안내 문구 표시 |
| GIF | 최대 300프레임 | 구간·FPS 조절 안내 |
| 서비스 워커 | 새 버전 반영에 새로고침 1회 필요 | `skipWaiting` + `clients.claim` (한 번 새로고침이면 최신) |
| 오프라인 | 최초 1회는 온라인 필요(프리캐시) | 이후 오프라인 동작 |

## 5. 다음 예정 작업

- **배경 제거 모듈** (사람/사물 배경 지우기) — 로컬 모델(wonnx/ONNX Runtime Web) 또는 색상 기반 마스크 방식 검토. 모델 파일 용량이 크면 `sw.js` 프리캐시에 넣지 말고 런타임 캐시로 처리할 것.
- **Mac용 배포** — 데스크톱 1280px 레이아웃·드래그앤드롭·마우스 조작을 기준으로 마무리하고, Mac 앱(래퍼) 배포 방식 검토.
- 문서 리더의 텍스트 선택·검색, PDF 페이지 썸네일 등 후속 개선.
