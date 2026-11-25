/**
 * TIP · 개발자 툴팩 (dev-tools)
 * JSON 정렬·압축·검증 / Base64·URL 인코딩 / JWT 디코드 / 타임스탬프 / UUID —
 * 전부 브라우저(기기) 안에서만 처리한다. 네트워크로 아무것도 보내지 않는다.
 */

import { formatBytes } from '../../js/ui.js';

const ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M8 4L3 12l5 8M16 4l5 8-5 8M13.5 5.5l-3 13"/></svg>`;

const TABS = [
  { id: 'json', label: 'JSON' },
  { id: 'codec', label: 'Base64, URL' },
  { id: 'jwt', label: 'JWT' },
  { id: 'time', label: '타임스탬프' },
  { id: 'uuid', label: 'UUID' },
  // v1.16.0 — 비밀번호 생성, 파일 해시, 이름 표기 변환
  { id: 'pass', label: '비밀번호' },
  { id: 'hash', label: '파일 해시' },
  { id: 'case', label: '이름 표기' },
];

const KST_OFFSET = 9 * 60 * 60 * 1000; // 한국은 서머타임이 없어 고정 +9시간으로 정확하다
const pad2 = (n) => String(n).padStart(2, '0');

/* ------------------------------- helpers ------------------------------- */

function kstString(ms) {
  const d = new Date(ms + KST_OFFSET);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())} ` +
    `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}`;
}

function isoString(ms) {
  try {
    return new Date(ms).toISOString();
  } catch {
    return '범위를 벗어난 시각';
  }
}

function b64encode(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function b64decode(text) {
  const clean = String(text).replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');
  const padded = clean + '='.repeat((4 - (clean.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder('utf-8').decode(bytes);
}

function jsonPositionNote(text, message) {
  let pos = null;
  let clean = message;
  const located = /position (\d+)/i.exec(message);
  if (located) {
    pos = Math.min(Number(located[1]), text.length);
    clean = message.replace(/\s*in JSON at position[\s\S]*$/i, '');
  } else {
    // 최신 V8은 위치 대신 문제 구간을 보여 준다: Unexpected token '}', "{"a":}" is not valid JSON
    const snippet = /"((?:[^"\\]|\\.)*)"\s+is not valid JSON\s*$/i.exec(message);
    if (snippet) {
      const raw = snippet[1].replace(/\\"/g, '"');
      const index = text.indexOf(raw);
      if (index >= 0) pos = Math.min(index + raw.length, text.length);
      clean = message.slice(0, snippet.index).replace(/,\s*$/, '');
    }
  }
  if (pos === null) return clean;
  const before = text.slice(0, pos);
  const line = before.split('\n').length;
  const col = pos - before.lastIndexOf('\n');
  return `${clean} (${line}번째 줄 ${col}번째 글자 부근)`;
}

function describeJson(value) {
  if (Array.isArray(value)) return `배열, 항목 ${value.length.toLocaleString()}개`;
  if (value === null) return 'null';
  if (typeof value === 'object') return `객체, 키 ${Object.keys(value).length.toLocaleString()}개`;
  if (typeof value === 'string') return `문자열, ${value.length.toLocaleString()}자`;
  return `${typeof value}, ${String(value)}`;
}

function bytesOf(text) {
  return new TextEncoder().encode(text).length;
}

function uuid4() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const hex = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

async function copyText(text) {
  if (!text) return false;
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand('copy');
      area.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

/* ------------------------------ MD5 (파일 해시용) ------------------------------ */
// 브라우저 crypto.subtle 에는 MD5 가 없다. 파일 해시를 기기 안에서 계산하려고 여기 둔다.

function md5Hex(bytes) {
  const shift = [
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
    5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
    4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
    6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
  ];
  const K = new Uint32Array(64);
  for (let i = 0; i < 64; i += 1) {
    K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296) >>> 0;
  }
  const length = bytes.length;
  const padded = (((length + 8) >> 6) + 1) * 64;
  const buffer = new Uint8Array(padded);
  buffer.set(bytes);
  buffer[length] = 0x80;
  const view = new DataView(buffer.buffer);
  const bits = length * 8;
  view.setUint32(padded - 8, bits >>> 0, true);
  view.setUint32(padded - 4, Math.floor(bits / 4294967296), true);

  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;
  const M = new Uint32Array(16);

  for (let offset = 0; offset < padded; offset += 64) {
    for (let i = 0; i < 16; i += 1) M[i] = view.getUint32(offset + i * 4, true);
    let A = a0;
    let B = b0;
    let C = c0;
    let D = d0;
    for (let i = 0; i < 64; i += 1) {
      let F;
      let g;
      if (i < 16) { F = (B & C) | (~B & D); g = i; }
      else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) % 16; }
      else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) % 16; }
      else { F = C ^ (B | ~D); g = (7 * i) % 16; }
      F = (F + A + K[i] + M[g]) >>> 0;
      A = D;
      D = C;
      C = B;
      const rotate = shift[i];
      B = (B + ((F << rotate) | (F >>> (32 - rotate)))) >>> 0;
    }
    a0 = (a0 + A) >>> 0;
    b0 = (b0 + B) >>> 0;
    c0 = (c0 + C) >>> 0;
    d0 = (d0 + D) >>> 0;
  }

  const out = new DataView(new ArrayBuffer(16));
  out.setUint32(0, a0, true);
  out.setUint32(4, b0, true);
  out.setUint32(8, c0, true);
  out.setUint32(12, d0, true);
  return [...new Uint8Array(out.buffer)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** 파일 이름 → 표기별 이름 (camelCase · snake_case · kebab-case · PascalCase). */
export function nameCases(input) {
  const raw = String(input || '').trim();
  if (!raw) return { camel: '', snake: '', kebab: '', pascal: '' };
  const words = raw
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[^A-Za-z0-9가-힣]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.toLowerCase());
  const upperFirst = (word) => word.charAt(0).toUpperCase() + word.slice(1);
  return {
    camel: words.map((word, index) => (index === 0 ? word : upperFirst(word))).join(''),
    snake: words.join('_'),
    kebab: words.join('-'),
    pascal: words.map(upperFirst).join(''),
  };
}

/* -------------------------------- module ------------------------------- */

const module = {
  id: 'dev-tools',
  name: '개발자 툴팩',
  kind: 'tool',
  category: 'dev',
  version: '1.0.0',
  subtitle: 'JSON, Base64, JWT, 시각, UUID',
  description: 'JSON 을 정리하거나 검사하고, Base64 와 URL 인코딩, JWT 풀기, 타임스탬프 변환, UUID 만들기를 한 화면에서 합니다.',
  icon: ICON,
  defaultEnabled: true,
  defaultPinned: false,

  mount(root, ctx) {
    const controller = new AbortController();
    const { signal } = controller;
    const toast = ctx?.toast || (() => {});

    root.innerHTML = `
      <div class="v16 dv">
        <div class="v16-tabs" role="tablist" aria-label="도구 선택" id="dv-tabs"></div>

        <section class="v16-panel" id="dv-p-json" role="tabpanel" aria-label="JSON">
          <div class="v16-field">
            <label class="v16-label" for="dv-json-in">입력</label>
            <textarea class="v16-ta" id="dv-json-in" rows="7" spellcheck="false"
                      placeholder='{"name":"TIP","items":[3,1,2]}'></textarea>
          </div>
          <div class="v16-actions">
            <button class="v16-btn" type="button" id="dv-json-indent2">정렬 2칸</button>
            <button class="v16-btn" type="button" id="dv-json-indent4">정렬 4칸</button>
            <button class="v16-btn" type="button" id="dv-json-min">압축</button>
            <button class="v16-btn" type="button" id="dv-json-check">검증</button>
            <button class="v16-btn" type="button" id="dv-json-copy">결과 복사</button>
            <button class="v16-btn" type="button" id="dv-json-clear">지우기</button>
          </div>
          <div class="v16-status" id="dv-json-status" hidden></div>
          <div class="v16-field">
            <label class="v16-label" for="dv-json-out">결과</label>
            <textarea class="v16-ta" id="dv-json-out" rows="9" spellcheck="false" readonly
                      placeholder="정렬하거나 압축한 결과가 여기에 나옵니다"></textarea>
          </div>
        </section>

        <section class="v16-panel" id="dv-p-codec" role="tabpanel" aria-label="Base64, URL" hidden>
          <div class="v16-field">
            <label class="v16-label" for="dv-codec-in">입력 (UTF-8)</label>
            <textarea class="v16-ta" id="dv-codec-in" rows="5" spellcheck="false"
                      placeholder="한글이나 이모지도 깨지지 않게 변환합니다"></textarea>
          </div>
          <div class="v16-actions">
            <button class="v16-btn" type="button" id="dv-codec-b64e">Base64 인코딩</button>
            <button class="v16-btn" type="button" id="dv-codec-b64d">Base64 디코딩</button>
            <button class="v16-btn" type="button" id="dv-codec-urle">URL 인코딩</button>
            <button class="v16-btn" type="button" id="dv-codec-urld">URL 디코딩</button>
          </div>
          <div class="v16-status" id="dv-codec-status" hidden></div>
          <div class="v16-field">
            <label class="v16-label" for="dv-codec-out">결과</label>
            <textarea class="v16-ta" id="dv-codec-out" rows="5" spellcheck="false" readonly
                      placeholder="변환 결과"></textarea>
          </div>
          <div class="v16-actions">
            <button class="v16-btn" type="button" id="dv-codec-copy">결과 복사</button>
            <button class="v16-btn" type="button" id="dv-codec-swap">결과를 입력으로</button>
          </div>
        </section>

        <section class="v16-panel" id="dv-p-jwt" role="tabpanel" aria-label="JWT" hidden>
          <div class="v16-field">
            <label class="v16-label" for="dv-jwt-in">JWT</label>
            <textarea class="v16-ta" id="dv-jwt-in" rows="4" spellcheck="false"
                      placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxIn0.signature"></textarea>
          </div>
          <p class="v16-note">서명(Signature)은 검증하지 않고 디코드만 합니다. 값은 기기 밖으로 나가지 않습니다.</p>
          <div id="dv-jwt-out"></div>
        </section>

        <section class="v16-panel" id="dv-p-time" role="tabpanel" aria-label="타임스탬프" hidden>
          <div class="v16-field">
            <label class="v16-label" for="dv-ts-in">Unix 타임스탬프 (초 또는 밀리초)</label>
            <input class="pt-input v16-input" id="dv-ts-in" inputmode="numeric" autocomplete="off"
                   placeholder="1700000000 또는 1700000000000">
          </div>
          <div class="v16-actions">
            <button class="v16-btn primary" type="button" id="dv-ts-run">변환</button>
            <button class="v16-btn" type="button" id="dv-ts-now">현재 시각</button>
          </div>
          <div class="v16-status" id="dv-ts-status" hidden></div>
          <div class="v16-kv" id="dv-ts-rows"></div>

          <div class="v16-field v16-sep">
            <label class="v16-label" for="dv-ts-date">날짜, 시각 → 타임스탬프 (한국 시간 기준)</label>
            <div class="v16-actions">
              <input class="pt-input v16-input" type="datetime-local" id="dv-ts-date">
              <button class="v16-btn" type="button" id="dv-ts-from-date">변환</button>
            </div>
          </div>
          <div class="v16-status" id="dv-ts-from-status" hidden></div>
        </section>

        <section class="v16-panel" id="dv-p-pass" role="tabpanel" aria-label="비밀번호" hidden>
          <div class="v16-field">
            <label class="v16-label" for="dv-pass-len">길이 (8~64)</label>
            <input class="pt-input v16-input" id="dv-pass-len" type="number" inputmode="numeric" min="8" max="64" step="1" value="16">
          </div>
          <div class="v16-actions dv-pass-opts">
            <label class="dv-check"><input type="checkbox" id="dv-pass-upper" checked> 대문자</label>
            <label class="dv-check"><input type="checkbox" id="dv-pass-lower" checked> 소문자</label>
            <label class="dv-check"><input type="checkbox" id="dv-pass-digit" checked> 숫자</label>
            <label class="dv-check"><input type="checkbox" id="dv-pass-symbol" checked> 기호</label>
            <label class="dv-check"><input type="checkbox" id="dv-pass-avoid"> 헷갈리는 글자 빼기 (O0Il1)</label>
          </div>
          <div class="v16-actions">
            <button class="v16-btn primary" type="button" id="dv-pass-run">만들기</button>
            <button class="v16-btn" type="button" id="dv-pass-copy">복사</button>
          </div>
          <div class="v16-field">
            <label class="v16-label" for="dv-pass-out">만든 비밀번호</label>
            <input class="pt-input v16-input mono" id="dv-pass-out" readonly autocomplete="off" spellcheck="false">
          </div>
          <p class="v16-note">crypto.getRandomValues 로 기기 안에서 만듭니다. 고른 글자 종류가 각각 하나 이상 들어갑니다.</p>
        </section>

        <section class="v16-panel" id="dv-p-hash" role="tabpanel" aria-label="파일 해시" hidden>
          <div class="dr-empty">
            <div class="dz-icon">${ICON}</div>
            <button class="primary-btn" type="button" id="dv-hash-browse">파일 선택</button>
            <p>파일을 고르면 SHA-256, SHA-1, MD5 를 기기 안에서 계산합니다.</p>
          </div>
          <input type="file" id="dv-hash-input" class="sr-only">
          <div class="v16-status" id="dv-hash-status" hidden></div>
          <div class="v16-kv" id="dv-hash-rows"></div>
          <p class="v16-note">해시는 파일 지문입니다. 받은 파일이 원본과 같은지 확인할 때 씁니다.</p>
        </section>

        <section class="v16-panel" id="dv-p-case" role="tabpanel" aria-label="이름 표기" hidden>
          <div class="v16-field">
            <label class="v16-label" for="dv-case-in">이름</label>
            <input class="pt-input v16-input" id="dv-case-in" placeholder="my file name 이나 myFileName" autocomplete="off">
          </div>
          <div class="v16-kv" id="dv-case-rows"></div>
          <p class="v16-note">띄어쓰기, 하이픈, 밑줄, 낙타 표기를 모두 낱말로 나눠 다시 붙입니다.</p>
        </section>

        <section class="v16-panel" id="dv-p-uuid" role="tabpanel" aria-label="UUID" hidden>
          <div class="v16-actions">
            <button class="v16-btn primary" type="button" id="dv-uuid-1">1개 생성</button>
            <button class="v16-btn" type="button" id="dv-uuid-5">5개 생성</button>
            <button class="v16-btn" type="button" id="dv-uuid-10">10개 생성</button>
            <button class="v16-btn" type="button" id="dv-uuid-copy">복사</button>
          </div>
          <div class="v16-out" id="dv-uuid-out" aria-live="polite">위 버튼을 누르면 UUID v4가 만들어집니다.</div>
        </section>
      </div>`;

    /* ------------------------------ tabs ------------------------------ */

    const tabBar = root.querySelector('#dv-tabs');
    const panels = new Map(TABS.map((tab) => [tab.id, root.querySelector(`#dv-p-${tab.id}`)]));

    function selectTab(id) {
      TABS.forEach((tab) => {
        const button = tabBar.querySelector(`[data-tab="${tab.id}"]`);
        const selected = tab.id === id;
        button.setAttribute('aria-selected', String(selected));
        button.tabIndex = selected ? 0 : -1;
        const panel = panels.get(tab.id);
        panel.hidden = !selected;
      });
      if (id === 'time' && !root.querySelector('#dv-ts-rows').childElementCount) {
        setNow();
      }
      // v1.16.0 — 이름 표기는 탭을 열 때 지금 값으로 한 번 그린다.
      if (id === 'case') renderCases();
    }

    TABS.forEach((tab) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'v16-tab';
      button.dataset.tab = tab.id;
      button.textContent = tab.label;
      button.setAttribute('role', 'tab');
      button.setAttribute('aria-selected', String(tab.id === TABS[0].id));
      button.tabIndex = tab.id === TABS[0].id ? 0 : -1;
      button.addEventListener('click', () => selectTab(tab.id), { signal });
      button.addEventListener('keydown', (event) => {
        if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
        event.preventDefault();
        const index = TABS.findIndex((t) => t.id === tab.id);
        const next = TABS[(index + (event.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length];
        selectTab(next.id);
        tabBar.querySelector(`[data-tab="${next.id}"]`).focus();
      }, { signal });
      tabBar.appendChild(button);
    });

    /* ------------------------------- JSON ------------------------------- */

    const jsonIn = root.querySelector('#dv-json-in');
    const jsonOut = root.querySelector('#dv-json-out');
    const jsonStatus = root.querySelector('#dv-json-status');

    function setJsonStatus(kind, text) {
      jsonStatus.hidden = !text;
      jsonStatus.className = `v16-status${kind ? ` ${kind}` : ''}`;
      jsonStatus.textContent = text || '';
    }

    function jsonTransform(mode) {
      const text = jsonIn.value.trim();
      if (!text) {
        jsonOut.value = '';
        setJsonStatus('warn', '입력이 비어 있습니다.');
        return;
      }
      try {
        const value = JSON.parse(text);
        const result = mode === 'min'
          ? JSON.stringify(value)
          : JSON.stringify(value, null, mode === 'indent4' ? 4 : 2);
        jsonOut.value = result;
        setJsonStatus('ok', `${describeJson(value)}, ${result.length.toLocaleString()}자, ${formatBytes(bytesOf(result))}`);
      } catch (error) {
        jsonOut.value = '';
        setJsonStatus('bad', `JSON 문법 오류. ${jsonPositionNote(text, error.message)}`);
      }
    }

    root.querySelector('#dv-json-indent2').addEventListener('click', () => jsonTransform('indent2'), { signal });
    root.querySelector('#dv-json-indent4').addEventListener('click', () => jsonTransform('indent4'), { signal });
    root.querySelector('#dv-json-min').addEventListener('click', () => jsonTransform('min'), { signal });
    root.querySelector('#dv-json-check').addEventListener('click', () => {
      const text = jsonIn.value.trim();
      if (!text) {
        setJsonStatus('warn', '검사할 JSON을 입력하세요.');
        return;
      }
      try {
        const value = JSON.parse(text);
        setJsonStatus('ok', `유효한 JSON 입니다. ${describeJson(value)}, ${formatBytes(bytesOf(text))}`);
      } catch (error) {
        setJsonStatus('bad', `JSON 문법 오류. ${jsonPositionNote(text, error.message)}`);
      }
    }, { signal });
    root.querySelector('#dv-json-copy').addEventListener('click', async () => {
      const target = jsonOut.value || jsonIn.value;
      if (!target) return toast('복사할 내용이 없습니다');
      toast(await copyText(target) ? '복사했습니다' : '복사하지 못했습니다');
    }, { signal });
    root.querySelector('#dv-json-clear').addEventListener('click', () => {
      jsonIn.value = '';
      jsonOut.value = '';
      setJsonStatus('', '');
      jsonIn.focus();
    }, { signal });

    /* --------------------------- Base64 · URL --------------------------- */

    const codecIn = root.querySelector('#dv-codec-in');
    const codecOut = root.querySelector('#dv-codec-out');
    const codecStatus = root.querySelector('#dv-codec-status');

    function setCodecStatus(kind, text) {
      codecStatus.hidden = !text;
      codecStatus.className = `v16-status${kind ? ` ${kind}` : ''}`;
      codecStatus.textContent = text || '';
    }

    function codecRun(mode) {
      const text = codecIn.value;
      if (!text) {
        codecOut.value = '';
        setCodecStatus('warn', '입력이 비어 있습니다.');
        return;
      }
      try {
        let result;
        if (mode === 'b64e') result = b64encode(text);
        else if (mode === 'b64d') result = b64decode(text);
        else if (mode === 'urle') result = encodeURIComponent(text);
        else result = decodeURIComponent(text);
        codecOut.value = result;
        setCodecStatus('ok', `${codecIn.value.length.toLocaleString()}자 → ${result.length.toLocaleString()}자`);
      } catch (error) {
        codecOut.value = '';
        const label = mode === 'b64d' ? 'Base64' : mode === 'urld' ? 'URL 인코딩' : '';
        setCodecStatus('bad', `${label} 형식이 올바르지 않습니다. ${error.message}`);
      }
    }

    [['#dv-codec-b64e', 'b64e'], ['#dv-codec-b64d', 'b64d'], ['#dv-codec-urle', 'urle'], ['#dv-codec-urld', 'urld']]
      .forEach(([selector, mode]) => {
        root.querySelector(selector).addEventListener('click', () => codecRun(mode), { signal });
      });

    root.querySelector('#dv-codec-copy').addEventListener('click', async () => {
      if (!codecOut.value) return toast('복사할 결과가 없습니다');
      toast(await copyText(codecOut.value) ? '복사했습니다' : '복사하지 못했습니다');
    }, { signal });

    root.querySelector('#dv-codec-swap').addEventListener('click', () => {
      if (!codecOut.value) return toast('결과가 없습니다');
      codecIn.value = codecOut.value;
      codecOut.value = '';
      setCodecStatus('', '');
    }, { signal });

    /* -------------------------------- JWT ------------------------------- */

    const jwtIn = root.querySelector('#dv-jwt-in');
    const jwtOut = root.querySelector('#dv-jwt-out');

    function b64urlToText(part) {
      const clean = part.replace(/-/g, '+').replace(/_/g, '/');
      const padded = clean + '='.repeat((4 - (clean.length % 4)) % 4);
      const binary = atob(padded);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
      return new TextDecoder('utf-8').decode(bytes);
    }

    function claimRow(name, seconds) {
      if (typeof seconds !== 'number' || !Number.isFinite(seconds)) return '';
      const ms = seconds * 1000;
      let tail = '';
      if (name === 'exp') {
        const diff = ms - Date.now();
        tail = diff >= 0 ? `, 만료까지 ${humanDuration(diff)}` : `, 만료됨 (${humanDuration(-diff)} 전)`;
      }
      return `<div class="v16-kv-row"><span class="v16-k">${name.toUpperCase()}</span>
        <span class="v16-v mono">${kstString(ms)} KST${tail}</span></div>`;
    }

    function humanDuration(ms) {
      const minutes = Math.floor(ms / 60000);
      if (minutes < 60) return `${Math.max(1, minutes)}분`;
      const hours = Math.floor(minutes / 60);
      if (hours < 24) return `${hours}시간 ${minutes % 60}분`;
      return `${Math.floor(hours / 24)}일 ${hours % 24}시간`;
    }

    function decodeJwt() {
      const raw = jwtIn.value.trim();
      jwtOut.innerHTML = '';
      if (!raw) return;
      const parts = raw.split('.');
      if (parts.length !== 3) {
        jwtOut.innerHTML = `<div class="v16-status bad">JWT 형식이 아닙니다. 점(.)으로 나뉜 3부분이어야 합니다. (${parts.length}부분)</div>`;
        return;
      }
      let header;
      let payload;
      try {
        header = JSON.parse(b64urlToText(parts[0]));
      } catch {
        header = null;
      }
      try {
        payload = JSON.parse(b64urlToText(parts[1]));
      } catch {
        payload = null;
      }
      if (!header || !payload) {
        jwtOut.innerHTML = `<div class="v16-status bad">Header 또는 Payload를 해석하지 못했습니다. 잘린 토큰인지 확인하세요.</div>`;
        return;
      }

      const claims = ['iat', 'nbf', 'exp'].map((key) => claimRow(key, payload[key])).join('');
      const signatureLength = (parts[2] || '').length;

      jwtOut.innerHTML = `
        <div class="v16-block">
          <div class="v16-block-head"><span>Header</span><button class="v16-mini" type="button" data-copy-json="header">복사</button></div>
          <pre class="v16-out" id="dv-jwt-header">${escapeText(JSON.stringify(header, null, 2))}</pre>
        </div>
        <div class="v16-block">
          <div class="v16-block-head"><span>Payload</span><button class="v16-mini" type="button" data-copy-json="payload">복사</button></div>
          <pre class="v16-out" id="dv-jwt-payload">${escapeText(JSON.stringify(payload, null, 2))}</pre>
        </div>
        ${claims ? `<div class="v16-kv">${claims}</div>` : ''}
        <div class="v16-block">
          <div class="v16-block-head"><span>Signature</span></div>
          <div class="v16-out mono">${escapeText(parts[2] || '(없음)')}</div>
          <p class="v16-note">${signatureLength.toLocaleString()}자, 서명은 검증하지 않습니다.</p>
        </div>`;

      jwtOut.querySelectorAll('[data-copy-json]').forEach((button) => {
        button.addEventListener('click', async () => {
          const which = button.dataset.copyJson === 'header' ? header : payload;
          toast(await copyText(JSON.stringify(which, null, 2)) ? '복사했습니다' : '복사하지 못했습니다');
        }, { signal });
      });
    }

    jwtIn.addEventListener('input', () => {
      clearTimeout(decodeJwt.timer);
      decodeJwt.timer = setTimeout(decodeJwt, 220);
    }, { signal });

    /* ---------------------------- 타임스탬프 ---------------------------- */

    const tsIn = root.querySelector('#dv-ts-in');
    const tsRows = root.querySelector('#dv-ts-rows');
    const tsStatus = root.querySelector('#dv-ts-status');
    const tsDate = root.querySelector('#dv-ts-date');
    const tsFromStatus = root.querySelector('#dv-ts-from-status');

    function toMs(value) {
      const digits = String(value).replace(/[^\d]/g, '');
      const number = Number(digits);
      if (!digits || !Number.isFinite(number)) return null;
      return digits.length >= 13 ? number : number * 1000;
    }

    function renderTs(ms, source) {
      const rows = [
        ['한국 시간', `${kstString(ms)} KST`],
        ['ISO 8601', isoString(ms)],
        ['Unix (초)', String(Math.floor(ms / 1000))],
        ['Unix (밀리초)', String(ms)],
      ];
      tsRows.innerHTML = rows.map(([label, value]) => `
        <div class="v16-kv-row">
          <span class="v16-k">${label}</span>
          <span class="v16-v mono" data-value="${escapeText(value)}">${escapeText(value)}</span>
          <button class="v16-mini" type="button" data-copy-row="${escapeText(value)}">복사</button>
        </div>`).join('');
      tsRows.querySelectorAll('[data-copy-row]').forEach((button) => {
        button.addEventListener('click', async () => {
          toast(await copyText(button.dataset.copyRow) ? '복사했습니다' : '복사하지 못했습니다');
        }, { signal });
      });
      tsStatus.hidden = false;
      tsStatus.className = 'v16-status ok';
      tsStatus.textContent = source;
    }

    function tsRun() {
      const ms = toMs(tsIn.value);
      if (ms === null) {
        tsStatus.hidden = false;
        tsStatus.className = 'v16-status warn';
        tsStatus.textContent = '변환할 숫자를 입력하세요 (10자리 초, 13자리 밀리초).';
        tsRows.innerHTML = '';
        return;
      }
      const digits = String(tsIn.value).replace(/[^\d]/g, '');
      renderTs(ms, digits.length >= 13 ? '밀리초로 읽었습니다.' : '초로 읽었습니다.');
    }

    function setNow() {
      const now = Date.now();
      tsIn.value = String(Math.floor(now / 1000));
      renderTs(now, '현재 시각입니다.');
    }

    root.querySelector('#dv-ts-run').addEventListener('click', tsRun, { signal });
    root.querySelector('#dv-ts-now').addEventListener('click', setNow, { signal });
    tsIn.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') tsRun();
    }, { signal });

    root.querySelector('#dv-ts-from-date').addEventListener('click', () => {
      const raw = tsDate.value;
      if (!raw) {
        tsFromStatus.hidden = false;
        tsFromStatus.className = 'v16-status warn';
        tsFromStatus.textContent = '날짜와 시각을 고르세요.';
        return;
      }
      const [datePart, timePart = '00:00'] = raw.split('T');
      const [y, mo, d] = datePart.split('-').map(Number);
      const [h, mi] = timePart.split(':').map(Number);
      const ms = Date.UTC(y, mo - 1, d, h, mi) - KST_OFFSET;
      tsIn.value = String(Math.floor(ms / 1000));
      renderTs(ms, `${kstString(ms)} KST → Unix 변환`);
      tsFromStatus.hidden = true;
    }, { signal });

    /* -------------------------------- UUID ------------------------------- */

    const uuidOut = root.querySelector('#dv-uuid-out');
    let uuidValues = [];

    function makeUuids(count) {
      uuidValues = Array.from({ length: count }, uuid4);
      uuidOut.textContent = uuidValues.join('\n');
      uuidOut.classList.add('mono');
    }

    root.querySelector('#dv-uuid-1').addEventListener('click', () => makeUuids(1), { signal });
    root.querySelector('#dv-uuid-5').addEventListener('click', () => makeUuids(5), { signal });
    root.querySelector('#dv-uuid-10').addEventListener('click', () => makeUuids(10), { signal });
    root.querySelector('#dv-uuid-copy').addEventListener('click', async () => {
      if (!uuidValues.length) return toast('먼저 UUID를 생성하세요');
      toast(await copyText(uuidValues.join('\n')) ? `${uuidValues.length}개 복사했습니다` : '복사하지 못했습니다');
    }, { signal });


    /* ---------------------------- 비밀번호 ---------------------------- */

    const passOut = root.querySelector('#dv-pass-out');
    const passLen = root.querySelector('#dv-pass-len');

    function randomIndex(max) {
      const limit = Math.floor(0x100000000 / max) * max;
      const buffer = new Uint32Array(1);
      let value = 0;
      do {
        crypto.getRandomValues(buffer);
        value = buffer[0];
      } while (value >= limit);
      return value % max;
    }

    function makePassword() {
      const length = Math.max(8, Math.min(64, Math.floor(Number(passLen.value) || 16)));
      passLen.value = String(length);
      const avoid = root.querySelector('#dv-pass-avoid').checked;
      const sets = [];
      const add = (on, chars) => {
        if (!on) return;
        let value = chars;
        if (avoid) value = value.replace(/[O0Il1]/g, '');
        if (value) sets.push([...value]);
      };
      add(root.querySelector('#dv-pass-upper').checked, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ');
      add(root.querySelector('#dv-pass-lower').checked, 'abcdefghijklmnopqrstuvwxyz');
      add(root.querySelector('#dv-pass-digit').checked, '0123456789');
      add(root.querySelector('#dv-pass-symbol').checked, '!@#$%^&*()-_=+[]{};:,.?/');
      if (!sets.length) {
        toast('글자 종류를 하나 이상 골라 주세요');
        passOut.value = '';
        return;
      }
      if (length < sets.length) {
        toast(`길이는 고른 글자 종류(${sets.length})보다 길어야 합니다`);
        return;
      }
      const pool = sets.flat();
      const chars = sets.map((set) => set[randomIndex(set.length)]);
      while (chars.length < length) chars.push(pool[randomIndex(pool.length)]);
      for (let i = chars.length - 1; i > 0; i -= 1) {
        const j = randomIndex(i + 1);
        [chars[i], chars[j]] = [chars[j], chars[i]];
      }
      passOut.value = chars.join('');
    }

    root.querySelector('#dv-pass-run').addEventListener('click', makePassword, { signal });
    root.querySelector('#dv-pass-copy').addEventListener('click', async () => {
      if (!passOut.value) return toast('먼저 비밀번호를 만드세요');
      toast(await copyText(passOut.value) ? '복사했습니다' : '복사하지 못했습니다');
    }, { signal });

    /* ---------------------------- 파일 해시 ---------------------------- */

    const hashInput = root.querySelector('#dv-hash-input');
    const hashRows = root.querySelector('#dv-hash-rows');
    const hashStatus = root.querySelector('#dv-hash-status');

    function setHashStatus(kind, text) {
      hashStatus.hidden = !text;
      hashStatus.className = `v16-status${kind ? ` ${kind}` : ''}`;
      hashStatus.textContent = text || '';
    }

    async function hexOf(kind, buffer) {
      if (kind === 'MD5') return md5Hex(new Uint8Array(buffer));
      const digest = await crypto.subtle.digest(kind, buffer);
      return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
    }

    async function hashFile(file) {
      if (!file) return;
      setHashStatus('warn', `${file.name} 계산 중…`);
      hashRows.innerHTML = '';
      try {
        const buffer = await file.arrayBuffer();
        const rows = [];
        for (const kind of ['SHA-256', 'SHA-1', 'MD5']) {
          rows.push([kind, await hexOf(kind, buffer)]);
        }
        hashRows.innerHTML = rows.map(([label, value]) => `
          <div class="v16-kv-row">
            <span class="v16-k">${label}</span>
            <span class="v16-v mono" data-value="${escapeText(value)}">${escapeText(value)}</span>
            <button class="v16-mini" type="button" data-copy-row="${escapeText(value)}">복사</button>
          </div>`).join('') + `
          <div class="v16-kv-row">
            <span class="v16-k">크기</span>
            <span class="v16-v">${formatBytes(buffer.byteLength)}</span>
          </div>`;
        hashRows.querySelectorAll('[data-copy-row]').forEach((button) => {
          button.addEventListener('click', async () => {
            toast(await copyText(button.dataset.copyRow) ? '복사했습니다' : '복사하지 못했습니다');
          }, { signal });
        });
        setHashStatus('ok', `${file.name} 해시를 계산했습니다`);
      } catch (error) {
        console.error('[TIP dev-tools]', error);
        setHashStatus('bad', '파일을 읽지 못했습니다');
      }
    }

    root.querySelector('#dv-hash-browse').addEventListener('click', () => hashInput.click(), { signal });
    hashInput.addEventListener('change', () => {
      const file = hashInput.files && hashInput.files[0];
      hashInput.value = '';
      hashFile(file);
    }, { signal });

    /* ---------------------------- 이름 표기 ---------------------------- */

    const caseIn = root.querySelector('#dv-case-in');
    const caseRows = root.querySelector('#dv-case-rows');

    function renderCases() {
      const result = nameCases(caseIn.value);
      const labels = [
        ['camelCase', result.camel],
        ['snake_case', result.snake],
        ['kebab-case', result.kebab],
        ['PascalCase', result.pascal],
      ];
      caseRows.innerHTML = labels.map(([label, value]) => `
        <div class="v16-kv-row">
          <span class="v16-k">${label}</span>
          <span class="v16-v mono" data-value="${escapeText(value)}">${escapeText(value)}</span>
          <button class="v16-mini" type="button" data-copy-row="${escapeText(value)}">복사</button>
        </div>`).join('');
      caseRows.querySelectorAll('[data-copy-row]').forEach((button) => {
        button.addEventListener('click', async () => {
          if (!button.dataset.copyRow) return;
          toast(await copyText(button.dataset.copyRow) ? '복사했습니다' : '복사하지 못했습니다');
        }, { signal });
      });
    }

    caseIn.addEventListener('input', renderCases, { signal });

    /* -------------------------------- init ------------------------------- */


    setNow();

    return () => {
      clearTimeout(decodeJwt.timer);
      controller.abort();
    };
  },
};

function escapeText(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export default module;
