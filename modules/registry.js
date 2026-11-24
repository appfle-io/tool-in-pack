/**
 * Module registry — the one place a new tool gets plugged in.
 *
 * A module is a plain ES module with a default export:
 *   {
 *     id, name, kind, subtitle, description, icon (svg string), version,
 *     category,                    // CATEGORIES 의 id 중 하나 — 홈 화면 섹션을 정한다
 *                                  //   'document' | 'media' | 'dev' | 'utility' | 'online'
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
// v1.14.0 — Mac 전용 생산성 확장(스티커·스포이드·드래그 OCR·창 분할)과 공용 도구(이름 변경·스니펫)
import stickyNotes from './sticky-notes/module.js';
import screenPicker from './screen-picker/module.js';
import dragOcr from './drag-ocr/module.js';
import windowSnap from './window-snap/module.js';
import bulkRename from './bulk-rename/module.js';
import snippets from './snippets/module.js';

/**
 * 홈 화면 섹션 순서. 여기에 적은 순서대로 홈이 그려진다.
 * 새 분류가 필요하면 이 배열에 한 줄 추가한다(라벨은 한국어, 짧게).
 *
 * v1.12.2 — 세 묶음을 다섯으로 나눴다: 문서(3) · 미디어(4) · 개발(5) · 유틸리티(5) · 조회·연동(3).
 * 예전 'docs' 는 'document' 로 이름만 바뀌었고(저장된 순서는 js/store.js 가 옮겨 읽는다),
 * 개발·조회·연동은 새 분류다. 모듈이 아직 'docs' 라고 적혀 있어도 아래 ALIAS 가 받아 준다.
 */
export const CATEGORIES = [
  { id: 'document', label: '문서' },
  { id: 'media', label: '미디어' },
  { id: 'dev', label: '개발' },
  { id: 'utility', label: '유틸리티' },
  { id: 'online', label: '조회 · 연동' },
];

/** category 를 빠뜨렸거나 모르는 값이면 이 분류로 모은다. */
export const FALLBACK_CATEGORY = 'utility';

/** v1.12.2 이전 분류 이름 → 지금 이름. */
const CATEGORY_ALIASES = { docs: 'document' };

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
  dragOcr,
  windowSnap,
  bulkRename,
];

const TAURI = typeof window !== 'undefined' && !!(window.__TAURI__ && window.__TAURI__.core);

/** 이 환경에서 쓸 수 있는 모듈 — 웹(PWA)에서는 Mac 전용(macOnly)을 감춘다. (v1.14.0) */
export function listModules() {
  return registry.filter((mod) => !mod.macOnly || TAURI);
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
