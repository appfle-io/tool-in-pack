#!/usr/bin/env node
/**
 * TIP v1.25.0 · 영상 필터 그래프 실제 검증
 *
 *   node tools/video-graph-test.mjs
 *   TIP_FFMPEG=/opt/homebrew/bin/ffmpeg node tools/video-graph-test.mjs
 *   TIP_CARGO=/path/to/cargo node tools/video-graph-test.mjs
 *
 * 하는 일
 *   1) tools/ve-graph-test 하네스를 cargo 로 빌드한다 — 앱이 쓰는 mac/src-tauri/src/video_graph.rs
 *      를 **그대로** 컴파일한다(그래프를 따로 옮겨 적지 않아 화면과 내보내기가 어긋나지 않는다).
 *   2) 색이 또렷한 시험 영상·정지 그림·스티커 PNG 를 ffmpeg 로 만든다.
 *   3) 새 기능 10종을 모두 담은 spec 을 하네스에 넣어 filter_complex 를 받는다.
 *   4) 그 그래프로 실제 MP4 를 인코딩하고, 구간 프레임을 PNG 로 뽑아 크기를 확인한다.
 *   5) 그래프에 각 기능의 필터가 실제로 들어갔는지 센다.
 *
 * 맥(CI)에서는 Homebrew ffmpeg 로, 리눅스 검증 상자에서는 정적 ffmpeg 로 돌린다.
 * 실패하면 어떤 항목이 왜 실패했는지 찍고 exit 1.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FF = process.env.TIP_FFMPEG || 'ffmpeg';
const CARGO = process.env.TIP_CARGO || 'cargo';
const FONT = join(ROOT, 'mac/src-tauri/assets/Pretendard-Regular.otf');
const WORK = mkdtempSync(join(tmpdir(), 'tip-ve-graph-'));
const CARGO_TARGET = process.env.TIP_CARGO_TARGET || join(WORK, 'target');

const fails = [];
const passes = [];
const check = (name, ok, detail = '') => {
  if (ok) {
    passes.push(name);
    console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ''}`);
  } else {
    fails.push(`${name}${detail ? ` — ${detail}` : ''}`);
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
};

/** ffmpeg 실행 — 실패하면 stderr 마지막 줄을 오류로. */
function run(args, options = {}) {
  try {
    return execFileSync(FF, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...options });
  } catch (error) {
    const message = String(error.stderr || error.message || '').trim().split('\n').slice(-4).join(' / ');
    throw new Error(message);
  }
}

console.log(`TIP 영상 그래프 검증 — 작업 폴더 ${WORK}`);

/* 1) 하네스 빌드 */
try {
  execFileSync(CARGO, ['build', '--quiet', '--manifest-path', join(ROOT, 'tools/ve-graph-test/Cargo.toml')], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, CARGO_TARGET_DIR: CARGO_TARGET },
  });
  check('하네스 빌드(video_graph.rs 그대로 컴파일)', true);
} catch (error) {
  const message = String(error.stderr || error.message || '').trim().split('\n').slice(-5).join(' / ');
  console.error(`하네스를 빌드하지 못했습니다 — ${message}`);
  process.exit(1);
}
const HARNESS = join(CARGO_TARGET, 'debug', 've-graph-test');

/* 2) 시험 재료 */
const source = join(WORK, 'source.mp4');
const still = join(WORK, 'still.png');
const shape = join(WORK, 'shape.png');
let ffmpegOk = true;
try {
  run(['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=640x480:d=4',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=4', '-shortest',
    '-c:v', 'libx264', '-preset', 'veryfast', '-c:a', 'aac', source]);
  run(['-y', '-hide_banner', '-loglevel', 'error', '-ss', '1', '-i', source, '-frames:v', '1', still]);
  run(['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=#FFE24A@0.0:s=160x90,format=rgba',
    '-vf', 'drawbox=x=10:y=30:w=100:h=30:color=#FFE24A@1:t=fill,drawbox=x=100:y=10:w=50:h=70:color=#FFE24A@1:t=fill',
    '-frames:v', '1', shape]);
  check('시험 영상·그림·스티커 만들기', true);
} catch (error) {
  ffmpegOk = false;
  console.error(`ffmpeg 로 시험 재료를 만들지 못했습니다 — ${error.message}`);
}
if (!ffmpegOk) process.exit(1);

const clip = (extra) => ({
  path: source, kind: 'video', trimStart: 0, trimEnd: 4, speed: 1, volume: 1,
  fadeIn: 0, fadeOut: 0, brightness: 0, contrast: 1, saturation: 1,
  fit: 'fit', rotate: 0, flipH: false, flipV: false, muted: false, reverse: false,
  temperature: 0, sharpen: 0, vignette: 0, denoise: 'off', voice: 'original',
  motion: null, transition: null, ...extra,
});

const W = 480;
const H = 270;
const spec = {
  clips: [
    clip({ fit: 'blur', temperature: 0.4, sharpen: 0.6, vignette: 0.5, denoise: 'strong', muted: true, muted: true,
      motion: { kind: 'zoomin', startScale: 1, endScale: 1.18, startX: 0.5, startY: 0.5, endX: 0.5, endY: 0.5 } }),
    clip({ fit: 'fill', rotate: 90, flipH: true, reverse: true, speed: 1.5,
      voice: 'helium', temperature: -0.3, denoise: 'light',
      transition: { kind: 'slideleft', duration: 0.6 } }),
    clip({ path: still, kind: 'image', trimEnd: 2, fit: 'fit', flipV: true, muted: true,
      motion: { kind: 'custom', startScale: 1.1, endScale: 1.3, startX: 0.4, startY: 0.5, endX: 0.6, endY: 0.5 },
      transition: { kind: 'circleopen', duration: 0.5 } }),
  ],
  overlays: [{ path: source, kind: 'video', start: 0.5, end: 2, x: 0.75, y: 0.25, scale: 0.3, opacity: 0.9 }],
  subtitles: [
    { text: '왼쪽\n두 번째 줄', lines: ['왼쪽', '두 번째 줄'], boxWidth: 300, align: 'left', lineHeight: 1.6,
      start: 0.2, end: 4.5, font: 'pretendard', fontFile: null, fontSize: 54, color: '#FFFFFF',
      outlineColor: '#000000', outlineWidth: 3, background: 0.35, animation: 'pop', x: 0.5, y: 0.8 },
    { text: '오른쪽 정렬', lines: ['오른쪽 정렬'], boxWidth: 240, align: 'right', lineHeight: 1.28,
      start: 5, end: 7, font: 'pretendard', fontFile: null, fontSize: 48, color: '#8BF7E4',
      outlineColor: '#0A3F44', outlineWidth: 5, background: 0, animation: 'slideup', x: 0.86, y: 0.28 },
  ],
  audios: [{ path: source, start: 0.5, volume: 0.5, fadeIn: 0.5, fadeOut: 1, duration: 6,
    muted: false, denoise: 'light', voice: 'echo' }],
  masks: [
    { kind: 'mosaic', shape: 'rect', x: 0.3, y: 0.35, w: 0.3, h: 0.25, strength: 0.8, start: 1, end: 3 },
    { kind: 'blur', shape: 'ellipse', x: 0.7, y: 0.65, w: 0.28, h: 0.3, strength: 0.6, start: 3.5, end: 6 },
  ],
  shapes: [{ png: readFileSync(shape).toString('base64'), x: 0.5, y: 0.28, opacity: 0.9, start: 2, end: 5 }],
  width: W, height: H, fps: 30, output: join(WORK, 'out.mp4'),
};

const specPath = join(WORK, 'spec.json');
writeFileSync(specPath, JSON.stringify(spec));
let graph;
try {
  graph = JSON.parse(execFileSync(HARNESS, [specPath, FONT], { encoding: 'utf8' }));
  check('하네스로 필터 그래프 뽑기', typeof graph.complex === 'string' && graph.complex.length > 200,
    `${graph.complex.length}자 · ${graph.complex.split(';').length}단계`);
} catch (error) {
  console.error(`그래프를 만들지 못했습니다 — ${String(error.stderr || error.message).trim()}`);
  process.exit(1);
}

/* 3) 실제 인코딩 */
try {
  run(['-y', '-hide_banner', '-nostdin', '-loglevel', 'error', ...graph.inputs,
    '-filter_complex', graph.complex, '-map', '[vout]', '-map', '[aout]',
    '-r', '30', '-pix_fmt', 'yuv420p', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22',
    '-c:a', 'aac', '-b:a', '128k', '-t', '8', spec.output]);
  check('실제 MP4 인코딩(문법·따옴표·스트림 매핑)', existsSync(spec.output) && statSync(spec.output).size > 20000,
    `${(statSync(spec.output).size / 1024).toFixed(0)}KB`);
} catch (error) {
  console.error(`인코딩에 실패했습니다 — ${error.message}`);
  process.exit(1);
}

/* 4) 프레임 뽑기(눈으로 볼 수 있게 파일로 남긴다) */
let frames = 0;
for (const at of [0.5, 1.5, 2.5, 4, 5.5]) {
  const file = join(WORK, `frame-${at}.png`);
  try {
    run(['-y', '-hide_banner', '-loglevel', 'error', '-ss', String(at), '-i', spec.output, '-frames:v', '1', file]);
    if (existsSync(file) && statSync(file).size > 1000) frames += 1;
  } catch { /* 그 시각이 영상 밖이면 넘어간다 */ }
}
check('구간 프레임 추출', frames >= 4, `${frames}/5장 · ${WORK}`);

/* 5) 기능별 필터가 그래프에 있는지 */
const wanted = {
  '블러 배경': /boxblur=/,
  '회전 90°': /transpose=1/,
  '좌우 반전': /hflip/,
  '상하 반전': /vflip/,
  '역재생': /(^|[,;\[])reverse/,
  '소리 역재생': /areverse/,
  '색온도': /colorbalance=rs=/,
  '선명도': /unsharp=5:5:/,
  '비네트': /vignette=angle=PI\//,
  '노이즈 제거': /afftdn=nr=/,
  '헬륨 변조': /asetrate=48000\*1\.28/,
  '에코': /aecho=/,
  '모자이크': /flags=neighbor/,
  '원형 블러': /geq=r='r\(X,Y\)'/,
  '구간 제한': /enable='between\(t,/,
  '스티커 PNG': /colorchannelmixer=aa=0\.900/,
  '자막 좌·우 정렬': /text_w/,
  '줌/팬': /zoompan=/,
  '전환(xfade)': /xfade=transition=slideleft/,
  '배경 음악': /amix=inputs=/,
  '음소거': /volume=0\.000/,
  'SAR 고정': /setsar=1,null\[vout\]/,
};
for (const [name, pattern] of Object.entries(wanted)) {
  check(`그래프에 ${name}`, pattern.test(graph.complex));
}

console.log(`\nTIP 영상 그래프 검증 — 통과 ${passes.length} / 실패 ${fails.length}`);
if (fails.length) {
  fails.forEach((line, index) => console.log(`  ${index + 1}. ✗ ${line}`));
  process.exit(1);
}
console.log(`  ✓ 전부 통과 (결과: ${spec.output})`);
