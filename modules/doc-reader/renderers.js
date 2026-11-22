/* Shared view builders for the doc reader (toolbar, file bar, stage). */

import { icons } from '../../js/ui.js';

export const STAGE_ID = 'dr-stage';

export function extLabel(name) {
  const match = /\.([a-z0-9]+)$/i.exec(name || '');
  return match ? match[1].toUpperCase() : 'FILE';
}

export function filebarTemplate() {
  return `
    <div class="filebar">
      <span class="f-icon" id="dr-f-icon"></span>
      <div class="f-info">
        <div class="f-name" id="dr-f-name"></div>
        <div class="f-meta" id="dr-f-meta"></div>
      </div>
      <button class="icon-btn" type="button" id="dr-reopen" aria-label="다른 파일 열기" title="다른 파일 열기">${icons.swap}</button>
      <button class="icon-btn" type="button" id="dr-close" aria-label="닫기" title="닫기">${icons.close}</button>
    </div>`;
}

export function pdfToolbarHTML() {
  return `
    <div class="doc-toolbar" id="dr-toolbar">
      <div class="tool-group">
        <button class="tool-btn" type="button" id="dr-prev" aria-label="이전 페이지">${icons.left}</button>
        <button class="tool-btn text" type="button" id="dr-page" title="페이지 이동">1 / 1</button>
        <button class="tool-btn" type="button" id="dr-next" aria-label="다음 페이지">${icons.right}</button>
      </div>
      <span class="tool-sep"></span>
      <div class="tool-group">
        <button class="tool-btn" type="button" id="dr-zoom-out" aria-label="축소">${icons.minus}</button>
        <span class="zoom-label" id="dr-zoom-label">100%</span>
        <button class="tool-btn" type="button" id="dr-zoom-in" aria-label="확대">${icons.plus}</button>
        <button class="tool-btn" type="button" id="dr-fit" aria-label="폭 맞춤" title="폭 맞춤">${icons.fit}</button>
      </div>
      <div class="tool-group right">
        <button class="tool-btn text" type="button" id="dr-rotate" title="회전">↻ 0°</button>
      </div>
    </div>`;
}

export function paperShell() {
  return '<div class="doc-paper" id="dr-paper"></div>';
}
