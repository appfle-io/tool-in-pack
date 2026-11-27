/**
 * 문서 리더 공통 새니타이즈 (v1.26.0)
 *
 * 문서 안의 HTML 은 전부 여기를 지난다 — .docx/.odt/.epub/.rtf/.md/.html(구형 .doc).
 * DOMPurify 가 이미 index.html 에서 로드되어 있고(window.DOMPurify), 없으면 태그를 모두
 * 걷어내고 글자만 남긴다(안전한 쪽으로 실패).
 *
 * 허용 URL — 우리가 만든 blob:(내장 이미지), 상대 경로, https/http, mailto, tel 만.
 * javascript:·data:text/html 같은 것은 남지 않는다. 내장 이미지는 전부 blob: 이다.
 */

// DOMPurify 기본 규칙에 blob:(우리가 만든 내장 그림)만 더한다.
// 상대 경로("images/a.png")는 통과하고 javascript:·data:text/html 은 걸러진다.
const ALLOWED_URI = /^(?:(?:blob|(?:(?:f|ht)tps?|mailto|tel|callto|sms|cid|xmpp)):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i;

const BASE = {
  ALLOWED_URI_REGEXP: ALLOWED_URI,
  FORBID_TAGS: ['script', 'style', 'iframe', 'frame', 'object', 'embed', 'form', 'input', 'button',
    'textarea', 'select', 'option', 'link', 'meta', 'base', 'svg', 'math', 'audio', 'video', 'source'],
  FORBID_ATTR: ['srcset', 'formaction', 'action', 'ping', 'srcdoc'],
  ALLOW_DATA_ATTR: false,
};

function escapeText(html) {
  const template = document.createElement('template');
  template.innerHTML = html;
  return template.content.textContent || '';
}

/** 문서 본문 HTML — 표·이미지·서식은 살리고 스크립트는 지운다. */
export function sanitizeBody(html) {
  const purify = window.DOMPurify;
  if (!purify) {
    const box = document.createElement('div');
    box.textContent = escapeText(html);
    return box.innerHTML;
  }
  return purify.sanitize(html, {
    ...BASE,
    ADD_ATTR: ['data-ref', 'data-href', 'data-sheet', 'colspan', 'rowspan'],
  });
}

/** EPUB 장 — 책이 준 HTML 이라 더 좁게: style 속성/클래스도 버린다. */
export function sanitizeChapter(html) {
  const purify = window.DOMPurify;
  if (!purify) {
    const box = document.createElement('div');
    box.textContent = escapeText(html);
    return box.innerHTML;
  }
  return purify.sanitize(html, {
    ...BASE,
    FORBID_ATTR: [...BASE.FORBID_ATTR, 'style', 'class', 'id', 'name'],
    ADD_ATTR: ['data-ref', 'data-href'],
  });
}

/** 구형 .doc — textutil 이 만든 HTML. 글꼴·문단 모양은 style 속성으로만 살린다. */
export function sanitizeConverted(html) {
  const purify = window.DOMPurify;
  if (!purify) {
    const box = document.createElement('div');
    box.textContent = escapeText(html);
    return box.innerHTML;
  }
  return purify.sanitize(html, {
    ...BASE,
    ADD_ATTR: ['colspan', 'rowspan'],
  });
}

/** 새니타이즈 뒤 남은 위험한 링크(javascript:)를 한 번 더 걷어낸다. */
export function stripBadLinks(container) {
  container.querySelectorAll('a[href]').forEach((anchor) => {
    const href = (anchor.getAttribute('href') || '').trim();
    if (/^\s*(javascript|vbscript|data):/i.test(href)) {
      anchor.removeAttribute('href');
      anchor.className = 'dr-link-off';
    } else {
      anchor.setAttribute('rel', 'noopener noreferrer');
      anchor.setAttribute('target', '_blank');
    }
  });
  container.querySelectorAll('img').forEach((image) => {
    image.removeAttribute('onerror');
    image.removeAttribute('onload');
    if (!/^(blob:|data:image\/|https?:)/i.test(image.getAttribute('src') || '')) image.remove();
    image.setAttribute('loading', 'lazy');
  });
}
