/*
 * TIP · 택시 미터기 (taxi-meter, v1.27.1)
 *
 * 게임 묶음의 재미용 미터기. 실제 영업용이 아니라 요금이 어떻게 쌓이는지 보여 주는 시뮬레이터다.
 *
 *   · 지역 요금표(서울 / 경기 표준 / 경기 가형 / 인천 / 부산)에 맞춰 기본·거리·시간 요금을 쌓고,
 *     심야와 시계 외 할증을 지역 상한(복합 할증) 안에서 더한다.
 *   · 실제 GPS 주행(navigator.geolocation.watchPosition)만 쓴다. 정지 중 오차를 거리로 세지 않고,
 *     튀는 좌표(순간이동)를 버린다.
 *   · 주행 중 화면이 꺼지지 않게 Wake Lock 을 요청하고, 일시 정지·빈 차·정산에서 놓아 준다.
 *   · 출발한 시·군·구를 벗어나면 시계 외 할증을 자동으로 켠다(geofence.js). 사용자가 스위치를
 *     직접 만졌으면 자동 감지가 덮어쓰지 않는다.
 *   · 요금 결제(1/N)를 누르면 기본·거리·시간·할증·통행료를 나눈 영수증과 1인당 금액을 보여 준다.
 *   · 전체화면: requestFullscreen 이 되는 곳은 그대로, iOS 사파리·홈 화면 앱처럼 막힌 곳은
 *     CSS 고정 오버레이로 화면을 꽉 채운다. Esc 또는 [나가기]로 돌아온다.
 *
 * 계산은 fare.js, 위치 경계는 geofence.js, 전광판·도트 말은 panel.js 에 나눠 두었다.
 */

import {
  REGIONS, regionById, resolveNightRate,
  computeFare, surchargeName, percentText, formatWon, formatClock, formatDistance, splitPerPerson,
} from './fare.js';
import { BoundaryWatch, haversineMeters, coreDistrict } from './geofence.js';
import { createLedPanel, createDotHorse } from './panel.js';

const ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 16.5 6 11.4A2 2 0 0 1 7.9 10h8.2a2 2 0 0 1 1.9 1.4l1.5 5.1"/><path d="M3.5 16.5h17"/><path d="M8 10V8.2A1.2 1.2 0 0 1 9.2 7h5.6A1.2 1.2 0 0 1 16 8.2V10"/><circle cx="7.4" cy="16.7" r="1.5"/><circle cx="16.6" cy="16.7" r="1.5"/><path d="M9.5 7V5.4h5V7"/></svg>`;

const STORE_KEY = 'tip.taxi.v1';
const UNIT = 100;

const WAKE_LABEL = {
  on: '화면 꺼짐 방지 ON',
  wait: '화면 꺼짐 방지 대기',
  none: '화면 꺼짐 방지 미지원',
};

const PHASE_LABEL = {
  idle: '빈 차',
  driving: 'LIVE',
  paused: '일시 정지',
  settled: '정산',
};

function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
    return saved && typeof saved === 'object' ? saved : {};
  } catch {
    return {};
  }
}

const module = {
  id: 'taxi-meter',
  name: '택시 미터기',
  shortName: '택시 미터',
  kind: 'tool',
  category: 'game',
  version: '1.27.1',
  subtitle: '달리는 만큼 오르는 요금',
  description: '지역 요금표대로 요금이 쌓이는 재미용 택시 미터기입니다. 실제 GPS 주행으로 달리며 기본요금, 거리요금, 시간요금과 심야 할증, 시계 외 할증, 통행료를 조절하고, 요금 결제(1/N)로 1인당 금액을 계산합니다. 전체화면으로 전광판을 크게 볼 수 있습니다.',
  icon: ICON,
  defaultEnabled: true,
  defaultPinned: false,

  mount(root, ctx) {
    const controller = new AbortController();
    const { signal } = controller;
    const toast = ctx && typeof ctx.toast === 'function' ? ctx.toast : () => {};
    const saved = loadSettings();
    const test = (typeof window !== 'undefined' && window.__txmTest) || {};

    const state = {
      regionId: REGIONS.some((item) => item.id === saved.region) ? saved.region : 'yongin',
      phase: 'idle',
      nightChoice: 'auto',
      outOfArea: false,
      manualOut: false,
      tollOn: false,
      toll: 1000,
      extraOn: false,
      extra: 2000,
      distanceM: 0,
      slowMs: 0,
      elapsedMs: 0,
      speedKmh: 0,
      people: Math.min(20, Math.max(1, Number(saved.people) || 2)),
      receiptOpen: false,
      fullscreen: false,
      wake: 'wait',
    };

    let region = regionById(state.regionId);
    const boundary = new BoundaryWatch({
      minMoveM: Number(test.minMoveM) > 0 ? Number(test.minMoveM) : 500,
      minIntervalMs: Number.isFinite(Number(test.minIntervalMs)) ? Number(test.minIntervalMs) : 60000,
    });

    const host = document.createElement('div');
    host.className = 'txm-root';
    root.append(host);
    host.innerHTML = `
      <div class="txm" data-phase="idle" data-mode="gps">
        <div class="txm-top">
          <span class="txm-wake" data-state="wait">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4.5" y="10.5" width="15" height="9.5" rx="2"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/></svg>
            <b>화면 꺼짐 방지 대기</b>
          </span>
          <label class="txm-region">
            <span>지역</span>
            <select id="txm-region" class="txm-select" aria-label="지역 요금표">
              ${REGIONS.map((item) => `<option value="${item.id}">${item.label}</option>`).join('')}
            </select>
          </label>
        </div>

        <section class="txm-board" aria-label="요금 표시">
          <div class="txm-board-head">
            <span class="txm-board-label">요금 (원)</span>
            <span class="txm-chips">
              <span class="txm-live" data-state="idle"><i aria-hidden="true"></i><b>빈 차</b></span>
              <span class="txm-surcharge" data-on="0"><b>+0%</b><span>할증 없음</span></span>
            </span>
            <button class="txm-fs" id="txm-fs" type="button" aria-pressed="false" aria-label="전체화면으로 보기">
              <svg class="txm-fs-on" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9V5.5A1.5 1.5 0 0 1 5.5 4H9"/><path d="M15 4h3.5A1.5 1.5 0 0 1 20 5.5V9"/><path d="M20 15v3.5a1.5 1.5 0 0 1-1.5 1.5H15"/><path d="M9 20H5.5A1.5 1.5 0 0 1 4 18.5V15"/></svg>
              <svg class="txm-fs-off" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 4v3.5A1.5 1.5 0 0 1 7.5 9H4"/><path d="M15 4v3.5A1.5 1.5 0 0 0 16.5 9H20"/><path d="M20 15h-3.5A1.5 1.5 0 0 0 15 16.5V20"/><path d="M4 15h3.5A1.5 1.5 0 0 1 9 16.5V20"/></svg>
              <span>전체화면</span>
            </button>
          </div>
          <div class="txm-digits">
            <canvas id="txm-digits" role="img" aria-label="요금 4,800원"></canvas>
          </div>
          <div class="txm-horse">
            <canvas id="txm-horse" role="img" aria-label="점으로 그린 말이 달리는 애니메이션"></canvas>
          </div>
          <div class="txm-metrics">
            <div class="txm-metric">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 20 12 4l7 16"/><path d="M8.4 13h7.2"/></svg>
              <span>거리</span><b><em class="txm-distance">0.00</em> km</b>
            </div>
            <div class="txm-metric">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20a8 8 0 1 1 0-16 8 8 0 0 1 0 16Z"/><path d="m12 12 3.5-3"/></svg>
              <span>속도</span><b><em class="txm-speed">0</em> km/h</b>
            </div>
            <div class="txm-metric">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8"/><path d="M12 7.5V12l3 1.8"/></svg>
              <span>시간</span><b><em class="txm-time">00:00</em></b>
            </div>
          </div>
        </section>

        <p class="txm-gps" role="status" hidden></p>

        <section class="txm-tuner" aria-label="할증 튜너">
          <header class="txm-tuner-head">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h9M17 7h3M4 12h3M11 12h9M4 17h9M17 17h3"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="15" cy="17" r="2"/></svg>
            <div><b>할증 튜너</b><p>실시간으로 할증 요소를 조정하세요</p></div>
          </header>

          <div class="txm-tune">
            <div class="txm-tune-head">
              <div class="txm-tune-title">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 14.5A8.5 8.5 0 0 1 9.5 4 8.5 8.5 0 1 0 20 14.5Z"/></svg>
                <span>야간 할증</span>
              </div>
              <span class="txm-night-now">현재 30%</span>
            </div>
            <div class="txm-night" role="group" aria-label="야간 할증 선택">
              <button type="button" data-night="auto" aria-pressed="true">자동</button>
              <button type="button" data-night="0" aria-pressed="false">0%</button>
              <button type="button" data-night="20" aria-pressed="false">20%</button>
              <button type="button" data-night="30" aria-pressed="false">30%</button>
              <button type="button" data-night="40" aria-pressed="false">40%</button>
            </div>
            <p class="txm-night-rule">23시~04시 +30%</p>
          </div>

          <div class="txm-tune">
            <div class="txm-tune-row">
              <div class="txm-tune-title">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v18"/><path d="M6 7h12"/><path d="M6 7 3.5 13h5L6 7Z"/><path d="M18 7l-2.5 6h5L18 7Z"/></svg>
                <span class="txm-title-text"><b>시계 외 할증</b><em class="txm-out-sub">용인시 → 타 시·군</em></span>
              </div>
              <div class="txm-ctl">
                <button class="txm-switch" id="txm-out" type="button" aria-pressed="false" aria-label="시계 외 할증"><span></span></button>
                <span class="txm-fixed">+20%</span>
              </div>
            </div>
            <p class="txm-detect" role="status">자동 감지 대기</p>
          </div>

          <div class="txm-tune">
            <div class="txm-tune-row">
              <div class="txm-tune-title">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="8" width="18" height="10" rx="2"/><path d="M7 8V6h10v2"/><path d="M7 13h4"/></svg>
                <span class="txm-title-text"><b>유료도로 통행료</b><em>실제 통행료를 더함</em></span>
              </div>
              <div class="txm-ctl">
                <button class="txm-switch" id="txm-toll" type="button" aria-pressed="false" aria-label="유료도로 통행료"><span></span></button>
              </div>
            </div>
            <div class="txm-money" id="txm-toll-box" hidden>
              <button type="button" class="txm-plus" data-add="toll" data-step="1000">+1,000원</button>
              <label class="txm-input"><input id="txm-toll" type="number" min="0" max="99000" step="100" value="1000" inputmode="numeric"><span>원</span></label>
            </div>
          </div>

          <div class="txm-tune">
            <div class="txm-tune-row">
              <div class="txm-tune-title">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.5"/><path d="M12 8v8M9.5 10.5h4M9.5 14h4"/></svg>
                <span class="txm-title-text"><b>추가 요금</b><em>호출비 등 직접 더하기</em></span>
              </div>
              <div class="txm-ctl">
                <button class="txm-switch" id="txm-extra" type="button" aria-pressed="false" aria-label="추가 요금"><span></span></button>
              </div>
            </div>
            <div class="txm-money" id="txm-extra-box" hidden>
              <button type="button" class="txm-plus" data-add="extra" data-step="1000">+1,000원</button>
              <label class="txm-input"><input id="txm-extra" type="number" min="0" max="99000" step="100" value="2000" inputmode="numeric"><span>원</span></label>
            </div>
          </div>
        </section>

        <div class="txm-actions">
          <button class="txm-btn txm-clear" id="txm-clear" type="button">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20V9l6-5 6 5v11"/><path d="M9 20v-6h4v6"/></svg>
            <b>빈 차</b>
          </button>
          <button class="txm-btn txm-go" id="txm-go" type="button">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="m13 6 6 6-6 6"/></svg>
            <b>주행 시작</b>
          </button>
          <button class="txm-btn txm-hold" id="txm-hold" type="button">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5v14M15 5v14"/></svg>
            <b>일시 정지</b>
          </button>
          <button class="txm-btn txm-pay" id="txm-pay" type="button">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 20V9a3 3 0 0 1 3-3h6a3 3 0 0 1 3 3v11"/><path d="M4 20h16"/><path d="M10 11h4"/></svg>
            <b>요금 결제</b><em>1/N</em>
          </button>
        </div>

        <section class="txm-receipt" id="txm-receipt" hidden aria-label="요금 정산"></section>

        <p class="txm-note">실제 영업용 미터기가 아닌 재미·참고용 시뮬레이터예요.</p>
        <p class="sr-only" id="txm-announce" role="status" aria-live="polite"></p>
      </div>
    `;

    const el = (selector) => host.querySelector(selector);
    const els = {
      shell: el('.txm'),
      wake: el('.txm-wake'),
      region: el('#txm-region'),
      board: el('.txm-board'),
      live: el('.txm-live'),
      liveText: el('.txm-live b'),
      surcharge: el('.txm-surcharge'),
      surchargeRate: el('.txm-surcharge b'),
      surchargeLabel: el('.txm-surcharge span'),
      digits: el('#txm-digits'),
      horse: el('#txm-horse'),
      distance: el('.txm-distance'),
      speed: el('.txm-speed'),
      time: el('.txm-time'),
      fs: el('#txm-fs'),
      gps: el('.txm-gps'),
      nightNow: el('.txm-night-now'),
      nightButtons: [...host.querySelectorAll('.txm-night button')],
      nightRule: el('.txm-night-rule'),
      outSub: el('.txm-out-sub'),
      outSwitch: el('#txm-out'),
      outFixed: el('.txm-fixed'),
      detect: el('.txm-detect'),
      tollSwitch: el('#txm-toll'),
      tollBox: el('#txm-toll-box'),
      tollInput: el('#txm-toll-input') || el('#txm-toll-box input'),
      extraSwitch: el('#txm-extra'),
      extraBox: el('#txm-extra-box'),
      extraInput: el('#txm-extra-box input'),
      clear: el('#txm-clear'),
      go: el('#txm-go'),
      hold: el('#txm-hold'),
      pay: el('#txm-pay'),
      receipt: el('#txm-receipt'),
      announce: el('#txm-announce'),
    };

    const led = createLedPanel(els.digits);
    const horse = createDotHorse(els.horse);

    let meterTimer = 0;
    let frameId = 0;
    let lastTickAt = 0;
    let lastHorseAt = 0;
    let horsePhase = 0;
    let wakeSentinel = null;
    let watchId = null;
    let pollTimer = 0;
    let lastFix = null;
    let fixStamp = '';
    let askedDeparture = false;
    let lastFareText = '';
    let disposed = false;

    /* ------------------------------ 계산 ------------------------------ */

    function nightChoiceRate() {
      return resolveNightRate(region, state.nightChoice, new Date());
    }

    function currentFare() {
      return computeFare(region, {
        distanceM: state.distanceM,
        slowSeconds: state.slowMs / 1000,
        nightRate: nightChoiceRate(),
        outOfArea: state.outOfArea,
        toll: state.tollOn ? state.toll : 0,
        extra: state.extraOn ? state.extra : 0,
      });
    }

    function perPersonNow() {
      return splitPerPerson(currentFare().total, state.people);
    }

    /* ------------------------------ 화면 ------------------------------ */

    function announce(text) {
      if (!els.announce) return;
      els.announce.textContent = '';
      window.setTimeout(() => { els.announce.textContent = text; }, 30);
    }

    function setWake(next) {
      state.wake = next;
      if (!els.wake) return;
      els.wake.dataset.state = next;
      els.wake.querySelector('b').textContent = WAKE_LABEL[next] || WAKE_LABEL.wait;
    }

    function setGpsNote(text, tone = '') {
      if (!els.gps) return;
      if (!text) {
        els.gps.hidden = true;
        els.gps.textContent = '';
        return;
      }
      els.gps.hidden = false;
      els.gps.textContent = text;
      els.gps.dataset.tone = tone;
    }

    function syncPhase() {
      els.shell.dataset.phase = state.phase;
      els.live.dataset.state = state.phase;
      els.liveText.textContent = PHASE_LABEL[state.phase] || '빈 차';
      if (els.go) {
        els.go.querySelector('b').textContent = state.phase === 'paused' ? '이어서 주행'
          : state.phase === 'settled' ? '새 주행' : '주행 시작';
        els.go.disabled = state.phase === 'driving';
      }
      if (els.hold) els.hold.disabled = state.phase !== 'driving';
      if (els.pay) {
        els.pay.disabled = state.phase === 'idle' && state.distanceM < 1 && state.elapsedMs < 1000;
        els.pay.dataset.open = state.receiptOpen ? '1' : '0';
      }
    }

    function syncControls() {
      if (els.region) {
        els.region.value = state.regionId;
        els.region.disabled = state.phase !== 'idle';
      }

      els.nightButtons.forEach((button) => {
        button.setAttribute('aria-pressed', String(button.dataset.night) === String(state.nightChoice) ? 'true' : 'false');
      });
      const auto = nightChoiceRate();
      els.nightNow.textContent = state.nightChoice === 'auto'
        ? `자동 ${percentText(auto)}`
        : `직접 ${state.nightChoice}%`;
      els.nightRule.textContent = state.nightChoice === 'auto'
        ? `자동 기준 ${region.nightLabel}`
        : '직접 고른 할증을 씁니다';

      els.outSwitch.setAttribute('aria-pressed', state.outOfArea ? 'true' : 'false');
      els.outSub.textContent = `${coreDistrict(region.district) || region.short} → 타 시·군`;
      if (els.outFixed) els.outFixed.textContent = percentText(region.outOfAreaRate);

      els.tollSwitch.setAttribute('aria-pressed', state.tollOn ? 'true' : 'false');
      els.tollBox.hidden = !state.tollOn;
      if (document.activeElement !== els.tollInput) els.tollInput.value = String(state.toll);
      els.extraSwitch.setAttribute('aria-pressed', state.extraOn ? 'true' : 'false');
      els.extraBox.hidden = !state.extraOn;
      if (document.activeElement !== els.extraInput) els.extraInput.value = String(state.extra);


      if (els.gps && !els.gps.textContent) setGpsNote('주행을 시작하면 현재 위치로 출발 시·군·구를 확인합니다.');
    }

    function paintFare() {
      const fare = currentFare();
      const totalText = formatWon(fare.total);
      led.set(totalText);
      if (totalText !== lastFareText) {
        lastFareText = totalText;
        els.digits.setAttribute('aria-label', `요금 ${totalText}원`);
      }
      const name = surchargeName(region, nightChoiceRate(), state.outOfArea);
      els.surchargeRate.textContent = percentText(fare.rate);
      els.surchargeLabel.textContent = name;
      els.surcharge.dataset.on = fare.rate > 0 ? '1' : '0';

      els.distance.textContent = formatDistance(state.distanceM);
      els.speed.textContent = String(Math.round(state.speedKmh));
      els.time.textContent = formatClock(state.elapsedMs);
    }

    function paintReceipt() {
      const open = state.receiptOpen && state.phase === 'settled';
      els.receipt.hidden = !open;
      if (!open) return;

      const fare = currentFare();
      const nightRate = nightChoiceRate();
      const name = surchargeName(region, nightRate, state.outOfArea);
      const rows = [
        ['기본요금', `${formatWon(fare.base)}원`],
        [`거리요금 (${formatDistance(state.distanceM)}km)`, `${formatWon(fare.distanceFare)}원`],
        [`시간요금 (${formatClock(state.slowMs)})`, `${formatWon(fare.timeFare)}원`],
        [`${name} ${percentText(fare.rate)}`, `${formatWon(fare.surcharge)}원`],
      ];
      if (state.tollOn) rows.push(['유료도로 통행료', `${formatWon(fare.toll)}원`]);
      if (state.extraOn) rows.push(['추가 요금', `${formatWon(fare.extra)}원`]);

      els.receipt.innerHTML = `
        <div class="txm-slip-head">
          <b>요금 정산</b>
          <span>${region.label} · ${fare.capped ? '복합 할증 상한 적용' : name}</span>
        </div>
        <dl class="txm-slip">
          ${rows.map(([label, value]) => `<div><dt>${label}</dt><dd>${value}</dd></div>`).join('')}
          <div class="txm-slip-total"><dt>합계</dt><dd>${formatWon(fare.total)}원</dd></div>
        </dl>
        <div class="txm-split">
          <span class="txm-split-label">나눠 낼 인원</span>
          <div class="txm-stepper">
            <button type="button" data-people="-1" aria-label="한 명 줄이기">−</button>
            <b><em class="txm-people">${state.people}</em>명</b>
            <button type="button" data-people="1" aria-label="한 명 늘리기">+</button>
          </div>
        </div>
        <div class="txm-per">
          <span>1인당</span>
          <b><em class="txm-per-value">${formatWon(perPersonNow())}</em>원</b>
        </div>
        <div class="txm-slip-actions">
          <button class="txm-copy" type="button" id="txm-copy">영수증 복사</button>
          <button class="txm-again" type="button" id="txm-again">빈 차로 돌리기</button>
        </div>
      `;
      const minus = els.receipt.querySelector('[data-people="-1"]');
      const plus = els.receipt.querySelector('[data-people="1"]');
      if (minus) minus.disabled = state.people <= 1;
      if (plus) plus.disabled = state.people >= 20;
      bindReceiptActions();
    }

    function receiptText() {
      const fare = currentFare();
      const name = surchargeName(region, nightChoiceRate(), state.outOfArea);
      const lines = [
        `택시 미터기 정산 (${region.label})`,
        `기본요금 ${formatWon(fare.base)}원`,
        `거리요금 ${formatDistance(state.distanceM)}km ${formatWon(fare.distanceFare)}원`,
        `시간요금 ${formatClock(state.slowMs)} ${formatWon(fare.timeFare)}원`,
        `${name} ${percentText(fare.rate)} ${formatWon(fare.surcharge)}원`,
      ];
      if (state.tollOn) lines.push(`유료도로 통행료 ${formatWon(fare.toll)}원`);
      if (state.extraOn) lines.push(`추가 요금 ${formatWon(fare.extra)}원`);
      lines.push(`합계 ${formatWon(fare.total)}원`);
      lines.push(`${state.people}명 1인당 ${formatWon(perPersonNow())}원`);
      lines.push('재미로 보는 시뮬레이터입니다.');
      return lines.join('\n');
    }

    async function copyReceipt() {
      const text = receiptText();
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(text);
        } else {
          const area = document.createElement('textarea');
          area.value = text;
          area.setAttribute('readonly', '');
          area.style.position = 'fixed';
          area.style.opacity = '0';
          document.body.append(area);
          area.select();
          document.execCommand('copy');
          area.remove();
        }
        toast('영수증을 복사했어요');
      } catch {
        toast('복사하지 못했어요. 영수증을 직접 선택해 주세요.');
      }
    }

    function bindReceiptActions() {
      const copy = els.receipt.querySelector('#txm-copy');
      if (copy) copy.addEventListener('click', copyReceipt, { signal });
      const again = els.receipt.querySelector('#txm-again');
      if (again) again.addEventListener('click', () => { emptyRide(); toast('빈 차로 돌렸어요'); }, { signal });
      els.receipt.querySelectorAll('[data-people]').forEach((button) => {
        button.addEventListener('click', () => {
          const next = state.people + Number(button.dataset.people);
          state.people = Math.min(20, Math.max(1, next));
          saveSettings();
          paintReceipt();
          paintFare();
        }, { signal });
      });
    }

    function paint() {
      paintFare();
      syncPhase();
      syncControls();
      paintReceipt();
    }

    function saveSettings() {
      try {
        localStorage.setItem(STORE_KEY, JSON.stringify({ region: state.regionId, people: state.people }));
      } catch { /* 저장하지 못해도 화면은 그대로 */ }
    }

    /* ------------------------------ Wake Lock ------------------------------ */

    async function acquireWake() {
      if (!navigator.wakeLock || typeof navigator.wakeLock.request !== 'function') {
        setWake('none');
        return;
      }
      try {
        const sentinel = await navigator.wakeLock.request('screen');
        if (state.phase !== 'driving') {
          try { await sentinel.release(); } catch { /* 이미 풀림 */ }
          return;
        }
        wakeSentinel = sentinel;
        setWake('on');
        sentinel.addEventListener('release', () => {
          if (wakeSentinel === sentinel) wakeSentinel = null;
          if (state.phase === 'driving') setWake('wait');
        });
      } catch {
        setWake('wait');
      }
    }

    function releaseWake() {
      const sentinel = wakeSentinel;
      wakeSentinel = null;
      if (sentinel) {
        try { sentinel.release(); } catch { /* 이미 풀림 */ }
      }
      setWake('wait');
    }

    /* ------------------------------ 전체화면 ------------------------------ */

    function paintFullscreen() {
      const on = state.fullscreen;
      els.shell.classList.toggle('txm-fs', on);
      document.documentElement.classList.toggle('txm-fs-open', on);
      if (!els.fs) return;
      els.fs.setAttribute('aria-pressed', on ? 'true' : 'false');
      els.fs.setAttribute('aria-label', on ? '전체화면에서 나가기' : '전체화면으로 보기');
      const label = els.fs.querySelector('span');
      if (label) label.textContent = on ? '나가기' : '전체화면';
    }

    // requestFullscreen 이 있는 곳(데스크톱 사파리·크롬 일부)은 브라우저 전체화면을 함께 쓴다.
    // iOS 사파리·홈 화면 앱처럼 막힌 곳은 CSS 오버레이만으로 화면을 꽉 채운다.
    function requestNativeFullscreen() {
      const target = els.shell;
      if (!target || typeof target.requestFullscreen !== 'function') return;
      try {
        const pending = target.requestFullscreen({ navigationUI: 'hide' });
        if (pending && typeof pending.catch === 'function') pending.catch(() => {});
      } catch { /* 오버레이가 대신한다 */ }
    }

    function exitNativeFullscreen() {
      if (!document.fullscreenElement || typeof document.exitFullscreen !== 'function') return;
      try {
        const pending = document.exitFullscreen();
        if (pending && typeof pending.catch === 'function') pending.catch(() => {});
      } catch { /* 이미 나온 상태 */ }
    }

    function enterFullscreen() {
      if (state.fullscreen) return;
      state.fullscreen = true;
      paintFullscreen();
      requestNativeFullscreen();
      led.resize();
      horse.resize();
      announce('전체화면으로 열었습니다. 나가기 단추나 Esc 로 돌아옵니다.');
    }

    function leaveFullscreen() {
      if (!state.fullscreen) return;
      state.fullscreen = false;
      paintFullscreen();
      exitNativeFullscreen();
      led.resize();
      horse.resize();
      announce('전체화면에서 나왔습니다.');
    }

    if (els.fs) {
      els.fs.addEventListener('click', () => {
        if (state.fullscreen) leaveFullscreen();
        else enterFullscreen();
      }, { signal });
    }

    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape' || !state.fullscreen) return;
      leaveFullscreen();
    }, { signal });

    // 브라우저가 스스로 전체화면을 닫으면(Esc·창 전환) 오버레이도 같이 닫는다.
    document.addEventListener('fullscreenchange', () => {
      if (!document.fullscreenElement && state.fullscreen) leaveFullscreen();
    }, { signal });

    /* ------------------------------ GPS ------------------------------ */

    function stopGps() {
      if (watchId !== null && navigator.geolocation) {
        try { navigator.geolocation.clearWatch(watchId); } catch { /* 이미 끊김 */ }
      }
      watchId = null;
      if (pollTimer) clearInterval(pollTimer);
      pollTimer = 0;
      lastFix = null;
      fixStamp = '';
    }

    function geolocationOptions() {
      return { enableHighAccuracy: true, maximumAge: 1000, timeout: 15000 };
    }

    function onGpsError(error) {
      const code = error && error.code;
      if (code === 1) {
        setGpsNote('위치 권한이 꺼져 있어요. 주소창 또는 설정에서 이 앱의 위치 권한을 허용해 주세요.', 'warn');
        if (state.phase === 'driving') {
          state.phase = 'idle';
          releaseWake();
          stopGps();
          paint();
        }
      } else if (code === 3) {
        setGpsNote('위치를 잡는 데 시간이 걸려요. 하늘이 보이는 곳에서 다시 시도해 주세요.', 'warn');
      } else {
        setGpsNote('위치를 받지 못했어요. 잠시 뒤 다시 시도합니다.', 'warn');
      }
    }

    function describeBoundary(result) {
      if (!result) return;
      if (result.kind === 'ready') {
        els.detect.dataset.tone = 'ok';
        els.detect.textContent = `출발지 ${result.departure}`;
        return;
      }
      if (result.kind === 'unknown') {
        els.detect.dataset.tone = 'warn';
        els.detect.textContent = '위치 지역을 확인하지 못했어요. 할증은 직접 켜 주세요.';
        return;
      }
      if (result.kind === 'update') {
        els.detect.dataset.tone = result.out ? 'warn' : 'ok';
        if (result.changed) {
          state.outOfArea = result.out;
          const move = `${result.departure} → ${result.current}`;
          els.detect.textContent = `자동 감지: ${move}`;
          announce(result.out ? `시계 외 할증을 자동으로 켰어요. ${move}` : `출발지로 돌아와 시계 외 할증을 껐어요.`);
          toast(result.out ? `시계 외 할증 ON (${move})` : `시계 외 할증 OFF (${move})`);
          paint();
        } else if (!state.manualOut) {
          els.detect.textContent = `자동 감지: ${result.current}`;
        }
      }
    }

    function onFix(position) {
      if (!position || !position.coords) return;
      const coords = position.coords;
      const stamp = `${position.timestamp || ''}:${coords.latitude}:${coords.longitude}`;
      if (stamp === fixStamp) return;
      fixStamp = stamp;

      const point = {
        lat: Number(coords.latitude),
        lon: Number(coords.longitude),
        accuracy: Number(coords.accuracy) || 0,
        at: Date.now(),
      };
      if (!Number.isFinite(point.lat) || !Number.isFinite(point.lon)) return;

      // 좌표에 속도가 실려 오지 않는 기기(null)와 진짜 0km/h 를 구분한다.
      const reported = coords.speed;
      const reportedKmh = typeof reported === 'number' && Number.isFinite(reported) && reported >= 0
        ? Math.min(200, reported * 3.6) : null;

      if (state.phase === 'driving' && !askedDeparture) {
        askedDeparture = true;
        boundary.begin(point).then(describeBoundary).catch(() => {});
      }

      if (state.phase !== 'driving') {
        lastFix = point;
        return;
      }

      if (point.accuracy > 120) {
        setGpsNote(`GPS 정확도가 낮아요 (${Math.round(point.accuracy)}m). 탁 트인 곳에서 다시 시도해 주세요.`, 'warn');
        return;
      }

      if (!lastFix) {
        lastFix = point;
        state.speedKmh = reportedKmh !== null ? reportedKmh : 0;
        setGpsNote(`GPS 연결됨 · 정확도 ${Math.round(point.accuracy)}m`, 'ok');
        paint();
        return;
      }

      const moved = haversineMeters(lastFix, point);
      const seconds = Math.max(0.4, (point.at - lastFix.at) / 1000);
      const implied = (moved / seconds) * 3.6;

      if (implied > 250) {
        // 순간이동 같은 좌표는 거리에 넣지 않고 기준점만 옮긴다.
        lastFix = point;
        return;
      }

      const noise = Math.max(4, point.accuracy * 0.7);
      if (moved >= noise) {
        state.distanceM += moved;
        state.speedKmh = reportedKmh !== null ? reportedKmh : Math.min(200, implied);
        lastFix = point;
      } else {
        // 정지 중 오차 — 거리로 세지 않고, 기준점도 그대로 둔다.
        state.speedKmh = reportedKmh !== null ? reportedKmh : 0;
      }

      setGpsNote(`GPS 연결됨 · 정확도 ${Math.round(point.accuracy)}m`, 'ok');
      boundary.observe(point).then(describeBoundary).catch(() => {});
      paint();
    }

    function startGps() {
      stopGps();
      if (!('geolocation' in navigator)) {
        setGpsNote('이 환경에서는 위치를 쓸 수 없어요. 위치 권한을 허용한 뒤 다시 시도해 주세요.', 'warn');
        return;
      }
      try {
        watchId = navigator.geolocation.watchPosition(onFix, onGpsError, geolocationOptions());
        // watchPosition 이 뜸한 기기에서도 2.5초마다 한 번 더 물어본다(같은 좌표는 걸러진다).
        pollTimer = window.setInterval(() => {
          if (state.phase !== 'driving') return;
          try {
            navigator.geolocation.getCurrentPosition(onFix, () => {}, { enableHighAccuracy: true, maximumAge: 2000, timeout: 8000 });
          } catch { /* 무시 */ }
        }, 2500);
      } catch {
        setGpsNote('위치를 켜지 못했어요. 위치 권한을 허용한 뒤 다시 시도해 주세요.', 'warn');
      }
    }

    /* ------------------------------ 주행 ------------------------------ */

    function tick() {
      const now = Date.now();
      const delta = lastTickAt ? Math.min(600000, now - lastTickAt) : 0;
      lastTickAt = now;
      if (state.phase !== 'driving') return;

      state.elapsedMs += delta;
      if (state.speedKmh < region.lowSpeedKmh && lastFix) state.slowMs += delta;
      paintFare();
    }

    function startTick() {
      if (meterTimer) return;
      lastTickAt = Date.now();
      meterTimer = window.setInterval(tick, 250);
    }

    function stopTick() {
      if (meterTimer) clearInterval(meterTimer);
      meterTimer = 0;
      lastTickAt = 0;
    }

    function frame(now) {
      if (disposed) return;
      frameId = requestAnimationFrame(frame);
      if (now - lastHorseAt < 40) return;
      lastHorseAt = now;
      const speed = state.phase === 'driving' ? state.speedKmh : 0;
      if (speed >= 1) horsePhase += 0.28 + (Math.min(speed, 120) / 120) * 0.85;
      horse.draw({ speed, phase: horsePhase });
    }

    function resetMeter() {
      state.distanceM = 0;
      state.slowMs = 0;
      state.elapsedMs = 0;
      state.speedKmh = 0;
      lastFareText = '';
      boundary.reset();
      askedDeparture = false;
    }

    function startRide() {
      if (state.phase === 'driving') return;
      if (state.phase === 'settled' || state.phase === 'idle') {
        resetMeter();
        state.outOfArea = false;
        state.manualOut = false;
        state.receiptOpen = false;
        els.detect.dataset.tone = '';
        els.detect.textContent = '자동 감지 대기';
      }
      state.phase = 'driving';
      startGps();
      setGpsNote('위치를 잡는 중이에요.', '');
      acquireWake();
      startTick();
      paint();
      announce('GPS 주행을 시작했습니다.');
    }

    function pauseRide() {
      if (state.phase !== 'driving') return;
      state.phase = 'paused';
      state.speedKmh = 0;
      stopTick();
      stopGps();
      releaseWake();
      paint();
      announce('주행을 잠시 멈췄습니다.');
    }

    function settleRide() {
      if (state.phase === 'settled') {
        state.receiptOpen = !state.receiptOpen;
        paint();
        return;
      }
      if (state.phase !== 'driving' && state.phase !== 'paused') {
        toast('먼저 주행을 시작해 주세요');
        return;
      }
      if (state.distanceM < 1 && state.elapsedMs < 1000) {
        toast('아직 달린 거리가 없어요');
        return;
      }
      state.phase = 'settled';
      state.speedKmh = 0;
      state.receiptOpen = true;
      stopTick();
      stopGps();
      releaseWake();
      paint();
      announce('요금을 정산했습니다.');
    }

    function emptyRide() {
      state.phase = 'idle';
      resetMeter();
      state.outOfArea = false;
      state.manualOut = false;
      state.receiptOpen = false;
      stopTick();
      stopGps();
      releaseWake();
      els.detect.dataset.tone = '';
      els.detect.textContent = '자동 감지 대기';
      setGpsNote('주행을 시작하면 현재 위치로 출발 시·군·구를 확인합니다.');
      paint();
      announce('빈 차로 돌렸습니다.');
    }

    /* ------------------------------ 입력 ------------------------------ */

    els.go.addEventListener('click', () => {
      if (state.phase === 'driving') return;
      startRide();
    }, { signal });

    els.hold.addEventListener('click', pauseRide, { signal });
    els.pay.addEventListener('click', settleRide, { signal });
    els.clear.addEventListener('click', () => { emptyRide(); toast('빈 차로 돌렸어요'); }, { signal });

    els.region.addEventListener('change', () => {
      if (state.phase !== 'idle') {
        els.region.value = state.regionId;
        toast('주행 중에는 지역을 바꿀 수 없어요. 빈 차로 돌린 뒤 바꿔 주세요.');
        return;
      }
      state.regionId = els.region.value;
      region = regionById(state.regionId);
      state.outOfArea = false;
      state.manualOut = false;
      boundary.reset();
      els.detect.dataset.tone = '';
      els.detect.textContent = '자동 감지 대기';
      saveSettings();
      paint();
    }, { signal });

    els.nightButtons.forEach((button) => {
      button.addEventListener('click', () => {
        state.nightChoice = button.dataset.night === 'auto' ? 'auto' : Number(button.dataset.night);
        paint();
      }, { signal });
    });

    els.outSwitch.addEventListener('click', () => {
      state.manualOut = true;
      state.outOfArea = !state.outOfArea;
      boundary.takeManual(state.outOfArea);
      els.detect.dataset.tone = 'ok';
      els.detect.textContent = state.outOfArea ? '수동 설정: 시계 외 할증 켜짐' : '수동 설정: 시계 외 할증 꺼짐';
      paint();
    }, { signal });

    els.tollSwitch.addEventListener('click', () => {
      state.tollOn = !state.tollOn;
      paint();
    }, { signal });

    els.extraSwitch.addEventListener('click', () => {
      state.extraOn = !state.extraOn;
      paint();
    }, { signal });

    function bindAmount(input, key) {
      input.addEventListener('input', () => {
        const raw = Number(String(input.value).replace(/[^\d]/g, ''));
        state[key] = Math.min(99000, Number.isFinite(raw) ? Math.round(raw / UNIT) * UNIT : 0);
        paintFare();
      }, { signal });
      input.addEventListener('blur', () => {
        input.value = String(state[key]);
      }, { signal });
    }
    bindAmount(els.tollInput, 'toll');
    bindAmount(els.extraInput, 'extra');

    host.querySelectorAll('[data-add]').forEach((button) => {
      button.addEventListener('click', () => {
        const key = button.dataset.add;
        state[key] = Math.min(99000, state[key] + Number(button.dataset.step || 1000));
        paint();
      }, { signal });
    });

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        setWake(state.wake === 'none' ? 'none' : 'wait');
        return;
      }
      if (state.phase === 'driving') acquireWake();
      lastTickAt = Date.now();
      paint();
    }, { signal });

    const resizeObserver = typeof ResizeObserver === 'function'
      ? new ResizeObserver(() => { led.resize(); horse.resize(); })
      : null;
    if (resizeObserver) {
      resizeObserver.observe(els.board);
      resizeObserver.observe(els.digits.parentElement || els.digits);
      resizeObserver.observe(els.horse.parentElement || els.horse);
    }
    window.addEventListener('resize', () => { led.resize(); horse.resize(); }, { signal });

    setWake('wait');
    els.region.value = state.regionId;
    setGpsNote('주행을 시작하면 현재 위치로 출발 시·군·구를 확인합니다.');
    led.resize();
    horse.resize();
    paint();
    frameId = requestAnimationFrame(frame);

    return () => {
      disposed = true;
      controller.abort();
      if (frameId) cancelAnimationFrame(frameId);
      stopTick();
      stopGps();
      releaseWake();
      if (state.fullscreen) {
        state.fullscreen = false;
        document.documentElement.classList.remove('txm-fs-open');
        exitNativeFullscreen();
      }
      if (resizeObserver) resizeObserver.disconnect();
      host.remove();
    };
  },
};

export default module;
