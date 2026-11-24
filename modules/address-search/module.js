/**
 * TIP · 주소 검색 (address-search) — v1.12.4
 *
 * 두 갈래:
 * - 한국 주소 — 다음(카카오) 우편번호 서비스를 **전용 iframe(address-frame.html)** 안에서 열어
 *   도로명·지번·영문 주소와 우편번호를 받는다(API 키 없음). v1.12.4 부터 이 화면은 그 서비스의
 *   스크립트를 직접 불러오지 않는다 — 다른 문서에서 돌리고 고른 주소만 postMessage 로 받는다.
 * - 해외 주소 — OpenStreetMap Nominatim 검색 API 로 한글·영어 검색, 주소·영문명·좌표를 보여 준다.
 *
 * 이 모듈만 예외적으로 외부 네트워크를 쓴다(사용자가 검색한 주소만 해당 서비스로 간다).
 * 입력한 검색어는 TIP 서버로 가지 않는다 — TIP 에는 서버가 없다.
 */

const DAUM_FRAME = './address-frame.html';
const NOMINATIM = 'https://nominatim.openstreetmap.org/search';

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
  let worldBusy = false;
  let lastKorean = null;

  root.innerHTML = `
    <section class="addr">
      <div class="addr-tabs" role="tablist" aria-label="주소 종류">
        <button class="addr-tab is-on" type="button" role="tab" aria-selected="true" data-tab="kr">한국 주소</button>
        <button class="addr-tab" type="button" role="tab" aria-selected="false" data-tab="world">해외 주소</button>
      </div>

      <div class="addr-pane" data-pane="kr">
        <p class="addr-note">
          <b>한글 · 영문 · 우편번호</b>를 한 번에 찾습니다. 검색은 <b>다음(카카오) 우편번호 서비스</b>에서 하며,
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
          <input id="addr-world-input" type="search" placeholder="도시·거리·건물 이름 (한글 또는 English)" aria-label="해외 주소 검색어">
          <button class="primary-btn ghost" type="submit" id="addr-world-submit">검색</button>
        </form>
        <p class="addr-note">
          <b>OpenStreetMap</b> 검색 결과입니다. 주소·영문 이름·좌표를 복사할 수 있습니다.
          검색어는 OpenStreetMap 으로만 전송되며, 한 번에 한 번씩만 조회합니다.
        </p>
        <p id="addr-world-status" class="addr-status" role="status"></p>
        <div id="addr-world-list" class="addr-world-list"></div>
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
    try {
      await navigator.clipboard.writeText(text);
      ctx.toast(`${label}을(를) 복사했습니다`);
    } catch (error) {
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
  function createKoreanFrame(sandboxed) {
    const frame = document.createElement('iframe');
    frame.className = 'addr-frame';
    frame.title = '우편번호 검색';
    frame.setAttribute('referrerpolicy', 'no-referrer');
    // 외부 서비스는 샌드박스(불투명 출처) 안에서만 돌린다 — 부모 문서·저장소·IPC 에 손대지 못한다.
    // (스크립트·폼·팝업만 허용). 이 환경이 불투명 출처 프레임을 막으면 아래에서 샌드박스를 빗긴
    // 프레임으로 한 번 다시 시도한다 — 웹 PWA 와 Mac 웹뷰 어디서든 주소 검색은 그대로 동작해야 한다.
    if (sandboxed) {
      frame.setAttribute('sandbox', 'allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox');
    }
    frame.src = DAUM_FRAME;
    daumReady = false;
    daumFrame = frame;
    krEmbed.replaceChildren(frame);
    return frame;
  }

  let sandboxRetried = false;

  /** 열기 — 필요하면 프레임을 만들고, 준비되면 열기 메시지를 보낸다. */
  function openKoreanFrame() {
    if (!daumFrame) {
      createKoreanFrame(true);
      return;
    }
    if (daumReady && daumFrame.contentWindow) {
      daumFrame.contentWindow.postMessage({ type: 'tip:address:open' }, '*');
    }
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

  function showKorean(data) {
    lastKorean = {
      road: data.roadAddress || data.autoRoadAddress || '',
      jibun: data.jibunAddress || data.autoJibunAddress || '',
      english: data.roadAddressEnglish || data.jibunAddressEnglish || '',
      zonecode: data.zonecode || '',
    };
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
      <p class="addr-note addr-result-note">영문 주소는 도로명 기준입니다. 우편번호는 5자리입니다.</p>
    `;
    krResult.scrollIntoView({ block: 'nearest' });
  }

  krOpen.addEventListener('click', () => {
    krError.hidden = true;
    krHint.textContent = '불러오는 중…';
    krEmbed.hidden = false;
    openKoreanFrame();
    // iframe 이 준비를 알리면 열기 요청을 다시 보낸다(첫 생성 때는 준비 전에 요청이 갈 수 있다).
    clearTimeout(daumTimer);
    daumTimer = setTimeout(() => {
      if (daumReady) return;
      // 샌드박스 프레임이 준비 신호를 못 보내는 환경이면 한 번만 샌드박스를 빗긴 프레임으로 재시도한다.
      if (!sandboxRetried) {
        sandboxRetried = true;
        createKoreanFrame(false);
        return;
      }
      krHint.textContent = '';
      krEmbed.hidden = true;
      krError.hidden = false;
    }, 6000);
  }, { signal });

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
      clearTimeout(daumTimer);
      showKorean(data.data);
      krEmbed.hidden = true;
      krHint.textContent = '다른 주소를 찾으려면 다시 누르세요.';
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

  /* ------------------------------ 시작 ------------------------------ */

  if (!navigator.onLine) {
    krHint.textContent = '지금은 오프라인입니다.';
    worldStatus.textContent = '지금은 오프라인입니다 — 인터넷에 연결하면 검색할 수 있습니다.';
  }

  window.addEventListener('online', () => {
    krHint.textContent = '';
    if (worldStatus.textContent.includes('오프라인')) worldStatus.textContent = '';
  }, { signal });

  return () => {
    clearTimeout(daumTimer);
    controller.abort();
  };
}

export default {
  id: 'address-search',
  name: '주소 검색',
  shortName: '주소',
  subtitle: '한글·영문 주소와 우편번호 찾기',
  description: '한국 주소는 다음 우편번호 서비스로 도로명·지번·영문·우편번호를, 해외 주소는 OpenStreetMap 으로 찾습니다.',
  icon: ICON,
  version: '1.12.4',
  category: 'online',
  defaultEnabled: true,
  defaultPinned: false,
  mount,
};
