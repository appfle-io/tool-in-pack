/* 반원 퀵바(Mac 메뉴 막대) 순서 계산 — v1.10.0
 *
 * 모드(`tip.radialOrderMode.v1`):
 *  - 'custom'(기본) — 메인 화면과 같은 순서(고정됨 → 문서 → 미디어 → 유틸리티, 각 섹션은 tip.order.v1).
 *    사용자가 퀵바 순서를 한 번이라도 바꾸면 tip.radialOrder.v1(모듈 id 배열)이 우선한다.
 *  - 'asc' / 'desc' — 켜 둔 모듈을 이름(shortName) 가나다/알파벳 순으로 정렬한다(저장된 순서는 그대로 보관).
 *  - 꺼 둔 모듈도 순서 배열에 남겨 두므로, 다시 켜면 원래 자리로 돌아온다.
 *  - 새로 추가된 모듈(= 배열에 없는 id)은 뒤에 붙는다.
 */

import { listModules, getModule, CATEGORIES, categoryOf } from '../modules/registry.js';
import { moduleState, getSectionOrder, getRadialOrder, setRadialOrder, getRadialOrderMode } from './store.js';

/** 저장된 순서(tip.order.v1)대로 정렬한다. 목록에 없는 모듈은 원래 순서대로 뒤에 붙는다. */
function orderedBy(mods, sectionId) {
  const saved = getSectionOrder(sectionId);
  if (!saved.length) return mods;
  const rank = new Map(saved.map((id, index) => [id, index]));
  const place = (mod) => (rank.has(mod.id) ? rank.get(mod.id) : Number.MAX_SAFE_INTEGER);
  return mods.slice().sort((a, b) => place(a) - place(b));
}

/** 꺼 둔 모듈까지 포함한 기본 순서 — 고정됨 → 문서 → 미디어 → 유틸리티. */
export function defaultQuickOrder() {
  const mods = listModules();
  const pinned = orderedBy(mods.filter((mod) => moduleState(mod).pinned), 'pinned');
  const rest = mods.filter((mod) => !moduleState(mod).pinned);

  const out = pinned.map((mod) => mod.id);
  CATEGORIES.forEach(({ id }) => {
    orderedBy(rest.filter((mod) => categoryOf(mod) === id), id).forEach((mod) => out.push(mod.id));
  });
  return out;
}

/** 레지스트리의 모든 모듈 id 를 담은 '완전한' 퀵바 순서. */
export function fullQuickOrder() {
  const def = defaultQuickOrder();
  const saved = getRadialOrder().filter((id) => !!getModule(id));
  const base = saved.length ? saved.slice() : def.slice();
  def.forEach((id) => {
    if (!base.includes(id)) base.push(id);
  });
  return base;
}

/** 켜 둔 모듈을 저장된(사용자 지정) 순서 그대로 — 편집 목록용. */
export function customQuickOrderIds() {
  return fullQuickOrder().filter((id) => {
    const mod = getModule(id);
    return !!mod && moduleState(mod).enabled;
  });
}

/** 반원 퀵바에 실제로 그릴 순서 — 켜 둔 모듈만. 모드가 asc/desc 면 이름순으로 정렬한다. */
export function quickOrderIds() {
  const ids = customQuickOrderIds();

  const mode = getRadialOrderMode();
  if (mode === 'custom') return ids;

  const dir = mode === 'desc' ? -1 : 1;
  const label = (id) => {
    const mod = getModule(id);
    return String((mod && (mod.shortName || mod.name)) || id);
  };
  return ids.slice().sort((a, b) => dir * label(a).localeCompare(label(b), 'ko'));
}

/** 켜 둔 모듈의 새 순서를 저장한다. 꺼 둔 모듈은 배열에서 원래 자리를 지킨다. */
export function saveQuickOrder(onIds) {
  const base = fullQuickOrder();
  const onSet = new Set(onIds);
  let next = 0;
  const merged = base.map((id) => (onSet.has(id) ? onIds[next++] : id));
  onIds.slice(next).forEach((id) => {
    if (!merged.includes(id)) merged.push(id);
  });
  setRadialOrder(merged);
}
