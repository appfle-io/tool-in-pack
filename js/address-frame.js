/* TIP · 우편번호 검색 전용 문서 — v1.13.0
 *
 * 왜 따로 두나:
 *   v1.12.3 까지는 메인 화면(index.html)이 다음(카카오) 우편번호 스크립트를 직접 불러와
 *   그 안에 검색 UI 를 embed 했다. 그러면 외부 스크립트가 앱 화면과 같은 문서에서 돈다.
 *   이제는 이 문서(iframe)에서만 돌리고, 고른 주소만 부모 화면으로 postMessage 한다.
 *
 * 부모(modules/address-search/module.js)와 주고받는 메시지
 *   ← { type: 'tip:address:open' }                 검색 UI 를 연다
 *   → { type: 'tip:address:ready' }                이 문서가 준비됨
 *   → { type: 'tip:address:opened' }               검색 UI 가 떴다
 *   → { type: 'tip:address:error', message }       서비스를 불러오지 못했다
 *   → { type: 'tip:address:result', data: {...} }  주소를 골랐다
 *
 * 주소 값은 다음 서비스가 준 값만 그대로 넘긴다. 이 문서는 앱 저장소(localStorage)를 쓰지 않는다.
 *
 * v1.13.1 — 카카오가 t1.daumcdn.net 을 닫는다고 공지(2026-11-30 종료)해 스크립트 주소를
 *   t1.kakaocdn.net 으로 바꿨다. 두 주소는 같은 파일(35,814 bytes)을 내려 준다.
 */

(function () {
  var SRC = 'https://t1.kakaocdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js';
  var statusEl = document.getElementById('addr-frame-status');
  var embedEl = document.getElementById('addr-frame-embed');
  var loading = null;
  var opened = false;

  function post(message) {
    try { parent.postMessage(message, '*'); } catch (error) { /* 부모가 없으면 그냥 둔다 */ }
  }

  function fail(message) {
    if (statusEl) {
      statusEl.hidden = false;
      statusEl.textContent = '우편번호 서비스를 불러오지 못했습니다 — 인터넷 연결을 확인한 뒤 다시 눌러 주세요.';
    }
    post({ type: 'tip:address:error', message: String(message || 'network') });
  }

  function load() {
    if (window.daum && window.daum.Postcode) return Promise.resolve();
    if (loading) return loading;

    loading = new Promise(function (resolve, reject) {
      var script = document.createElement('script');
      script.src = SRC;
      script.async = true;
      var timer = setTimeout(function () { reject(new Error('timeout')); }, 12000);
      script.onload = function () {
        clearTimeout(timer);
        if (window.daum && window.daum.Postcode) resolve();
        else reject(new Error('missing'));
      };
      script.onerror = function () {
        clearTimeout(timer);
        reject(new Error('network'));
      };
      document.head.appendChild(script);
    }).catch(function (error) {
      loading = null;
      throw error;
    });

    return loading;
  }

  function open() {
    if (opened) return;
    load().then(function () {
      opened = true;
      if (statusEl) statusEl.hidden = true;
      if (embedEl) embedEl.hidden = false;
      // v1.14.0 — embed 전에 한 번 레이아웃을 확정한다. 보이지 않는(높이 0) 상자에 embed 하면
      // 다음 우편번호 서비스가 0 높이로 그려 왼쪽 위에 작은 상자만 남았다.
      void (embedEl && embedEl.offsetHeight);
      var postcode = new window.daum.Postcode({
        oncomplete: function (data) {
          post({
            type: 'tip:address:result',
            data: {
              roadAddress: data.roadAddress || '',
              autoRoadAddress: data.autoRoadAddress || '',
              jibunAddress: data.jibunAddress || '',
              autoJibunAddress: data.autoJibunAddress || '',
              roadAddressEnglish: data.roadAddressEnglish || '',
              jibunAddressEnglish: data.jibunAddressEnglish || '',
              zonecode: data.zonecode || '',
              buildingName: data.buildingName || '',
            },
          });
        },
        width: '100%',
        height: '100%',
      });
      postcode.embed(embedEl, { q: '' });
      // embed 뒤에도 한 번 더 크기를 알려 준다(내부 iframe 이 100% 로 늘어나게).
      setTimeout(function () {
        var inner = embedEl && embedEl.querySelector('iframe');
        if (inner) {
          inner.style.width = '100%';
          inner.style.height = '100%';
          inner.style.border = '0';
          inner.style.display = 'block';
        }
      }, 60);
      // v1.13.0 — embed() 가 조용히 아무것도 그리지 않으면 화면이 흰색으로만 남았다.
      // 잠깐 뒤 속을 보고, 비어 있으면 부모에 오류로 알려 안내 문구가 뜨게 한다.
      setTimeout(function () {
        var drew = embedEl && (embedEl.childElementCount > 0 || embedEl.textContent.trim().length > 0);
        if (!drew) {
          opened = false;
          embedEl.hidden = true;
          fail('empty');
          return;
        }
        post({ type: 'tip:address:opened' });
      }, 1200);
    }).catch(function (error) {
      fail(error && error.message ? error.message : error);
    });
  }

  window.addEventListener('message', function (event) {
    var data = event.data;
    if (!data || data.type !== 'tip:address:open') return;
    open();
  });

  post({ type: 'tip:address:ready' });
})();
