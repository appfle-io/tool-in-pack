/* TIP · 우편번호 전용 창 — v1.15.1 (Mac 앱)
 *
 * 왜 따로 두나:
 *   v1.14.0 까지는 메인 화면의 iframe(address-frame.html) 안에서 다음(카카오) 우편번호 스크립트를
 *   돌렸다. iframe 은 앱과 같은 출처이고 sandbox 가 없어서, 그 안의 스크립트가 parent.__TAURI__ 로
 *   앱 명령을 부를 수 있었다. sandbox 를 다시 걸면 카카오 스크립트가 저장소·쿠키를 읽다 멈춰
 *   흰 화면이 되므로(v1.13.0), Mac 앱에서는 **IPC 권한이 없는 별도 창**으로 띄운다.
 *     · 창 라벨(postcode)은 capabilities/default.json 의 windows 목록에 없다 → IPC 권한 0.
 *     · Rust 가 초기화 스크립트로 window.__TAURI__·window.__TAURI_INTERNALS__ 를 지운 뒤 문서를 연다.
 *     · 이 창에는 부모가 없다(window.parent === window) → parent.__TAURI__ 도 없다.
 *
 * 결과는 이렇게 돌려준다(둘 다 쓴다):
 *   1) 주소를 고르면 postcode-done.html#d=<base64 JSON> 로 이동한다. Rust 의 on_navigation 이 그
 *      조각을 읽어 `tip://postcode-result` 이벤트로 화면에 넘기고, 화면이 이 창을 닫는다.
 *   2) 같은 값을 localStorage('tip.postcode.result.v1')에도 남긴다 — 이벤트를 놓쳐도 화면이
 *      그 값을 읽어 쓸 수 있게(같은 출처의 창들이 저장소를 공유한다).
 *
 * 이 문서는 앱 저장소를 읽지 않고, 주소 값은 다음 서비스가 준 값만 넘긴다.
 */

(function () {
  var SRC = 'https://t1.kakaocdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js';
  var RESULT_KEY = 'tip.postcode.result.v1';
  var statusEl = document.getElementById('postcode-status');
  var embedEl = document.getElementById('postcode-embed');
  var loading = null;
  var opened = false;

  function setStatus(text) {
    if (!statusEl) return;
    statusEl.hidden = false;
    statusEl.innerHTML = text;
  }

  function fail() {
    setStatus(
      '<b>우편번호 서비스를 불러오지 못했습니다.</b><br>인터넷 연결을 확인한 뒤 다시 시도해 주세요.'
      + '<br><button id="postcode-retry" type="button">다시 시도</button>'
    );
    var retry = document.getElementById('postcode-retry');
    if (retry) {
      retry.addEventListener('click', function () {
        if (embedEl) embedEl.hidden = true;
        setStatus('우편번호 서비스를 불러오는 중…');
        opened = false;
        loading = null;
        open();
      });
    }
  }

  /** 고른 주소를 결과 페이지로 넘긴다 — 조각(주소 조각)에만 담아 서버로 보내지 않는다. */
  function handoff(data) {
    var payload = {
      roadAddress: data.roadAddress || '',
      autoRoadAddress: data.autoRoadAddress || '',
      jibunAddress: data.jibunAddress || '',
      autoJibunAddress: data.autoJibunAddress || '',
      roadAddressEnglish: data.roadAddressEnglish || '',
      jibunAddressEnglish: data.jibunAddressEnglish || '',
      zonecode: data.zonecode || '',
      buildingName: data.buildingName || '',
    };
    var json = JSON.stringify(payload);
    // 보험 1 — 같은 출처 창들이 공유하는 저장소에 한 번 남긴다.
    try {
      localStorage.setItem(RESULT_KEY, JSON.stringify({ at: Date.now(), data: payload }));
    } catch (error) { /* 저장하지 못해도 아래 이동으로 결과는 전달된다 */ }
    // 보험 2 — Rust 가 이 주소 조각을 읽어 화면에 이벤트로 넘긴다.
    var encoded = '';
    try {
      encoded = btoa(unescape(encodeURIComponent(json)));
    } catch (error) {
      encoded = '';
    }
    if (encoded) {
      location.href = './postcode-done.html#d=' + encoded;
    } else {
      setStatus('<b>주소를 골랐지만 넘기지 못했습니다.</b><br>창을 닫고 다시 시도해 주세요.');
    }
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
      // 보이지 않는(높이 0) 상자에 embed 하면 서비스가 0 높이로 그려 작은 상자만 남는다.
      void (embedEl && embedEl.offsetHeight);
      var postcode = new window.daum.Postcode({
        oncomplete: handoff,
        width: '100%',
        height: '100%',
      });
      postcode.embed(embedEl, { q: '' });
      setTimeout(function () {
        var inner = embedEl && embedEl.querySelector('iframe');
        if (inner) {
          inner.style.width = '100%';
          inner.style.height = '100%';
          inner.style.border = '0';
          inner.style.display = 'block';
        }
      }, 60);
      setTimeout(function () {
        var drew = embedEl && (embedEl.childElementCount > 0 || embedEl.textContent.trim().length > 0);
        if (!drew) {
          opened = false;
          embedEl.hidden = true;
          fail();
        }
      }, 1500);
    }).catch(function () {
      fail();
    });
  }

  open();
})();
