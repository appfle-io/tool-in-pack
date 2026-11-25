/*
 * TIP · 제비뽑기 (draw-lots, v1.18.0)
 *
 * 봉투를 한 장씩 뒤집거나(3D 뒤집기·살짝 흔들림), 한꺼번에 열어 당첨과 꽝을 가른다.
 * 사람 수(2~12)와 꽝 개수(0~사람 수-1)를 정하고, 이름은 비워 두면 '1번'부터 채워진다.
 * 결과를 뽑는 일은 모두 이 브라우저 안에서 한다.
 */

import {
  setupScreen, resultPanel, bindActions, hudStat, loserSlots, shuffle,
} from '../../js/game-kit.js';

const ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="6" width="18" height="13" rx="2.2"/><path d="M3.6 6.8 12 13l8.4-6.2"/><path d="M12 13v6"/></svg>`;

const REVEAL_GAP = 90;

function cardMarkup(card, index) {
  const verdict = card.lose ? '꽝' : '당첨';
  return `
    <button class="dl-card" type="button" data-index="${index}"
            aria-label="${index + 1}번 봉투, 아직 안 뽑음" aria-pressed="false">
      <span class="dl-inner">
        <span class="dl-face dl-front">
          <span class="dl-env" aria-hidden="true">
            <span class="dl-flap"></span>
            <span class="dl-seal">?</span>
            <span class="dl-line"></span>
            <span class="dl-line dl-line-2"></span>
          </span>
          <span class="dl-name">${card.name}</span>
        </span>
        <span class="dl-face dl-back${card.lose ? ' is-lose' : ' is-win'}">
          <span class="dl-verdict">${verdict}</span>
          <span class="dl-name">${card.name}</span>
        </span>
      </span>
    </button>`;
}

const module = {
  id: 'draw-lots',
  name: '제비뽑기',
  shortName: '제비뽑기',
  kind: 'tool',
  category: 'game',
  version: '1.18.0',
  subtitle: '봉투를 한 장씩 뒤집기',
  description: '사람 수와 꽝 개수를 정하고 봉투를 눌러 당첨과 꽝을 가립니다. 한 장씩 뽑거나 한꺼번에 열 수 있고, 같은 설정으로 바로 다시 뽑습니다.',
  icon: ICON,
  defaultEnabled: true,
  defaultPinned: false,

  mount(root, ctx) {
    const controller = new AbortController();
    const { signal } = controller;
    const toast = ctx && typeof ctx.toast === 'function' ? ctx.toast : () => {};
    const host = document.createElement('div');
    host.className = 'gm-root';
    root.append(host);

    let setup = null;
    let cards = [];
    let timers = new Set();
    let resultShown = false;

    function clearTimers() {
      timers.forEach((timer) => clearTimeout(timer));
      timers.clear();
    }

    /* ------------------------------ 설정 ------------------------------ */

    function showSetup() {
      clearTimers();
      cards = [];
      resultShown = false;
      setupScreen(host, {
        gameId: 'draw-lots',
        hint: '이름을 비우면 번호로 채웁니다.',
        signal,
        onStart: (next) => start(next),
      });
    }

    /* ------------------------------ 한 판 ------------------------------ */

    function start(next) {
      clearTimers();
      setup = next;
      deal();
      renderPlay();
    }

    /** 꽝 자리를 새로 뽑아 봉투를 다시 깐다. */
    function deal() {
      const losers = loserSlots(setup.people, setup.losers);
      cards = shuffle(setup.names.slice(0, setup.people).map((name, index) => ({
        name,
        lose: losers.has(index),
        open: false,
      })));
      resultShown = false;
    }

    function renderPlay() {
      host.innerHTML = `
        <div class="gm dl">
          <div class="gm-hud" id="dl-hud">
            ${hudStat('남은 봉투', String(cards.length), 'left')}
            ${hudStat('당첨', '0', 'win')}
            ${hudStat('꽝', '0', 'lose')}
          </div>
          <p class="gm-lead" id="dl-lead">봉투를 눌러 한 장씩 뽑거나, 모두 열기를 누르세요.</p>
          <div class="dl-grid" id="dl-grid">
            ${cards.map((card, index) => cardMarkup(card, index)).join('')}
          </div>
          <div class="gm-actions">
            <button class="v16-btn" type="button" id="dl-open-all">모두 열기</button>
            <button class="v16-btn" type="button" id="dl-reshuffle">다시 뽑기</button>
            <button class="v16-btn" type="button" data-act="setup">설정 바꾸기</button>
          </div>
          <div id="dl-result"></div>
          <p class="gm-live sr-only" id="dl-live" role="status" aria-live="polite"></p>
        </div>`;
      paintCounts();
    }

    function paintCounts() {
      const opened = cards.filter((card) => card.open);
      const left = cards.length - opened.length;
      const wins = opened.filter((card) => !card.lose).length;
      const loses = opened.filter((card) => card.lose).length;
      const hud = host.querySelector('#dl-hud');
      if (hud) {
        const values = hud.querySelectorAll('.gm-stat-v');
        if (values[0]) values[0].textContent = String(left);
        if (values[1]) values[1].textContent = String(wins);
        if (values[2]) values[2].textContent = String(loses);
      }
      const lead = host.querySelector('#dl-lead');
      if (lead) {
        lead.textContent = left
          ? `봉투를 눌러 한 장씩 뽑거나, 모두 열기를 누르세요. ${left}장 남았습니다.`
          : '모두 뽑았습니다. 결과를 확인하세요.';
      }
      const openAll = host.querySelector('#dl-open-all');
      if (openAll) openAll.disabled = left === 0;
    }

    function announce(text) {
      const live = host.querySelector('#dl-live');
      if (live) live.textContent = text;
    }

    /** 봉투 하나를 뒤집는다. 이미 열려 있으면 아무 일도 없다. */
    function openCard(index, silent = false) {
      const card = cards[index];
      if (!card || card.open) return false;
      card.open = true;
      const el = host.querySelector(`.dl-card[data-index="${index}"]`);
      if (el) {
        el.classList.add('is-open');
        el.setAttribute('aria-pressed', 'true');
        el.setAttribute('aria-label', `${index + 1}번 봉투, ${card.lose ? '꽝' : '당첨'}`);
      }
      const name = card.name;
      if (card.lose) toast(`${name} 꽝`);
      else toast(`${name} 당첨`);
      paintCounts();
      announce(`${name} ${card.lose ? '꽝' : '당첨'}`);
      if (cards.every((item) => item.open)) finish();
      return true;
    }

    function openAll() {
      const rest = cards.map((card, index) => (card.open ? -1 : index)).filter((index) => index >= 0);
      rest.forEach((index, order) => {
        const timer = setTimeout(() => {
          timers.delete(timer);
          openCard(index, true);
        }, order * REVEAL_GAP);
        timers.add(timer);
      });
    }

    function finish() {
      if (resultShown) return;
      resultShown = true;
      const box = host.querySelector('#dl-result');
      if (!box) return;
      const entries = cards.map((card) => ({ name: card.name, lose: card.lose }));
      box.innerHTML = resultPanel({
        id: 'dl-summary',
        entries,
        note: `${entries.length}명 가운데 당첨 ${entries.filter((entry) => !entry.lose).length}명`,
      });
      const openAllButton = host.querySelector('#dl-open-all');
      if (openAllButton) openAllButton.disabled = true;
    }

    /* ------------------------------ 연결 ------------------------------ */

    host.addEventListener('click', (event) => {
      const card = event.target.closest('.dl-card');
      if (card) {
        event.preventDefault();
        openCard(Number(card.dataset.index));
        return;
      }
      if (event.target.closest('#dl-open-all')) {
        event.preventDefault();
        openAll();
        return;
      }
      if (event.target.closest('#dl-reshuffle')) {
        event.preventDefault();
        if (!setup) return;
        clearTimers();
        deal();
        renderPlay();
        return;
      }
    }, { signal });

    bindActions(host, {
      onRetry: () => {
        if (!setup) return;
        clearTimers();
        deal();
        renderPlay();
      },
      onSetup: () => showSetup(),
    }, signal);

    showSetup();
    return () => {
      clearTimers();
      controller.abort();
    };
  },
};

export default module;
