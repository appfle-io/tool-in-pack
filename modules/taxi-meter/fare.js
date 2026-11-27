/*
 * TIP · 택시 미터기 (taxi-meter) 요금 계산 — 지역 요금표와 할증 규칙.
 *
 * 화면과 계산을 떼어 두어, 요금 규칙만 따로 시험할 수 있게 했다.
 * 숫자는 각 시·도 고시를 2026년 11월 기준으로 옮긴 것입니다. 요금은 바뀔 수 있습니다.
 *
 *   · 서울 중형    기본 1.6km 4,800원 · 131m당 100원 · 30초당 100원
 *                 심야 22~23시 +20%, 23~02시 +40%, 02~04시 +20% · 시계외 +20% (복합 최대 +60%)
 *   · 경기 표준    기본 1.6km 4,800원 · 131m당 100원 · 30초당 100원
 *                 심야 23~04시 +30% · 시계외 +20% (복합 최대 +50%)
 *   · 경기 가형    기본 1.8km 4,800원 · 104m당 100원 · 25초당 100원
 *                 심야 23~04시 +30% · 시계외 +20% (복합 최대 +50%)
 *   · 인천        기본 1.6km 4,800원 · 135m당 100원 · 33초당 100원
 *                 심야 22~23시 +20%, 23~02시 +40%, 02~04시 +20% · 시계외 +30%
 *   · 부산        기본 2.0km 4,800원 · 132m당 100원 · 33초당 100원
 *                 심야 23~00시 +20%, 00~02시 +30%, 02~04시 +20% · 시계외 +30% (복합 최대 +50%)
 *
 * 요금은 100원 단위로 오르고, 막힐 때(시속 15km 안팎 미만)는 시간요금이 함께 쌓인다.
 */

export const UNIT = 100;
export const LOW_SPEED_KMH = 15.72;

export const REGIONS = [
  {
    id: 'yongin',
    label: '용인 · 경기 가형',
    short: '용인',
    district: '용인시',
    baseFare: 4800,
    baseMeters: 1800,
    stepMeters: 104,
    stepSeconds: 25,
    lowSpeedKmh: LOW_SPEED_KMH,
    night: [{ from: 23, to: 4, rate: 0.3 }],
    nightLabel: '23시~04시 +30%',
    outOfAreaRate: 0.2,
    maxSurcharge: 0.5,
  },
  {
    id: 'gyeonggi',
    label: '경기 표준',
    short: '경기',
    district: '수원시',
    baseFare: 4800,
    baseMeters: 1600,
    stepMeters: 131,
    stepSeconds: 30,
    lowSpeedKmh: LOW_SPEED_KMH,
    night: [{ from: 23, to: 4, rate: 0.3 }],
    nightLabel: '23시~04시 +30%',
    outOfAreaRate: 0.2,
    maxSurcharge: 0.5,
  },
  {
    id: 'seoul',
    label: '서울',
    short: '서울',
    district: '중구',
    baseFare: 4800,
    baseMeters: 1600,
    stepMeters: 131,
    stepSeconds: 30,
    lowSpeedKmh: LOW_SPEED_KMH,
    night: [
      { from: 22, to: 23, rate: 0.2 },
      { from: 23, to: 2, rate: 0.4 },
      { from: 2, to: 4, rate: 0.2 },
    ],
    nightLabel: '22~23시 +20% · 23~02시 +40% · 02~04시 +20%',
    outOfAreaRate: 0.2,
    maxSurcharge: 0.6,
  },
  {
    id: 'incheon',
    label: '인천',
    short: '인천',
    district: '인천',
    baseFare: 4800,
    baseMeters: 1600,
    stepMeters: 135,
    stepSeconds: 33,
    lowSpeedKmh: 15,
    night: [
      { from: 22, to: 23, rate: 0.2 },
      { from: 23, to: 2, rate: 0.4 },
      { from: 2, to: 4, rate: 0.2 },
    ],
    nightLabel: '22~23시 +20% · 23~02시 +40% · 02~04시 +20%',
    outOfAreaRate: 0.3,
    maxSurcharge: 0.7,
  },
  {
    id: 'busan',
    label: '부산',
    short: '부산',
    district: '부산',
    baseFare: 4800,
    baseMeters: 2000,
    stepMeters: 132,
    stepSeconds: 33,
    lowSpeedKmh: 15,
    night: [
      { from: 23, to: 0, rate: 0.2 },
      { from: 0, to: 2, rate: 0.3 },
      { from: 2, to: 4, rate: 0.2 },
    ],
    nightLabel: '23~00시 +20% · 00~02시 +30% · 02~04시 +20%',
    outOfAreaRate: 0.3,
    maxSurcharge: 0.5,
  },
];

export const NIGHT_CHOICES = ['auto', 0, 20, 30, 40];

export function regionById(id) {
  return REGIONS.find((region) => region.id === id) || REGIONS[0];
}

/** 시각이 심야 구간 안인지. 자정을 넘는 구간(23시~04시)도 받는다. */
export function inNightWindow(hour, window) {
  if (window.from === window.to) return false;
  return window.from < window.to
    ? hour >= window.from && hour < window.to
    : hour >= window.from || hour < window.to;
}

/** 그 시각에 자동으로 붙는 심야 할증률(0, 0.2, 0.3, 0.4). */
export function nightRateAt(region, date = new Date()) {
  const hour = date.getHours();
  for (const window of region.night) {
    if (inNightWindow(hour, window)) return window.rate;
  }
  return 0;
}

/**
 * 화면의 야간 할증 선택(auto / 0 / 20 / 30 / 40)을 실제 할증률로 바꾼다.
 * auto 일 때만 시계를 본다.
 */
export function resolveNightRate(region, choice, date = new Date()) {
  if (choice === 'auto' || choice === undefined || choice === null) return nightRateAt(region, date);
  const percent = Number(choice);
  return Number.isFinite(percent) ? Math.max(0, percent) / 100 : 0;
}

/**
 * 요금 계산. 거리(m)와 느린 시간(초)을 넣으면 기본·거리·시간·할증·통행료로 나눠 돌려준다.
 * 할증은 기본+거리+시간 합계에 붙고, 지역 상한(복합 할증)에서 잘린다.
 */
export function computeFare(region, input = {}) {
  const distanceM = Math.max(0, Number(input.distanceM) || 0);
  const slowSeconds = Math.max(0, Number(input.slowSeconds) || 0);
  const nightRate = Math.max(0, Number(input.nightRate) || 0);
  const outOfAreaRate = input.outOfArea ? region.outOfAreaRate : 0;
  const toll = Math.max(0, Math.round(Number(input.toll) || 0));
  const extra = Math.max(0, Math.round(Number(input.extra) || 0));

  const overMeters = Math.max(0, distanceM - region.baseMeters);
  const distanceFare = Math.floor(overMeters / region.stepMeters) * UNIT;
  const timeFare = Math.floor(slowSeconds / region.stepSeconds) * UNIT;
  const meterFare = region.baseFare + distanceFare + timeFare;

  const requested = nightRate + outOfAreaRate;
  const rate = Math.min(requested, region.maxSurcharge);
  const meterTotal = Math.round((meterFare * (1 + rate)) / UNIT) * UNIT;
  const surcharge = meterTotal - meterFare;

  return {
    base: region.baseFare,
    distanceFare,
    timeFare,
    meterFare,
    rate,
    capped: requested > rate + 1e-9,
    surcharge,
    meterTotal,
    toll,
    extra,
    total: meterTotal + toll + extra,
    discount: 0,
  };
}

/** 붙는 할증의 이름 — 복합 / 야간 / 시계외 / 없음. */
export function surchargeName(region, nightRate, outOfArea) {
  const night = nightRate > 0;
  const out = !!outOfArea && region.outOfAreaRate > 0;
  if (night && out) return '복합 할증';
  if (night) return '야간 할증';
  if (out) return '시계외 할증';
  return '할증 없음';
}

export function percentText(rate) {
  const percent = Math.round(rate * 100);
  return `${percent > 0 ? '+' : ''}${percent}%`;
}

export function formatWon(value) {
  const number = Math.round(Number(value) || 0);
  return number.toLocaleString('ko-KR');
}

/** 경과 시간 — 1시간이 넘으면 h:mm:ss. */
export function formatClock(milliseconds) {
  const total = Math.max(0, Math.floor((Number(milliseconds) || 0) / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const pad = (number) => String(number).padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
}

export function formatDistance(meters) {
  const km = Math.max(0, Number(meters) || 0) / 1000;
  return km >= 100 ? km.toFixed(1) : km.toFixed(2);
}

/** 1/N 정산 — 10원 단위로 올린다(모자라게 걷지 않도록). */
export function splitPerPerson(total, people) {
  const count = Math.min(20, Math.max(1, Math.round(Number(people) || 1)));
  return Math.ceil((Number(total) || 0) / count / 10) * 10;
}
