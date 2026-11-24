/* TIP · 우편번호 결과 안내 — v1.15.1
 *
 * 주소를 고른 우편번호 창이 postcode-done.html#d=<base64 JSON> 로 이동한다. Rust 는 같은 조각을
 * 읽어 본문 창에 `tip://postcode-result` 로 넘기고, 본문 창이 이 창을 닫는다. 그 사이에 이 문서는
 * 고른 주소를 사람이 읽고 복사할 수 있게 보여 준다(결과 전달이 실패해도 직접 옮겨 적을 수 있게).
 *
 * 이 창에는 Tauri IPC 권한이 없으므로 Tauri 를 부르지 않는다 — 주소를 화면에 그리는 일만 한다.
 */

(function () {
  var rowsEl = document.getElementById('done-rows');
  var hintEl = document.getElementById('done-hint');

  function decode(hash) {
    var raw = String(hash || '').replace(/^#/, '');
    if (raw.indexOf('d=') !== 0) return null;
    var encoded = raw.slice(2);
    // 인코딩된 채로 와도 읽는다(퍼센트 인코딩 유무 둘 다).
    var variants = [encoded];
    try { variants.push(decodeURIComponent(encoded)); } catch (error) { /* 그대로도 시도한다 */ }
    for (var index = 0; index < variants.length; index += 1) {
      try {
        var json = decodeURIComponent(escape(atob(variants[index])));
        var data = JSON.parse(json);
        if (data && typeof data === 'object') return data;
      } catch (error) { /* 다음 방식으로 */ }
    }
    return null;
  }

  function row(label, value) {
    if (!value) return null;
    var wrap = document.createElement('div');
    wrap.className = 'row';
    var dt = document.createElement('dt');
    dt.textContent = label;
    var dd = document.createElement('dd');
    dd.textContent = value;
    wrap.append(dt, dd);
    return wrap;
  }

  var data = decode(location.hash);
  if (!data) {
    if (hintEl) hintEl.textContent = '주소를 읽지 못했습니다. 이 창을 닫고 다시 검색해 주세요.';
    return;
  }

  var items = [
    row('도로명', data.roadAddress || data.autoRoadAddress),
    row('지번', data.jibunAddress || data.autoJibunAddress),
    row('영문', data.roadAddressEnglish || data.jibunAddressEnglish),
    row('우편번호', data.zonecode),
    row('건물명', data.buildingName),
  ].filter(Boolean);

  if (rowsEl) rowsEl.append(...items);
  if (hintEl) {
    hintEl.textContent = navigator.clipboard
      ? '같은 주소를 복사해 두려면 위 내용을 선택해 복사해 주세요.'
      : '창이 닫히지 않으면 직접 닫아 주세요.';
  }
})();
