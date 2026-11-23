/* TIP · 전역 빠른 실행 검색 (v1.12.0)
 *
 * macOS 앱에서 전역 단축키(기본 Alt+Space)로 열리는 작은 창.
 * 모듈 이름·부제·키워드로 찾아 Enter 로 바로 실행한다(컴팩트 창). 웹에서는 search.html 로 미리 볼 수 있다.
 */

import { listModules, categoryOf, CATEGORIES } from '../modules/registry.js';
import { moduleState, syncStore } from './store.js';

const TAURI = !!(window.__TAURI__ && window.__TAURI__.core);

const inputEl = document.getElementById('palette-input');
const listEl = document.getElementById('palette-list');
const emptyEl = document.getElementById('palette-empty');

const CATEGORY_LABEL = Object.fromEntries(CATEGORIES.map(({ id, label }) => [id, label]));

/** 검색어 보강 — 모듈 이름에 없는 흔한 말로도 찾히게. */
const KEYWORDS = {
  'doc-reader': 'pdf hwp hwpx 문서 뷰어 열기 읽기',
  'clipboard-history': '클립보드 복사 히스토리 클립 이미지 텍스트',
  'img-converter': '이미지 사진 변환 포맷 png jpg webp heic 리사이즈',
  'pdf-tools': 'pdf 합치기 병합 추출 페이지 자르기',
  'md-editor': '마크다운 메모 작성 md 에디터',
  'photo-privacy': '모자이크 블러 위치정보 gps exif 사진 개인정보',
  'qr-gen': 'qr 큐알 코드 와이파이 링크 생성',
  'video-gif': '동영상 영상 gif 자르기 클립 변환',
  'video-mosaic': '영상 모자이크 얼굴 가리기',
  'dev-tools': '개발 json base64 해시 인코딩 디코딩',
  'text-diff': '텍스트 비교 diff 차이',
  'regex-tester': '정규식 regex 테스트',
  'color-tools': '색 색상 컬러 팔레트 변환',
  'icon-gen': '아이콘 icns ico 파비콘 생성',
  'ocr-reader': 'ocr 글자 인식 이미지 텍스트 추출',
  'file-compress': '압축 해제 zip 용량 줄이기',
  'unit-converter': '단위 변환 길이 무게 온도',
  'currency-calc': '환율 계산 통화 달러 원',
};

const COMMANDS = [
  { id: 'cmd:home', kind: 'command', name: 'TIP 앱 열기', subtitle: '홈 화면으로', keywords: '홈 열기 메인 창 앱' },
  { id: 'cmd:settings', kind: 'command', name: '환경설정 열기', subtitle: '모듈 켜기·테마·노치·검색 단축키', keywords: '설정 환경설정 테마 색 단축키' },
];

let results = [];
let cursor = 0;

function invoke(command, args) {
  if (!TAURI) return Promise.resolve(null);
  return window.__TAURI__.core.invoke(command, args || {});
}

function normalize(text) {
  return String(text || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function score(item, query) {
  if (!query) return item.kind === 'command' ? 1 : 2;
  const name = normalize(item.name);
  const shortName = normalize(item.shortName);
  const haystack = `${name} ${shortName} ${normalize(item.subtitle)} ${normalize(item.keywords)}`;
  if (shortName.startsWith(query) || name.startsWith(query)) return 0;
  if (haystack.includes(query)) return 1;
  // 띄어쓰기 단위로 모두 들어 있으면 통과
  const parts = query.split(' ').filter(Boolean);
  if (parts.length > 1 && parts.every((part) => haystack.includes(part))) return 2;
  return 99;
}

function collect() {
  syncStore();
  const commandItems = COMMANDS.map((cmd) => ({ ...cmd }));
  const moduleItems = listModules().map((mod) => ({
    id: mod.id,
    kind: 'module',
    name: mod.shortName || mod.name,
    fullName: mod.name,
    subtitle: mod.subtitle,
    icon: mod.icon,
    category: CATEGORY_LABEL[categoryOf(mod)] || '유틸리티',
    keywords: `${mod.name} ${KEYWORDS[mod.id] || ''} ${mod.description || ''}`,
    enabled: moduleState(mod).enabled,
  }));
  return [...commandItems, ...moduleItems];
}

const ALL = collect();

function search(query) {
  const q = normalize(query);
  const scored = ALL
    .map((item) => ({ item, rank: score(item, q) }))
    .filter(({ rank }) => rank < 99)
    .sort((a, b) => (a.rank - b.rank) || Number(b.item.enabled === true) - Number(a.item.enabled === true));
  return scored.map(({ item }) => item).slice(0, 9);
}

function render() {
  results = search(inputEl.value);
  cursor = Math.min(cursor, Math.max(0, results.length - 1));
  listEl.innerHTML = '';
  emptyEl.hidden = results.length > 0;

  results.forEach((item, index) => {
    const li = document.createElement('li');
    li.className = `palette-row${index === cursor ? ' is-active' : ''}${item.enabled === false ? ' is-off' : ''}`;
    li.id = `palette-row-${index}`;
    li.setAttribute('role', 'option');
    li.setAttribute('aria-selected', String(index === cursor));
    li.innerHTML = `
      <span class="palette-row-icon">${item.icon || (item.kind === 'command' ? '⌘' : '')}</span>
      <span class="palette-row-text">
        <b>${escapeHtml(item.name)}</b>
        <span>${escapeHtml(item.subtitle || '')}</span>
      </span>
      <span class="palette-row-meta">${item.kind === 'command' ? '명령' : escapeHtml(item.category || '')}${item.enabled === false ? ' · 중지됨' : ''}</span>
    `;
    li.addEventListener('click', () => { cursor = index; render(); run(results[cursor]); });
    li.addEventListener('mousemove', () => {
      if (cursor === index) return;
      cursor = index;
      [...listEl.children].forEach((node, i) => {
        node.classList.toggle('is-active', i === index);
        node.setAttribute('aria-selected', String(i === index));
      });
    });
    listEl.append(li);
  });

  inputEl.setAttribute('aria-activedescendant', results.length ? `palette-row-${cursor}` : '');
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (ch) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
  ));
}

async function run(item) {
  if (!item) return;
  if (!TAURI) {
    if (item.kind === 'module') location.href = `./index.html?module=${encodeURIComponent(item.id)}`;
    else if (item.id === 'cmd:settings') location.href = './index.html?settings=1';
    else location.href = './index.html';
    return;
  }
  try {
    if (item.kind === 'command') {
      if (item.id === 'cmd:settings') await invoke('open_main', { module: null, settings: true });
      else await invoke('open_main', { module: null, settings: false });
    } else if (item.enabled === false) {
      await invoke('open_main', { module: item.id, settings: false });
    } else {
      await invoke('open_tool', { id: item.id, title: item.fullName || item.name });
    }
    await invoke('hide_search');
  } catch (error) {
    console.error('[TIP search]', error);
    await invoke('hide_search').catch(() => {});
  }
}

inputEl.addEventListener('input', () => { cursor = 0; render(); });

window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    event.preventDefault();
    if (TAURI) invoke('hide_search');
    else window.close();
    return;
  }
  if (event.key === 'ArrowDown') {
    event.preventDefault();
    if (!results.length) return;
    cursor = (cursor + 1) % results.length;
    render();
    listEl.children[cursor]?.scrollIntoView({ block: 'nearest' });
    return;
  }
  if (event.key === 'ArrowUp') {
    event.preventDefault();
    if (!results.length) return;
    cursor = (cursor - 1 + results.length) % results.length;
    render();
    listEl.children[cursor]?.scrollIntoView({ block: 'nearest' });
    return;
  }
  if (event.key === 'Enter') {
    event.preventDefault();
    run(results[cursor]);
  }
});

/* 단축키로 다시 열 때 — 입력을 비우고 초점을 돌려놓는다. */
function reset() {
  inputEl.value = '';
  cursor = 0;
  render();
  inputEl.focus();
}

if (TAURI && window.__TAURI__.event) {
  window.__TAURI__.event.listen('tip://search-refresh', reset);
}

window.addEventListener('focus', () => inputEl.focus());

if (new URLSearchParams(location.search).has('bg')) {
  document.body.classList.add('has-preview-bg');
}

render();
inputEl.focus();
