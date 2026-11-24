/**
 * TIP · 창 분할 (window-snap, v1.14.0 — Mac 앱 전용)
 *
 * 앞에 있는 창을 화면의 왼쪽·오른쪽·위·아래 절반, 최대, 가운데 70% 로 옮긴다.
 * macOS 의 손쉬운 사용(Accessibility) 권한이 필요하고, 없으면 시스템 설정으로 안내한다.
 * 창을 옮길 뿐 화면 내용은 읽지 않는다.
 */

import { actionsFor, getShortcut } from '../../js/feature-settings.js';

const ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M12 4v16"/></svg>`;

const TAURI = !!(window.__TAURI__ && window.__TAURI__.core);
const C = TAURI ? window.__TAURI__.core : null;

const PRESETS = [
  { id: 'left', label: '왼쪽 절반', glyph: '◧' },
  { id: 'right', label: '오른쪽 절반', glyph: '◨' },
  { id: 'top', label: '위쪽 절반', glyph: '⬒' },
  { id: 'bottom', label: '아래쪽 절반', glyph: '⬓' },
  { id: 'max', label: '최대화', glyph: '⛶' },
  { id: 'center', label: '가운데 70%', glyph: '❐' },
];

const module = {
  id: 'window-snap',
  name: '창 분할',
  shortName: '창 분할',
  kind: 'tool',
  category: 'utility',
  version: '1.14.0',
  subtitle: '앞 창을 반쪽, 최대, 가운데로',
  description: '단축키 한 번으로 지금 쓰는 창을 화면 절반이나 가운데로 옮깁니다. 손쉬운 사용 권한이 필요합니다.',
  icon: ICON,
  badge: 'Mac',
  macOnly: true,
  defaultEnabled: true,
  defaultPinned: false,

  mount(root, ctx) {
    const controller = new AbortController();
    const { signal } = controller;
    const toast = ctx?.toast || (() => {});

    const actions = actionsFor('window-snap');
    const grid = PRESETS.map((preset) => {
      const shortcut = getShortcut(`snap:${preset.id}`);
      return `
        <button class="snap-btn" type="button" data-preset="${preset.id}">
          <span class="snap-glyph" aria-hidden="true">${preset.glyph}</span>
          <span class="snap-label">${preset.label}</span>
          <span class="snap-key">${shortcut ? escapeHtml(shortcut) : '단축키 없음'}</span>
        </button>`;
    }).join('');

    root.innerHTML = `
      <div class="v16 snap">
        <div class="snap-grid">${grid}</div>
        <p class="v16-note" id="snap-note">먼저 옮길 창을 클릭해 앞으로 가져온 뒤 아래 버튼을 누르세요.</p>
        <div class="v16-actions">
          <button class="v16-btn" type="button" id="snap-perm">손쉬운 사용 설정 열기</button>
          <button class="v16-btn" type="button" id="snap-settings">단축키 설정</button>
        </div>
        <div class="v16-status" id="snap-status" hidden></div>
      </div>`;

    const statusEl = root.querySelector('#snap-status');
    const noteEl = root.querySelector('#snap-note');

    function setStatus(text, bad) {
      statusEl.hidden = !text;
      statusEl.className = `v16-status${bad ? ' bad' : ''}`;
      statusEl.textContent = text || '';
    }

    if (!TAURI) {
      noteEl.textContent = '창 분할은 Mac 앱에서만 쓸 수 있습니다.';
      root.querySelectorAll('.snap-btn').forEach((btn) => { btn.disabled = true; });
      return () => controller.abort();
    }

    async function apply(preset) {
      setStatus('');
      try {
        await C.invoke('snap_active_window', { preset });
        setStatus('창을 옮겼습니다.');
        setTimeout(() => setStatus(''), 1600);
      } catch (error) {
        const message = typeof error === 'string' ? error : (error && error.message) || '';
        if (message.includes('[permission]')) {
          setStatus('손쉬운 사용 권한이 필요합니다. 아래 [손쉬운 사용 설정 열기]로 TIP 을 켜 주세요.', true);
        } else {
          setStatus(message || '창을 옮기지 못했습니다.', true);
        }
      }
    }

    root.querySelectorAll('.snap-btn').forEach((button) => {
      button.addEventListener('click', () => apply(button.dataset.preset), { signal });
    });

    root.querySelector('#snap-perm').addEventListener('click', () => {
      C.invoke('open_privacy_settings', { kind: 'accessibility' })
        .then(() => toast('시스템 설정의 손쉬운 사용 항목을 열었습니다'))
        .catch(() => toast('시스템 설정을 열지 못했습니다'));
    }, { signal });

    root.querySelector('#snap-settings').addEventListener('click', () => {
      if (ctx?.openSettings) ctx.openSettings('window-snap');
      else toast('설정 → 모듈 → 창 분할 에서 단축키를 정할 수 있습니다');
    }, { signal });

    // 권한 상태를 미리 알려 준다.
    C.invoke('accessibility_trusted').then((trusted) => {
      if (!trusted) {
        setStatus('아직 손쉬운 사용 권한이 없습니다. 버튼을 누르면 macOS 가 물어보거나 시스템 설정으로 안내합니다.', true);
      } else {
        noteEl.textContent = `앞 창을 옮깁니다, 단축키 ${actions.length}개를 설정에서 정할 수 있습니다.`;
      }
    }).catch(() => {});

    return () => controller.abort();
  },
};

function escapeHtml(text) {
  return String(text ?? '').replace(/[&<>"']/g, (ch) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
  ));
}

export default module;
