/* TIP · '이어서 하기' — 한 모듈의 결과를 다음 모듈로 넘긴다 (v1.16.0)
 *
 * 저장소에 남기지 않는다. 화면을 옮기는 그 순간 메모리에만 두고, 받는 모듈이 한 번 꺼내면 사라진다.
 *   글자 추출 → 텍스트 비교·마크다운 편집기
 *   이미지 컨버터 → 파일 압축·사진 모자이크
 *   PDF 결과 → 파일 압축
 *
 * 넘기는 값
 *   { text }                       글자
 *   { files: [File] }              파일 (브라우저 File, 기기 안에서만)
 */

const TTL = 5 * 60 * 1000;
let pending = null;

export function setContinue(moduleId, payload) {
  const id = String(moduleId || '').trim();
  if (!id || !payload) return false;
  pending = { moduleId: id, created: Date.now(), ...payload };
  return true;
}

export function peekContinue(moduleId) {
  if (!pending || pending.moduleId !== moduleId || Date.now() - pending.created > TTL) return null;
  return pending;
}

/** 한 번 꺼내면 지운다 — 같은 결과가 두 번 적용되지 않게. */
export function takeContinue(moduleId) {
  const value = peekContinue(moduleId);
  pending = null;
  return value;
}

/** 결과를 넘기고 그 모듈로 이동한다. */
export function continueTo(ctx, moduleId, payload) {
  if (!setContinue(moduleId, payload)) return false;
  if (ctx && typeof ctx.goModule === 'function') ctx.goModule(moduleId);
  else location.hash = `#/${moduleId}`;
  return true;
}

/**
 * 결과 영역 아래에 '이어서 하기' 버튼 줄을 붙인다.
 *   appendContinueBar(holder, ctx, [
 *     { id: 'text-diff', label: '텍스트 비교', payload: { text } },
 *     { id: 'md-editor', label: '마크다운으로 쓰기', payload: { text } },
 *   ]);
 */
export function appendContinueBar(holder, ctx, items) {
  if (!holder) return null;
  holder.querySelector(':scope > .continue-bar')?.remove();
  const list = (items || []).filter((item) => item && item.id && item.payload);
  if (!list.length) return null;

  const bar = document.createElement('div');
  bar.className = 'continue-bar';
  const label = document.createElement('span');
  label.className = 'continue-label';
  label.textContent = '이어서 하기';
  bar.append(label);

  list.forEach((item) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'v16-btn';
    button.textContent = item.label;
    button.addEventListener('click', () => {
      if (continueTo(ctx, item.id, item.payload)) {
        if (ctx && typeof ctx.toast === 'function') ctx.toast(`${item.label}로 넘겼습니다`);
      }
    });
    bar.append(button);
  });

  holder.append(bar);
  return bar;
}
