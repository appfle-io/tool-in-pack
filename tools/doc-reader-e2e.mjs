#!/usr/bin/env node
/**
 * TIP v1.26.0 · 문서 리더 확장자 전수 E2E — 실제 샘플 문서를 열어 화면을 확인한다.
 *
 *   node tools/doc-reader-e2e.mjs
 *   TIP_CHROME=/path/to/chrome node tools/doc-reader-e2e.mjs
 *   TIP_PLAYWRIGHT=/path/to/node_modules/playwright node tools/doc-reader-e2e.mjs
 *   TIP_LIBS=/path/to/libs node tools/doc-reader-e2e.mjs        # LD_LIBRARY_PATH 가 필요할 때
 *   TIP_CHROME_ARGS=--renderer-process-limit=1 node tools/doc-reader-e2e.mjs
 *
 * settings-e2e 에서 문서 리더 구간만 떼어 낸 검사다(메모리가 빠듯한 상자에서는 이 파일만 돌린다).
 * samples/doc-reader/ 의 진짜 파일들을 열어 다음을 본다.
 *   · 스프레드시트 — 시트 탭·병합 셀·고정 머리글·200행 나눔·시트 안 찾기·열 너비
 *   · 문서 — docx 제목/목록/표/그림/쪽 나눔, odt 표·그림, rtf 한글·표
 *   · 전자책 — 목차·장 이동·그림
 *   · 프레젠테이션 — 슬라이드 넘김·표·그림·발표자 노트·슬라이드 목록
 *   · 텍스트 — md 표/코드, json 트리·유효성, yaml/xml/log/txt 줄 번호·찾기
 *   · 보안 — script·onerror·javascript: 가 실행되지 않음
 *   · 390px 가로 넘침 0 · 콘솔 오류 0
 */

import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { extname, join, dirname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let chromium;
for (const candidate of ['playwright', process.env.TIP_PLAYWRIGHT || ''].filter(Boolean)) {
  try { ({ chromium } = require(candidate)); break; } catch { /* 다음 후보 */ }
}
if (!chromium) {
  console.error('playwright 를 찾지 못했습니다 — `npm i -D playwright` 뒤 다시 실행하거나 TIP_PLAYWRIGHT=/path/to/playwright 로 경로를 주세요.');
  process.exit(2);
}

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SAMPLES = join(ROOT, 'samples', 'doc-reader');
const EXE = process.env.TIP_CHROME || '';
const LIB = process.env.TIP_LIBS || '';

/* ------------------------------ 결과 기록 ------------------------------ */

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? `  — ${detail}` : ''}`);
}

/* ------------------------------ 정적 서버 ------------------------------ */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.pdf': 'application/pdf',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

const server = createServer((req, res) => {
  const url = decodeURIComponent((req.url || '/').split('?')[0]);
  let path = normalize(join(ROOT, url === '/' ? 'index.html' : url));
  if (!path.startsWith(ROOT)) { res.writeHead(403).end('no'); return; }
  if (existsSync(path) && statSync(path).isDirectory()) path = join(path, 'index.html');
  if (!existsSync(path)) { res.writeHead(404).end('not found'); return; }
  res.writeHead(200, { 'Content-Type': MIME[extname(path)] || 'application/octet-stream' });
  res.end(readFileSync(path));
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const BASE = `http://127.0.0.1:${server.address().port}`;

/* ------------------------------ 브라우저 ------------------------------ */

const browser = await chromium.launch({
  ...(EXE ? { executablePath: EXE } : {}),
  ...(LIB ? { env: { ...process.env, LD_LIBRARY_PATH: LIB } } : {}),
  args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
    ...(process.env.TIP_CHROME_ARGS || '').split(' ').filter(Boolean)],
});

const problems = [];
async function newPage({ width = 1180, height = 900, mac = false } = {}) {
  const page = await browser.newPage({ viewport: { width, height } });
  page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
  page.on('response', (response) => {
    if (response.status() >= 400 && !response.url().endsWith('/favicon.ico')) {
      problems.push(`http ${response.status()}: ${response.url()}`);
    }
  });
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(`console: ${message.text()}`);
  });
  page.on('dialog', async (dialog) => {
    problems.push(`dialog: ${dialog.message()}`);
    await dialog.dismiss();
  });
  if (mac) {
    await page.addInitScript(() => {
      window.__TIP_INVOKES = [];
      window.__TAURI__ = {
        core: {
          invoke: async (cmd, args) => {
            window.__TIP_INVOKES.push({ cmd, name: args && args.name });
            if (cmd === 'doc_convert_html') {
              return `<!DOCTYPE html><html><head><style>p.x{}</style></head><body>
                <h1>변환된 옛 문서</h1>
                <p>textutil 이 만든 본문입니다.</p>
                <script>window.__DOC_XSS__ = 1<\/script>
                <p><a href="javascript:window.__DOC_XSS__ = 2">위험한 링크</a></p>
                </body></html>`;
            }
            return null;
          },
        },
      };
    });
  }
  return page;
}

async function open(page, file) {
  await page.evaluate(() => { location.hash = '#/'; });
  await page.waitForTimeout(80);
  await page.evaluate(() => { location.hash = '#/doc-reader'; });
  await page.waitForTimeout(160);
  await page.setInputFiles('#dr-input', join(SAMPLES, file));
  // 파싱이 끝나 로딩 표시가 사라질 때까지 기다린다(첫 실행은 900KB 파서를 받느라 몇 초 걸린다).
  await page.waitForFunction(() => {
    const stage = document.querySelector('.doc-stage');
    if (!stage) return false;
    if (stage.querySelector('.loading')) return false;
    return stage.innerText.trim().length > 0 || !!document.querySelector('.notice');
  }, null, { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(250);
}

const page = await newPage();
await page.goto(`${BASE}/#/doc-reader`, { waitUntil: 'networkidle' });

const state = () => page.evaluate(() => ({
  stage: document.querySelector('.doc-stage')?.className || '',
  text: document.querySelector('.doc-stage')?.innerText || '',
  notice: document.querySelector('.notice')?.innerText || '',
  tabs: [...document.querySelectorAll('.dr-sheet-tab')].map((node) => node.textContent.trim()),
  pageLabel: document.querySelector('#dr-page-label')?.textContent || '',
  slideLabel: document.querySelector('#dr-slide-count')?.textContent || '',
  chapterLabel: document.querySelector('#dr-epub-count')?.textContent || '',
  images: [...document.querySelectorAll('.doc-stage img')].map((node) => ({
    src: node.getAttribute('src') || '', width: node.naturalWidth,
  })),
  tables: document.querySelectorAll('.doc-stage table').length,
}));

/* --------------------------- 스프레드시트 --------------------------- */

await open(page, 'sheet-basic.xlsx');
let view = await state();
check('xlsx — 시트 탭 3개', view.tabs.join(',') === '매출,재고,메모', view.tabs.join(','));
check('xlsx — 표가 그려짐', view.tables === 1 && view.text.includes('2026년 4분기 매출 보고서'));
check('xlsx — 숫자 서식 유지', view.text.includes('24,400,000'));
const merged = await page.evaluate(() => {
  const cell = document.querySelector('.dr-sheet thead th[colspan]');
  return { colspan: cell?.getAttribute('colspan'), text: cell?.textContent || '' };
});
check('xlsx — 병합 셀(colspan)', merged.colspan === '5', JSON.stringify(merged));
const sticky = await page.evaluate(() => { const cell = document.querySelector('.dr-sheet thead th'); return cell ? getComputedStyle(cell).position : 'none'; });
check('xlsx — 머리글 고정(sticky)', sticky === 'sticky', sticky);
const rowspan = await page.evaluate(() => {
  const cell = [...document.querySelectorAll('.dr-sheet td')].find((node) => node.textContent.trim() === '구분');
  return cell?.getAttribute('rowspan');
});
check('xlsx — 세로 병합(rowspan)', rowspan === '2', String(rowspan));

// 재고 시트 — 320행 → 200행씩 두 쪽
await page.click('.dr-sheet-tab[data-sheet="1"]');
await page.waitForTimeout(300);
view = await state();
const firstPageRows = await page.locator('.dr-sheet tbody tr').count();
check('xlsx — 둘째 시트 200행만 그린다', firstPageRows === 200, String(firstPageRows));
check('xlsx — 쪽 표시 1 / 2', view.pageLabel === '1 / 2', view.pageLabel);
await page.click('#dr-page-next');
await page.waitForTimeout(300);
const secondPage = await page.evaluate(() => ({
  rows: document.querySelectorAll('.dr-sheet tbody tr').length,
  first: document.querySelector('.dr-sheet tbody td[data-c="1"]')?.textContent || '',
}));
check('xlsx — 다음 쪽 120행', secondPage.rows === 120 && secondPage.first.includes('부품 201'), JSON.stringify(secondPage));

// 시트 안 찾기 — 다른 쪽에 있는 값으로 이동
await page.click('#dr-page-prev');
await page.waitForTimeout(200);
await page.fill('#dr-find-q', '부품 310');
await page.waitForTimeout(350);
const found = await page.evaluate(() => ({
  label: document.querySelector('#dr-find-n')?.textContent,
  page: document.querySelector('#dr-page-label')?.textContent,
  current: document.querySelector('.dr-sheet td.is-current')?.textContent || '',
}));
check('xlsx — 찾기 결과 수', found.label === '1/1', found.label);
check('xlsx — 찾은 셀로 쪽 이동', found.page === '2 / 2' && found.current.includes('부품 310'), JSON.stringify(found));

await open(page, 'table.csv');
view = await state();
check('csv — 따옴표 안 쉼표를 한 칸으로', view.text.includes('쉼표, 포함된 메모'));
check('csv — 따옴표 이스케이프', view.text.includes('따옴표 " 포함'));
check('csv — 셀 안 줄바꿈', await page.evaluate(() => [...document.querySelectorAll('.dr-sheet td')]
  .some((node) => node.innerHTML.includes('<br>'))));

await open(page, 'table.tsv');
view = await state();
check('tsv — 탭 구분', view.text.includes('김하늘') && view.text.includes('디자인'));

await open(page, 'legacy-excel.xls');
view = await state();
check('xls — 옛 엑셀 읽기', view.text.includes('362500') && view.text.includes('모자'), view.text.slice(0, 60).replace(/\n/g, ' '));
check('xls — 병합 셀', await page.evaluate(() => [...document.querySelectorAll('.dr-sheet td')]
  .some((node) => node.getAttribute('colspan') === '2')));

await open(page, 'sheet-macro.xlsm');
view = await state();
check('xlsm — 매크로 문서 읽기', view.tabs.length === 3 && view.text.includes('합계'));

await open(page, 'budget.ods');
view = await state();
check('ods — 시트·값', view.text.includes('2026년 예산안') && view.text.includes('3,200,000'));
check('ods — 병합 셀', await page.evaluate(() => document.querySelector('.dr-sheet thead th[colspan]')?.getAttribute('colspan') === '4'));

/* ------------------------------- 문서 ------------------------------- */

await open(page, 'report.docx');
view = await state();
check('docx — 제목·본문', view.text.includes('TIP 문서 리더 시험 문서') && view.text.includes('큰 글씨'));
check('docx — 제목 단계(h1/h2)', await page.evaluate(() =>
  document.querySelectorAll('.dr-docx h1').length >= 2 && document.querySelectorAll('.dr-docx h2').length >= 2));
check('docx — 목록(불릿·번호)', await page.evaluate(() =>
  document.querySelectorAll('.dr-docx ul.dr-list').length >= 1 && document.querySelectorAll('.dr-docx ol.dr-list').length >= 1));
check('docx — 표·가로 병합', await page.evaluate(() => {
  const cell = [...document.querySelectorAll('.dr-docx-table td')].find((node) => node.textContent.trim() === '구분');
  return cell?.getAttribute('colspan') === '2';
}));
check('docx — 내장 그림(blob)', view.images.some((image) => image.src.startsWith('blob:') && image.width > 0));
check('docx — 쪽 나눔', await page.evaluate(() => document.querySelectorAll('.dr-docx hr.pagebreak').length >= 1));

await open(page, 'unsafe.docx');
const xssDocx = await page.evaluate(() => ({
  flag: window.__DOCX_XSS__,
  links: [...document.querySelectorAll('.dr-paper a')].map((node) => node.getAttribute('href')),
  script: document.querySelectorAll('.dr-paper script').length,
  text: document.querySelector('.doc-stage')?.textContent || '',
}));
check('docx — script 미실행·태그 제거', xssDocx.flag === undefined && xssDocx.script === 0);
check('docx — onerror 미실행', !xssDocx.flag);
check('docx — javascript: 링크 제거', xssDocx.links.every((href) => !href || !/javascript:/i.test(href)),
  JSON.stringify(xssDocx.links));

await open(page, 'notes.odt');
view = await state();
check('odt — 제목·문단', view.text.includes('오픈도큐먼트 시험') && view.text.includes('가운데 정렬 문단입니다.'));
check('odt — 표', view.tables === 1 && view.text.includes('3,000'));
check('odt — 그림', view.images.some((image) => image.src.startsWith('blob:') && image.width > 0));

await open(page, 'letter.rtf');
view = await state();
check('rtf — 한글 본문', view.text.includes('문서 리더 RTF 시험') && view.text.includes('한글도 그대로 보여야 합니다.'));
check('rtf — 굵게/기울임/밑줄', await page.evaluate(() => {
  const html = document.querySelector('.doc-stage')?.innerHTML || '';
  return /font-weight:700/.test(html) && /font-style:italic/.test(html) && /text-decoration:underline/.test(html);
}));
check('rtf — 표 한 개', view.tables === 1 && view.text.includes('180,000'));

/* ------------------------------ 전자책 ------------------------------ */

await open(page, 'book.epub');
view = await state();
check('epub — 장 표시 1 / 3', view.chapterLabel === '1 / 3', view.chapterLabel);
check('epub — 첫 장 본문', view.text.includes('전자책의 첫 장입니다.'));
check('epub — 그림', view.images.some((image) => image.src.startsWith('blob:') && image.width > 0));
const epubMeta = await page.evaluate(() => document.querySelector('#dr-f-meta')?.textContent || '');
check('epub — 책 정보(저자·장 수)', epubMeta.includes('유동규') && epubMeta.includes('3장'), epubMeta);

await page.click('#dr-epub-toc');
await page.waitForTimeout(250);
check('epub — 목차 3개', await page.locator('.dr-toc-item').count() === 3);
await page.click('.dr-toc-item[data-position="2"]');
await page.waitForTimeout(400);
view = await state();
check('epub — 목차로 3장 이동', view.chapterLabel === '3 / 3' && view.text.includes('마지막 장입니다.'));
const epubXss = await page.evaluate(() => ({
  flag: window.__EPUB_XSS__, scripts: document.querySelectorAll('.doc-stage script').length,
}));
check('epub — 장 안 script 미실행', epubXss.flag === undefined && epubXss.scripts === 0, JSON.stringify(epubXss));

// 책 안 링크로 장 이동
await page.click('#dr-epub-first');
await page.waitForTimeout(350);
await page.locator('.doc-stage a', { hasText: '2장으로' }).first().click();
await page.waitForTimeout(450);
view = await state();
check('epub — 본문 링크로 장 이동', view.chapterLabel === '2 / 3' && view.text.includes('둘째 장입니다.'));

/* --------------------------- 프레젠테이션 --------------------------- */

await open(page, 'deck.pptx');
view = await state();
check('pptx — 4장', view.slideLabel === '1 / 4', view.slideLabel);
check('pptx — 제목 슬라이드', view.text.includes('TIP 문서 리더'));
await page.click('#dr-slide-next');
await page.waitForTimeout(500);
view = await state();
check('pptx — 둘째 장 본문', view.text.includes('스프레드시트') && view.text.includes('전자책'));
await page.click('#dr-slide-next');
await page.waitForTimeout(500);
view = await state();
check('pptx — 셋째 장 표', view.text.includes('매출 요약') && await page.locator('.dr-pptx-table td').count() >= 9);
await page.click('#dr-slide-next');
await page.waitForTimeout(500);
view = await state();
check('pptx — 넷째 장 그림', view.images.some((image) => image.src.startsWith('blob:') && image.width > 0));
await page.click('#dr-notes-btn');
await page.waitForTimeout(300);
const notes = await page.evaluate(() => ({
  visible: !document.querySelector('.dr-notes').hidden,
  text: document.querySelector('.dr-notes')?.innerText || '',
}));
check('pptx — 발표자 노트', notes.visible && notes.text.includes('넷째 장 노트'), notes.text.slice(0, 40));
await page.click('#dr-slide-list-btn');
await page.waitForTimeout(250);
check('pptx — 슬라이드 목록 4개', await page.locator('.dr-slide-jump').count() === 4);
await page.click('.dr-slide-jump[data-position="1"]');
await page.waitForTimeout(450);
view = await state();
check('pptx — 목록에서 이동', view.slideLabel === '2 / 4' && view.text.includes('이번에 더한 것'));

/* ---------------------------- 텍스트·개발 ---------------------------- */

await open(page, 'readme.md');
view = await state();
check('md — 제목·목록', view.text.includes('TIP 문서 리더') && await page.locator('.dr-paper-md li').count() >= 3);
check('md — 표', await page.locator('.dr-paper-md table td').count() >= 4);
check('md — 코드 블록', await page.locator('.dr-paper-md pre code').count() >= 1);
const mdXss = await page.evaluate(() => ({ flag: window.__MD_XSS__, scripts: document.querySelectorAll('.dr-paper-md script').length }));
check('md — script/onerror 미실행', mdXss.flag === undefined && mdXss.scripts === 0, JSON.stringify(mdXss));

await open(page, 'config.json');
view = await state();
check('json — 유효성 표시', (await page.textContent('#dr-json-valid')) === '올바른 JSON');
check('json — 트리(접기)', await page.locator('.dr-json-tree details').count() >= 3);
check('json — 값 표시', view.text.includes('tool-in-pack') && view.text.includes('maxRows'));
await page.click('#dr-json-mode');
await page.waitForTimeout(250);
check('json — 원문 보기 전환', (await page.textContent('#dr-json-mode')) === '트리 보기'
  && await page.locator('.dr-code .dr-line').count() > 5);
await page.fill('#dr-find-q', 'maxRows');
await page.waitForTimeout(300);
check('json — 원문에서 찾기 강조', await page.locator('mark.dr-hit').count() >= 1);

await open(page, 'broken.json');
check('json — 깨진 파일 표시', (await page.textContent('#dr-json-valid')).includes('올바른 JSON 이 아님')
  && (await page.textContent('.dr-json-error')).includes('JSON'));

await open(page, 'settings.yaml');
view = await state();
check('yaml — 줄 번호', await page.locator('.dr-code .dr-ln').count() >= 14);
check('yaml — 내용', view.text.includes('darkMode') && view.text.includes('doc-reader'));
await page.fill('#dr-find-q', 'accent');
await page.waitForTimeout(350);
check('yaml — 찾기 강조', await page.locator('mark.dr-hit').count() >= 1);

await open(page, 'feed.xml');
view = await state();
check('xml — 내용', view.text.includes('<catalog>') && view.text.includes('한글 제목'));

await open(page, 'app.log');
const logTones = await page.evaluate(() => ({
  error: document.querySelectorAll('.dr-line.is-error').length,
  warn: document.querySelectorAll('.dr-line.is-warn').length,
  lines: document.querySelectorAll('.dr-line').length,
}));
check('log — 오류/경고 색 구분', logTones.error >= 4 && logTones.warn >= 8, JSON.stringify(logTones));
check('log — 줄 수', logTones.lines === 60, String(logTones.lines));

await open(page, 'notes.txt');
view = await state();
check('txt — 줄 번호', await page.locator('.dr-code .dr-ln').count() === 6);
await page.fill('#dr-find-q', '마지막');
await page.waitForTimeout(300);
check('txt — 찾기 강조', await page.locator('mark.dr-hit').count() === 1);

/* --------------------------- 파일 드롭 추천 --------------------------- */

const dropFor = async (name, mime) => {
  await page.evaluate(() => { location.hash = '#/'; });
  await page.waitForTimeout(150);
  await page.evaluate(({ name: fileName, mime: fileMime }) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([new Uint8Array([1, 2, 3])], fileName, { type: fileMime }));
    document.querySelector('#view').dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }));
  }, { name, mime });
  await page.waitForTimeout(250);
  const names = await page.locator('.drop-panel .drop-item b').allTextContents();
  await page.locator('.drop-panel .drop-close').last().click({ force: true }).catch(() => {});
  await page.waitForTimeout(150);
  return names;
};

const dropXlsx = await dropFor('a.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
check('드롭 — xlsx 에 문서 리더 추천', dropXlsx[0] === '문서 리더', dropXlsx.join(','));
const dropDocx = await dropFor('a.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
check('드롭 — docx 에 문서 리더 추천', dropDocx[0] === '문서 리더', dropDocx.join(','));
const dropPptx = await dropFor('a.pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
check('드롭 — pptx 에 문서 리더 추천', dropPptx[0] === '문서 리더', dropPptx.join(','));
const dropEpub = await dropFor('a.epub', 'application/epub+zip');
check('드롭 — epub 에 문서 리더 추천', dropEpub[0] === '문서 리더', dropEpub.join(','));
const dropCsv = await dropFor('a.csv', 'text/csv');
check('드롭 — csv 에 문서 리더 추천', dropCsv[0] === '문서 리더', dropCsv.join(','));
const dropEmpty = await dropFor('a.tsv', '');
check('드롭 — MIME 없는 tsv 도 추천', dropEmpty[0] === '문서 리더', dropEmpty.join(','));

// 드롭에서 골라 실제로 열리는지
await page.evaluate(() => { location.hash = '#/'; });
await page.waitForTimeout(150);
await page.evaluate(async () => {
  const response = await fetch('/samples/doc-reader/sheet-basic.xlsx');
  const buffer = await response.arrayBuffer();
  const transfer = new DataTransfer();
  transfer.items.add(new File([buffer], 'sheet-basic.xlsx', { type: '' }));
  document.querySelector('#view').dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }));
});
await page.waitForTimeout(300);
await page.locator('.drop-panel .drop-item', { hasText: '문서 리더' }).first().click({ force: true });
await page.waitForTimeout(1200);
view = await state();
check('드롭 — 고른 뒤 문서 리더가 파일을 연다', view.tabs.includes('매출') && view.text.includes('2026년 4분기'), view.tabs.join(','));

/* --------------------------- 모바일 390px --------------------------- */

const mobile = await newPage({ width: 390, height: 844 });
await mobile.goto(`${BASE}/#/doc-reader`, { waitUntil: 'networkidle' });
for (const file of ['sheet-basic.xlsx', 'report.docx', 'deck.pptx', 'book.epub', 'config.json', 'notes.txt']) {
  await open(mobile, file);
  const width = await mobile.evaluate(() => ({
    doc: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  check(`390px — ${file} 가로 넘침 없음`, width.doc <= width.client, `${width.doc}/${width.client}`);
}
await mobile.close();

/* ------------------------------- Mac 앱 ------------------------------- */

const mac = await newPage({ mac: true });
await mac.goto(`${BASE}/#/doc-reader`, { waitUntil: 'networkidle' });
await mac.setInputFiles('#dr-input', {
  name: 'old-document.doc',
  mimeType: 'application/msword',
  buffer: Buffer.from('d0cf11e0a1b11ae1', 'hex'),
});
await mac.waitForTimeout(1200);
const macResult = await mac.evaluate(() => ({
  invokes: window.__TIP_INVOKES,
  text: document.querySelector('.doc-stage')?.innerText || '',
  links: [...document.querySelectorAll('.doc-stage a')].map((node) => node.getAttribute('href')),
  xss: window.__DOC_XSS__,
}));
check('Mac — doc_convert_html 호출', macResult.invokes.some((call) => call.cmd === 'doc_convert_html'
  && call.name === 'old-document.doc'), JSON.stringify(macResult.invokes));
check('Mac — 변환 결과 표시', macResult.text.includes('변환된 옛 문서'));
check('Mac — textutil HTML 새니타이즈', macResult.xss === undefined
  && macResult.links.every((href) => !href || !/javascript:/i.test(href)));

const webDoc = await page.evaluate(async () => {
  location.hash = '#/doc-reader';
  return true;
});
await page.setInputFiles('#dr-input', {
  name: 'old-document.doc',
  mimeType: 'application/msword',
  buffer: Buffer.from('d0cf11e0a1b11ae1', 'hex'),
});
await page.waitForTimeout(400);
const webNotice = await page.evaluate(() => document.querySelector('.notice')?.innerText || '');
check('웹 — .doc 은 Mac 앱 안내', webNotice.includes('Mac 앱에서 .doc 열람 가능'), webNotice.replace(/\n/g, ' '));

/* ------------------------------ 콘솔 오류 ------------------------------ */

check('콘솔 오류 0', problems.length === 0, problems.slice(0, 3).join(' | '));

/* ------------------------------- 결과 ------------------------------- */

await browser.close();
server.close();

const failed = results.filter((entry) => !entry.ok);
console.log(`\n문서 리더 E2E — 통과 ${results.length - failed.length} / 실패 ${failed.length}`);
if (failed.length) {
  failed.forEach((entry, index) => console.log(`  ${index + 1}. ✗ ${entry.name}${entry.detail ? ` — ${entry.detail}` : ''}`));
  process.exit(1);
}
console.log('  ✓ 전부 통과');
