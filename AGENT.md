# AGENT.md — AI·개발자용 작업 지침

TIP(TOOL-IN-PACK)을 이어서 개발하는 AI 어시스턴트와 개발자를 위한 규칙입니다.
작업을 시작하기 전에 이 문서와 `HISTORY.md`를 읽으세요. 사용자에게 보여 줄 설명은 `README.md`에 있습니다.

---

## 1. 필수 지침

### 지침 1 — 새 모듈은 `README.md`에 반드시 추가한다

새 모듈을 만들거나 기존 모듈의 사용법이 바뀌면 **`README.md`(사용자용 설명서)에 그 모듈의 기능과 사용법을 반드시 추가·수정**합니다.

- `README.md` §2 "모듈별 사용법"에 **번호 항목**으로 넣고, 맨 위 모듈 표에도 한 줄 추가합니다.
- 적을 내용: 무엇을 하는지, 입력 형식, 화면에서 누르는 순서, 결과 저장 형식, 사용자에게 알려야 할 제약(브라우저별 차이 등).
- 개발자용 세부 구조는 `README.md`가 아니라 이 문서와 `HISTORY.md`에 적습니다. (`README.md`는 사용자가 읽는 문서)

### 지침 2 — 작업 후 `HISTORY.md`에 기록한다

작업을 마치면 `HISTORY.md`의 **§0 작성 요령**에 따라 `§3 버전 기록` **맨 위**에 한 블록을 추가합니다.

기록 항목: **작성자(유동규 + 구현 AI)** · **일시** · **버전(`sw.js` `CACHE_VERSION`, 커밋 해시)** · **개발 내용(파일 경로·기능 상세)** · **사용한 언어/라이브러리/세팅** · **주의·제약**.

기록 없이 배포하지 않습니다. 다음 작업자가 무엇이 바뀌었는지 알 수 없으면 그 작업은 끝난 것이 아닙니다.

### 지침 3 — 버전은 `MAJOR.MINOR.PATCH` 규칙대로 올린다

현재 버전은 **1.10.0** (2026-11-23 기준). 버전은 세 자리 숫자로만 쓰고(`1.5.0`), 어느 자리를 올릴지는 아래 기준을 따른다.

| 자리 | 올리는 때 | 예 |
| --- | --- | --- |
| **MAJOR** (맨 앞) | 대규모 구조 개편, 대대적 수정 | `1.5.0` → `2.0.0` |
| **MINOR** (중간) | 기능 추가, 기능 수정 | `1.5.0` → `1.6.0` |
| **PATCH** (마지막) | 오류 수정, 개선사항 반영 | `1.5.0` → `1.5.1` |

- 작은 수정이라도 **버전은 반드시 올린다**(배포마다 `CACHE_VERSION`이 바뀌어야 기존 사용자가 새 파일을 받는다).
- 한 번에 여러 자리를 올려도 된다. 예: 구조 개편 + 버그 수정 → `2.0.0`.
- **세 곳의 버전이 항상 같아야 한다.**
  1. `sw.js` `CACHE_VERSION` = `tip-vX.Y.Z`
  2. `HISTORY.md` — §1 "현재 버전"과 §3 새 블록 제목
  3. `README.md` — §7 버전 표의 맨 위 줄
- 버전을 올리지 않은 커밋(문서만 고치는 등)은 직전 버전을 그대로 쓴다. `CACHE_VERSION`도 그대로 둔다.

### 지침 4 — 커밋 메시지는 `[vX.Y.Z] type: 내용` 형식으로 쓴다

```
[vX.Y.Z] type: 변경 내용
```

- 예: `[v1.5.0] feat: 홈 화면 카테고리 섹션(문서·미디어·유틸리티) 추가`, `[v1.5.1] fix: 핀 해제 후 고정됨 섹션이 남는 오류 수정`
- `type` 은 아래 중 하나만 쓴다.

| type | 쓰는 때 |
| --- | --- |
| `feat` | 기능 추가·기능 수정 |
| `fix` / `error` | 오류 수정·버그 개선 |
| `docs` | 문서(`README.md`, `AGENT.md`, `HISTORY.md` 등) |
| `style` | UI·스타일(동작 변화 없음) |
| `refactor` | 구조 개선(동작 변화 없음) |
| `chore` | 설정·빌드·기타 |

- 여러 종류가 섞이면 **주된 변경 하나**를 type으로 고르고, 나머지는 커밋 본문에 적는다.
- 제목은 한국어로 짧게(50자 안팎), 마침표 없이. 버전은 대괄호 안에 `v`를 붙여 쓴다.
- 예시 파일: `git commit -m "[v1.5.0] feat: 홈 화면 카테고리 섹션(문서·미디어·유틸리티) 추가"`

---

## 2. 절대 규칙 (깨면 라이브가 망가진다)

1. **빌드 도구를 들이지 않는다.** 순수 HTML + CSS + ES Modules. npm 런타임 의존, 번들러, TypeScript, 프레임워크 금지. `index.html`을 정적 서버에 올리면 그대로 동작해야 한다.
2. **외부 CDN을 쓰지 않는다.** 모든 라이브러리는 `vendor/<이름>/`에 셀프호스팅하고 버전을 고정한다. (오프라인 동작 + 공급망 안정성) 새 라이브러리를 넣을 때는 라이선스 파일을 함께 넣고 `LICENSE`의 서드파티 목록에 추가한다.
3. **모듈 등록은 두 곳만.** `modules/<name>/module.js`(default export에 `id, name, shortName?, subtitle, description, icon, version, category, defaultEnabled, defaultPinned, mount(root, ctx)`) + `modules/registry.js`의 import 1줄과 배열 1줄. 그 밖의 코드(홈 카드, 홈 섹션, 라우팅, 켜기/끄기, 고정)는 자동으로 붙으므로 손대지 않는다.
4. **배포마다 `sw.js`를 갱신한다.** `CACHE_VERSION`을 올리고(예: `tip-v1.5.0`) 새 모듈·벤더 파일 경로를 `APP_SHELL` 프리캐시에 추가한다. 빠뜨리면 기존 사용자는 옛 파일을 계속 받는다.
5. **GitHub Pages 제약을 기억한다.** COOP/COEP 헤더가 없어 `SharedArrayBuffer`를 쓸 수 없다. 멀티스레드 `ffmpeg.wasm`, `SharedArrayBuffer` 기반 wasm, 스레드 워커 조합은 라이브에서 실패한다. 큰 wasm을 꼭 써야 하면 프리캐시에 넣지 말고 런타임 캐시로 처리해 초기 설치를 느리게 만들지 않는다.
6. **모바일과 데스크톱을 함께 본다.** 390×844(iPhone)와 1280×800(데스크톱·Mac 예정) 모두에서 확인한다. Mac 배포가 예정되어 있으므로 **파일 드래그앤드롭, 마우스 드래그(캔버스 편집), 넓은 화면 2열 레이아웃**을 항상 점검한다.
7. **100% 로컬 처리를 깨지 않는다.** 파일을 서버로 보내는 기능, 계정 로그인, 분석 도구, 외부 API 호출을 추가하지 않는다. 화면 문구도 "기기 안에서만 처리"와 일치해야 한다. **예외는 하나 — 앱 업데이트 확인(v1.10.0)** 이 GitHub Releases 의 공개 최신 버전만 읽는다(사용자 파일·데이터는 보내지 않는다). 그 밖의 외부 호출은 여전히 금지다.
8. **푸시 전에 실제 파일로 검증하고, 푸시 후 라이브에서 다시 확인한다.** (아래 §5)

---

## 3. 구조와 관례

```
index.html          앱 셸 (테마 프리페인트, 벤더 <script>, #view, #toast)
radial.html         Mac 메뉴 막대 반원 퀵바 창 (투명 창, 580×206)
js/app.js           해시 라우터(#/<id>), 홈 허브(고정됨 + 카테고리 섹션), ⚙️ 설정 시트, SW 등록
js/ui.js            el(), toast(), formatBytes(), 공용 아이콘(icons)
js/store.js         localStorage — 모듈 enabled/pinned, 테마, 액센트, 홈 카드 순서(tip.order.v1), 퀵바 순서(tip.radialOrder.v1), 퀵바 투명도(tip.quickbarOpacity.v1)
js/radial.js        반원 퀵바 렌더·회전·모듈 열기
js/quickbar.js      퀵바 순서 계산(기본 = 홈 순서, 지정 = tip.radialOrder.v1)
mac/                macOS 앱 (Tauri 2) — 아래 §3 'macOS 앱' 절
modules/registry.js 모듈 레지스트리 + CATEGORIES(홈 섹션 순서·라벨)
modules/<name>/     모듈 구현
vendor/             셀프호스팅 라이브러리
css/app.css         전역 스타일 (파일 하나, 끝에 버전별 섹션이 쌓임)
css/radial.css      반원 퀵바 창 전용 스타일
```

### 모듈 작성 관례

- `mount(root, ctx)`에서 `root.innerHTML`로 화면을 그리고, 이벤트는 **`AbortController`의 signal**로 묶은 뒤 정리 함수를 반환한다.
  ```js
  mount(root) {
    const controller = new AbortController();
    const { signal } = controller;
    root.innerHTML = `...`;
    root.querySelector('#btn').addEventListener('click', fn, { signal });
    return () => controller.abort();
  }
  ```
- `ctx`: `{ goHome(), toast(), icons }`.
- 모든 모듈은 **빈 상태(아이콘 + 파일 선택 버튼 + 한 줄 안내)** 를 갖고, **끌어다 놓기**를 지원한다.
- 파일 처리 결과는 항상 **용량·개수 등 실제 값**을 화면에 보여 준다(사용자가 결과를 확인할 수 있게).
- 오류는 `console.error('[TIP <module-id>]', error)` + 화면 안내 문구로. 조용히 실패하지 않는다.
- 문구는 한국어, 짧고 담백하게. 이모지는 쓰지 않는다(설정·시스템 문구 톤 유지).

### 카테고리(`category`) 관례 — 홈 화면 섹션

모든 모듈은 `category` 를 **반드시** 지정한다. 홈 화면은 이 값으로 섹션을 묶어 그린다.

| `category` | 섹션 이름 | 넣는 모듈 |
| --- | --- | --- |
| `docs` | 문서 | 문서 리더(`doc-reader`), PDF 합치기(`pdf-tools`) |
| `media` | 미디어 | 이미지 컨버터(`img-converter`), 사진 모자이크(`photo-privacy`), 동영상 자르기·GIF(`video-gif`) |
| `utility` | 유틸리티 | QR 생성기(`qr-gen`) 등 그 밖의 도구 |

- 섹션 순서와 라벨은 `modules/registry.js`의 `CATEGORIES` 배열 하나가 정한다. 홈은 **고정됨 → `CATEGORIES` 순서**대로 그린다.
- `category` 를 빠뜨리거나 모르는 값을 쓰면 `FALLBACK_CATEGORY`(`utility`)로 모인다. (조용히 사라지지는 않지만, 제 분류에 두려면 반드시 지정한다)
- **새 분류가 필요하면** `CATEGORIES` 에 `{ id, label }` 을 순서에 맞게 추가하고, 이 표와 `README.md` 모듈 표의 "분류"도 함께 고친다. 분류를 늘리는 일은 드물어야 한다(3~4개 유지).
- 분류는 모듈의 성격을 말한다. `kind`(`reader`/`tool`)는 내부 구분용이므로 홈 표시에는 쓰지 않는다.

### macOS 앱 (`mac/`, Tauri 2) — v1.9.0 / 퀵바 v1.10.0

- **웹 자산을 복사해서 쓴다.** `mac/scripts/collect-web.sh` 가 루트의 `index.html`·`radial.html`·`css/`·`js/`·`modules/`·`vendor/`·`icons/` 를 `mac/dist-web/` 으로 복사하고, `tauri.conf.json` 의 `beforeBuildCommand` 가 빌드 전에 자동 실행한다. `dist-web` 은 커밋하지 않는다(`.gitignore`).
- **웹 코드는 그대로 둔다.** Mac 전용 분기는 `js/app.js`·`js/radial.js` 안의 `TAURI = !!window.__TAURI__` 뿐이다. 웹(PWA)에는 영향이 없어야 한다.
- **Tauri 설정**: `withGlobalTauri: true`(번들러 없이 `window.__TAURI__` 사용), `macOSPrivateApi: true`(투명 창), `csp: null`(벤더 wasm/worker).
- **창 3종** (`mac/src-tauri/src/lib.rs`):
  | label | 크기 | 성격 |
  | --- | --- | --- |
  | `main` | 1040×760 (최소 420×700) | 전체 창. X 를 누르면 **숨김**(`prevent_close`), Dock·트레이로 재오픈 |
  | `quickbar` | 580×206 | 반타원(아치) 퀵바 — 판 가로 284·세로 176(`js/radial.js` `G`), 아래 30px 는 그림자 여백. 투명·무테두리·always on top·skip taskbar, **포커스 아웃 시 hide**. 트레이 아이콘 아래 **2px** 에 두어 위쪽 일직선이 메뉴 막대에 붙는다(`place_under_tray(…, gap)`) |
  | `tool` | 420×680 | 모듈별 컴팩트 창. `index.html?module=<id>` 로 열고, 이미 있으면 `tip://open-module` 이벤트로 모듈만 바꾼다 |
- **트레이**: `mac/src-tauri/icons/tray-icon.png`(44×44 RGBA, **PWA 앱 아이콘과 같은 색**) + `icon_as_template(false)` — v1.10.0 부터 흑백 템플릿 대신 앱 아이콘을 쓴다(사용자 요청). `tools/make-mac-icons.py` 의 `build_tray_color()` 가 `icons/icon-1024.png` 를 라운드 사각형으로 다듬어 만든다(투명 여백 2px). 흑백 템플릿(`trayTemplate*.png`)은 남아 있지만 쓰지 않는다. 좌클릭 = 퀵바 토글, 우클릭 = 메뉴(앱 열기·퀵바·환경설정·종료). 아이콘 좌표(`TrayIconEvent::Click.rect`)를 저장해 창을 그 아래에 놓는다.
- **환경설정 열기(창 3종 밖의 4번째 길)**: 퀵바의 ⚙ 버튼 → `invoke('open_main', { module: null, settings: true })` → `show_main` 이 메인 창을 띄우고 `tip://open-settings` 이벤트를 보냄 → `js/app.js` 가 `openSheet()`. 창이 이미 떠 있으면 그대로 시트만 앞으로 나온다. 웹에서는 `index.html?settings=1` 로 이동해 같은 시트를 열고, 주소의 파라미터는 `history.replaceState` 로 지운다. 메인 화면이 아직 안 떴을 때를 대비해 Rust 가 `PENDING_SETTINGS` 를 남기고, `app.js` 가 시작할 때 `take_pending_settings` 로 한 번 꺼낸다.
- **명령 목록** (`invoke_handler`): `hide_radial` · `open_main` · `open_tool` · `take_pending_settings` · `set_tray_visible` · `check_app_update` · `install_app_update_and_restart`.
- **앱 업데이트 (v1.10.0)**: `check_app_update` 가 `https://api.github.com/repos/appfle-io/tool-in-pack/releases/latest` 를 읽어 `CARGO_PKG_VERSION` 과 비교하고, `.app.tar.gz` 에셋의 `browser_download_url` 을 돌려준다. `install_app_update_and_restart(url)` 는 `reqwest` 스트림으로 임시 폴더에 받으면서 `tip://update-progress`(`{stage, percent}`) 를 보내고(프런트가 진행률 로딩바를 그림), `tar -xzf` → `ditto` 로 번들 교체(백업 후, 실패 시 되돌림) → `open -n` → `app.exit(0)`. 릴리스가 없으면 404 를 받아 "공개된 새 버전이 없습니다" 로 응답한다. **이 경로만 외부 네트워크를 쓴다**(5번 지침의 예외 — 공개 릴리스 정보만 읽고 사용자 데이터는 보내지 않는다).
- **메뉴 막대에 표시 (v1.10.0)**: `localStorage['tip.menuBarVisible.v1']`(`'1'`/`'0'`, 기본 `'1'`) → `set_tray_visible(true|false)` → `tray_by_id("tip").set_visible()`, 끄면 반원 퀵바도 숨긴다. Rust 는 localStorage 를 못 읽으므로 **메인 창이 시작할 때 저장값을 밀어 준다**(`js/app.js` 부트). 도구 창(`?module=`)은 이 동기화를 하지 않는다. 트레이를 꺼도 Dock 아이콘은 남겨 회수 경로를 만든다.
- **메뉴 도구 투명도 (v1.11.0)**: `localStorage['tip.quickbarOpacity.v1']` 에 `'35'`~`'100'`(정수 %, 기본 `'92'`)을 저장한다. `js/app.js` 의 `quickbarOpacityRow()` 가 ⚙️ → **메뉴 막대** 섹션 안의 슬라이더(`.op-row`, `input[type=range]`)를 그리고, `js/radial.js` 의 `applyOpacity()` 가 `--fan-alpha`(알파 = %/100)를 `<html>` 에 넣어 유리판 배경(`rgba(…, var(--fan-alpha, .92))`)만 바꾼다. 타일·글자는 불투명하게 두어 가독성은 그대로다. 값이 바뀌면 퀵바의 700ms 폴링(`signature()` 에 키 포함)·`storage`·포커스 이벤트로 열려 있는 창에도 반영된다. 슬라이더는 더블클릭하면 기본 92% 로 돌아간다.
- **아이콘 재생성**: `python3 tools/make-mac-icons.py` (`icon.icns`, `icon.png`, `tray-icon.png`, `trayTemplate.png`, `trayTemplate@2x.png`). 결과물은 커밋한다. `icon.png` 는 `tauri::generate_context!` 가 기본 창 아이콘으로 읽으므로 **없으면 빌드가 panic** 한다.
- **트레이 좌표**: `TrayIconEvent::Click.rect` 의 `position`·`size` 는 dpi **열거형**(`tauri::Position` / `tauri::Size`)이다. `.x`·`.width` 필드가 없으므로 `Position::Physical/Logical` 을 직접 매칭해 물리 픽셀로 바꾼 뒤 저장한다(`lib.rs` 의 `on_tray_icon_event`).
- **빌드**: `.github/workflows/build-mac.yml` — `macos-latest`, Universal(`aarch64-apple-darwin` + `x86_64-apple-darwin`), `npx tauri build --target universal-apple-darwin --bundles app,dmg`. 로컬(Mac)에서는 `cd mac && npm install && npm run build`.
- **배포 두 갈래**: `main` push(`mac/**` 변경)는 **아티팩트만** 만든다. `v*` 태그 push(`git tag -a v1.10.0 && git push origin v1.10.0`)는 빌드 + **Release 생성·첨부**(`.dmg`·`.app.tar.gz`·`SHA256SUMS.txt`)까지 한다. **앱 내 업데이트 확인은 `releases/latest` 를 읽으므로, 배포할 때는 태그까지 push 해야 새 버전이 잡힌다.**
- **v1.10.0 산출물**(2026-11-23): `TIP_1.10.0_universal.dmg` 31,712,201 bytes sha256 `a5670d12…9d26`, `TIP_1.10.0_universal.app.tar.gz` 30,373,162 bytes sha256 `752f84af…e4592`, Release <https://github.com/appfle-io/tool-in-pack/releases/tag/v1.10.0>.
- **서명 분기**: Secrets `APPLE_CERTIFICATE`·`APPLE_CERTIFICATE_PASSWORD`·`APPLE_SIGNING_IDENTITY`(+공증용 `APPLE_ID`·`APPLE_PASSWORD`·`APPLE_TEAM_ID`)가 있으면 Developer ID 서명·공증, 없으면 Ad-hoc(`APPLE_SIGNING_IDENTITY=-`). **Secrets 를 if 조건에 직접 쓸 수 없어** job `env.SIGNING_CERT` 로 내려받아 조건에 쓴다. 2026-11-23 에 6종을 모두 등록했고, 그 뒤 빌드는 **서명 + 공증**으로 돈다.
- **서명이 깨질 때 먼저 볼 두 곳** (2026-11-23 실제로 겪은 순서):
  1. **인증서 해독 줄** — macOS 의 `base64` 는 GNU식 `--decode` 를 모른다. 지금은 `printf '%s' "$CERT_B64" | tr -d '\r\n\t ' | openssl base64 -d -A -out …` 를 쓴다. 이 줄이 틀리면 단계가 **0초 만에** 실패한다.
  2. **`.p12` 형식** — 최신 암호화로 내보낸 .p12 는 `security import` 가 거부한다. **`-legacy` 로 다시 내보낸 .p12**(암호 동일)로 `APPLE_CERTIFICATE` 를 교체하면 통과한다.
- **워크플로우는 CLI 로 못 고친다** — 이 App 에 `workflows` 스코프가 없어 `.github/workflows/*` push 는 `refusing to allow a GitHub App to create or update workflow` 로 거부된다. GitHub 웹 편집(또는 workflows 권한이 있는 계정)으로 커밋해야 한다.
- **아티팩트·로그 접근 한계** — 자동화 토큰에 `actions`(다운로드)·admin 권한이 없어 `actions/artifacts/{id}/zip` 은 `403`, `actions/runs/{id}/logs` 는 `Must have admin rights` 로 거부된다. 빌드 산출물은 run 페이지에서 내려받거나, 태그 push 로 Release 에 첨부해 공개 URL 로 받는 편이 확실하다.
- **버전 일치**: `mac/package.json` · `mac/src-tauri/Cargo.toml` · `mac/src-tauri/tauri.conf.json` 의 `version` 을 `sw.js` 와 같은 값으로 올린다(Info.plist `CFBundleShortVersionString` 이 된다).
- **주의 — 워크플로우 파일은 CLI 로 못 올린다**: 이 저장소의 GitHub App 에 `workflows` 스코프가 없어 `.github/workflows/*` push 는 거부된다. 빌드 워크플로우를 고칠 때는 GitHub 웹 편집으로 커밋하고, 나머지 코드는 평소처럼 push 한다.

### 반원 퀵바 순서 (`tip.radialOrderMode.v1` · `tip.radialOrder.v1`) 관례 — v1.9.0 / 모드 v1.10.0

- **모드**(`tip.radialOrderMode.v1`): `'custom'`(기본) · `'asc'` · `'desc'`. `asc`/`desc` 는 켜 둔 모듈을 **이름(shortName) `localeCompare('ko')`** 로 정렬해 그린다(한국어 ICU 정렬이라 라틴 문자는 한글 뒤에 온다). 정렬은 `js/quickbar.js` 의 `quickOrderIds()` 한 곳에서만 한다.
- **사용자 지정 목록**은 `customQuickOrderIds()` 로 모드와 무관하게 저장된 순서 그대로 읽는다(편집 화면용). 모드를 바꿔도 `tip.radialOrder.v1` 은 지우지 않는다.
- 설정 UI는 **하위 메뉴**다: 메인 시트에는 `반원 퀵바 순서` 한 줄(`.sheet-menu`, 지금 모드 표시 + `›`)만 두고, 누르면 `sheetView = 'quickbar'` 로 전환해 방식 3개(`.mode-row`)와 (custom 일 때만) 드래그 목록을 그린다. `‹ 설정`(`.sheet-back`)으로 돌아온다.
- 기본값은 **홈과 같은 순서**(고정됨 → 문서 → 미디어 → 유틸리티, 각 섹션은 `tip.order.v1`). `js/quickbar.js` 의 `defaultQuickOrder()` 가 만든다.
- 사용자가 ⚙️ → **반원 퀵바 순서** 에서 한 번이라도 바꾸면 `tip.radialOrder.v1`(카테고리 구분 없는 **module id 배열**)이 우선한다.
- 배열은 **레지스트리의 모든 모듈 id** 를 담는다. 꺼 둔 모듈의 id 도 남겨 두므로 다시 켜면 원래 자리로 돌아오고, 새로 추가된 모듈(배열에 없는 id)은 뒤에 붙는다(`fullQuickOrder()`).
- 저장은 `saveQuickOrder(onIds)` 로만 한다 — 켜 둔 모듈만 새 순서로 치환하고 꺼 둔 모듈의 자리는 건드리지 않는다.
- 퀵바는 **켜 둔 모듈만** 그린다(`quickOrderIds()`). 홈 섹션 순서를 바꿔도 사용자 지정 퀵바 순서는 바뀌지 않는다(초기화 버튼으로만 되돌아간다).

### 홈 카드 순서 (`tip.order.v1`) 관례 — v1.8.0

홈 카드 순서는 `js/store.js`가 `tip.order.v1`에 **섹션별 module id 배열**로 저장한다(`{ pinned, docs, media, utility }`).

- `js/app.js`의 `ordered()`가 섹션 항목을 이 배열 순서로 정렬해 그린다. 배열에 **없는 新모듈은 원래(레지스트리) 순서대로 뒤에 붙으므로**, 모듈을 추가할 때 순서 파일을 건드릴 필요가 없다.
- 순서 변경은 **같은 섹션 안에서만** 된다(드래그·키보드 모두). 꺼진 모듈(`off` 섹션)은 순서를 바꾸지 않는다.
- 드래그는 **Pointer Events**(`pointerdown`/`pointermove`/`pointerup` + `setPointerCapture`)로 구현되어 있다. 핸들에만 `touch-action: none`을 주어 본문 스크롤과 부딪치지 않는다. HTML5 `draggable`로 바꾸면 iOS 터치에서 끊긴다.
- 설정 시트의 **카드 순서 초기화**가 `resetSectionOrder()`로 이 키만 지운다(다른 설정은 그대로).

### 스타일 관례 (v1.1.0 이후 톤)

- 플랫 중립: 헤어라인 보더(`--line`), 카드 배경(`--card`), 그림자 없음, 알약형 남용 금지.
- 색은 `var(--accent)` 하나 + 상태색(`--good`, `--warn`, `--bad`). 라이트/다크 모두 확인.
- 라운드: 카드 `--radius`(12px), 내부 컨트롤 `--radius-sm`(9px).
- 재사용 클래스: `.primary-btn`(+`.ghost`), `.icon-btn`, `.tool-btn`, `.ic-options`, `.ic-row`, `.ic-label`, `.ic-seg`, `.notice`, `.dr-empty`, `.filebar`, `.pp-card`.
- 데스크톱(≥960px)은 모듈 성격에 따라 2열(캔버스/플레이어 + 340px 패널)로 확장한다.

---

## 4. 새 모듈 추가 체크리스트

1. `modules/<name>/module.js` 작성 — `id`는 URL이 된다(`#/<id>`). `category` 를 `docs` / `media` / `utility` 중에서 지정한다.
2. `modules/registry.js`에 import + 배열 항목 추가.
3. `css/app.css` 끝에 해당 모듈 섹션 추가(접두사 클래스로 스코프).
4. 필요한 라이브러리를 `vendor/`에 추가 + `LICENSE` 서드파티 목록 + `sw.js` 프리캐시.
5. `index.html`에 `<script>`가 필요하면 추가(클래식 전역 라이브러리만; ESM은 모듈에서 import).
6. `sw.js` `CACHE_VERSION` 갱신(지침 3의 버전 규칙) + 새 파일 프리캐시.
7. **`README.md` 모듈별 사용법·모듈 표(분류) 추가** (지침 1).
8. **`HISTORY.md` 기록 추가** (지침 2).
9. 검증(§5) → 커밋(`git -c user.name="appfle-io" -c user.email="appfle.io@gmail.com" -m "[vX.Y.Z] type: 내용"`, 지침 4) → `git push origin main` → 라이브 확인.

---

## 5. 검증 절차

### 로컬

```bash
cd work/tip
python3 -m http.server 8000        # http://127.0.0.1:8000/
```

- **항상 새 브라우저 컨텍스트**로 확인한다. 서비스 워커가 옛 파일을 물고 있으면 수정이 반영되지 않는다.
- **반원 퀵바**는 `http://127.0.0.1:8000/radial.html` 로 직접 열어 확인한다(창 크기 **580×206**). `?bg=1` 을 붙이면 스크린샷용 배경이 깔린다(테마를 따라간다). 판은 **위가 일직선·아래가 납작한 반타원**(`clip-path: path("M … L … A 284 176 0 0 1 …")`, v1.11.0)이고, 타일은 **반지름 400의 얕은 호**를 따라 3칸 옆이 x±204(칸 각도 ≈10.2°)에 놓인다. 휠·←→ 회전, 타일 클릭(`index.html?module=<id>` 이동), 라이트/다크·색상, 켜기/끄기 필터, `tip.radialOrder.v1` 반영, **투명도(`tip.quickbarOpacity.v1` — 판 배경 알파, 35~100%·기본 92%)**, **앱 열기·환경설정 버튼**, **환경설정 클릭 → `index.html?settings=1` 시트 바로 열림**을 본다.
- **Mac 앱**은 로컬에 Rust·Xcode 가 있어야 빌드된다. 없으면 `gh workflow run build-mac.yml` 로 CI 빌드를 돌리고 `gh run view --log-failed` 로 확인한다.
- 실제 파일로 끝까지 실행해 **결과 파일을 검사**한다. 예: 병합 PDF는 페이지 수·페이지 크기, 모자이크 저장본은 EXIF 0건, GIF는 `GIF89a` 헤더·프레임 수, 클립은 길이·해상도.
- 모바일 390×844 + 데스크톱 1280×800 두 크기에서 스크린샷을 남긴다.
- 확인 항목: 콘솔 에러 0, 페이지 에러 0, 404 0, 가로 스크롤 넘침 없음, 라이트/다크.
- **앱 업데이트·메뉴 막대 토글**은 Tauri 목(`window.__TAURI__` 를 add_init_script 로 주입, `invoke` 를 배열에 기록)으로 검증한다 — `work/tip-v110/test_update.py`, `work/tip-v110/test_menubar.py`. 실제 설치·재시작은 macOS 실기에서만 확인할 수 있다.

### 푸시 후 라이브

```bash
curl -s https://appfle-io.github.io/tool-in-pack/sw.js | head -3   # CACHE_VERSION 이 새 버전인지
```

- 반영은 보통 30~90초. 그 뒤 라이브 URL에서 홈 카드 수와 신규 모듈 동작을 다시 확인한다.
- 기존 방문자는 **새로고침 1회** 후 새 버전을 받는다(설계된 동작).

---

## 6. 하지 말아야 할 것

- 사용자가 요청하지 않은 모듈 비활성화, 기본값 변경, 데이터 삭제.
- `localStorage` 키 이름 변경(`tip.settings.v1`, `tip.theme`, `tip.accent`, `tip.order.v1`, `tip.radialOrder.v1`, `tip.quickbarOpacity.v1`) — 기존 사용자 설정·카드 순서가 날아간다.
- `app.js`의 라우팅 규칙(`#/<id>`) 변경 — PWA 바로가기(`manifest.json` `shortcuts`)와 홈 화면 링크가 깨진다.
- 검증 없이 `main`에 푸시. (라이브가 곧 배포본이다)
- 버전 규칙(지침 3)·커밋 메시지 규칙(지침 4)을 건너뛰는 것 — `CACHE_VERSION`·`HISTORY.md`·`README.md` 버전이 서로 다르거나, `[vX.Y.Z] type:` 없는 커밋 제목.
- `vendor/` 파일을 손으로 고치고 기록을 남기지 않는 것 — 어떤 패치를 했는지 `HISTORY.md`와 파일 상단 주석에 남긴다.
