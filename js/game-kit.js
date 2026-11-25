/* TIP · 게임 공통 (v1.18.0)
 *
 * 제비뽑기 · 사다리타기 · 선착순 골인이 함께 쓰는 것만 모았다.
 *   · 사람 수(2~12)와 꽝 개수(0~사람 수-1)를 정하는 설정 화면
 *   · 참가자 이름 입력(비우면 '1번'부터 자동으로 채운다)
 *   · 설정 기억(tip.games.<게임>.v1) — 새로 설정하기로 돌아오면 지난 값 그대로
 *   · 다시하기 / 새로 설정하기 버튼과 결과 요약(당첨과 꽝을 나눠서)
 *   · 공정한 난수(crypto)와 섞기
 *
 * 화면 문구는 다른 모듈과 같은 톤으로 짧게 쓰고, 계산은 모두 이 기기 안에서 한다.
 */

export const PEOPLE_MIN = 2;
export const PEOPLE_MAX = 12;
export const NAME_MAX = 12;

const STORE_PREFIX = 'tip.games.';

/* ------------------------------ 난수 ------------------------------ */

/** 0 이상 max 미만의 정수 — crypto 를 먼저 쓴다. */
export function randomInt(max) {
  const limit = Math.max(1, Math.floor(max));
  try {
    const buffer = new Uint32Array(1);
    crypto.getRandomValues(buffer);
    return buffer[0] % limit;
  } catch {
    return Math.floor(Math.random() * limit);
  }
}

/** 0 이상 1 미만 — 모듈의 움직임 계산에 쓴다. */
export function randomUnit() {
  return randomInt(1e6) / 1e6;
}

/** 새 배열로 섞기(Fisher–Yates). */
export function shuffle(list) {
  const out = list.slice();
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);
    const swap = out[i];
    out[i] = out[j];
    out[j] = swap;
  }
  return out;
}

/** count 개 중 losers 개를 골라 꽝 자리로 — Set<number>. 꽝은 아무도 못 받게 사람 수-1 까지만. */
export function loserSlots(count, losers) {
  const total = Math.max(1, Math.floor(count));
  const pick = Math.max(0, Math.min(Math.floor(losers), total - 1));
  const slots = Array.from({ length: total }, (_, index) => index);
  return new Set(shuffle(slots).slice(0, pick));
}

/* ------------------------------ 설정 ------------------------------ */

export function defaultName(index) {
  return `${index + 1}번`;
}

function clampInt(value, min, max, fallback) {
  if (value == null || value === '') return fallback;
  const number = Math.floor(Number(value));
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}

/** 들어온 값을 쓸 수 있는 설정으로 다듬는다. 이름이 비면 '1번'처럼 채운다. */
export function normalizeSetup(raw) {
  const people = clampInt(raw && raw.people, PEOPLE_MIN, PEOPLE_MAX, 4);
  const losers = clampInt(raw && raw.losers, 0, people - 1, Math.min(1, people - 1));
  const names = [];
  for (let index = 0; index < PEOPLE_MAX; index += 1) {
    const given = raw && Array.isArray(raw.names) ? raw.names[index] : '';
    const text = String(given == null ? '' : given).trim().slice(0, NAME_MAX);
    names.push(text || defaultName(index));
  }
  const map = raw && typeof raw.map === 'string' ? raw.map : '';
  return { people, losers, names, map };
}

export function readSetup(gameId) {
  try {
    const text = localStorage.getItem(`${STORE_PREFIX}${gameId}.v1`);
    return text ? normalizeSetup(JSON.parse(text)) : null;
  } catch {
    return null;
  }
}

export function saveSetup(gameId, setup) {
  try {
    localStorage.setItem(`${STORE_PREFIX}${gameId}.v1`, JSON.stringify(normalizeSetup(setup)));
  } catch {
    /* 저장하지 못해도 이번 판은 그대로 둔다 */
  }
}

/* ------------------------------ 글자 ------------------------------ */

export function escapeText(text) {
  return String(text == null ? '' : text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* ------------------------------ 설정 화면 ------------------------------ */

function mapButton(map, active) {
  return `
    <button class="gm-map${active ? ' is-on' : ''}" type="button" role="radio"
            aria-checked="${active ? 'true' : 'false'}" data-map="${escapeText(map.id)}">
      <span class="gm-map-art" aria-hidden="true">${map.art || ''}</span>
      <span class="gm-map-text">
        <b>${escapeText(map.name)}</b>
        <span>${escapeText(map.sub || '')}</span>
      </span>
    </button>`;
}

/**
 * 사람 수 · 꽝 · 이름(· 맵)을 정하는 화면을 host 안에 그린다.
 * 시작을 누르면 onStart(setup) 을 부르고, 그 설정은 이 기기에 남는다.
 *
 * options: { gameId, maps, hint, signal, onStart }
 */
export function setupScreen(host, options) {
  const { gameId, maps = [], hint = '', signal, onStart } = options;
  const state = normalizeSetup(readSetup(gameId));
  // 설정 화면을 다시 그릴 때마다 지난 화면의 단추 연결을 끊는다(두 번 눌리지 않게).
  if (host.__gmSetup) host.__gmSetup.abort();
  const controller = new AbortController();
  host.__gmSetup = controller;
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', () => controller.abort(), { once: true });
  }
  const listen = { signal: controller.signal };
  if (maps.length && !maps.some((map) => map.id === state.map)) state.map = maps[0].id;

  host.innerHTML = `
    <div class="gm gm-setup">
      <div class="gm-panel">
        <div class="gm-row">
          <span class="gm-label" id="gm-people-label">사람 수</span>
          <div class="gm-stepper" role="group" aria-labelledby="gm-people-label">
            <button class="gm-step" type="button" data-field="people" data-dir="-1" aria-label="사람 수 줄이기">−</button>
            <output class="gm-value" id="gm-people" aria-live="polite">${state.people}</output>
            <button class="gm-step" type="button" data-field="people" data-dir="1" aria-label="사람 수 늘리기">+</button>
          </div>
          <span class="gm-sub">2명에서 12명</span>
        </div>
        <div class="gm-row">
          <span class="gm-label" id="gm-losers-label">꽝</span>
          <div class="gm-stepper" role="group" aria-labelledby="gm-losers-label">
            <button class="gm-step" type="button" data-field="losers" data-dir="-1" aria-label="꽝 줄이기">−</button>
            <output class="gm-value" id="gm-losers" aria-live="polite">${state.losers}</output>
            <button class="gm-step" type="button" data-field="losers" data-dir="1" aria-label="꽝 늘리기">+</button>
          </div>
          <span class="gm-sub" id="gm-losers-sub"></span>
        </div>
      </div>

      ${maps.length ? `
      <div class="gm-panel">
        <div class="gm-row gm-row-head"><span class="gm-label">맵</span></div>
        <div class="gm-maps" role="radiogroup" aria-label="맵 고르기">
          ${maps.map((map) => mapButton(map, map.id === state.map)).join('')}
        </div>
      </div>` : ''}

      <div class="gm-panel">
        <div class="gm-row gm-row-head">
          <span class="gm-label">참가자 이름</span>
          <button class="gm-link" type="button" id="gm-refill">이름 자동 채우기</button>
        </div>
        <div class="gm-names" id="gm-names"></div>
      </div>

      <div class="gm-start-row">
        <button class="v16-btn primary gm-start" type="button" id="gm-start">시작</button>
        ${hint ? `<span class="gm-hint">${escapeText(hint)}</span>` : ''}
      </div>
    </div>`;

  const peopleEl = host.querySelector('#gm-people');
  const losersEl = host.querySelector('#gm-losers');
  const losersSub = host.querySelector('#gm-losers-sub');
  const namesEl = host.querySelector('#gm-names');

  function paintNames() {
    namesEl.innerHTML = state.names.slice(0, state.people).map((name, index) => `
      <label class="gm-name-row">
        <span class="gm-name-no">${index + 1}</span>
        <input class="pt-input gm-name-input" type="text" maxlength="${NAME_MAX}" value="${escapeText(name)}"
               data-index="${index}" aria-label="${index + 1}번 참가자 이름" spellcheck="false"
               autocomplete="off" enterkeyhint="done">
      </label>`).join('');
  }

  function paintCounts() {
    peopleEl.textContent = String(state.people);
    losersEl.textContent = String(state.losers);
    losersSub.textContent = state.people <= PEOPLE_MIN + 1
      ? `0명 또는 ${state.people - 1}명`
      : `0명에서 ${state.people - 1}명까지`;
    host.querySelectorAll('.gm-step').forEach((button) => {
      const field = button.dataset.field;
      const dir = Number(button.dataset.dir);
      const value = field === 'people' ? state.people : state.losers;
      const max = field === 'people' ? PEOPLE_MAX : state.people - 1;
      const min = field === 'people' ? PEOPLE_MIN : 0;
      button.disabled = dir < 0 ? value <= min : value >= max;
    });
  }

  function paint() {
    paintCounts();
    paintNames();
  }

  function step(field, dir) {
    if (field === 'people') {
      const next = Math.max(PEOPLE_MIN, Math.min(PEOPLE_MAX, state.people + dir));
      if (next === state.people) return;
      state.people = next;
      // 이름칸에 적어 둔 값을 먼저 state 로 옮긴 뒤 인원을 바꾼다.
      readNames();
      state.losers = Math.min(state.losers, state.people - 1);
    } else {
      const next = Math.max(0, Math.min(state.people - 1, state.losers + dir));
      if (next === state.losers) return;
      state.losers = next;
      losersEl.textContent = String(state.losers);
    }
    paint();
  }

  function readNames() {
    namesEl.querySelectorAll('.gm-name-input').forEach((input, index) => {
      state.names[index] = input.value;
    });
  }

  function finalSetup() {
    readNames();
    const names = [];
    for (let index = 0; index < state.people; index += 1) {
      const text = String(state.names[index] || '').trim().slice(0, NAME_MAX);
      names.push(text || defaultName(index));
    }
    return normalizeSetup({ people: state.people, losers: state.losers, names, map: state.map });
  }

  host.addEventListener('click', (event) => {
    const stepButton = event.target.closest('.gm-step');
    if (stepButton) {
      event.preventDefault();
      step(stepButton.dataset.field, Number(stepButton.dataset.dir));
      return;
    }
    if (event.target.closest('#gm-refill')) {
      event.preventDefault();
      state.names = Array.from({ length: PEOPLE_MAX }, (_, index) => defaultName(index));
      paintNames();
      return;
    }
    const mapButtonEl = event.target.closest('.gm-map');
    if (mapButtonEl) {
      event.preventDefault();
      state.map = mapButtonEl.dataset.map;
      host.querySelectorAll('.gm-map').forEach((node) => {
        const on = node === mapButtonEl;
        node.classList.toggle('is-on', on);
        node.setAttribute('aria-checked', on ? 'true' : 'false');
      });
      return;
    }
    if (event.target.closest('#gm-start')) {
      event.preventDefault();
      const setup = finalSetup();
      saveSetup(gameId, setup);
      onStart(setup);
    }
  }, listen);

  host.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && event.target.classList.contains('gm-name-input')) {
      event.preventDefault();
      event.target.blur();
    }
  }, listen);

  paint();
}

/* ------------------------------ 결과 ------------------------------ */

/**
 * 결과 요약 상자 — 당첨과 꽝을 나눠 이름을 보여 주고, 아래에 다시하기·새로 설정하기.
 * entries: [{ name, lose, meta }]   (meta 는 순위처럼 이름 옆에 붙는 짧은 글자)
 * extraHtml: 요약 위에 끼울 것(예: 선착순 골인의 순위표)
 */
export function resultPanel({ id = '', entries = [], extraHtml = '', note = '' }) {
  const wins = entries.filter((entry) => !entry.lose);
  const loses = entries.filter((entry) => entry.lose);
  const chip = (entry) => `<li class="gm-chip${entry.lose ? ' is-lose' : ' is-win'}">
      <span class="gm-chip-dot" aria-hidden="true"></span>
      <span class="gm-chip-name">${escapeText(entry.name)}</span>
      ${entry.meta ? `<span class="gm-chip-meta">${escapeText(entry.meta)}</span>` : ''}
    </li>`;

  return `
    <div class="gm-result"${id ? ` id="${id}"` : ''}>
      <div class="gm-result-head">
        <h3>결과</h3>
        ${note ? `<p class="gm-result-note">${escapeText(note)}</p>` : ''}
      </div>
      ${extraHtml}
      <div class="gm-groups">
        <div class="gm-group is-win">
          <div class="gm-group-head"><span>당첨</span><b>${wins.length}명</b></div>
          <ul class="gm-chip-list">${wins.length ? wins.map(chip).join('') : '<li class="gm-chip is-empty">없음</li>'}</ul>
        </div>
        <div class="gm-group is-lose">
          <div class="gm-group-head"><span>꽝</span><b>${loses.length}명</b></div>
          <ul class="gm-chip-list">${loses.length ? loses.map(chip).join('') : '<li class="gm-chip is-empty">없음</li>'}</ul>
        </div>
      </div>
      <div class="gm-actions">
        <button class="v16-btn primary gm-retry" type="button" data-act="retry">다시하기</button>
        <button class="v16-btn gm-reset" type="button" data-act="setup">새로 설정하기</button>
      </div>
    </div>`;
}

/** 결과 상자의 다시하기·새로 설정하기를 잇는다. */
export function bindActions(host, { onRetry, onSetup }, signal) {
  host.addEventListener('click', (event) => {
    const button = event.target.closest('[data-act]');
    if (!button) return;
    event.preventDefault();
    if (button.dataset.act === 'retry') onRetry();
    else if (button.dataset.act === 'setup') onSetup();
  }, { signal });
}

/** 위젯에서 자주 쓰는 짧은 숫자 표시. */
export function hudStat(label, value, variant = '') {
  return `<div class="gm-stat${variant ? ` is-${variant}` : ''}">
      <span class="gm-stat-k">${escapeText(label)}</span>
      <b class="gm-stat-v">${escapeText(value)}</b>
    </div>`;
}
