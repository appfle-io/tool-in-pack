/* TIP · 모듈 찾기 말뭉치 (v1.28.0)
 *
 * 같은 키워드 표를 두 곳에서 쓴다.
 *   · 전역 빠른 실행 검색(js/search.js) — ⌥Space
 *   · 홈 상단 모듈 검색(js/app.js) — v1.28.0
 * 표를 한 곳에 두어 한쪽만 낡는 일이 없게 했다. 이름·부제·설명에 없는 흔한 말로도 찾힌다.
 */

import { categoryOf, CATEGORIES } from '../modules/registry.js';
import { koreanRank } from './chosung.js';

/** 검색어 보강 — 모듈 이름에 없는 흔한 말로도 찾히게. */
export const KEYWORDS = {
  'doc-reader': 'pdf hwp hwpx xlsx xls docx pptx epub csv 문서 뷰어 엑셀 워드 파워포인트 전자책 열기 읽기',
  'clipboard-history': '클립보드 복사 히스토리 클립 이미지 텍스트',
  'address-search': '주소 우편번호 도로명 영문 해외 검색 변환',
  'parcel-tracker': '배송 택배 송장 운송장 조회 추적 배달',
  'img-converter': '이미지 사진 변환 포맷 png jpg webp heic 리사이즈',
  'pdf-tools': 'pdf 합치기 병합 추출 페이지 자르기',
  'md-editor': '마크다운 메모 작성 md 에디터',
  'photo-privacy': '모자이크 블러 위치정보 gps exif 사진 개인정보',
  'qr-gen': 'qr 큐알 코드 와이파이 링크 생성',
  'video-gif': '동영상 영상 gif 자르기 클립 변환',
  'video-mosaic': '영상 모자이크 얼굴 가리기',
  'dev-tools': '개발 json base64 해시 인코딩 디코딩',
  'text-diff': '텍스트 비교 diff 차이',
  'regex-tester': '정규식 regex 테스트',
  'color-tools': '색 색상 컬러 팔레트 변환 대비',
  'icon-gen': '아이콘 icns ico 파비콘 생성',
  'ocr-reader': 'ocr 글자 인식 이미지 텍스트 추출 화면 캡처 드래그',
  'file-compress': '압축 해제 zip 용량 줄이기',
  'unit-converter': '단위 변환 길이 무게 온도',
  'currency-calc': '환율 계산 통화 달러 원',
  'sticky-notes': '스티커 메모 포스트잇 바탕화면 메모지',
  'snippets': '스니펫 문구 서명 계좌 주소 복사',
  'screen-picker': '스포이드 색 추출 화면 색상 집기 picker',
  'window-snap': '창 분할 반쪽 배열 정렬 타일',
  'bulk-rename': '파일 이름 변경 일괄 정규식 번호',
  'timer': '타이머 시간 알람 시계 카운트다운 분 초',
  // v1.16.0
  'text-counter': '글자 수 세기 원고지 바이트 공백 단어 줄 카운트',
  'date-calc': '날짜 계산 d-day 디데이 만나이 근무일 공휴일 더하기',
  'typing-converter': '한영 변환 타자 오타 영문 한글 자판',
  'screenshot-annotate': '스크린샷 캡처 화살표 모자이크 표시 주석',
  // v1.18.0
  'draw-lots': '제비 뽑기 추첨 랜덤 봉투 당첨 꽝 뽑기',
  'ladder-game': '사다리 타기 사다리타기 추첨 랜덤 당첨 꽝',
  'race-game': '선착순 골인 경주 달리기 핀볼 구슬 레이스 추첨',
  // v1.23.0 · v1.22.0 · v1.27.0 — 표에 없던 모듈도 홈 검색에서 찾히게
  'video-editor': '영상 편집 자막 타임라인 컷 붙이기 영상제작',
  'voice-recorder': '녹음 마이크 소리 저장 음성',
  'taxi-meter': '택시 미터기 요금 심야 할증 정산 거리',
};

const CATEGORY_LABEL = Object.fromEntries(CATEGORIES.map(({ id, label }) => [id, label]));

/** 이 모듈을 찾을 때 보는 글 — 이름·부제·설명·키워드·분류 이름. */
export function moduleSearchText(mod) {
  return `${mod.name || ''} ${mod.subtitle || ''} ${mod.description || ''} `
    + `${KEYWORDS[mod.id] || ''} ${CATEGORY_LABEL[categoryOf(mod)] || ''}`;
}

/**
 * 질의에 얼마나 맞는지 — 작을수록 먼저. 99 면 맞지 않는다.
 *   0 이름이 질의로 시작 · 1 이름에 포함 · 2 부제·키워드·분류에 포함
 *   3 여러 낱말이 모두 들어 있음 · 4 한글 초성(ㅂㄱ → 문서 리더)
 */
export function scoreModuleQuery(mod, query) {
  const needle = String(query || '').trim().toLowerCase();
  if (!needle) return 0;
  const name = String(mod.name || '').toLowerCase();
  if (name.startsWith(needle)) return 0;
  if (name.includes(needle)) return 1;
  const hay = moduleSearchText(mod).toLowerCase();
  if (hay.includes(needle)) return 2;
  const parts = needle.split(/\s+/).filter(Boolean);
  if (parts.length > 1 && parts.every((part) => hay.includes(part))) return 3;
  if (koreanRank(String(mod.name || ''), needle) < 99) return 4;
  return 99;
}
