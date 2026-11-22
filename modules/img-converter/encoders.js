/**
 * Pure-JS encoders for the image converter: BMP (24-bit), ICO (PNG-in-ICO),
 * and single-page PDF (JPEG-in-PDF). No dependencies, works offline.
 */

/* ----------------------------- helpers -------------------------------- */

export function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) reject(new Error('캔버스를 이미지로 변환하지 못했습니다.'));
        else resolve(blob);
      },
      type,
      quality
    );
  });
}

/* ------------------------------ BMP ----------------------------------- */
/* 24-bit bottom-up BMP, rows padded to 4 bytes, no alpha. */

export function encodeBMP(canvas) {
  const ctx = canvas.getContext('2d');
  const { width: w, height: h } = canvas;
  const data = ctx.getImageData(0, 0, w, h).data;

  const rowSize = Math.floor((24 * w + 31) / 32) * 4;
  const pixelSize = rowSize * h;
  const fileSize = 14 + 40 + pixelSize;

  const buffer = new ArrayBuffer(fileSize);
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);

  // BITMAPFILEHEADER
  bytes[0] = 0x42; bytes[1] = 0x4d; // 'BM'
  view.setUint32(2, fileSize, true);
  view.setUint32(10, 54, true);
  // BITMAPINFOHEADER
  view.setUint32(14, 40, true);
  view.setInt32(18, w, true);
  view.setInt32(22, h, true); // positive → bottom-up
  view.setUint16(26, 1, true);
  view.setUint16(28, 24, true);
  view.setUint32(34, pixelSize, true);
  view.setUint32(38, 2835, true); // ~72 dpi
  view.setUint32(42, 2835, true);

  let p = 54;
  for (let y = h - 1; y >= 0; y -= 1) {
    const rowStart = p;
    for (let x = 0; x < w; x += 1) {
      const i = (y * w + x) * 4;
      bytes[p] = data[i + 2];     // B
      bytes[p + 1] = data[i + 1]; // G
      bytes[p + 2] = data[i];     // R
      p += 3;
    }
    p = rowStart + rowSize; // padding lands inside the zeroed buffer
  }

  return new Blob([buffer], { type: 'image/bmp' });
}

/* ------------------------------ ICO ----------------------------------- */
/* PNG-in-ICO container: 16 / 32 / 48 / 256 px frames. */

export async function encodeICO(canvas) {
  const sizes = [16, 32, 48, 256];
  const frames = [];

  for (const size of sizes) {
    const c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    const ctx = c.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(canvas, 0, 0, size, size);
    const png = await canvasToBlob(c, 'image/png');
    frames.push({ size, png: new Uint8Array(await png.arrayBuffer()) });
  }

  const headerSize = 6 + frames.length * 16;
  const total = headerSize + frames.reduce((sum, f) => sum + f.png.length, 0);
  const buffer = new ArrayBuffer(total);
  const view = new DataView(buffer);

  view.setUint16(0, 0, true);      // reserved
  view.setUint16(2, 1, true);      // type: icon
  view.setUint16(4, frames.length, true);

  let offset = headerSize;
  frames.forEach((frame, i) => {
    const entry = 6 + i * 16;
    view.setUint8(entry, frame.size === 256 ? 0 : frame.size); // width (0 = 256)
    view.setUint8(entry + 1, frame.size === 256 ? 0 : frame.size);
    view.setUint8(entry + 2, 0);  // palette
    view.setUint8(entry + 3, 0);  // reserved
    view.setUint16(entry + 4, 1, true);  // color planes
    view.setUint16(entry + 6, 32, true); // bits per pixel
    view.setUint32(entry + 8, frame.png.length, true);
    view.setUint32(entry + 12, offset, true);
    new Uint8Array(buffer, offset, frame.png.length).set(frame.png);
    offset += frame.png.length;
  });

  return new Blob([buffer], { type: 'image/x-icon' });
}

/* ------------------------------ PDF ----------------------------------- */
/* Single-page PDF with the image as a JPEG XObject, page size = image size. */

export async function encodePDF(canvas, quality = 0.9) {
  const w = canvas.width;
  const h = canvas.height;
  const jpeg = await canvasToBlob(canvas, 'image/jpeg', quality);
  const jpegBytes = new Uint8Array(await jpeg.arrayBuffer());

  const enc = new TextEncoder();
  const chunk = (str) => enc.encode(str);

  const objects = [];
  objects.push(chunk('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n'));
  objects.push(chunk('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n'));
  objects.push(chunk(
    `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] ` +
    '/Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>\nendobj\n'
  ));
  objects.push(chunk(
    `4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${w} /Height ${h} ` +
    `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode ` +
    `/Length ${jpegBytes.length} >>\nstream\n`
  ));
  objects.push(jpegBytes);
  objects.push(chunk('\nendstream\nendobj\n'));
  objects.push(chunk(
    `5 0 obj\n<< /Length ${`q ${w} 0 0 ${h} 0 0 cm /Im0 Do Q`.length} >>\nstream\n` +
    `q ${w} 0 0 ${h} 0 0 cm /Im0 Do Q\nendstream\nendobj\n`
  ));

  const header = chunk('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
  const offsets = [];
  let position = header.length;
  const body = [];
  for (const obj of objects) {
    offsets.push(position);
    body.push(obj);
    position += obj.length;
  }
  const xrefStart = position;
  const xref = chunk(
    `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` +
    offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('') +
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`
  );

  return new Blob([header, ...body, xref], { type: 'application/pdf' });
}

/* -------------------------- quality detection -------------------------- */

export function browserEncodes(type) {
  const c = document.createElement('canvas');
  c.width = 1;
  c.height = 1;
  return c.toDataURL(type).startsWith(`data:${type}`);
}
