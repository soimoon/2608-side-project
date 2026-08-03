/**
 * 붙여넣기 한 덩어리 텍스트에서 "영단어 / 한글 뜻" 쌍을 뽑아낸다.
 *
 * 엑셀에서 셀을 복사하면 탭 구분 텍스트가 클립보드에 담기므로,
 * 별도 라이브러리 없이 엑셀 복붙이 그대로 동작한다. CSV 파일도 같은 함수로 처리한다.
 * 폰 카메라 OCR(구글 렌즈 등)로 뽑은 텍스트도 normalizeOcrText()로 먼저 다듬는다.
 *
 * 지원하는 형태 (한 줄에 하나씩):
 *   synthesize	통합하다             ← 엑셀 복붙 (탭)
 *   synthesize, 통합하다
 *   synthesize - 통합하다 / synthesize : 통합하다
 *   synthesize 통합하다, 종합하다     ← 구분자 없이 공백만
 *   통합하다  synthesize             ← 한글이 앞에 오는 경우
 *   12. synthesize  통합하다          ← 앞 번호는 제거
 *   "synthesize","통합하다"           ← 따옴표로 감싼 CSV
 *
 * OCR 텍스트는 추가로 이런 잡음을 겪는다 (normalizeOcrText가 처리):
 *   synthesize                       ← 영단어와 뜻이 서로 다른 줄로 쪼개짐
 *   통합하다                         ← (위 두 줄을 한 줄로 합친다)
 *   Day 3                            ← 페이지 상단 표제 (제거)
 *   42                                ← 페이지 번호만 있는 줄 (제거)
 *   5ynthesize	통합하다             ← 숫자/기호가 알파벳으로 오인식 (보정)
 *
 * Quizlet 학습 화면에서 그대로 긁어 복사하면 이런 모양이 된다 (공식 "내보내기"의
 * 깔끔한 탭 구분과 달리, 뜻 줄에 영어 유의어가 한글 뜻과 섞여 있다):
 *   exploit                                                ← 단어만 있는 줄
 *   utilize, use, make use of, take advantage of, 이용하다   ← 유의어 + 한글 뜻
 *   (두 줄을 합쳐 en=exploit, ko="utilize, ..., 이용하다"로 — 유의어까지 그대로 살린다)
 */

const HANGUL = /[ㄱ-ㆎ가-힣]/;
const LATIN = /[A-Za-z]/;

/** 앞쪽 번호 매김: "1.", "12)", "[3]" 등. */
const LEADING_NUMBER = /^\s*[[(]?\d+[.)\]:]\s+/;

/** 양끝에 붙은 구분자·따옴표·불릿. */
const EDGE_JUNK = /^["'`\s,:;\-–—|/•*]+|["'`\s,:;\-–—|/•*]+$/g;

/** 영단어 뒤에 붙은 품사 표기: "(v.)", "[n]", "v." 등. */
const POS_SUFFIX = /[\s([]*\b(?:n|v|a|adj|adv|prep|conj|pron|int)\b\.?[\s)\]]*$/i;

export interface ParsedRow {
  en: string;
  ko: string;
  /** OCR 오인식을 자동 보정한 내역. 있으면 검수 UI가 눈에 띄게 표시해야 한다. */
  corrected?: string[];
}

export interface ParseResult {
  rows: ParsedRow[];
  /** 영단어/한글 쌍으로 해석하지 못한 줄. UI에서 사용자에게 그대로 보여준다. */
  skipped: string[];
}

function cleanEn(raw: string): string {
  let s = raw.replace(EDGE_JUNK, '');
  const stripped = s.replace(POS_SUFFIX, '').trim();
  // 품사 표기를 떼고도 알파벳이 남을 때만 적용한다 ("a", "v" 같은 단어 보호).
  if (LATIN.test(stripped)) s = stripped;
  return s.replace(/\s+/g, ' ').trim();
}

function cleanKo(raw: string): string {
  return raw.replace(EDGE_JUNK, '').replace(/\s+/g, ' ').trim();
}

/** OCR이 자주 혼동하는 문자 → 알파벳 자리에서만 바꾼다 (숫자만 있는 토큰은 건드리지 않음). */
const CONFUSABLE_EN: Record<string, string> = { '0': 'o', '1': 'l', '5': 's', '|': 'l' };

function fixConfusablesEn(word: string): { text: string; changed: boolean } {
  if (!LATIN.test(word)) return { text: word, changed: false };
  let changed = false;
  const text = [...word]
    .map((ch) => {
      const rep = CONFUSABLE_EN[ch];
      if (rep === undefined) return ch;
      changed = true;
      return rep;
    })
    .join('');
  return { text, changed };
}

/** 낱자모(ㅇ, ㅁ 등) 단독 등장은 글자가 아니라 OCR 잡음이므로 제거한다. */
const LONE_JAMO = /[ㄱ-ㅎㅏ-ㅣ]/g;

function stripLoneJamo(text: string): { text: string; changed: boolean } {
  if (!LONE_JAMO.test(text)) return { text, changed: false };
  return { text: text.replace(LONE_JAMO, '').replace(/\s+/g, ' ').trim(), changed: true };
}

/** en/ko 원문을 정리하고, 자동 보정이 있었으면 사람이 읽을 수 있는 메모로 남긴다. */
function buildRow(enRaw: string, koRaw: string): ParsedRow | null {
  const en0 = cleanEn(enRaw);
  const ko0 = cleanKo(koRaw);
  if (!en0 || !ko0) return null;

  const enFix = fixConfusablesEn(en0);
  const koFix = stripLoneJamo(ko0);

  const corrected: string[] = [];
  if (enFix.changed) corrected.push(`영단어 자동 보정: "${en0}" → "${enFix.text}"`);
  if (koFix.changed) corrected.push(`뜻 자동 보정: "${ko0}" → "${koFix.text}"`);

  return corrected.length
    ? { en: enFix.text, ko: koFix.text, corrected }
    : { en: enFix.text, ko: koFix.text };
}

/** 한글 문자를 기준으로 영어 구간과 한글 구간의 경계를 찾아 자른다. */
function splitByHangulBoundary(line: string): ParsedRow | null {
  let first = -1;
  let last = -1;
  for (let i = 0; i < line.length; i++) {
    if (HANGUL.test(line[i])) {
      if (first < 0) first = i;
      last = i;
    }
  }
  if (first < 0) return null;

  // 영어가 앞: "synthesize 통합하다" / "accomplishment, feat, 위업, 공적"
  const head = line.slice(0, first);
  if (LATIN.test(head)) {
    // head 안에 이미 쉼표가 있으면 유의어 나열이 시작된 것이다(Quizlet 복붙 등).
    // 첫 쉼표까지만 단어로 삼고, 나머지(남은 유의어 + 한글 뜻)는 통째로 뜻에 묶는다.
    const commaIdx = head.indexOf(',');
    if (commaIdx >= 0) return buildRow(head.slice(0, commaIdx), line.slice(commaIdx + 1));
    return buildRow(head, line.slice(first));
  }
  // 한글이 앞: "통합하다 synthesize"
  const tail = line.slice(last + 1);
  if (LATIN.test(tail)) return buildRow(tail, line.slice(0, last + 1));
  return null;
}

/** 구분자로 이미 두 조각이 난 경우, 어느 쪽이 영어이고 어느 쪽이 한글인지 판별한다. */
function assignSides(a: string, b: string): ParsedRow | null {
  const aKo = HANGUL.test(a);
  const bKo = HANGUL.test(b);
  if (!aKo && bKo) return buildRow(a, b);
  if (aKo && !bKo) return buildRow(b, a);
  return null;
}

function parseLine(rawLine: string): ParsedRow | null {
  const line = rawLine.replace(LEADING_NUMBER, '').trim();
  if (!line) return null;

  // 1) 탭이 있으면 가장 신뢰할 수 있는 구분자다 (엑셀 복붙 · OCR 줄 병합 결과).
  if (line.includes('\t')) {
    const parts = line.split('\t').map((p) => p.trim()).filter(Boolean);
    if (parts.length >= 2) {
      // 3열 이상이면 한글이 없는 첫 칸을 영어로, 나머지 한글 칸을 뜻으로 합친다.
      const en = parts.find((p) => LATIN.test(p) && !HANGUL.test(p));
      const ko = parts.filter((p) => HANGUL.test(p)).join(', ');
      if (en && ko) {
        const row = buildRow(en, ko);
        if (row) return row;
      }
      const pair = assignSides(parts[0], parts.slice(1).join(' '));
      if (pair) return pair;
    }
  }

  // 2) 한글 경계로 자른다. 뜻에 쉼표가 들어간 경우("통합하다, 종합하다")도 안전하다.
  const boundary = splitByHangulBoundary(line);
  if (boundary) return boundary;

  // 3) 마지막 수단: 명시적 구분자 한 번만 쪼갠다.
  const m = line.match(/^(.*?)\s*[,:;|]|^(.*?)\s+[-–—]\s+/);
  if (m) {
    const left = (m[1] ?? m[2] ?? '').trim();
    const right = line.slice(m[0].length).trim();
    const pair = assignSides(left, right);
    if (pair) return pair;
  }

  return null;
}

// ---------- OCR 텍스트 전처리 ----------

/** 전각 영숫자·기호(예: "Ａ" "１" "．")를 반각으로. */
const FULLWIDTH_ASCII = /[！-～]/g;
const FULLWIDTH_SPACE = /　/g;

/** 스마트 따옴표를 일반 따옴표로. */
const SMART_QUOTES: [RegExp, string][] = [
  [/[‘’′]/g, "'"],
  [/[“”″]/g, '"'],
];

function toHalfwidth(text: string): string {
  return text
    .replace(FULLWIDTH_ASCII, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(FULLWIDTH_SPACE, ' ');
}

function straightenQuotes(text: string): string {
  return SMART_QUOTES.reduce((s, [re, rep]) => s.replace(re, rep), text);
}

/** "Day 3", "Chapter 12", 페이지 번호만 있는 줄처럼 단어 쌍이 아닌 표제·잡음 줄. */
const HEADER_LINE = /^(?:day|chapter|unit|lesson|page)\.?\s*\d+\s*[.:]?$/i;
const NUMERIC_ONLY_LINE = /^\d+\s*[.):]?$/;

function isJunkLine(line: string): boolean {
  return HEADER_LINE.test(line) || NUMERIC_ONLY_LINE.test(line);
}

const isLatinOnlyLine = (s: string) => LATIN.test(s) && !HANGUL.test(s);

/**
 * OCR 특유의 잡음을 걷어내 parseBulk가 다루기 좋은 형태로 만든다.
 *  - 전각 문자 → 반각, 스마트 따옴표 → 일반 따옴표
 *  - "Day 3" 같은 표제 줄, 페이지 번호만 있는 줄 제거
 *  - 영단어만 있는 줄 바로 다음에 한글이 포함된 줄이 오면 한 줄로 합친다
 *    (카메라 OCR이 영단어 열과 뜻 열을 위아래로 잘못 인식하는 경우 · Quizlet 학습
 *    화면을 그대로 긁었을 때 "단어" 줄 다음에 "유의어, 한글 뜻"이 섞인 줄이 오는 경우
 *    둘 다 해당한다. 다음 줄이 한글만 있을 필요는 없다 — 유의어가 섞여 있어도
 *    parseLine의 탭 처리가 한글 없는 조각은 걸러내고 한글 있는 조각만 뜻으로 묶는다)
 */
export function normalizeOcrText(raw: string): string {
  const cleaned = straightenQuotes(toHalfwidth(raw));

  const lines = cleaned
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !isJunkLine(l));

  const merged: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const cur = lines[i];
    const next = lines[i + 1];
    // next가 이미 탭을 포함하면 그 자체로 완성된 한 쌍이다(예: 엑셀 복붙 줄 바로 다음에
    // 영어만 있는 무관한 줄이 온 경우) — 그런 줄까지 앞줄과 합치면 안 된다.
    if (next && !cur.includes('\t') && !next.includes('\t') && isLatinOnlyLine(cur) && HANGUL.test(next)) {
      merged.push(`${cur}\t${next}`);
      i++; // next는 이미 합쳤으니 건너뛴다
      continue;
    }
    merged.push(cur);
  }
  return merged.join('\n');
}

/**
 * parseBulk가 실패로 분류한 줄에 대해 검수용 초안을 만든다.
 * parseLine보다 훨씬 느슨하다 — 공백으로 나눈 토큰을 한글 포함 여부로만 갈라 붙인다.
 * 결과를 그대로 등록하면 안 되고, 검수 화면에서 사람이 확인한 뒤 써야 한다.
 */
export function guessSplit(raw: string): ParsedRow {
  const tokens = raw.split(/\s+/).filter(Boolean);
  const en = tokens.filter((t) => LATIN.test(t) && !HANGUL.test(t)).join(' ');
  const ko = tokens.filter((t) => HANGUL.test(t)).join(' ');
  return { en: cleanEn(en), ko: cleanKo(ko) };
}

export function parseBulk(text: string): ParseResult {
  const rows: ParsedRow[] = [];
  const skipped: string[] = [];
  const seen = new Set<string>();

  for (const rawLine of normalizeOcrText(text).split(/\r?\n/)) {
    if (!rawLine.trim()) continue;
    const row = parseLine(rawLine);
    if (!row) {
      skipped.push(rawLine.trim());
      continue;
    }
    // 붙여넣기 안에서의 중복은 첫 항목만 남긴다.
    const key = row.en.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push(row);
  }

  return { rows, skipped };
}
