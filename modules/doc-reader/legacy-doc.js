/**
 * 구형 Word(.doc) — Mac 앱에서만 (v1.26.0)
 *
 * macOS 기본 textutil 로 HTML 로 바꾼 뒤(IPC doc_convert_html), 화면에서 한 번 더 지운다.
 * 웹(PWA)에는 textutil 이 없어 이 형식은 열 수 없고, 그 사실을 안내한다.
 */

import { sanitizeConverted, stripBadLinks } from './sanitize.js';

function toBase64(bytes) {
  const chunk = 0x8000;
  let binary = '';
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(index, index + chunk));
  }
  return btoa(binary);
}

export function tauriCore() {
  return typeof window !== 'undefined' && window.__TAURI__ && window.__TAURI__.core
    ? window.__TAURI__.core
    : null;
}

export async function openLegacyDoc(ctx) {
  const core = tauriCore();
  if (!core) {
    throw new Error('웹에서는 .doc 파일을 열 수 없습니다. Mac 앱에서 열어 주세요.');
  }
  const bytes = new Uint8Array(await ctx.file.arrayBuffer());
  const html = await core.invoke('doc_convert_html', {
    name: ctx.file.name,
    data: toBase64(bytes),
  });
  const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
  const body = doc.body ? doc.body.innerHTML : String(html || '');
  const clean = sanitizeConverted(body);
  ctx.stage.classList.add('dr-paper', 'dr-doc');
  ctx.stage.innerHTML = clean;
  stripBadLinks(ctx.stage);
  if (!ctx.stage.textContent.trim() && !ctx.stage.querySelector('img,table')) {
    throw new Error('문서에서 보여 줄 내용을 찾지 못했습니다.');
  }
  return {};
}
