/**
 * OOXML/ODF 공통 도구 (v1.26.0) — ZIP 열기, XML 읽기, 관계(rels) 풀기, 내장 이미지 꺼내기.
 *
 * 문서 파일은 전부 기기 안에서만 풀린다. JSZip 은 index.html 이 미리 로드해 둔 전역(window.JSZip).
 * XML 은 DOMParser('text/xml') 로 읽고, 접두어(ns:)와 무관하게 localName 으로 찾는다.
 */

export function loadZip(file) {
  if (!window.JSZip) throw new Error('압축 해제 도구(JSZip)를 불러오지 못했습니다.');
  return window.JSZip.loadAsync(file);
}

export function xml(text) {
  const doc = new DOMParser().parseFromString(text, 'text/xml');
  const error = doc.querySelector('parsererror');
  if (error) throw new Error('XML 구조를 해석하지 못했습니다(손상된 파일일 수 있습니다).');
  return doc;
}

export function nameOf(node) {
  return (node.localName || node.nodeName || '').toLowerCase();
}

/** 자손 중 이름이 같은 것 전부(문서 순서). */
export function els(node, name) {
  const out = [];
  if (!node) return out;
  const target = name.toLowerCase();
  const walk = (parent) => {
    for (const child of Array.from(parent.children || [])) {
      if (nameOf(child) === target) out.push(child);
      walk(child);
    }
  };
  walk(node);
  return out;
}

/** 바로 아래 자식 중 이름이 같은 것. */
export function kids(node, name) {
  if (!node || !node.children) return [];
  return Array.from(node.children).filter((child) => nameOf(child) === name.toLowerCase());
}

export function kid(node, name) {
  return kids(node, name)[0] || null;
}

/** localName 으로 속성을 읽는다(접두어 무관). */
export function attr(node, name) {
  if (!node || !node.attributes) return null;
  for (const attribute of Array.from(node.attributes)) {
    if (nameOf(attribute) === name.toLowerCase()) return attribute.value;
  }
  return null;
}

/** r:id 처럼 접두어가 붙은 속성을 먼저 찾는다(같은 localName 의 일반 id 보다 우선). */
export function relAttr(node, name) {
  if (!node || !node.attributes) return null;
  const target = name.toLowerCase();
  for (const attribute of Array.from(node.attributes)) {
    if ((attribute.name || '').includes(':') && nameOf(attribute) === target) return attribute.value;
  }
  for (const attribute of Array.from(node.attributes)) {
    if (nameOf(attribute) === target) return attribute.value;
  }
  return null;
}

/** r:id 처럼 접두어가 붙은 속성도 이름으로 찾는다. */
export function attrEnding(node, suffix) {
  if (!node || !node.attributes) return null;
  for (const attribute of Array.from(node.attributes)) {
    if (nameOf(attribute) === suffix.toLowerCase()) return attribute.value;
  }
  return null;
}

export function textOf(node) {
  return node ? node.textContent || '' : '';
}

/** zip 안 경로를 문서 기준 상대 경로로 풀어 준다. */
export function resolvePath(baseDir, target) {
  if (!target) return '';
  let targetPath = String(target).replace(/\\/g, '/');
  if (targetPath.startsWith('/')) return targetPath.slice(1);
  const parts = `${baseDir ? `${baseDir}/` : ''}${targetPath}`.split('/');
  const out = [];
  for (const part of parts) {
    if (!part || part === '.') continue;
    if (part === '..') out.pop();
    else out.push(part);
  }
  return out.join('/');
}

export function dirOf(path) {
  const index = path.lastIndexOf('/');
  return index < 0 ? '' : path.slice(0, index);
}

export function mimeFromPath(path) {
  const ext = (/\.([a-z0-9]+)$/i.exec(path) || [, ''])[1].toLowerCase();
  return {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp',
    webp: 'image/webp', svg: 'image/svg+xml', tif: 'image/tiff', tiff: 'image/tiff',
    emf: 'image/emf', wmf: 'image/wmf', mp4: 'video/mp4', m4a: 'audio/mp4', mp3: 'audio/mpeg',
    css: 'text/css', xhtml: 'application/xhtml+xml', html: 'text/html',
  }[ext] || 'application/octet-stream';
}

/** 관계 파일(word/_rels/document.xml.rels 등)을 id → {type, target(해석된 경로)} 로 읽는다. */
export async function readRels(zip, partPath) {
  const relPath = `${dirOf(partPath)}${dirOf(partPath) ? '/' : ''}_rels/${partPath.split('/').pop()}.rels`;
  const entry = zip.file(relPath);
  const map = new Map();
  if (!entry) return map;
  const doc = xml(await entry.async('string'));
  for (const relation of els(doc, 'relationship')) {
    const id = attr(relation, 'id');
    const target = attr(relation, 'target') || '';
    if (!id) continue;
    map.set(id, {
      type: attr(relation, 'type') || '',
      target: attr(relation, 'targetmode') === 'external' ? target : resolvePath(dirOf(partPath), target),
      external: attr(relation, 'targetmode') === 'external',
    });
  }
  return map;
}

/** zip 안 파일을 blob URL 로 만든다 — 다 쓴 URL 은 호출한 쪽이 revoke 한다. */
export async function blobUrl(zip, path) {
  const entry = zip.file(path);
  if (!entry) return '';
  const data = await entry.async('arraybuffer');
  return URL.createObjectURL(new Blob([data], { type: mimeFromPath(path) }));
}

/** 내장 이미지 경로 목록을 파일 안에서 찾아 둔다(필요할 때만 blob 으로). */
export function imageEntries(zip, prefixes) {
  return Object.keys(zip.files).filter((name) => !zip.files[name].dir
    && /\.(png|jpe?g|gif|bmp|webp|svg|tiff?)$/i.test(name)
    && prefixes.some((prefix) => name.toLowerCase().startsWith(prefix)));
}

export function formatError(error, label) {
  const message = String(error?.message || error || '');
  if (/password|encrypt/i.test(message)) return `암호로 보호된 ${label} 파일입니다. 암호를 푼 뒤 다시 열어 주세요.`;
  if (/End of data|Corrupt|zip|central directory/i.test(message)) {
    return `${label} 파일 구조를 읽지 못했습니다. 파일이 손상되지 않았는지 확인해 주세요.`;
  }
  return `이 ${label} 파일을 여는 데 실패했습니다: ${message}`;
}
