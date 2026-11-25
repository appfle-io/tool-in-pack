/**
 * Module registry — the one place a new tool gets plugged in.
 *
 * A module is a plain ES module with a default export:
 *   {
 *     id, name, kind, subtitle, description, icon (svg string), version,
 *     category,                    // CATEGORIES 의 id 중 하나 — 홈 화면 섹션을 정한다
 *                                  //   'docs' | 'media' | 'file' | 'calc' | 'dev' | 'mac'
 *     accepts,                     // (선택) 이 모듈이 받는 파일 MIME 패턴 목록 (v1.16.0)
 *     defaultEnabled, defaultPinned,
 *     mount(root, ctx) -> cleanup function | void
 *   }
 *
 * Adding a tool:
 *   1. modules/<your-module>/module.js  (with mount(), and `category`)
 *   2. one import + one entry in `registry` below
 * Everything else (home card, enable/pin toggles, routing, offline shell)
 * picks it up automatically.
 */

import docReader from './doc-reader/module.js';
import devTools from './dev-tools/module.js';
import textDiff from './text-diff/module.js';
import regexTester from './regex-tester/module.js';
import colorTools from './color-tools/module.js';
import iconGen from './icon-gen/module.js';
import ocrReader from './ocr-reader/module.js';
import imgConverter from './img-converter/module.js';
import pdfTools from './pdf-tools/module.js';
import photoPrivacy from './photo-privacy/module.js';
import qrGen from './qr-gen/module.js';
import videoGif from './video-gif/module.js';
import videoMosaic from './video-mosaic/module.js';
import mdEditor from './md-editor/module.js';
import fileCompress from './file-compress/module.js';
import unitConverter from './unit-converter/module.js';
import currencyCalc from './currency-calc/module.js';
import clipboardHistory from './clipboard-history/module.js';
import addressSearch from './address-search/module.js';
import parcelTracker from './parcel-tracker/module.js';
// v1.14.0 — Mac 전용 생산성 확장(스티커·스포이드·창 분할)과 공용 도구(이름 변경·스니펫)
import stickyNotes from './sticky-notes/module.js';
import screenPicker from './screen-picker/module.js';
import windowSnap from './window-snap/module.js';
import bulkRename from './bulk-rename/module.js';
import snippets from './snippets/module.js';
// v1.15.0 — TIP 내장 타이머(분·초 자유 설정, 노치 알약·전역 검색과 상태 공유)
import timer from './timer/module.js';
// v1.16.0 — 글자 수 세기·날짜 계산기·한영 타자 변환·스크린샷+표시
import textCounter from './text-counter/module.js';
import dateCalc from './date-calc/module.js';
import typingConverter from './typing-converter/module.js';
import screenshotAnnotate from './screenshot-annotate/module.js';

/**
 * 홈 화면 섹션 순서. 여기에 적은 순서대로 홈이 그려진다.
 * 새 분류가 필요하면 이 배열에 한 줄 추가한다(라벨은 한국어, 짧게).
 *
 * v1.16.0 — 여섯 묶음으로 다시 나눴다: 문서·글 · 사진·영상 · 파일 · 계산·조회 · 개발·디자인 · Mac 화면 도구.
 * 예전 '문서(document)'·'미디어(media)'·'개발(dev)'·'유틸리티(utility)'·'조회·연동(online)' 은
 * 아래 ALIASES 가 받아 주고, 저장된 순서는 js/store.js 가 새 분류로 옮겨 읽는다.
 * '문서·글'처럼 가운데 점(·)이 들어간 라벨은 이 섹션 제목에서만 허용한다(모듈 화면 문구는 금지).
 */
export const CATEGORIES = [
  { id: 'docs', label: '문서·글' },
  { id: 'media', label: '사진·영상' },
  { id: 'file', label: '파일' },
  { id: 'calc', label: '계산·조회' },
  { id: 'dev', label: '개발·디자인' },
  { id: 'mac', label: 'Mac 화면 도구', mac: true },
];

/** category 를 빠뜨렸거나 모르는 값이면 이 분류로 모은다. */
export const FALLBACK_CATEGORY = 'calc';

/** v1.16.0 이전 분류 이름 → 지금 이름. (모듈이 옛 이름을 들고 있어도 자리를 찾는다) */
const CATEGORY_ALIASES = {
  docs: 'docs',
  document: 'docs',
  media: 'media',
  file: 'file',
  calc: 'calc',
  dev: 'dev',
  mac: 'mac',
  // 예전 '유틸리티'·'조회·연동' 은 성격이 달라 모듈마다 새 이름으로 옮겼다.
  // 옛 이름을 그대로 든 모듈이 있으면 '계산·조회' 로 모은다(임시 자리).
  utility: 'calc',
  online: 'calc',
};

export function categoryOf(mod) {
  const raw = mod && mod.category;
  const id = CATEGORY_ALIASES[raw] || raw;
  return CATEGORIES.some((category) => category.id === id) ? id : FALLBACK_CATEGORY;
}

export const registry = [
  docReader,
  clipboardHistory,
  addressSearch,
  parcelTracker,
  imgConverter,
  pdfTools,
  mdEditor,
  photoPrivacy,
  qrGen,
  videoGif,
  videoMosaic,
  devTools,
  textDiff,
  regexTester,
  colorTools,
  iconGen,
  ocrReader,
  fileCompress,
  unitConverter,
  currencyCalc,
  // v1.14.0
  stickyNotes,
  snippets,
  screenPicker,
  windowSnap,
  bulkRename,
  // v1.15.0
  timer,
  // v1.16.0
  textCounter,
  dateCalc,
  typingConverter,
  screenshotAnnotate,
];

const TAURI = typeof window !== 'undefined' && !!(window.__TAURI__ && window.__TAURI__.core);

/** 이 환경에서 쓸 수 있는 모듈 — 웹(PWA)에서는 Mac 전용(macOnly)을 감춘다. (v1.14.0) */
export function listModules() {
  return registry.filter((mod) => !mod.macOnly || TAURI);
}

/** 이 환경에서 보이는 분류 — 웹(PWA)에서는 'Mac 화면 도구' 섹션째 감춘다. (v1.16.0) */
export function visibleCategories() {
  return CATEGORIES.filter((category) => !category.mac || TAURI);
}

/** 환경과 상관없이 등록된 모든 모듈 — 설정 화면 등 내부용. */
export function allModules() {
  return registry.slice();
}

export function isTauri() {
  return TAURI;
}

export function getModule(id) {
  return registry.find((mod) => mod.id === id) || null;
}
