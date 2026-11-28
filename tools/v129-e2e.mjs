#!/usr/bin/env node
/**
 * TIP v1.29.0 · 녹음 3모드 · 모드별 단축키 숫자 · Apple Vision OCR · HEIC 변환 E2E
 *
 *   node tools/v129-e2e.mjs
 *   TIP_CHROME=/path/to/chrome node tools/v129-e2e.mjs
 *   TIP_PLAYWRIGHT=/path/to/node_modules/playwright node tools/v129-e2e.mjs
 *
 * 실제로 눌러 본다. Tauri(Mac 앱) 를 흉내 내는 window.__TAURI__ 를 페이지 스크립트보다 먼저 넣고,
 * invoke 는 커맨드별 가짜 값을 돌려주며 호출을 기록한다. 이벤트 리스너는 window.__TIP_LISTENERS__ 에
 * 남겨 두어 시험이 직접 'Rust 가 보낸 것처럼' 이벤트를 밀어 넣는다.
 */

import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { extname, join, dirname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let chromium;
for (const candidate of ['playwright', process.env.TIP_PLAYWRIGHT || ''].filter(Boolean)) {
  try {
    ({ chromium } = require(candidate));
    break;
  } catch { /* 다음 후보 */ }
}
if (!chromium) {
  console.error('playwright 를 찾지 못했습니다 — `npm i -D playwright` 뒤 다시 실행하거나 TIP_PLAYWRIGHT=/path/to/playwright 로 경로를 주세요.');
  process.exit(2);
}

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const EXE = process.env.TIP_CHROME || '';
const LIB = process.env.TIP_LIBS || '';

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
  '.wasm': 'application/wasm',
  '.gz': 'application/gzip',
};

const server = createServer((req, res) => {
  const url = decodeURIComponent((req.url || '/').split('?')[0]);
  let path = normalize(join(ROOT, url === '/' ? 'index.html' : url));
  if (!path.startsWith(ROOT)) {
    res.writeHead(403).end('no');
    return;
  }
  if (existsSync(path) && statSync(path).isDirectory()) path = join(path, 'index.html');
  if (!existsSync(path)) {
    res.writeHead(404).end('not found');
    return;
  }
  res.writeHead(200, { 'Content-Type': MIME[extname(path)] || 'application/octet-stream' });
  res.end(readFileSync(path));
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const BASE = `http://127.0.0.1:${server.address().port}`;

/* ------------------------------ Tauri 흉내 ------------------------------ */

const MOCK = `
(() => {
  const calls = [];
  window.__TIP_CALLS__ = calls;
  try {
    Object.defineProperty(navigator, 'serviceWorker', {
      value: { register: () => Promise.reject(new Error('test: no sw')), ready: Promise.reject(new Error('test: no sw')), controller: null, addEventListener() {}, removeEventListener() {} },
      configurable: true,
    });
  } catch { /* 못 바꾸면 그대로 */ }

  const voice = { status: 'idle', acc: 0, started: 0, name: null, mode: 'normal', partner: null, notice: null, error: null };
  const files = [{ name: 'TIP 2026-11-29 09-10-00.m4a', size: 480000, created: 1764370000000 }];
  const out = () => {
    const elapsed = voice.status === 'recording' ? voice.acc + (Date.now() - voice.started) : voice.acc;
    return {
      status: voice.status,
      elapsedMs: elapsed,
      level: voice.status === 'recording' ? 0.4 : 0,
      name: voice.name,
      mime: 'audio/mp4',
      error: voice.error,
      dir: '~/Music/TIP Recordings',
      bytes: 12000,
      mode: voice.mode,
      partner: voice.partner,
      notice: voice.notice,
    };
  };
  const notify = () => {
    const handler = window.__TIP_LISTENERS__ && window.__TIP_LISTENERS__['tip://voice-state'];
    if (handler) handler({ payload: out() });
  };
  window.__TIP_VOICE__ = voice;
  window.__TIP_VOICE_FILES__ = files;

  let engineReady = false;
  window.__TIP_ENGINE_RESOLVE__ = null;
  const segments = [
    { start: 0, end: 3.2, speaker: '화자 1', text: '오늘 회의는 여기서 시작하겠습니다.' },
    { start: 3.6, end: 7.4, speaker: '화자 2', text: '네, 지난주 진행 상황부터 말씀드릴게요.' },
  ];
  const answers = {
    take_pending_settings: false,
    get_autostart: false,
    set_autostart: null,
    set_tray_visible: null,
    set_notch_enabled: null,
    set_notch_hover: null,
    notch_hover_hold: null,
    set_module_shortcuts: [],
    get_module_shortcuts: [],
    set_search_shortcut: null,
    get_search_shortcut: 'Alt+Space',
    check_app_update: { available: false, current: '1.29.0', message: '최신 버전입니다 (v1.29.0)' },
    open_privacy_settings: null,
    calendar_list: [],
    calendar_events: [],
    calendar_today: [],
    media_state: { app: 'Music', playing: false, title: '', artist: '', position: 0, duration: 0 },
    media_control: null,
    notch_metrics: { hasNotch: true, notchWidth: 200, notchHeight: 32, screenWidth: 1512, screenHeight: 982 },
    clip_list: [],
    list_installed_apps: [],
    search_local_files: [],
    open_tool: null,
    open_main: null,
    copy_text: null,
    open_external_url: null,
    voice_mic_status: { status: 'authorized', label: '허용됨' },
    voice_mic_request: null,
    voice_reveal: null,
    voice_engine_status: () => ({
      whisper: engineReady, diarizer: engineReady, ready: engineReady,
      missing: engineReady ? [] : ['음성 인식(whisper.cpp, 약 151MB)', '화자 분리(sherpa-onnx, 약 79MB)'],
      downloadSize: engineReady ? 0 : 230000000,
      message: engineReady ? null : '회의록 엔진을 아직 받지 않았습니다',
    }),
    voice_engine_download: () => new Promise((resolve) => {
      window.__TIP_ENGINE_RESOLVE__ = () => {
        engineReady = true;
        resolve({ whisper: true, diarizer: true, ready: true, missing: [], downloadSize: 0, message: null });
      };
    }),
    voice_start: (args) => {
      voice.status = 'recording';
      voice.acc = 0;
      voice.started = Date.now();
      voice.mode = args.mode || 'normal';
      voice.name = args.mode === 'online' ? 'TIP 2026-11-29 10-00-00 (나).m4a' : 'TIP 2026-11-29 10-00-00.m4a';
      voice.partner = args.mode === 'online' ? 'TIP 2026-11-29 10-00-00 (상대방).wav' : null;
      notify();
      return out();
    },
    voice_stop: () => {
      if (voice.status === 'recording') voice.acc += Date.now() - voice.started;
      voice.status = 'idle';
      files.unshift({ name: voice.name || 'TIP 2026-11-29 10-00-00.m4a', size: 240000, created: Date.now() });
      notify();
      return out();
    },
    voice_pause: () => { voice.acc += Date.now() - voice.started; voice.status = 'paused'; notify(); return out(); },
    voice_resume: () => { voice.started = Date.now(); voice.status = 'recording'; notify(); return out(); },
    voice_status: () => out(),
    voice_list: () => files.slice(),
    voice_transcript: () => null,
    voice_transcribe: () => ({ name: 'TIP 2026-11-29 10-00-00.m4a', mode: 'inperson', segments, speakers: ['화자 1', '화자 2'], engine: 'whisper.cpp', created: Date.now(), seconds: 7.4 }),
    voice_delete: () => null,
    ocr_vision: () => ({ text: '안녕하세요\\nHELLO WORLD', lines: [], confidence: 96.2, engine: 'vision' }),
    img_heic_to_png: () => {
      const b64 = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFUlEQVR4nGP8z8Dwn4GBgYmBAAIAoA0D/y1pAAAAAElFTkSuQmCC';
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
      return bytes.buffer;
    },
  };

  window.__TAURI__ = {
    core: {
      invoke(command, args) {
        calls.push({ command, args: args || {} });
        const value = Object.prototype.hasOwnProperty.call(answers, command) ? answers[command] : null;
        return Promise.resolve(typeof value === 'function' ? value(args || {}) : value);
      },
    },
    event: {
      listen: (name, handler) => {
        window.__TIP_LISTENERS__ = window.__TIP_LISTENERS__ || {};
        window.__TIP_LISTENERS__[name] = handler;
        return Promise.resolve(() => {});
      },
      emit: () => Promise.resolve(),
      emitTo: () => Promise.resolve(),
    },
  };
})();
`;

const launchOptions = {
  headless: true,
  args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
    ...(process.env.TIP_CHROME_ARGS || '').split(' ').filter(Boolean)],
};
if (EXE) launchOptions.executablePath = EXE;
const browser = await chromium.launch(launchOptions);

const consoleErrors = [];
async function newPage(viewport, colorScheme = 'light') {
  const context = await browser.newContext({ viewport, locale: 'ko-KR', colorScheme });
  await context.addInitScript(MOCK);
  const page = await context.newPage();
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  page.on('pageerror', (error) => consoleErrors.push(`pageerror: ${String(error)}`));
  return { context, page };
}

const calls = (page, command) => page.evaluate((cmd) => window.__TIP_CALLS__.filter((call) => call.command === cmd), command);
const lastCall = async (page, command) => {
  const list = await calls(page, command);
  return list.length ? list[list.length - 1] : null;
};
const toastText = (page) => page.evaluate(() => (document.getElementById('toast')?.classList.contains('show') ? document.getElementById('toast').textContent : ''));

/* ============================ ① 녹음 3모드 ============================ */

const { context: voiceContext, page: voice } = await newPage({ width: 1280, height: 900 });
await voice.goto(`${BASE}/index.html`, { waitUntil: 'networkidle' });
await voice.evaluate(() => localStorage.clear());
await voice.reload({ waitUntil: 'networkidle' });
await voice.evaluate(() => { location.hash = '#/voice-recorder'; });
await voice.waitForSelector('#vr-modes .ic-seg', { timeout: 5000 });
await voice.waitForTimeout(400);

const modeLabels = await voice.locator('#vr-modes .ic-seg').allTextContents();
check('v1.29.0 — 모드 탭 세 개', modeLabels.length === 3, modeLabels.join(' / '));
check('v1.29.0 — 탭 이름(일반·대면·화상)', modeLabels.join('|') === '일반 녹음|대면 회의|화상 회의', modeLabels.join('|'));
check('v1.29.0 — 처음은 일반 녹음', (await voice.locator('#vr-main').textContent()).includes('일반 녹음 시작'), await voice.locator('#vr-main').textContent());
check('v1.29.0 — 일반 모드는 엔진 칸을 숨긴다', await voice.locator('#vr-engine').isHidden());

await voice.click('#vr-modes .ic-seg:nth-child(2)');
await voice.waitForTimeout(200);
check('v1.29.0 — 대면 회의로 바꾸면 버튼·설명이 바뀐다', (await voice.locator('#vr-main').textContent()).includes('대면 회의 시작')
  && (await voice.locator('#vr-mode-note').textContent()).includes('화자 분리'), await voice.locator('#vr-mode-note').textContent());
check('v1.29.0 — 대면 회의에 엔진 칸이 보인다', await voice.locator('#vr-engine').isVisible());
check('v1.29.0 — 엔진이 없으면 아직 없음', (await voice.locator('#vr-engine-state').textContent()) === '아직 없음', await voice.locator('#vr-engine-state').textContent());
check('v1.29.0 — 필요한 크기를 MB 로 안내', ((await voice.locator('#vr-engine-note').textContent()).includes('MB')), await voice.locator('#vr-engine-note').textContent());

// 엔진 받기 — 진행률을 밀어 넣고, 마지막에 resolve 한다.
await voice.click('#vr-engine-get');
await voice.waitForTimeout(200);
check('v1.29.0 — 내려받기 호출', (await calls(voice, 'voice_engine_download')).length === 1);
await voice.evaluate(() => {
  const handler = window.__TIP_LISTENERS__['tip://voice-engine-progress'];
  if (handler) handler({ payload: { stage: 'download', percent: 42 } });
});
await voice.waitForTimeout(150);
const engineWidth = await voice.evaluate(() => document.getElementById('vr-engine-fill').style.width);
check('v1.29.0 — 진행률이 막대에 반영', parseInt(engineWidth, 10) >= 40, engineWidth);
await voice.evaluate(() => window.__TIP_ENGINE_RESOLVE__());
await voice.waitForTimeout(300);
check('v1.29.0 — 받은 뒤 준비됨', (await voice.locator('#vr-engine-state').textContent()) === '준비됨', await voice.locator('#vr-engine-state').textContent());

// 시작·중지 → 대화록
await voice.click('#vr-main');
await voice.waitForTimeout(300);
const startCall = await lastCall(voice, 'voice_start');
check('v1.29.0 — 시작할 때 모드를 넘긴다', startCall && startCall.args.mode === 'inperson', JSON.stringify(startCall && startCall.args));
check('v1.29.0 — 녹음 중 표시', (await voice.locator('#vr-tag').textContent()).includes('녹음 중'), await voice.locator('#vr-tag').textContent());
check('v1.29.0 — 녹음 중에는 탭이 잠긴다', await voice.locator('#vr-modes .ic-seg').first().isDisabled());

await voice.click('#vr-main');
await voice.waitForTimeout(500);
check('v1.29.0 — 중지 호출', (await calls(voice, 'voice_stop')).length === 1);

// Rust 가 대화록을 보내는 것처럼
await voice.evaluate(() => {
  const handler = window.__TIP_LISTENERS__['tip://voice-transcript'];
  if (!handler) return;
  handler({ payload: { name: 'TIP 2026-11-29 10-00-00.m4a', mode: 'inperson', stage: 'diarize', percent: 60, error: null, transcript: null } });
});
await voice.waitForTimeout(150);
check('v1.29.0 — 대화록 진행률이 보인다', (await voice.locator('#vr-transcript-status').textContent()).includes('%'), await voice.locator('#vr-transcript-status').textContent());

await voice.evaluate(() => {
  const handler = window.__TIP_LISTENERS__['tip://voice-transcript'];
  if (!handler) return;
  handler({ payload: {
    name: 'TIP 2026-11-29 10-00-00.m4a',
    mode: 'inperson',
    stage: 'done',
    percent: 100,
    error: null,
    transcript: {
      name: 'TIP 2026-11-29 10-00-00.m4a', mode: 'inperson',
      segments: [
        { start: 0, end: 3.2, speaker: '화자 1', text: '오늘 회의는 여기서 시작하겠습니다.' },
        { start: 3.6, end: 7.4, speaker: '화자 2', text: '네, 지난주 진행 상황부터 말씀드릴게요.' },
      ],
      speakers: ['화자 1', '화자 2'], engine: 'whisper.cpp', created: Date.now(), seconds: 7.4,
    },
  } });
});
await voice.waitForTimeout(300);
check('v1.29.0 — 대화록 줄이 그려진다', (await voice.locator('.vr-line').count()) === 2, String(await voice.locator('.vr-line').count()));
check('v1.29.0 — 화자 칩이 보인다', (await voice.locator('.vr-speaker').first().textContent()) === '화자 1', await voice.locator('.vr-speaker').first().textContent());
check('v1.29.0 — 시간 표시', (await voice.locator('.vr-time').first().textContent()) === '00:00', await voice.locator('.vr-time').first().textContent());

// 화자 이름 바꾸기
await voice.locator('.vr-speaker').first().click();
await voice.waitForTimeout(150);
check('v1.29.0 — 화자 칩을 누르면 입력칸', (await voice.locator('.vr-speaker-input').count()) === 1);
await voice.fill('.vr-speaker-input', '김 과장');
await voice.press('.vr-speaker-input', 'Enter');
await voice.waitForTimeout(200);
check('v1.29.0 — 바꾼 이름이 줄에 반영', (await voice.locator('.vr-speaker').first().textContent()) === '김 과장', await voice.locator('.vr-speaker').first().textContent());
const storedSpeakers = await voice.evaluate(() => JSON.parse(localStorage.getItem('tip.voice.speakers.v1') || '{}'));
check('v1.29.0 — 바꾼 이름을 기억', JSON.stringify(storedSpeakers['TIP 2026-11-29 10-00-00.m4a'] || {}).includes('김 과장'), JSON.stringify(storedSpeakers));

// 화상 회의 탭
await voice.click('#vr-modes .ic-seg:nth-child(3)');
await voice.waitForTimeout(200);
check('v1.29.0 — 화상 회의 설명에 시스템 오디오', (await voice.locator('#vr-mode-note').textContent()).includes('상대방'), await voice.locator('#vr-mode-note').textContent());
check('v1.29.0 — 화상 회의는 화면 기록 권한 안내', (await voice.locator('#vr-engine').textContent()).includes('화면 기록'), (await voice.locator('#vr-engine').textContent()).slice(0, 60));
await voice.click('#vr-main');
await voice.waitForTimeout(300);
const onlineStart = await lastCall(voice, 'voice_start');
check('v1.29.0 — 화상 회의도 모드를 넘긴다', onlineStart && onlineStart.args.mode === 'online', JSON.stringify(onlineStart && onlineStart.args));
check('v1.29.0 — 화상 회의는 (나)·(상대방) 두 파일', (await voice.locator('#vr-meta').textContent()).includes('(나)'), await voice.locator('#vr-meta').textContent());
await voice.click('#vr-main');
await voice.waitForTimeout(400);

/* ============================ ② 단축키 숫자 ============================ */

await voice.evaluate(() => { location.hash = '#/'; });
await voice.waitForTimeout(400);
await voice.click('#settings-btn');
await voice.waitForSelector('.sheet .sheet-tabs', { timeout: 4000 });
await voice.click('.sheet-tab[data-tab="modules"]');
await voice.waitForTimeout(200);
await voice.click('.sheet-module-row:has-text("녹음")');
await voice.waitForTimeout(300);

const letterInputs = voice.locator('.shortcut-letter');
check('v1.29.0 — 녹음 단축키 세 줄', (await letterInputs.count()) === 3, String(await letterInputs.count()));
check('v1.29.0 — 기본 글자 R·M·O', (await letterInputs.nth(0).inputValue()) === 'R'
  && (await letterInputs.nth(1).inputValue()) === 'M' && (await letterInputs.nth(2).inputValue()) === 'O',
  `${await letterInputs.nth(0).inputValue()}/${await letterInputs.nth(1).inputValue()}/${await letterInputs.nth(2).inputValue()}`);
check('v1.29.0 — 안내 문구가 영문·숫자', (await letterInputs.nth(0).getAttribute('placeholder')) === 'A~Z·0~9', await letterInputs.nth(0).getAttribute('placeholder'));

await voice.evaluate(() => { window.__TIP_CALLS__.length = 0; });
await letterInputs.nth(1).click();
await letterInputs.nth(1).fill('');
await voice.keyboard.press('1');
await voice.waitForTimeout(400);
const digitCall = await lastCall(voice, 'set_module_shortcuts');
const digitItem = (digitCall?.args.items || []).find(([key]) => key === 'voice:meeting-inperson');
check('v1.29.0 — 숫자 1 이 Digit1 로 등록', JSON.stringify(digitItem) === JSON.stringify(['voice:meeting-inperson', 'Control+Shift+Digit1']), JSON.stringify(digitItem));
check('v1.29.0 — 칸에도 1 이 남는다', (await letterInputs.nth(1).inputValue()) === '1', await letterInputs.nth(1).inputValue());

// 숫자 키패드
await voice.evaluate(() => { window.__TIP_CALLS__.length = 0; });
await letterInputs.nth(2).click();
await letterInputs.nth(2).fill('');
await voice.keyboard.press('Numpad2');
await voice.waitForTimeout(400);
const numpadCall = await lastCall(voice, 'set_module_shortcuts');
const numpadItem = (numpadCall?.args.items || []).find(([key]) => key === 'voice:meeting-online');
check('v1.29.0 — 키패드 2 도 Digit2 로 등록', JSON.stringify(numpadItem) === JSON.stringify(['voice:meeting-online', 'Control+Shift+Digit2']), JSON.stringify(numpadItem));
check('v1.29.0 — 키패드 값이 칸에 남는다', (await letterInputs.nth(2).inputValue()) === '2', await letterInputs.nth(2).inputValue());

// 이미 쓰는 조합은 거절
await voice.evaluate(() => { window.__TIP_CALLS__.length = 0; });
await letterInputs.nth(0).click();
await letterInputs.nth(0).fill('');
await voice.keyboard.press('1');
await voice.waitForTimeout(300);
check('v1.29.0 — 겹치는 숫자는 거절', (await letterInputs.nth(0).inputValue()) === 'R', await letterInputs.nth(0).inputValue());
check('v1.29.0 — 거절을 알린다', ((await toastText(voice)) || '').includes('이미 씁니다'), await toastText(voice));

/* ============================ ③ Apple Vision OCR ============================ */

const { context: ocrContext, page: ocr } = await newPage({ width: 1280, height: 900 });
await ocr.goto(`${BASE}/index.html`, { waitUntil: 'networkidle' });
await ocr.evaluate(() => localStorage.clear());
await ocr.reload({ waitUntil: 'networkidle' });
await ocr.evaluate(() => { location.hash = '#/ocr-reader'; });
await ocr.waitForSelector('#ocr-modes .ic-seg', { timeout: 5000 });
await ocr.waitForTimeout(300);

check('v1.29.0 — 글자 추출이 Vision 안내', (await ocr.locator('#ocr-empty-note').textContent()).includes('Vision') || (await ocr.locator('#ocr-note').textContent()).includes('Vision'),
  await ocr.locator('#ocr-note').textContent());
await ocr.click('#ocr-modes .ic-seg:has-text("이미지에서")');
await ocr.waitForTimeout(150);
const pngBytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
await ocr.setInputFiles('#ocr-input', { name: 'page.png', mimeType: 'image/png', buffer: pngBytes });
await ocr.waitForTimeout(300);
await ocr.click('#ocr-run');
await ocr.waitForTimeout(600);
const ocrCall = await lastCall(ocr, 'ocr_vision');
check('v1.29.0 — Vision OCR 호출', !!ocrCall && typeof ocrCall.args.data === 'string' && ocrCall.args.data.length > 20, JSON.stringify(ocrCall && Object.keys(ocrCall.args)));
check('v1.29.0 — 언어 코드를 Vision 꼴로', JSON.stringify(ocrCall?.args.languages) === JSON.stringify(['ko-KR', 'en-US']), JSON.stringify(ocrCall?.args.languages));
check('v1.29.0 — 읽은 글자가 뜬다', (await ocr.locator('#ocr-text').inputValue()).includes('안녕하세요'), await ocr.locator('#ocr-text').inputValue());
check('v1.29.0 — 신뢰도 표시', (await ocr.locator('#ocr-status').textContent()).includes('96'), await ocr.locator('#ocr-status').textContent());
check('v1.29.0 — 언어 안내도 Vision', (await ocr.locator('#ocr-note').textContent()).includes('내려받는 것이 없고'), await ocr.locator('#ocr-note').textContent());

/* ============================ ④ HEIC ============================ */

const { context: heicContext, page: heic } = await newPage({ width: 1280, height: 900 });
await heic.goto(`${BASE}/index.html`, { waitUntil: 'networkidle' });
await heic.evaluate(() => localStorage.clear());
await heic.reload({ waitUntil: 'networkidle' });
await heic.evaluate(() => { location.hash = '#/img-converter'; });
await heic.waitForSelector('#ic-input', { timeout: 5000 });
await heic.waitForTimeout(300);

const heicBytes = Buffer.concat([
  Buffer.from([0, 0, 0, 0x18]),
  Buffer.from('ftypheic', 'ascii'),
  Buffer.alloc(64, 7),
]);
await heic.setInputFiles('#ic-input', { name: 'photo.heic', mimeType: 'image/heic', buffer: heicBytes });
await heic.waitForTimeout(300);
check('v1.29.0 — HEIC 파일이 목록에', (await heic.locator('.ic-file').count()) === 1, String(await heic.locator('.ic-file').count()));
await heic.click('#ic-run');
await heic.waitForTimeout(1200);
const heicCall = await lastCall(heic, 'img_heic_to_png');
check('v1.29.0 — HEIC 는 IPC 로 바꾼다', !!heicCall && typeof heicCall.args.data === 'string' && heicCall.args.data.length > 20, JSON.stringify(heicCall && Object.keys(heicCall.args)));
check('v1.29.0 — 바꾼 결과가 나온다', (await heic.locator('.ic-result').count()) === 1, String(await heic.locator('.ic-result').count()));
check('v1.29.0 — 결과 이름은 .png', ((await heic.locator('.ic-result .f-name').first().textContent()) || '').endsWith('.png'), await heic.locator('.ic-result .f-name').first().textContent());
check('v1.29.0 — 웹 안내 문구도 있다', (await heic.locator('#ic-empty').textContent()).includes('HEIC'), await heic.locator('#ic-empty').textContent());

/* ============================ ⑤ 390px 와 다크 ============================ */

const { context: mobileContext, page: mobile } = await newPage({ width: 390, height: 844 });
await mobile.goto(`${BASE}/index.html`, { waitUntil: 'networkidle' });
await mobile.evaluate(() => localStorage.clear());
await mobile.reload({ waitUntil: 'networkidle' });
await mobile.evaluate(() => { location.hash = '#/voice-recorder'; });
await mobile.waitForSelector('#vr-modes .ic-seg', { timeout: 5000 });
await mobile.waitForTimeout(400);
const overflow = await mobile.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
check('v1.29.0 — 390px 가로 넘침 없음(녹음)', overflow <= 1, String(overflow));
const tabOverflow = await mobile.evaluate(() => {
  const box = document.getElementById('vr-modes');
  return box ? box.scrollWidth - box.clientWidth : 0;
});
check('v1.29.0 — 390px 에서 모드 탭이 넘치지 않는다', tabOverflow <= 1, String(tabOverflow));
await mobile.click('#vr-modes .ic-seg:nth-child(2)');
await mobile.waitForTimeout(200);
await mobile.evaluate(() => {
  const handler = window.__TIP_LISTENERS__['tip://voice-transcript'];
  if (!handler) return;
  handler({ payload: {
    name: 'TIP 2026-11-29 10-00-00.m4a', mode: 'inperson', stage: 'done', percent: 100, error: null,
    transcript: {
      name: 'TIP 2026-11-29 10-00-00.m4a', mode: 'inperson',
      segments: [{ start: 0, end: 3.2, speaker: '화자 1', text: '아주 긴 문장이 들어와도 화면을 넘지 않고 줄바꿈되어야 합니다. 두 번째 문장도 마찬가지입니다.' }],
      speakers: ['화자 1'], engine: 'whisper.cpp', created: Date.now(), seconds: 3.2,
    },
  } });
});
await mobile.waitForTimeout(300);
const overflowAfter = await mobile.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
check('v1.29.0 — 긴 대화록도 390px 넘침 없음', overflowAfter <= 1, String(overflowAfter));

// 글자 추출·이미지 컨버터도 390px 에서 넘치지 않는다.
for (const [id, label] of [['ocr-reader', '글자 추출'], ['img-converter', '이미지 컨버터']]) {
  await mobile.evaluate((hash) => { location.hash = `#/${hash}`; }, id);
  await mobile.waitForTimeout(600);
  const wide = await mobile.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check(`v1.29.0 — ${label} 390px 넘침 없음`, wide <= 1, String(wide));
}

const { context: darkContext, page: dark } = await newPage({ width: 900, height: 800 }, 'dark');
await dark.goto(`${BASE}/index.html`, { waitUntil: 'networkidle' });
await dark.evaluate(() => { localStorage.setItem('tip.theme', 'dark'); });
await dark.reload({ waitUntil: 'networkidle' });
await dark.evaluate(() => { location.hash = '#/voice-recorder'; });
await dark.waitForSelector('#vr-modes .ic-seg', { timeout: 5000 });
await dark.waitForTimeout(300);
await dark.evaluate(() => {
  const handler = window.__TIP_LISTENERS__['tip://voice-transcript'];
  if (!handler) return;
  handler({ payload: {
    name: 'TIP 2026-11-29 10-00-00.m4a', mode: 'inperson', stage: 'done', percent: 100, error: null,
    transcript: {
      name: 'TIP 2026-11-29 10-00-00.m4a', mode: 'inperson',
      segments: [{ start: 0, end: 2, speaker: '화자 1', text: '다크 모드에서도 잘 보입니다.' }],
      speakers: ['화자 1'], engine: 'whisper.cpp', created: Date.now(), seconds: 2,
    },
  } });
});
await dark.waitForTimeout(300);
const darkText = await dark.evaluate(() => {
  const line = document.querySelector('.vr-line .vr-text');
  if (!line) return '';
  return getComputedStyle(line).color;
});
check('v1.29.0 — 다크에서 대화록 글자가 보인다', !!darkText && darkText !== 'rgba(0, 0, 0, 0)', darkText);
check('v1.29.0 — 다크 테마 적용', (await dark.evaluate(() => document.documentElement.getAttribute('data-theme'))) === 'dark');

/* ============================ 결과 ============================ */

const realErrors = consoleErrors.filter((line) => !/favicon|service worker|ERR_FILE|no sw/i.test(line));
check('v1.29.0 — 콘솔 오류 0', realErrors.length === 0, realErrors.slice(0, 3).join(' | '));

const failed = results.filter((item) => !item.ok);
console.log(`\nTIP v1.29.0 E2E — 통과 ${results.length - failed.length} / 실패 ${failed.length}`);
if (failed.length) {
  failed.forEach((item, index) => console.log(`  ${index + 1}. ✗ ${item.name} — ${item.detail}`));
}

await browser.close();
server.close();
process.exit(failed.length ? 1 : 0);
