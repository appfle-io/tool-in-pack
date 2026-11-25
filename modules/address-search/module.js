/**
 * TIP · 주소 검색 (address-search) — v1.15.1
 *
 * 두 갈래:
 * - 한국 주소 — 다음(카카오) 우편번호 서비스로 도로명·지번·영문 주소와 우편번호를 받는다(API 키 없음).
 *   · Mac 앱(v1.15.1): **IPC 권한이 없는 별도 창**(postcode.html)에서 띄운다 — 카카오 스크립트가
 *     window.__TAURI__ 도 parent.__TAURI__ 도 쓸 수 없다(창 라벨이 capabilities 에 없고, Rust 가
 *     전역을 지운 뒤 문서를 연다). 고른 주소만 `tip://postcode-result` 이벤트로 돌아온다.
 *     v1.15.2 — 그 창은 앱과 저장소를 공유하지 않는다(incognito). 결과는 이벤트와 Rust 보관함
 *     (take_postcode_result) 두 길로만 받는다.
 *   · 웹(PWA): 예전처럼 전용 iframe(address-frame.html)에서 돌리고 postMessage 로만 받는다
 *     (웹에는 __TAURI__ 가 없어 격리 문제가 없다).
 * - 해외 주소 — OpenStreetMap Nominatim 검색 API 로 한글·영어 검색, 주소·영문명·좌표를 보여 준다.
 *
 * 이 모듈만 예외적으로 외부 네트워크를 쓴다(사용자가 검색한 주소만 해당 서비스로 간다).
 * 입력한 검색어는 TIP 서버로 가지 않는다 — TIP 에는 서버가 없다.
 */

import { romanizeAddress } from './romanize.js';

const DAUM_FRAME = './address-frame.html';
const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
const TAURI = !!(window.__TAURI__ && window.__TAURI__.core);

const ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s6.5-5.4 6.5-11a6.5 6.5 0 1 0-13 0C5.5 15.6 12 21 12 21z"/><circle cx="12" cy="10" r="2.4"/></svg>';
const COPY = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M15 5.5V5a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h.5"/></svg>';

function escapeHtml(text) {
  return String(text ?? '').replace(/[&<>"']/g, (ch) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
  ));
}

function mount(root, ctx) {
  const controller = new AbortController();
  const { signal } = controller;

  let daumFrame = null;
  let daumReady = false;
  let daumTimer = null;
  let postcodePoll = null;
  let worldBusy = false;
  let lastKorean = null;

  root.innerHTML = `
    <section class="addr">
      <div class="addr-tabs" role="tablist" aria-label="주소 종류">
        <button class="addr-tab is-on" type="button" role="tab" aria-selected="true" data-tab="kr">한국 주소</button>
        <button class="addr-tab" type="button" role="tab" aria-selected="false" data-tab="world">해외 주소</button>
        <button class="addr-tab" type="button" role="tab" aria-selected="false" data-tab="en">영문 변환</button>
      </div>

      <div class="addr-pane" data-pane="kr">
        <p class="addr-note">
          <b>한글 주소와 영문 주소, 우편번호</b>를 한 번에 찾습니다. 검색은 <b>다음(카카오) 우편번호 서비스</b>에서 하며,
          입력한 검색어는 그 서비스로만 전송됩니다.
        </p>
        <div class="addr-actions">
          <button id="addr-kr-open" class="primary-btn" type="button">주소 검색 열기</button>
          <span class="addr-hint" id="addr-kr-hint"></span>
        </div>
        <div id="addr-kr-embed" class="addr-embed" hidden></div>
        <p id="addr-kr-error" class="notice addr-error" hidden>
          <b>인터넷 연결이 필요합니다.</b>
          우편번호 서비스를 불러오지 못했습니다. 연결을 확인한 뒤 다시 눌러 주세요.
        </p>
        <div id="addr-kr-result" class="addr-result" hidden></div>
      </div>

      <div class="addr-pane" data-pane="world" hidden>
        <form id="addr-world-form" class="addr-form" autocomplete="off">
          <input id="addr-world-input" type="search" placeholder="도시, 거리, 건물 이름 (한글 또는 English)" aria-label="해외 주소 검색어">
          <button class="primary-btn ghost" type="submit" id="addr-world-submit">검색</button>
        </form>
        <p class="addr-note">
          <b>OpenStreetMap</b> 검색 결과입니다. 주소와 영문 이름, 좌표를 복사할 수 있습니다.
          검색어는 OpenStreetMap 으로만 전송되며, 한 번에 한 번씩만 조회합니다.
        </p>
        <p id="addr-world-status" class="addr-status" role="status"></p>
        <div id="addr-world-list" class="addr-world-list"></div>
      </div>

      <div class="addr-pane" data-pane="en" hidden>
        <p class="addr-note">
          한국어 주소를 붙여넣으면 <b>해외직구용 영문 주소</b>로 바꿉니다.
          변환은 국어의 로마자 표기법 규칙을 따르며 네트워크를 쓰지 않습니다.
        </p>
        <label class="addr-en-label" for="addr-en-input">한국어 주소</label>
        <textarea id="addr-en-input" class="v16-ta" rows="3" spellcheck="false"
                  placeholder="예: 경기도 용인시 기흥구 동백중앙로 16번길 3-1 301호"></textarea>
        <div class="v16-actions">
          <button class="v16-btn primary" type="button" id="addr-en-run">영문 주소 만들기</button>
          <button class="v16-btn" type="button" id="addr-en-clear">비우기</button>
        </div>
        <div id="addr-en-result" class="addr-en-result" hidden></div>
      </div>
    </section>
  `;

  const krOpen = root.querySelector('#addr-kr-open');
  const krEmbed = root.querySelector('#addr-kr-embed');
  const krError = root.querySelector('#addr-kr-error');
  const krResult = root.querySelector('#addr-kr-result');
  const krHint = root.querySelector('#addr-kr-hint');
  const worldForm = root.querySelector('#addr-world-form');
  const worldInput = root.querySelector('#addr-world-input');
  const worldStatus = root.querySelector('#addr-world-status');
  const worldList = root.querySelector('#addr-world-list');

  /* ------------------------------ 탭 · 복사 ------------------------------ */

  const tabs = [...root.querySelectorAll('.addr-tab')];
  function selectTab(id) {
    tabs.forEach((tab) => {
      const on = tab.dataset.tab === id;
      tab.classList.toggle('is-on', on);
      tab.setAttribute('aria-selected', String(on));
    });
    root.querySelectorAll('.addr-pane').forEach((pane) => {
      pane.hidden = pane.dataset.pane !== id;
    });
  }
  tabs.forEach((tab) => tab.addEventListener('click', () => selectTab(tab.dataset.tab), { signal }));

  async function copy(text, label) {
    const value = String(text || '').trim();
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      ctx.toast(`${label}을(를) 복사했습니다`);
      return;
    } catch (error) {
      // Mac 앱(WKWebView)에서는 클립보드 권한이 막힐 수 있다 — Rust 가 대신 넣는다.
      const tauri = window.__TAURI__;
      if (tauri && tauri.core) {
        try {
          await tauri.core.invoke('copy_text', { text: value });
          ctx.toast(`${label}을(를) 복사했습니다`);
          return;
        } catch (fallbackError) {
          console.error('[TIP address-search] 복사하지 못했습니다', fallbackError);
        }
      }
      console.error('[TIP address-search] 복사하지 못했습니다', error);
      ctx.toast('복사하지 못했습니다');
    }
  }

  root.addEventListener('click', (event) => {
    const button = event.target.closest('[data-copy]');
    if (!button) return;
    const value = button.dataset.copy;
    if (value) copy(value, button.dataset.label || '내용');
  }, { signal });

  /* ------------------------------ 한국 주소 ------------------------------ */

  /** iframe 을 만들고 열기 요청을 보낸다 — 서비스 스크립트는 그 안에서만 돈다. */
  function createKoreanFrame() {
    const frame = document.createElement('iframe');
    frame.className = 'addr-frame';
    // v1.14.0 — 프레임이 모듈 폭을 꽉 채우게 한다(예전에는 높이가 어긋나 작게 보였다).
    frame.style.width = '100%';
    frame.style.height = '480px';
    frame.style.display = 'block';
    frame.style.border = '0';
    frame.title = '우편번호 검색';
    frame.setAttribute('referrerpolicy', 'no-referrer');
    // v1.13.0 — sandbox 를 걷어낸다. v1.12.4 의 `sandbox="allow-scripts …"`(불투명 출처 null)는
    // 다음 우편번호 스크립트가 저장소·쿠키를 읽는 순간 SecurityError 로 멈춰 Mac 앱에서 흰 화면만
    // 남겼다. 지금은 서비스 스크립트를 이 전용 문서(address-frame.html) 안에서만 돌리고(메인 화면은
    // 이 스크립트를 불러오지 않는다), 불러올 수 있는 곳은 tauri.conf.json 의 CSP 가 다음·카카오
    // 우편번호 도메인으로 제한한다. 고른 주소만 postMessage 로 부모에 넘어온다.
    frame.src = DAUM_FRAME;
    daumReady = false;
    daumFrame = frame;
    krEmbed.replaceChildren(frame);
    return frame;
  }

  /** 열기 — 필요하면 프레임을 만들고, 준비되면 열기 메시지를 보낸다. */
  function openKoreanFrame() {
    if (!daumFrame) {
      createKoreanFrame();
      return;
    }
    if (daumReady && daumFrame.contentWindow) {
      daumFrame.contentWindow.postMessage({ type: 'tip:address:open' }, '*');
    }
  }

  /* --------- 한국 주소 — Mac 앱은 IPC 권한 없는 별도 창(v1.15.1) --------- */

  function invoke(command, args) {
    return window.__TAURI__.core.invoke(command, args || {});
  }

  /** 주소 하나를 결과 카드로 그린다 — 창/프레임 어느 쪽으로 받았든 같은 길을 쓴다. */
  function deliverKorean(data) {
    if (!data || typeof data !== 'object') return;
    stopPostcodePoll();
    clearTimeout(daumTimer);
    showKorean(data);
    krEmbed.hidden = true;
    krHint.textContent = '다른 주소를 찾으려면 다시 누르세요.';
    if (TAURI) invoke('close_postcode_window').catch(() => {});
  }

  function stopPostcodePoll() {
    if (postcodePoll) clearInterval(postcodePoll);
    postcodePoll = null;
  }

  /** 우편번호 창의 결과를 살펴본다 — 이벤트를 놓쳤을 때를 위해 Rust 가 들고 있는 마지막 결과를 꺼낸다.
   *  (v1.15.2 — 우편번호 창은 앱과 저장소를 공유하지 않으므로 localStorage 보험은 없앴다.) */
  function checkPostcodeResult() {
    if (!TAURI) return;
    invoke('take_postcode_result').then((payload) => {
      if (!payload) return;
      try {
        deliverKorean(JSON.parse(payload));
      } catch (error) {
        console.error('[TIP address-search] 주소 결과를 읽지 못했습니다', error);
      }
    }).catch(() => {});
  }

  /** Mac 앱 — 우편번호를 별도 창으로 열고 결과를 기다린다. */
  function openKoreanWindow() {
    krError.hidden = true;
    krEmbed.hidden = true;
    krHint.textContent = '별도 창에서 검색 중…';
    stopPostcodePoll();
    invoke('open_postcode_window').then(() => {
      // 고른 주소는 이벤트로도 오고, 놓쳤을 때를 위해 0.6초마다 한 번 더 살펴본다(5분까지).
      let ticks = 0;
      postcodePoll = setInterval(() => {
        ticks += 1;
        if (ticks > 500) stopPostcodePoll();
        checkPostcodeResult();
      }, 600);
    }).catch((error) => {
      console.error('[TIP address-search] 우편번호 창을 열지 못했습니다', error);
      krHint.textContent = '';
      krError.hidden = false;
    });
  }

  function koreanRows(data) {
    const road = data.roadAddress || data.autoRoadAddress || '';
    const jibun = data.jibunAddress || data.autoJibunAddress || '';
    const english = data.roadAddressEnglish || data.jibunAddressEnglish || '';
    const rows = [
      { label: '도로명 주소', value: road },
      { label: '지번 주소', value: jibun },
      { label: '영문 주소', value: english },
      { label: '우편번호', value: data.zonecode || '' },
    ];
    if (data.buildingName) rows.push({ label: '건물명', value: data.buildingName });
    return rows.filter((row) => row.value);
  }

/** 공식 영문 도로명 주소를 해외 배송지 항목으로 나눈다.
 *  카카오가 주는 영문 주소는 '번지, 도로명, 구, 시' 순서라 마지막이 도시다. */
  function englishParts(english, zonecode, koreanRoad) {
    let line = '';
    let city = '';
    let state = '';
    let zip = String(zonecode || '').trim();

    if (english) {
      const parts = english.split(',').map((part) => part.trim()).filter(Boolean);
      if (parts.length >= 2) {
        city = parts[parts.length - 1];
        line = parts.slice(0, -1).join(', ');
      } else {
        line = english.trim();
      }
    }
    if (!line && koreanRoad) {
      const local = romanizeAddress(koreanRoad);
      line = local.line;
      city = city || local.city;
      state = local.state;
      zip = zip || local.zip;
    }
    return { line, city, state, zip, full: [line, city, state].filter(Boolean).join(', ') + (zip ? ` ${zip}` : '') };
  }

  function showKorean(data) {
    lastKorean = {
      road: data.roadAddress || data.autoRoadAddress || '',
      jibun: data.jibunAddress || data.autoJibunAddress || '',
      english: data.roadAddressEnglish || data.jibunAddressEnglish || '',
      zonecode: data.zonecode || '',
    };
    const shipping = englishParts(lastKorean.english, lastKorean.zonecode, lastKorean.road);
    const rows = koreanRows(data);
    const block = [
      lastKorean.road || lastKorean.jibun,
      lastKorean.english,
      lastKorean.zonecode ? `(${lastKorean.zonecode})` : '',
    ].filter(Boolean).join('\n');

    krResult.hidden = false;
    krResult.innerHTML = `
      <div class="addr-result-head">
        <b>검색 결과</b>
        <button class="addr-copy-all" type="button" data-copy="${escapeHtml(block)}" data-label="주소 전체">
          ${COPY}<span>전체 복사</span>
        </button>
      </div>
      <dl class="addr-rows">
        ${rows.map((row) => `
          <div class="addr-row">
            <dt>${escapeHtml(row.label)}</dt>
            <dd>
              <span class="addr-value">${escapeHtml(row.value)}</span>
              <button class="addr-copy" type="button" data-copy="${escapeHtml(row.value)}" data-label="${escapeHtml(row.label)}" aria-label="${escapeHtml(row.label)} 복사" title="복사">${COPY}</button>
            </dd>
          </div>
        `).join('')}
      </dl>
      <div class="addr-ship">
        <div class="addr-ship-head">
          <b>해외직구용 영문 주소</b>
          <button class="addr-chip" type="button" data-copy="${escapeHtml(shipping.full)}" data-label="영문 주소 전체">전체 복사</button>
        </div>
        <p class="addr-ship-full">${escapeHtml(shipping.full)}</p>
        <div class="addr-ship-fields">
          <button class="addr-ship-field" type="button" data-copy="${escapeHtml(shipping.line)}" data-label="Address Line">
            <span>Address Line</span><b>${escapeHtml(shipping.line || '없음')}</b>
          </button>
          <button class="addr-ship-field" type="button" data-copy="${escapeHtml(shipping.city)}" data-label="City">
            <span>City</span><b>${escapeHtml(shipping.city || '없음')}</b>
          </button>
          <button class="addr-ship-field" type="button" data-copy="${escapeHtml(shipping.state)}" data-label="State / Province">
            <span>State / Province</span><b>${escapeHtml(shipping.state || '없음')}</b>
          </button>
          <button class="addr-ship-field" type="button" data-copy="${escapeHtml(shipping.zip)}" data-label="Zip Code">
            <span>Zip Code</span><b>${escapeHtml(shipping.zip || '없음')}</b>
          </button>
        </div>
      </div>
      <p class="addr-note addr-result-note">영문 주소는 도로명 기준입니다. 우편번호는 5자리이며, 항목을 누르면 그 값만 복사됩니다.</p>
    `;
    krResult.scrollIntoView({ block: 'nearest' });
  }

  krOpen.addEventListener('click', () => {
    krError.hidden = true;
    if (TAURI) {
      openKoreanWindow();
      return;
    }
    krHint.textContent = '불러오는 중…';
    krEmbed.hidden = false;
    openKoreanFrame();
    // iframe 이 준비를 알리면 열기 요청을 다시 보낸다(첫 생성 때는 준비 전에 요청이 갈 수 있다).
    clearTimeout(daumTimer);
    daumTimer = setTimeout(() => {
      if (daumReady) return;
      krHint.textContent = '';
      krEmbed.hidden = true;
      krError.hidden = false;
    }, 6000);
  }, { signal });

  // Mac 앱 — 우편번호 창(Rust)이 고른 주소를 이벤트로 넘겨 준다.
  if (TAURI) {
    window.__TAURI__.event.listen('tip://postcode-result', (event) => {
      const payload = event.payload;
      try {
        const data = typeof payload === 'string' ? JSON.parse(payload) : payload;
        deliverKorean(data);
      } catch (error) {
        console.error('[TIP address-search] 주소 결과를 읽지 못했습니다', error);
      }
    });
  }

  // iframe(우편번호 전용 문서)이 보내는 메시지만 받는다 — 출처가 그 프레임일 때만 처리한다.
  window.addEventListener('message', (event) => {
    if (!daumFrame || event.source !== daumFrame.contentWindow) return;
    const data = event.data;
    if (!data || typeof data.type !== 'string') return;

    if (data.type === 'tip:address:ready') {
      daumReady = true;
      if (!krEmbed.hidden) daumFrame.contentWindow.postMessage({ type: 'tip:address:open' }, '*');
      return;
    }
    if (data.type === 'tip:address:opened') {
      clearTimeout(daumTimer);
      krHint.textContent = '';
      return;
    }
    if (data.type === 'tip:address:error') {
      clearTimeout(daumTimer);
      console.error('[TIP address-search] 우편번호 서비스를 불러오지 못했습니다', data.message);
      krHint.textContent = '';
      krEmbed.hidden = true;
      krError.hidden = false;
      return;
    }
    if (data.type === 'tip:address:result' && data.data) {
      deliverKorean(data.data);
    }
  }, { signal });

  /* ------------------------------ 해외 주소 ------------------------------ */

  function renderWorld(items, query) {
    if (!items.length) {
      worldList.innerHTML = `<p class="dr-empty addr-world-empty"><b>결과가 없습니다</b><span>다른 이름이나 철자로 다시 찾아보세요.</span></p>`;
      return;
    }

    worldList.innerHTML = items.map((item, index) => {
      const name = item.namedetails && (item.namedetails['name:en'] || item.namedetails.name) || item.name || '';
      const coords = `${Number(item.lat).toFixed(5)}, ${Number(item.lon).toFixed(5)}`;
      return `
        <article class="addr-world-item">
          <div class="addr-world-head">
            <b>${escapeHtml(name || query)}</b>
            <span class="addr-world-type">${escapeHtml(item.type || '')}</span>
          </div>
          <p class="addr-world-name">${escapeHtml(item.display_name || '')}</p>
          <p class="addr-world-coords">${escapeHtml(coords)}</p>
          <div class="addr-world-actions">
            <button class="addr-chip" type="button" data-copy="${escapeHtml(item.display_name || '')}" data-label="주소">주소 복사</button>
            ${name && name !== item.display_name ? `<button class="addr-chip" type="button" data-copy="${escapeHtml(name)}" data-label="영문 이름">영문명 복사</button>` : ''}
            <button class="addr-chip" type="button" data-copy="${escapeHtml(coords)}" data-label="좌표">좌표 복사</button>
            <a class="addr-chip addr-map" href="https://www.openstreetmap.org/?mlat=${encodeURIComponent(item.lat)}&mlon=${encodeURIComponent(item.lon)}#map=17/${encodeURIComponent(item.lat)}/${encodeURIComponent(item.lon)}" target="_blank" rel="noopener noreferrer">지도 열기</a>
          </div>
        </article>
      `;
    }).join('');
  }

  async function searchWorld(query) {
    const q = String(query || '').trim();
    if (!q || worldBusy) return;
    worldBusy = true;
    worldStatus.textContent = '검색 중…';
    worldList.innerHTML = '';
    const url = `${NOMINATIM}?format=jsonv2&addressdetails=1&namedetails=1&limit=8&accept-language=ko,en&q=${encodeURIComponent(q)}`;
    try {
      const response = await fetch(url, { signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const items = await response.json();
      worldStatus.textContent = Array.isArray(items) && items.length
        ? `${items.length}곳을 찾았습니다.`
        : '';
      renderWorld(Array.isArray(items) ? items : [], q);
    } catch (error) {
      if (error.name === 'AbortError') return;
      console.error('[TIP address-search] 해외 주소를 찾지 못했습니다', error);
      worldStatus.textContent = '';
      worldList.innerHTML = `
        <p class="notice addr-error">
          <b>인터넷 연결이 필요합니다.</b>
          OpenStreetMap 검색에 연결하지 못했습니다. 연결을 확인한 뒤 다시 검색해 주세요.
        </p>
      `;
    } finally {
      worldBusy = false;
    }
  }

  worldForm.addEventListener('submit', (event) => {
    event.preventDefault();
    searchWorld(worldInput.value);
  }, { signal });

  /* ------------------------------ 영문 변환 ------------------------------ */

  const enInput = root.querySelector('#addr-en-input');
  const enResult = root.querySelector('#addr-en-result');
  const enRun = root.querySelector('#addr-en-run');

  function renderEnglish(result) {
    if (!result || !result.korean) {
      enResult.hidden = true;
      return;
    }
    const fields = [
      ['Address Line', result.line],
      ['City', result.city],
      ['State / Province', result.state],
      ['Zip Code', result.zip],
    ];
    enResult.hidden = false;
    enResult.innerHTML = `
      <div class="addr-ship-head">
        <b>영문 주소</b>
        <button class="addr-chip" type="button" data-copy="${escapeHtml(result.full)}" data-label="영문 주소 전체">전체 복사</button>
      </div>
      <p class="addr-ship-full">${escapeHtml(result.full || '없음')}</p>
      <div class="addr-ship-fields">
        ${fields.map(([label, value]) => `
          <button class="addr-ship-field" type="button" data-copy="${escapeHtml(value || '')}" data-label="${escapeHtml(label)}">
            <span>${escapeHtml(label)}</span><b>${escapeHtml(value || '없음')}</b>
          </button>
        `).join('')}
      </div>
      <p class="addr-note addr-result-note">
        도로명 주소는 도로 고유 표기가 따로 있습니다. 배송지에는 주소 검색 결과의 공식 영문 주소를 쓰고,
        이 변환은 붙여넣은 주소를 빠르게 옮길 때 쓰세요.
      </p>
    `;
  }

  enRun.addEventListener('click', () => {
    const text = enInput.value;
    if (!text.trim()) {
      ctx.toast('한국어 주소를 붙여넣어 주세요');
      enResult.hidden = true;
      return;
    }
    const result = romanizeAddress(text);
    renderEnglish(result);
    ctx.toast('영문 주소를 만들었습니다');
  }, { signal });

  enInput.addEventListener('keydown', (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault();
      enRun.click();
    }
  }, { signal });

  root.querySelector('#addr-en-clear').addEventListener('click', () => {
    enInput.value = '';
    enResult.hidden = true;
    enInput.focus();
  }, { signal });

  /* ------------------------------ 시작 ------------------------------ */

  if (!navigator.onLine) {
    krHint.textContent = '지금은 오프라인입니다.';
    worldStatus.textContent = '지금은 오프라인입니다. 인터넷에 연결하면 검색할 수 있습니다.';
  }

  window.addEventListener('online', () => {
    krHint.textContent = '';
    if (worldStatus.textContent.includes('오프라인')) worldStatus.textContent = '';
  }, { signal });

  return () => {
    clearTimeout(daumTimer);
    stopPostcodePoll();
    controller.abort();
  };
}

export default {
  id: 'address-search',
  name: '주소 검색',
  shortName: '주소',
  subtitle: '한글과 영문 주소, 우편번호 찾기',
  description: '한국 주소는 다음 우편번호 서비스에서 도로명, 지번, 영문, 우편번호로 찾고 해외 주소는 OpenStreetMap 에서 찾습니다. 주소를 찾을 때만 인터넷을 씁니다.',
  icon: ICON,
  version: '1.15.4',
  category: 'calc',
  defaultEnabled: true,
  defaultPinned: false,
  mount,
};
