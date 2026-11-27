/*
 * TIP · 택시 미터기 (taxi-meter) 시계외 자동 감지 — 출발한 시·군·구를 벗어나면 +20% 를 켠다.
 *
 * 흐름
 *   1) GPS 주행을 시작하면 현재 좌표로 출발 시·군·구를 한 번 확인한다(역지오코딩).
 *   2) 주행 중 500m 넘게 움직였고 마지막 확인에서 60초가 지났으면 현재 위치를 다시 확인한다.
 *   3) 출발지와 달라지면 화면 쪽에 알려 준다(할증 스위치는 부르는 쪽이 켠다).
 *
 * 원칙
 *   · 인터넷이 없거나 서비스가 응답하지 않아도 조용히 넘어간다. 콘솔에 오류를 남기지 않는다
 *     (미터기 자체는 오프라인에서도 그대로 돌아야 한다).
 *   · 세 번 실패하면 그 주행에서는 더 시도하지 않고 사람이 직접 켜는 쪽으로 둔다.
 *   · 사용자가 스위치를 직접 만졌으면(manual) 자동 감지가 덮어쓰지 않는다.
 */

export const REVERSE_ENDPOINT = 'https://nominatim.openstreetmap.org/reverse';
export const DISTRICT_KEYS = ['city', 'county', 'municipality', 'borough', 'city_district', 'town', 'village', 'suburb', 'district'];
const DISTRICT_SUFFIX = /(시|군|구)$/;

/** 두 좌표 사이 거리(m). */
export function haversineMeters(from, to) {
  if (!from || !to) return 0;
  const radius = 6371000;
  const toRad = (value) => (value * Math.PI) / 180;
  const dLat = toRad(to.lat - from.lat);
  const dLon = toRad(to.lon - from.lon);
  const lat1 = toRad(from.lat);
  const lat2 = toRad(to.lat);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * radius * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** 역지오코딩 응답의 address 에서 시·군·구 이름을 꺼낸다. 없으면 빈 문자열. */
export function districtFromAddress(address) {
  if (!address || typeof address !== 'object') return '';
  const values = DISTRICT_KEYS
    .map((key) => String(address[key] || '').trim())
    .filter(Boolean);
  const named = values.find((value) => DISTRICT_SUFFIX.test(value));
  if (named) return named;
  return values[0] || '';
}

/** '수원시 장안구' 와 '수원시' 를 같은 곳으로 보도록 앞 낱말만 남긴다. */
export function coreDistrict(name) {
  return String(name || '').trim().split(/\s+/)[0] || '';
}

export function sameDistrict(left, right) {
  const a = coreDistrict(left);
  const b = coreDistrict(right);
  if (!a || !b) return true;
  return a === b;
}

const districtCache = new Map();

/**
 * 좌표 → 시·군·구. 실패하면 null. 콘솔에 아무것도 남기지 않는다.
 * timeoutMs 안에 응답이 없으면 요청을 끊는다(4초).
 */
export async function reverseDistrict(lat, lon, options = {}) {
  const timeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : 4000;
  const key = `${Number(lat).toFixed(3)},${Number(lon).toFixed(3)}`;
  if (districtCache.has(key)) return districtCache.get(key);
  if (typeof fetch !== 'function') return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  if (options.signal) {
    if (options.signal.aborted) controller.abort();
    else options.signal.addEventListener('abort', () => controller.abort(), { once: true });
  }
  try {
    const url = `${options.endpoint || REVERSE_ENDPOINT}?format=jsonv2&addressdetails=1&zoom=10`
      + `&accept-language=ko&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}`;
    const response = await fetch(url, {
      signal: controller.signal,
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) return null;
    const data = await response.json();
    const district = districtFromAddress(data && data.address);
    if (district) districtCache.set(key, district);
    return district || null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 한 번의 주행 동안 출발지·현재지를 들고 있는 감시자.
 * 화면은 observe() 가 돌려주는 값만 보고 스위치를 켜고 끈다.
 */
export class BoundaryWatch {
  constructor(options = {}) {
    this.minMoveM = Number(options.minMoveM) > 0 ? Number(options.minMoveM) : 500;
    this.minIntervalMs = Number(options.minIntervalMs) >= 0 ? Number(options.minIntervalMs) : 60000;
    this.timeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : 4000;
    this.endpoint = options.endpoint || REVERSE_ENDPOINT;
    this.signal = options.signal || null;
    this.departure = '';
    this.current = '';
    this.manual = false;
    this.out = false;
    this.failures = 0;
    this.anchor = null;
    this.checkedAt = 0;
    this.busy = false;
  }

  reset() {
    this.departure = '';
    this.current = '';
    this.manual = false;
    this.out = false;
    this.failures = 0;
    this.anchor = null;
    this.checkedAt = 0;
    this.busy = false;
  }

  /** 사용자가 스위치를 직접 만졌다 — 이후 자동 감지는 켜고 끄지 않는다. */
  takeManual(out) {
    this.manual = true;
    this.out = !!out;
  }

  /** 출발지 확인. 실패해도 조용히 false. */
  async begin(point) {
    if (!point || this.busy) return null;
    this.busy = true;
    this.anchor = point;
    this.checkedAt = Date.now();
    const name = await reverseDistrict(point.lat, point.lon, {
      timeoutMs: this.timeoutMs, endpoint: this.endpoint, signal: this.signal,
    });
    this.busy = false;
    if (!name) {
      this.failures += 1;
      return { kind: 'unknown', departure: '', current: '', out: this.out };
    }
    this.departure = name;
    this.current = name;
    return { kind: 'ready', departure: name, current: name, out: this.out };
  }

  /**
   * 새 좌표를 받을 때마다 부른다. 조건(500m·60초)을 못 채우면 null 을 곧바로 돌려준다.
   */
  async observe(point) {
    if (!point || this.busy) return null;
    if (this.failures >= 3) return null;
    if (!this.departure) return this.begin(point);

    const moved = haversineMeters(this.anchor, point);
    if (moved < this.minMoveM) return null;
    if (Date.now() - this.checkedAt < this.minIntervalMs) return null;

    this.busy = true;
    this.anchor = point;
    this.checkedAt = Date.now();
    const name = await reverseDistrict(point.lat, point.lon, {
      timeoutMs: this.timeoutMs, endpoint: this.endpoint, signal: this.signal,
    });
    this.busy = false;

    if (!name) {
      this.failures += 1;
      return { kind: 'unknown', departure: this.departure, current: '', out: this.out };
    }

    this.current = name;
    const previous = this.out;
    const out = !sameDistrict(this.departure, name);
    if (!this.manual) this.out = out;
    return {
      kind: 'update',
      departure: this.departure,
      current: name,
      out: this.manual ? previous : out,
      changed: this.manual ? false : out !== previous,
    };
  }
}
