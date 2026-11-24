/**
 * TIP · 타이머 (timer, v1.15.0)
 *
 * macOS 기본 시계 앱은 다른 앱이 조종할 API 가 없어 TIP 이 직접 만든 타이머.
 * 원하는 분·초를 자유롭게 넣거나 프리셋(1·3·5·10·25분)으로 시작하고, 일시정지·재개·초기화한다.
 * 상태는 js/timer-store.js 한 곳(localStorage)에 있어 노치 알약·노치 패널·전역 검색과 늘 같다.
 * 끝나면 Mac 은 알림 센터 + 소리, 웹은 브라우저 알림 + 소리로 알린다.
 */

import {
  timerState, remainingSeconds, startTimer, toggleTimer, resetTimer, extendTimer,
  subscribeTimer, formatClock, describeSeconds, TIMER_PRESETS, tickTimer, alertTimerDone,
} from '../../js/timer-store.js';

const ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="13.5" r="7.5"/><path d="M12 10v3.8l2.4 1.6"/><path d="M9.5 3h5M12 3v2.5"/><path d="M19.5 7.5 21 9"/></svg>`;

const module = {
  id: 'timer',
  name: '타이머',
  shortName: '타이머',
  kind: 'tool',
  category: 'utility',
  version: '1.15.0',
  subtitle: '분과 초를 정해 세는 타이머',
  description: '원하는 시간을 직접 넣거나 프리셋으로 시작합니다. 노치 알약과 메인 창이 같은 타이머를 보여 주고, 끝나면 알림과 소리로 알립니다.',
  icon: ICON,
  defaultEnabled: true,
  defaultPinned: false,

  mount(root, ctx) {
    const controller = new AbortController();
    const { signal } = controller;
    const toast = ctx?.toast || (() => {});
    let notifiedFor = 0;

    root.innerHTML = `
      <div class="v16 tm">
        <div class="tm-card">
          <div class="tm-clock" id="tm-clock" aria-live="off">00:00</div>
          <div class="tm-bar" role="progressbar" aria-label="타이머 진행" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
            <span class="tm-bar-fill" id="tm-fill"></span>
          </div>
          <p class="tm-state" id="tm-state">시간을 정해 시작하세요</p>
          <div class="tm-actions">
            <button class="v16-btn primary tm-start" type="button" id="tm-start">시작</button>
            <button class="v16-btn" type="button" id="tm-reset">초기화</button>
            <button class="v16-btn" type="button" id="tm-extend">+1분</button>
          </div>
        </div>

        <div class="v16-block">
          <div class="v16-block-head"><span>빠른 시작</span><span class="tm-side" id="tm-side"></span></div>
          <div class="tm-presets" id="tm-presets"></div>
        </div>

        <div class="v16-block">
          <div class="v16-block-head"><span>직접 정하기</span></div>
          <div class="tm-inputs">
            <label class="tm-field"><span>분</span>
              <input class="pt-input" id="tm-min" type="number" inputmode="numeric" min="0" max="1440" step="1" value="7">
            </label>
            <label class="tm-field"><span>초</span>
              <input class="pt-input" id="tm-sec" type="number" inputmode="numeric" min="0" max="59" step="1" value="0">
            </label>
            <button class="v16-btn primary" type="button" id="tm-custom">이 시간으로 시작</button>
          </div>
          <p class="v16-note">분은 0~1440, 초는 0~59. 노치와 메인 창, 전역 검색이 같은 타이머를 씁니다.</p>
        </div>

        <div class="tm-hint">
          <b>어디서든</b> — 전역 검색(Option+Space)에서 <code>타이머 7분</code>, <code>타이머 1분 30초</code>,
          <code>timer 90s</code> 처럼 치면 바로 시작됩니다. 노치 알약에도 남은 시간이 보입니다.
        </div>
      </div>`;

    const clockEl = root.querySelector('#tm-clock');
    const fillEl = root.querySelector('#tm-fill');
    const barEl = root.querySelector('.tm-bar');
    const stateEl = root.querySelector('#tm-state');
    const startBtn = root.querySelector('#tm-start');
    const sideEl = root.querySelector('#tm-side');
    const minEl = root.querySelector('#tm-min');
    const secEl = root.querySelector('#tm-sec');

    const presetsEl = root.querySelector('#tm-presets');
    TIMER_PRESETS.forEach((minutes) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'tm-preset';
      button.dataset.min = String(minutes);
      button.textContent = `${minutes}분`;
      button.addEventListener('click', () => {
        startTimer(minutes * 60);
        toast(`${minutes}분 타이머를 시작했습니다`);
      }, { signal });
      presetsEl.append(button);
    });

    function paint() {
      const state = timerState();
      const left = remainingSeconds(state);
      clockEl.textContent = formatClock(left);
      clockEl.classList.toggle('is-running', state.status === 'running');
      clockEl.classList.toggle('is-done', state.status === 'done');

      const total = state.duration || 0;
      const percent = total > 0 ? Math.max(0, Math.min(100, (left / total) * 100)) : 0;
      fillEl.style.width = `${percent}%`;
      barEl.setAttribute('aria-valuenow', String(Math.round(percent)));
      barEl.className = `tm-bar${state.status === 'done' ? ' is-done' : ''}${state.status === 'paused' ? ' is-paused' : ''}`;

      if (state.status === 'running') stateEl.textContent = `${describeSeconds(total)} 타이머 — 줄어드는 중`;
      else if (state.status === 'paused') stateEl.textContent = `일시정지 — ${formatClock(left)} 남음`;
      else if (state.status === 'done') stateEl.textContent = '끝났습니다. 초기화하거나 새로 시작하세요.';
      else stateEl.textContent = '시간을 정해 시작하세요';

      startBtn.textContent = state.status === 'running' ? '일시정지' : (state.status === 'paused' ? '계속' : '시작');
      sideEl.textContent = state.status === 'idle' ? '대기' : (state.status === 'done' ? '완료' : formatClock(left));
      presetsEl.querySelectorAll('.tm-preset').forEach((button) => {
        button.classList.toggle('is-on', state.status !== 'idle' && total === Number(button.dataset.min) * 60);
      });
    }

    startBtn.addEventListener('click', () => {
      const state = timerState();
      if (state.status === 'running' || state.status === 'paused') {
        toggleTimer();
        paint();
        return;
      }
      const seconds = customSeconds();
      if (!seconds) {
        toast('먼저 시간을 정해 주세요 — 분이나 초를 1 이상으로');
        minEl.focus();
        return;
      }
      startTimer(seconds);
      toast(`${describeSeconds(seconds)} 타이머를 시작했습니다`);
    }, { signal });

    root.querySelector('#tm-reset').addEventListener('click', () => {
      resetTimer();
      paint();
      toast('타이머를 초기화했습니다');
    }, { signal });

    root.querySelector('#tm-extend').addEventListener('click', () => {
      if (!extendTimer(60)) {
        toast('먼저 타이머를 시작해 주세요');
        return;
      }
      paint();
      toast('1분 더했습니다');
    }, { signal });

    root.querySelector('#tm-custom').addEventListener('click', () => {
      const seconds = customSeconds();
      if (!seconds) {
        toast('분이나 초를 1 이상으로 넣어 주세요');
        return;
      }
      startTimer(seconds);
      toast(`${describeSeconds(seconds)} 타이머를 시작했습니다`);
    }, { signal });

    function customSeconds() {
      const minutes = Math.max(0, Math.min(1440, Math.floor(Number(minEl.value) || 0)));
      const seconds = Math.max(0, Math.min(59, Math.floor(Number(secEl.value) || 0)));
      const total = minutes * 60 + seconds;
      return total > 0 && total <= 24 * 60 * 60 ? total : 0;
    }

    const unsubscribe = subscribeTimer(() => { paint(); checkFinished(); });
    const timer = setInterval(() => { paint(); checkFinished(); }, 250);

    function checkFinished() {
      if (!tickTimer()) return;
      const state = timerState();
      if (state.finishedAt && state.finishedAt === notifiedFor) return;
      notifiedFor = state.finishedAt;
      alertTimerDone(state.duration);
      toast('타이머가 끝났습니다');
    }

    paint();
    return () => {
      clearInterval(timer);
      unsubscribe();
      controller.abort();
    };
  },
};

export default module;
