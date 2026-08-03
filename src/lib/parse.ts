/**
 * 붙여넣기 한 덩어리 텍스트에서 "영단어 / 한글 뜻" 쌍을 뽑아낸다.
 *
 * 엑셀에서 셀을 복사하면 탭 구분 텍스트가 클립보드에 담기므로,
 * 별도 라이브러리 없이 엑셀 복붙이 그대로 동작한다. CSV 파일도 같은 함수로 처리한다.
 *
 * 지원하는 형태 (한 줄에 하나씩):
 *   synthesize	통합하다             ← 엑셀 복붙 (탭)
 *   synthesize, 통합하다
 *   synthesize - 통합하다 / synthesize : 통합하다
 *   synthesize 통합하다, 종합하다     ← 구분자 없이 공백만
 *   통합하다  synthesize             ← 한글이 앞에 오는 경우
 *   12. synthesize  통합하다          ← 앞 번호는 제거
 *   "synthesize","통합하다"           ← 따옴표로 감싼 CSV
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

  // 영어가 앞: "synthesize 통합하다"
  const head = line.slice(0, first);
  if (LATIN.test(head)) {
    return { en: cleanEn(head), ko: cleanKo(line.slice(first)) };
  }
  // 한글이 앞: "통합하다 synthesize"
  const tail = line.slice(last + 1);
  if (LATIN.test(tail)) {
    return { en: cleanEn(tail), ko: cleanKo(line.slice(0, last + 1)) };
  }
  return null;
}

/** 구분자로 이미 두 조각이 난 경우, 어느 쪽이 영어이고 어느 쪽이 한글인지 판별한다. */
function assignSides(a: string, b: string): ParsedRow | null {
  const aKo = HANGUL.test(a);
  const bKo = HANGUL.test(b);
  if (!aKo && bKo) return { en: cleanEn(a), ko: cleanKo(b) };
  if (aKo && !bKo) return { en: cleanEn(b), ko: cleanKo(a) };
  return null;
}

function parseLine(rawLine: string): ParsedRow | null {
  const line = rawLine.replace(LEADING_NUMBER, '').trim();
  if (!line) return null;

  // 1) 탭이 있으면 가장 신뢰할 수 있는 구분자다 (엑셀 복붙).
  if (line.includes('\t')) {
    const parts = line.split('\t').map((p) => p.trim()).filter(Boolean);
    if (parts.length >= 2) {
      // 3열 이상이면 한글이 없는 첫 칸을 영어로, 나머지 한글 칸을 뜻으로 합친다.
      const en = parts.find((p) => LATIN.test(p) && !HANGUL.test(p));
      const ko = parts.filter((p) => HANGUL.test(p)).join(', ');
      if (en && ko) return { en: cleanEn(en), ko: cleanKo(ko) };
      const pair = assignSides(parts[0], parts.slice(1).join(' '));
      if (pair) return pair;
    }
  }

  // 2) 한글 경계로 자른다. 뜻에 쉼표가 들어간 경우("통합하다, 종합하다")도 안전하다.
  const boundary = splitByHangulBoundary(line);
  if (boundary && boundary.en && boundary.ko) return boundary;

  // 3) 마지막 수단: 명시적 구분자 한 번만 쪼갠다.
  const m = line.match(/^(.*?)\s*[,:;|]|^(.*?)\s+[-–—]\s+/);
  if (m) {
    const left = (m[1] ?? m[2] ?? '').trim();
    const right = line.slice(m[0].length).trim();
    const pair = assignSides(left, right);
    if (pair && pair.en && pair.ko) return pair;
  }

  return null;
}

export function parseBulk(text: string): ParseResult {
  const rows: ParsedRow[] = [];
  const skipped: string[] = [];
  const seen = new Set<string>();

  for (const rawLine of text.split(/\r?\n/)) {
    if (!rawLine.trim()) continue;
    const row = parseLine(rawLine);
    if (!row || !row.en || !row.ko) {
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
