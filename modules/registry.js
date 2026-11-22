/**
 * Module registry — the one place a new tool gets plugged in.
 *
 * A module is a plain ES module with a default export:
 *   {
 *     id, name, kind, subtitle, description, icon (svg string), version,
 *     category,                    // CATEGORIES 의 id 중 하나 — 홈 화면 섹션을 정한다
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
import imgConverter from './img-converter/module.js';
import pdfTools from './pdf-tools/module.js';
import photoPrivacy from './photo-privacy/module.js';
import qrGen from './qr-gen/module.js';
import videoGif from './video-gif/module.js';

/**
 * 홈 화면 섹션 순서. 여기에 적은 순서대로 홈이 그려진다.
 * 새 분류가 필요하면 이 배열에 한 줄 추가한다(라벨은 한국어, 짧게).
 */
export const CATEGORIES = [
  { id: 'docs', label: '문서' },
  { id: 'media', label: '미디어' },
  { id: 'utility', label: '유틸리티' },
];

/** category 를 빠뜨렸거나 모르는 값이면 이 분류로 모은다. */
export const FALLBACK_CATEGORY = 'utility';

export function categoryOf(mod) {
  const id = mod && mod.category;
  return CATEGORIES.some((category) => category.id === id) ? id : FALLBACK_CATEGORY;
}

export const registry = [
  docReader,
  imgConverter,
  pdfTools,
  photoPrivacy,
  qrGen,
  videoGif,
];

export function listModules() {
  return registry.slice();
}

export function getModule(id) {
  return registry.find((mod) => mod.id === id) || null;
}
