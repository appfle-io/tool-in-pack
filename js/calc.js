/* TIP · 즉석 계산기 (v1.14.0)
 *
 * 전역 검색(Option+Space)에 `12800*1.1`, `(500+300)/2`, `2^10`, `15% of 200` 처럼 넣으면
 * 맨 위에 결과가 뜬다. eval·Function 은 쓰지 않는다 — CSP 로 막혀 있고, 무엇보다
 * 검색창에 들어온 글자를 코드로 실행하면 안 된다. 아래는 숫자와 연산자만 읽는 작은 파서다.
 *
 * 문법
 *   expression := term (('+' | '-') term)*
 *   term       := unary (('*' | '/' | 'of' | '×' | '÷') unary)*
 *   unary      := ('-' | '+') unary | power
 *   power      := primary ('^' unary)?          (오른쪽 결합 — 2^3^2 = 2^9)
 *   primary    := number ('%'?) | '(' expression ')' ('%'?)
 *
 * '%' 는 값 뒤에 붙으면 100 으로 나눈다(`15%` = 0.15). `15% of 200` 은 0.15 * 200 = 30.
 */

const MAX_LENGTH = 120;
const MAX_EXPONENT = 64;

function tokenize(source) {
  const text = String(source || '').replace(/,/g, '').replace(/×/g, '*').replace(/÷/g, '/');
  const tokens = [];
  let index = 0;
  while (index < text.length) {
    const ch = text[index];
    if (ch === ' ' || ch === '\t') {
      index += 1;
      continue;
    }
    if (/[0-9.]/.test(ch)) {
      let number = '';
      while (index < text.length && /[0-9.]/.test(text[index])) {
        number += text[index];
        index += 1;
      }
      // 1e3 같은 지수 표기도 받아 준다.
      if (index < text.length && (text[index] === 'e' || text[index] === 'E')) {
        let exponent = text[index];
        let probe = index + 1;
        if (text[probe] === '+' || text[probe] === '-') {
          exponent += text[probe];
          probe += 1;
        }
        if (/[0-9]/.test(text[probe] || '')) {
          while (probe < text.length && /[0-9]/.test(text[probe])) {
            exponent += text[probe];
            probe += 1;
          }
          number += exponent;
          index = probe;
        }
      }
      const value = Number(number);
      if (!Number.isFinite(value) || number.split('.').length > 2) return null;
      tokens.push({ type: 'number', value });
      continue;
    }
    if ('+-*/^%()'.includes(ch)) {
      tokens.push({ type: ch });
      index += 1;
      continue;
    }
    // 'of' — 퍼센트와 함께 쓰는 곱셈 낱말.
    if (/^of$/i.test(text.slice(index, index + 2)) && !/[a-z0-9]/i.test(text.slice(index + 2, index + 3))) {
      // 앞뒤가 낱말이 아닐 때만 (예: 'roof' 안의 of 는 낱말 검색이다)
      const before = text[index - 1] || ' ';
      if (!/[a-z0-9]/i.test(before)) {
        tokens.push({ type: 'of' });
        index += 2;
        continue;
      }
    }
    return null;
  }
  return tokens;
}

function evaluate(tokens) {
  let position = 0;

  const peek = () => tokens[position];
  const take = () => tokens[position++];

  function parseExpression() {
    let value = parseTerm();
    if (value === null) return null;
    while (peek() && (peek().type === '+' || peek().type === '-')) {
      const op = take().type;
      const right = parseTerm();
      if (right === null) return null;
      value = op === '+' ? value + right : value - right;
    }
    return value;
  }

  function parseTerm() {
    let value = parseUnary();
    if (value === null) return null;
    while (peek() && ['*', '/', 'of'].includes(peek().type)) {
      const op = take().type;
      const right = parseUnary();
      if (right === null) return null;
      if (op === '*') value *= right;
      else if (op === 'of') value *= right;
      else {
        if (right === 0) return null;
        value /= right;
      }
    }
    return value;
  }

  function parseUnary() {
    const token = peek();
    if (!token) return null;
    if (token.type === '-') {
      take();
      const value = parseUnary();
      return value === null ? null : -value;
    }
    if (token.type === '+') {
      take();
      return parseUnary();
    }
    return parsePower();
  }

  function parsePower() {
    const base = parsePrimary();
    if (base === null) return null;
    if (peek() && peek().type === '^') {
      take();
      const exponent = parseUnary();
      if (exponent === null) return null;
      if (Math.abs(exponent) > MAX_EXPONENT) return null;
      return base ** exponent;
    }
    return base;
  }

  function parsePrimary() {
    const token = take();
    if (!token) return null;
    if (token.type === 'number') return percentTail(token.value);
    if (token.type === '(') {
      const value = parseExpression();
      if (value === null) return null;
      if (!peek() || peek().type !== ')') return null;
      take();
      return percentTail(value);
    }
    return null;
  }

  function percentTail(value) {
    if (peek() && peek().type === '%') {
      take();
      return value / 100;
    }
    return value;
  }

  const result = parseExpression();
  if (result === null || position !== tokens.length) return null;
  if (!Number.isFinite(result)) return null;
  return result;
}

/** 화면에 보여 줄 숫자 — 아주 크거나 작으면 지수 표기, 아니면 천 단위 쉼표. */
export function formatNumber(value) {
  if (!Number.isFinite(value)) return '';
  const rounded = Math.abs(value) < 1e-10 ? 0 : value;
  if (Number.isInteger(rounded) && Math.abs(rounded) < 1e15) {
    return rounded.toLocaleString('ko-KR');
  }
  if (Math.abs(rounded) >= 1e15 || (Math.abs(rounded) > 0 && Math.abs(rounded) < 1e-6)) {
    return rounded.toExponential(6).replace(/\.?0+e/, 'e');
  }
  const fixed = Number(rounded.toFixed(8));
  return fixed.toLocaleString('ko-KR', { maximumFractionDigits: 8 });
}

/**
 * 수식이면 { value, text } 를, 아니면 null 을 돌려준다.
 * 한 글자 숫자('3')만 있을 때는 계산 결과를 띄우지 않는다(그냥 검색어일 수 있다).
 */
export function calculate(source) {
  const text = String(source || '').trim();
  if (!text || text.length > MAX_LENGTH) return null;
  // 수식에 쓸 수 없는 글자가 있으면 곧바로 포기 — 계산기 낱말(of)는 예외.
  if (/[가-힣ㄱ-ㅎ]/.test(text)) return null;
  if (!/[+\-*/^%()]|of/i.test(text)) return null;
  if (!/[0-9]/.test(text)) return null;

  const tokens = tokenize(text);
  if (!tokens || !tokens.length) return null;
  const value = evaluate(tokens);
  if (value === null) return null;
  return { value, text: formatNumber(value) };
}
