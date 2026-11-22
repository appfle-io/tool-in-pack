/**
 * 최소 EXIF 메타데이터 리더 — JPEG(APP1/TIFF), PNG(eXIf 청크), WebP(EXIF 청크).
 * 사진에서 '촬영 기기 · 촬영 일시 · GPS 좌표' 같은 항목만 뽑아 보여주기 위한 목적.
 * 외부 라이브러리 없이 ArrayBuffer만 읽는다 (업로드 없음).
 */

const EMPTY = { items: [], gps: null, count: 0, formats: [] };

const TYPE_SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 };

function tagName(tag) {
  return {
    0x010e: '설명',
    0x010f: '제조사',
    0x0110: '촬영 기기',
    0x0112: '방향',
    0x0131: '소프트웨어',
    0x0132: '파일 수정일',
    0x013b: '작성자',
    0x8298: '저작권',
    0x829a: '노출 시간',
    0x829d: '조리개',
    0x8827: 'ISO',
    0x9003: '촬영 일시',
    0x9004: '디지털화 일시',
    0x920a: '초점 거리',
    0xa002: '가로 픽셀',
    0xa003: '세로 픽셀',
    0xa434: '렌즈',
  }[tag] || null;
}

function ascii(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; i += 1) {
    const code = bytes[i];
    if (code === 0) break;
    out += String.fromCharCode(code);
  }
  return out.trim();
}

function rational(dv, at, little, signed = false) {
  const num = signed ? dv.getInt32(at, little) : dv.getUint32(at, little);
  const den = signed ? dv.getInt32(at + 4, little) : dv.getUint32(at + 4, little);
  if (!den) return 0;
  return num / den;
}

function readValue(dv, little, type, count, at) {
  const size = (TYPE_SIZE[type] || 1) * count;
  if (type === 2) return ascii(new Uint8Array(dv.buffer, dv.byteOffset + at, Math.max(0, size)));
  const values = [];
  for (let i = 0; i < count; i += 1) {
    const offset = at + i * (TYPE_SIZE[type] || 1);
    switch (type) {
      case 1: case 7: values.push(dv.getUint8(offset)); break;
      case 3: values.push(dv.getUint16(offset, little)); break;
      case 4: values.push(dv.getUint32(offset, little)); break;
      case 5: values.push(rational(dv, offset, little)); break;
      case 9: values.push(dv.getInt32(offset, little)); break;
      case 10: values.push(rational(dv, offset, little, true)); break;
      default: values.push(dv.getUint8(offset));
    }
  }
  return count === 1 ? values[0] : values;
}

function dmsToDecimal(dms, ref) {
  if (!Array.isArray(dms) || dms.length < 3) return null;
  const value = Math.abs(dms[0]) + Math.abs(dms[1]) / 60 + Math.abs(dms[2]) / 3600;
  if (!Number.isFinite(value)) return null;
  return /^s|^w/i.test(ref || '') ? -value : value;
}

function coordinate(value, ref, isLat) {
  if (value == null) return null;
  const fixed = Math.abs(value).toFixed(6);
  const hemisphere = value < 0
    ? (isLat ? 'S' : 'W')
    : (isLat ? 'N' : 'E');
  const label = isLat ? '위도' : '경도';
  return `${label} ${fixed}° ${hemisphere}${ref && !/^[NSEW]/i.test(String(ref)) ? ` (${ref})` : ''}`;
}

/** TIFF 블록(IFD0 + Exif IFD + GPS IFD)을 해석한다. */
function parseTiff(tiff) {
  const dv = new DataView(tiff.buffer, tiff.byteOffset, tiff.byteLength);
  const little = tiff[0] === 0x49 && tiff[1] === 0x49;
  const big = tiff[0] === 0x4d && tiff[1] === 0x4d;
  if (!little && !big) return null;
  if (dv.getUint16(2, little) !== 42) return null;

  const items = [];
  let gps = null;
  let count = 0;

  function entries(ifdOffset, limit = 64) {
    if (!ifdOffset || ifdOffset + 2 > tiff.length) return [];
    const total = dv.getUint16(ifdOffset, little);
    const list = [];
    for (let i = 0; i < Math.min(total, limit); i += 1) {
      const at = ifdOffset + 2 + i * 12;
      if (at + 12 > tiff.length) break;
      const tag = dv.getUint16(at, little);
      const type = dv.getUint16(at + 2, little);
      const n = dv.getUint32(at + 4, little);
      const byteLength = (TYPE_SIZE[type] || 1) * n;
      let valueAt = at + 8;
      if (byteLength > 4) {
        valueAt = dv.getUint32(at + 8, little);
        if (valueAt + byteLength > tiff.length) continue;
      }
      list.push({ tag, type, count: n, value: readValue(dv, little, type, n, valueAt) });
    }
    return list;
  }

  const ifd0 = entries(dv.getUint32(4, little));
  if (!ifd0.length) return null;

  let exifIfdOffset = 0;
  let gpsIfdOffset = 0;

  for (const entry of ifd0) {
    if (entry.tag === 0x8769) { exifIfdOffset = entry.value; continue; }
    if (entry.tag === 0x8825) { gpsIfdOffset = entry.value; continue; }
    const name = tagName(entry.tag);
    if (!name || entry.value === '' || entry.value == null) continue;
    if (entry.tag === 0x0112) continue; // 방향 값은 사람이 읽을 정보로만 쓰지 않는다
    items.push({ label: name, value: String(entry.value) });
    count += 1;
  }

  if (exifIfdOffset) {
    let original = null;
    const exifRows = [];
    for (const entry of entries(exifIfdOffset)) {
      const name = tagName(entry.tag);
      if (!name || entry.value === '' || entry.value == null) continue;
      let value = entry.value;
      if (entry.tag === 0x829a && typeof value === 'number') value = `1/${Math.round(1 / value)}초`;
      else if (entry.tag === 0x829d && typeof value === 'number') value = `f/${value.toFixed(1)}`;
      else if (entry.tag === 0x920a && typeof value === 'number') value = `${value.toFixed(0)}mm`;
      else if (typeof value === 'number') value = String(Math.round(value * 100) / 100);
      if (entry.tag === 0x9003 || entry.tag === 0x9004) original = original || String(value);
      if (entry.tag === 0x9009) continue; // color space
      exifRows.push({ label: name, value: String(value) });
      count += 1;
    }
    // 촬영 일시를 먼저 보여준다
    items.unshift(...exifRows.filter((row) => row.label === '촬영 일시'));
    items.push(...exifRows.filter((row) => row.label !== '촬영 일시'));
    void original;
  }

  if (gpsIfdOffset) {
    const gpsEntries = entries(gpsIfdOffset);
    const byTag = new Map(gpsEntries.map((entry) => [entry.tag, entry.value]));
    const lat = dmsToDecimal(byTag.get(2), byTag.get(1));
    const lon = dmsToDecimal(byTag.get(4), byTag.get(3));
    const rows = [];
    if (lat != null) rows.push({ label: 'GPS 위치', value: coordinate(lat, byTag.get(1), true) });
    if (lon != null) rows.push({ label: 'GPS 위치', value: coordinate(lon, byTag.get(3), false) });
    const altitude = byTag.get(6);
    if (typeof altitude === 'number') {
      const below = byTag.get(5) === 1;
      rows.push({ label: '고도', value: `${below ? '-' : ''}${altitude.toFixed(0)}m` });
    }
    if (rows.length) {
      items.unshift(...rows);
      count += rows.length;
      gps = lat != null && lon != null ? { lat, lon } : null;
    }
  }

  if (!items.length && !count) return { items, gps, count, formats: ['EXIF'] };
  return { items, gps, count, formats: ['EXIF'] };
}

function readJpeg(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 2;
  const formats = [];
  let result = null;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) { offset += 1; continue; }
    const marker = bytes[offset + 1];
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { offset += 2; continue; }
    if (marker === 0xda || marker === 0xd9) break;
    const size = dv.getUint16(offset + 2);
    if (size < 2) break;
    const start = offset + 4;
    const end = offset + 2 + size;
    if (marker === 0xe1 && end <= bytes.length) {
      const head = String.fromCharCode(...bytes.subarray(start, Math.min(start + 6, end)));
      if (head.startsWith('Exif')) {
        const tiff = bytes.subarray(start + 6, end);
        const parsed = parseTiff(tiff);
        if (parsed) result = parsed;
      } else if (head.startsWith('http') || head.includes('ns.adobe')) {
        formats.push('XMP');
      }
    }
    offset = end;
  }
  if (!result) return formats.length ? { ...EMPTY, formats } : EMPTY;
  return { ...result, formats: [...formats, ...result.formats] };
}

function readPng(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 8;
  const formats = [];
  let result = null;
  while (offset + 8 <= bytes.length) {
    const length = dv.getUint32(offset);
    const type = String.fromCharCode(bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7]);
    const dataAt = offset + 8;
    if (dataAt + length > bytes.length) break;
    if (type === 'eXIf') {
      const tiff = bytes.subarray(dataAt, dataAt + length);
      const parsed = parseTiff(tiff);
      if (parsed) result = parsed;
    } else if (type === 'tEXt' || type === 'iTXt') {
      const chunk = String.fromCharCode(...bytes.subarray(dataAt, Math.min(dataAt + length, dataAt + 120)));
      if (/XML:com.adobe.xmp/i.test(chunk)) formats.push('XMP');
    } else if (type === 'IEND') break;
    offset = dataAt + length + 4;
  }
  if (!result) return formats.length ? { ...EMPTY, formats } : EMPTY;
  return { ...result, formats: [...formats, ...result.formats] };
}

function readWebp(bytes) {
  if (String.fromCharCode(...bytes.subarray(0, 4)) !== 'RIFF') return EMPTY;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 12;
  const formats = [];
  let result = null;
  while (offset + 8 <= bytes.length) {
    const type = String.fromCharCode(...bytes.subarray(offset, offset + 4));
    const size = dv.getUint32(offset + 4, true);
    const dataAt = offset + 8;
    if (dataAt + size > bytes.length) break;
    if (type === 'EXIF') {
      let tiff = bytes.subarray(dataAt, dataAt + size);
      if (String.fromCharCode(...tiff.subarray(0, 4)) === 'Exif') tiff = tiff.subarray(6);
      const parsed = parseTiff(tiff);
      if (parsed) result = parsed;
    } else if (type === 'XMP ') {
      formats.push('XMP');
    }
    offset = dataAt + size + (size % 2);
  }
  if (!result) return formats.length ? { ...EMPTY, formats } : EMPTY;
  return { ...result, formats: [...formats, ...result.formats] };
}

/** @param {Uint8Array} bytes */
export function parseMetadata(bytes) {
  try {
    if (!bytes || bytes.length < 12) return { ...EMPTY };
    if (bytes[0] === 0xff && bytes[1] === 0xd8) return readJpeg(bytes);
    if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return readPng(bytes);
    return readWebp(bytes);
  } catch (error) {
    console.warn('[TIP exif]', error);
    return { ...EMPTY };
  }
}

/** 결과 요약 문장 */
export function describeMetadata(meta) {
  if (!meta || !meta.count) {
    return { ok: true, text: 'EXIF / 위치정보 없음' };
  }
  const gps = meta.gps ? 'GPS 포함' : 'GPS 없음';
  return { ok: false, text: `EXIF ${meta.count}항목 · ${gps}` };
}
