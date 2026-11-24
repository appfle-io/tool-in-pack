/**
 * TIP · 파일 일괄 이름 변경 (bulk-rename, v1.14.0 — 웹 + Mac)
 *
 * 여러 파일의 이름을 한 번에 바꾼다 — 찾기·바꾸기(정규식), 앞·뒤 붙이기, 일련번호, 대소문자.
 * Mac 앱: Finder 에서 끌어다 놓은 파일은 디스크의 이름을 실제로 바꾼다(Rust rename_files).
 * 웹(PWA): 이름만 바꾼 사본을 ZIP 으로 묶어 내려받는다 — 원본은 건드리지 않는다.
 * 어떤 파일 이름도 밖으로 나가지 않는다.
 */

import { formatBytes } from '../../js/ui.js';
import { getFeatureValue } from '../../js/feature-settings.js';

const ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h10M4 12h7M4 17h5"/><path d="M15 15l3 3 4-5"/><path d="M14 4h6v3"/></svg>`;

const TAURI = !!(window.__TAURI__ && window.__TAURI__.core);
const C = TAURI ? window.__TAURI__.core : null;

function splitName(name) {
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return { base: name, ext: '' };
  return { base: name.slice(0, dot), ext: name.slice(dot) };
}

function pad(number, digits) {
  return String(number).padStart(digits, '0');
}

const module = {
  id: 'bulk-rename',
  name: '파일 이름 일괄 변경',
  shortName: '이름 변경',
  kind: 'tool',
  category: 'utility',
  version: '1.14.0',
  subtitle: '찾기·바꾸기 · 일련번호 · ZIP',
  description: '여러 파일 이름을 미리 보며 한 번에 바꿉니다. Mac 앱은 원본 이름을, 웹은 ZIP 사본을 만듭니다.',
  icon: ICON,
  defaultEnabled: true,
  defaultPinned: false,

  mount(root, ctx) {
    const controller = new AbortController();
    const { signal } = controller;
    const toast = ctx?.toast || (() => {});

    /** @type {{key:string, name:string, path:string|null, file:File|null, size:number}[]} */
    let entries = [];
    let busy = false;

    root.innerHTML = `
      <div class="v16 rename">
        <div class="dr-empty" id="rn-drop">
          <div class="dz-icon">${ICON}</div>
          <button class="primary-btn" type="button" id="rn-browse">파일 선택</button>
          <p>${TAURI ? 'Finder 에서 파일을 이 화면으로 끌어다 놓으면 원본 이름이 바뀝니다' : '여러 파일을 고르면 이름만 바꾼 ZIP 을 만들어 드립니다'}</p>
        </div>
        <input type="file" id="rn-input" class="sr-only" multiple>

        <div id="rn-work" hidden>
          <div class="v16-block-head"><span>바꾸기 규칙</span><span class="ocr-count" id="rn-count"></span></div>
          <div class="rn-rules">
            <label class="rn-row"><span>찾기</span><input class="pt-input" id="rn-find" placeholder="예: IMG_" spellcheck="false"></label>
            <label class="rn-row"><span>바꾸기</span><input class="pt-input" id="rn-replace" placeholder="비우면 지웁니다" spellcheck="false"></label>
            <div class="rn-flags">
              <label class="rn-check"><input type="checkbox" id="rn-regex"> 정규식</label>
              <label class="rn-check"><input type="checkbox" id="rn-ignore" checked> 대소문자 무시</label>
            </div>
            <label class="rn-row"><span>앞에 붙이기</span><input class="pt-input" id="rn-prefix" placeholder="예: trip_" spellcheck="false"></label>
            <label class="rn-row"><span>뒤에 붙이기</span><input class="pt-input" id="rn-suffix" placeholder="예: _done" spellcheck="false"></label>
            <label class="rn-row"><span>일련번호</span><input class="pt-input" id="rn-number" placeholder="예: 001  (비우면 없음)" spellcheck="false"></label>
            <label class="rn-row"><span>대소문자</span>
              <select class="pt-input" id="rn-case">
                <option value="none">그대로</option>
                <option value="lower">소문자</option>
                <option value="upper">대문자</option>
              </select>
            </label>
          </div>

          <div class="v16-block-head"><span>미리 보기</span><button class="v16-mini" type="button" id="rn-clear">목록 비우기</button></div>
          <div class="rn-table" id="rn-table" role="table" aria-label="이름 변경 미리 보기"></div>
          <p class="v16-note" id="rn-hint"></p>

          <div class="v16-actions">
            <button class="v16-btn primary" type="button" id="rn-apply">이름 바꾸기</button>
            <button class="v16-btn" type="button" id="rn-zip">ZIP 으로 내려받기</button>
          </div>
          <div class="v16-status" id="rn-status" hidden></div>
        </div>
      </div>`;

    const drop = root.querySelector('#rn-drop');
    const input = root.querySelector('#rn-input');
    const work = root.querySelector('#rn-work');
    const tableEl = root.querySelector('#rn-table');
    const countEl = root.querySelector('#rn-count');
    const hintEl = root.querySelector('#rn-hint');
    const statusEl = root.querySelector('#rn-status');
    const applyBtn = root.querySelector('#rn-apply');
    const zipBtn = root.querySelector('#rn-zip');

    const fields = {
      find: root.querySelector('#rn-find'),
      replace: root.querySelector('#rn-replace'),
      regex: root.querySelector('#rn-regex'),
      ignore: root.querySelector('#rn-ignore'),
      prefix: root.querySelector('#rn-prefix'),
      suffix: root.querySelector('#rn-suffix'),
      number: root.querySelector('#rn-number'),
      case: root.querySelector('#rn-case'),
    };

    // 설정에서 고른 일련번호 자릿수로 시작 값 힌트를 준다.
    const digits = Number(getFeatureValue('rename.pad', '3')) || 3;
    fields.number.placeholder = `예: ${pad(1, digits)}  (비우면 없음)`;

    function setStatus(text, bad) {
      statusEl.hidden = !text;
      statusEl.className = `v16-status${bad ? ' bad' : ''}`;
      statusEl.textContent = text || '';
    }

    function newName(name, index) {
      const { base, ext } = splitName(name);
      let next = base;

      const find = fields.find.value;
      if (find) {
        if (fields.regex.checked) {
          try {
            const pattern = new RegExp(find, fields.ignore.checked ? 'gi' : 'g');
            next = next.replace(pattern, fields.replace.value);
          } catch {
            return { error: '정규식이 올바르지 않습니다' };
          }
        } else if (fields.ignore.checked) {
          const pattern = new RegExp(find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
          next = next.replace(pattern, fields.replace.value);
        } else {
          next = next.split(find).join(fields.replace.value);
        }
      }

      if (fields.case.value === 'lower') next = next.toLowerCase();
      if (fields.case.value === 'upper') next = next.toUpperCase();

      const numberText = fields.number.value.trim();
      if (numberText) {
        // 앞자리에 숫자가 있으면 그 값을 시작 번호로, 자릿수는 그 길이로 본다.
        const match = numberText.match(/(\d+)/);
        const start = match ? Number(match[1]) : 1;
        const width = match ? match[1].length : digits;
        const token = numberText.replace(/\d+/, pad(start + index, width));
        next = `${token}_${next}`;
      }

      const prefix = fields.prefix.value;
      const suffix = fields.suffix.value;
      next = `${prefix}${next}${suffix}`;

      if (!next.trim()) return { error: '이름이 비어 있습니다' };
      return { name: `${next}${ext}` };
    }

    function plan() {
      const used = new Set();
      return entries.map((entry, index) => {
        const result = newName(entry.name, index);
        const name = result.name || entry.name;
        const duplicate = used.has(name.toLowerCase());
        used.add(name.toLowerCase());
        return {
          entry,
          name,
          changed: name !== entry.name,
          error: result.error || (duplicate ? '이름이 겹칩니다' : ''),
        };
      });
    }

    function render() {
      const rows = plan();
      const changed = rows.filter((row) => row.changed && !row.error).length;
      const errors = rows.filter((row) => row.error).length;
      countEl.textContent = `${entries.length}개 · 바뀌는 이름 ${changed}개`;
      tableEl.innerHTML = '';

      rows.forEach((row) => {
        const line = document.createElement('div');
        line.className = `rn-line${row.error ? ' is-bad' : row.changed ? ' is-on' : ''}`;
        const before = document.createElement('span');
        before.className = 'rn-before';
        before.textContent = row.entry.name;
        const after = document.createElement('span');
        after.className = 'rn-after';
        after.textContent = row.error || row.name;
        line.append(before, after);
        tableEl.append(line);
      });

      const nativeCount = entries.filter((entry) => entry.path).length;
      hintEl.textContent = TAURI
        ? nativeCount
          ? `끌어다 놓은 파일 ${nativeCount}개는 디스크의 이름이 실제로 바뀝니다.`
          : 'Finder 에서 파일을 끌어다 놓으면 원본 이름을 바꿀 수 있습니다. 지금 목록은 ZIP 사본으로만 만들 수 있습니다.'
        : '원본은 그대로 두고, 이름을 바꾼 사본을 ZIP 으로 묶어 내려받습니다.';
      applyBtn.disabled = !nativeCount || errors > 0 || busy;
      zipBtn.disabled = !entries.length || errors > 0 || busy;
      setStatus(errors ? `${errors}개 이름에 문제가 있습니다 — 겹치거나 비어 있습니다.` : '', errors > 0);
      work.hidden = entries.length === 0;
    }

    function addFiles(files) {
      files.forEach((file) => {
        entries.push({
          key: `${file.name}:${file.size}:${Math.random().toString(36).slice(2, 7)}`,
          name: file.name,
          path: null,
          file,
          size: file.size,
        });
      });
      render();
    }

    function addPaths(paths) {
      paths.forEach((path) => {
        const name = String(path).split('/').pop();
        if (!name) return;
        entries.push({ key: path, name, path, file: null, size: 0 });
      });
      render();
    }

    function refreshField() {
      [fields.find, fields.replace, fields.prefix, fields.suffix, fields.number].forEach((field) => {
        field.addEventListener('input', render, { signal });
      });
      [fields.regex, fields.ignore].forEach((field) => field.addEventListener('change', render, { signal }));
      fields.case.addEventListener('change', render, { signal });
    }

    root.querySelector('#rn-browse').addEventListener('click', () => input.click(), { signal });
    input.addEventListener('change', () => {
      addFiles(Array.from(input.files || []));
      input.value = '';
    }, { signal });

    ['dragenter', 'dragover'].forEach((type) => {
      root.addEventListener(type, (event) => {
        event.preventDefault();
        root.classList.add('dr-over');
      }, { signal });
    });
    ['dragleave', 'drop'].forEach((type) => {
      root.addEventListener(type, (event) => {
        event.preventDefault();
        root.classList.remove('dr-over');
      }, { signal });
    });
    root.addEventListener('drop', (event) => {
      const files = Array.from(event.dataTransfer?.files || []);
      if (files.length) addFiles(files);
    }, { signal });

    // Mac 앱 — Finder 드롭은 네이티브 경로로 온다.
    if (TAURI && window.__TAURI__.event) {
      window.__TAURI__.event.listen('tip://files-drop', (event) => {
        const paths = Array.isArray(event.payload) ? event.payload : [];
        if (paths.length) {
          addPaths(paths);
          toast(`파일 ${paths.length}개를 불러왔습니다`);
        }
      });
      let hover = 0;
      window.__TAURI__.event.listen('tip://files-drag', (event) => {
        if (event.payload) {
          root.classList.add('dr-over');
          clearTimeout(hover);
        } else {
          hover = setTimeout(() => root.classList.remove('dr-over'), 200);
        }
      });
    }

    root.querySelector('#rn-clear').addEventListener('click', () => {
      entries = [];
      render();
      drop.hidden = false;
    }, { signal });

    async function applyNative() {
      const rows = plan().filter((row) => row.changed && row.entry.path);
      if (!rows.length) {
        toast('바뀌는 이름이 없습니다');
        return;
      }
      if (!window.confirm(`${rows.length}개 파일의 이름을 실제로 바꿉니다. 계속할까요?`)) return;
      busy = true;
      applyBtn.disabled = true;
      try {
        const moved = await C.invoke('rename_files', {
          plan: rows.map((row) => ({ from: row.entry.path, to: row.name })),
        });
        toast(`${moved}개 파일의 이름을 바꿨습니다`);
        // 바뀐 이름을 목록에도 반영한다(경로도 새 이름으로).
        rows.forEach((row) => {
          const entry = row.entry;
          entry.path = entry.path.replace(/[^/]+$/, row.name);
          entry.name = row.name;
        });
        entries.forEach((entry) => {
          if (!entry.path) return;
          const renames = rows.find((row) => row.entry === entry);
          if (!renames) return;
        });
        render();
      } catch (error) {
        console.error('[TIP rename]', error);
        const message = typeof error === 'string' ? error : '이름을 바꾸지 못했습니다';
        setStatus(message, true);
      } finally {
        busy = false;
        render();
      }
    }

    async function downloadZip() {
      if (!window.JSZip) {
        toast('ZIP 도구를 불러오지 못했습니다');
        return;
      }
      const rows = plan().filter((row) => !row.error);
      busy = true;
      render();
      try {
        const zip = new window.JSZip();
        for (const row of rows) {
          const entry = row.entry;
          if (entry.file) {
            zip.file(row.name, entry.file);
          } else {
            zip.file(row.name, '');
          }
        }
        const blob = await zip.generateAsync({ type: 'blob' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `tip-renamed-${Date.now()}.zip`;
        document.body.append(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 4000);
        toast(`${rows.length}개 이름으로 ZIP 을 만들었습니다 (${formatBytes(blob.size)})`);
      } catch (error) {
        console.error('[TIP rename]', error);
        setStatus('ZIP 을 만들지 못했습니다', true);
      } finally {
        busy = false;
        render();
      }
    }

    applyBtn.addEventListener('click', applyNative, { signal });
    zipBtn.addEventListener('click', downloadZip, { signal });

    refreshField();
    render();

    return () => controller.abort();
  },
};

export default module;
