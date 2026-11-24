#!/usr/bin/env node
/**
 * TIP · JS 문법 검사 (v1.14.0)
 *
 * `node --check` 는 파일 확장자가 .js 이고 package.json 에 type=module 이 없으면 ES 모듈을
 * CommonJS 로 읽어 import 문에서 실패한다. 그래서 각 파일을 임시 .mjs 사본으로 복사해 검사한다.
 *
 *   node tools/check-js.mjs
 */

import { readdirSync, readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIRS = ['js', 'modules', 'tools'];
const temp = mkdtempSync(join(tmpdir(), 'tip-js-'));

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(path));
    else if (entry.name.endsWith('.js') || entry.name.endsWith('.mjs')) out.push(path);
  }
  return out;
}

const files = DIRS.flatMap((dir) => {
  try { return walk(join(ROOT, dir)); } catch { return []; }
});

const fails = [];
for (const file of files) {
  const copy = join(temp, `${relative(ROOT, file).replace(/[\\/]/g, '_')}.mjs`);
  writeFileSync(copy, readFileSync(file));
  try {
    execFileSync(process.execPath, ['--check', copy], { stdio: 'pipe' });
  } catch (error) {
    const text = String(error.stderr || error.message || '').trim().split('\n').slice(0, 4).join('\n');
    fails.push(`${relative(ROOT, file)}\n${text}`);
  }
}

rmSync(temp, { recursive: true, force: true });

console.log(`TIP JS 문법 검사 — ${files.length}개 파일 · 실패 ${fails.length}`);
if (fails.length) {
  fails.forEach((line, index) => console.log(`  ${index + 1}. ✗ ${line}`));
  process.exit(1);
}
console.log('  ✓ 전부 통과');
