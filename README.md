# TIP — TOOL-IN-PACK

작은 도구들을 한곳에 모은 모듈형 유틸리티 PWA. 모든 처리는 브라우저(기기) 안에서 끝나고, 어떤 파일도 서버로 전송되지 않습니다.

**라이브:** https://appfle-io.github.io/tool-in-pack/  (GitHub Pages, `/tool-in-pack/` 서브경로)

## 구조

```
index.html              앱 셸 (PWA 메타 태그 포함)
manifest.json           PWA 매니페스트
sw.js                   앱 셸 오프라인 캐싱 (배포 시 CACHE_VERSION 갱신)
css/app.css             전체 스타일 (모바일 퍼스트, Safe Area 대응)
js/app.js               라우터 + 홈 허브 (모듈 카드, 사용/고정 토글)
js/ui.js                DOM 헬퍼·아이콘
js/store.js             localStorage 설정 (모듈별 enabled / pinned)
modules/registry.js     모듈 레지스트리 — 모듈 추가는 여기 한 줄
modules/doc-reader/     문서 리더
  module.js             파일 선택·드래그앤드롭·형식 분기
  pdf-viewer.js         PDF (pdf.js): 페이지 캔버스·이동·확대/축소·회전·iOS 핀치
  hwp.js                HWP 5.x 바이너리 (hwp.js 파서) → HTML 렌더링
  hwpx.js               HWPX (JSZip 해제 → section XML 파싱) → HTML 렌더링
  renderers.js          리더 공용 UI 빌더
modules/img-converter/  이미지 컨버터 (PNG/JPG/WebP/ICO/BMP/PDF, HEIC 입력)
modules/pdf-tools/      PDF 합치기 · 페이지 추출 (pdf-lib)
modules/photo-privacy/  모자이크 · EXIF/GPS 제거
  exif.js               JPEG/PNG/WebP EXIF 리더 (기기·일시·GPS)
modules/qr-gen/         QR 생성기 (URL/텍스트/와이파이 → PNG·SVG)
modules/video-gif/      동영상 자르기 · GIF (gifenc + MediaRecorder, wasm 없음)
vendor/                 셀프 호스팅 라이브러리 (CDN 의존 없음, 오프라인 동작)
  pdfjs/  jszip/  hwpjs/  pdf-lib/  qrcode/  gifenc/
icons/                  PWA/PNG 아이콘 (tools/make-icons.py 로 생성)
tools/make-icons.py     아이콘 재생성 스크립트 (Pillow)
samples/                샘플 문서 (PDF/HWPX 자체 생성, HWP는 공개 픽스처)
```

## 모듈 추가하는 법

`modules/<이름>/module.js` 를 만들고 기본 내보내기에 `id`, `name`, `subtitle`, `description`, `icon`, `mount(root, ctx)` 를 정의한 뒤 `modules/registry.js` 에 import 한 줄을 추가하면 홈 허브에 바로 카드가 생깁니다.

## 라이선스

MIT (본 저장소 코드). 서드파티: pdf.js Apache-2.0 · JSZip MIT/GPL-3 · hwp.js Apache-2.0 · heic2any MIT · pdf-lib MIT · qrcode-generator MIT · gifenc MIT — LICENSE 참고.

## 버전

- v1.4.0 — PDF 합치기·페이지 추출, 모자이크·EXIF 제거, QR 생성기, 동영상 자르기·GIF 추가 (모듈 6종)
- v1.3.0 — 딥그린 기본 액센트, 환경설정 시트(화면 모드·색상)
- v1.2.0 — 이미지 컨버터 추가 (모듈 2종)
