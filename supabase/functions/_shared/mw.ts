/**
 * Merriam-Webster Dictionary API 응답에서 발음을 뽑아내는 순수 로직.
 *
 * 이 파일은 Deno API를 쓰지 않는다 — Edge Function(Deno)과 vitest(Node) 양쪽에서
 * 그대로 import해 같은 코드를 테스트한다. 네트워크 호출은 index.ts가 담당한다.
 *
 * 왜 MW인가: 이 앱은 철자와 발음을 "정확하게" 외우는 게 목적이라, 발음이 틀리면
 * 기능이 있는 것보다 없는 게 낫다. MW는 성우가 실제로 녹음한 미국식 음원이고
 * TOEFL도 미국식이라 목적에 맞는다. (Wiktionary 계열 무료 API는 자원봉사자 녹음이라
 * 영/미/호주 억양이 뒤섞여 있어 쓰지 않는다.)
 */

/** 미국식(en/us) mp3. Learner's·Collegiate 모두 같은 CDN을 쓴다. */
const AUDIO_BASE = 'https://media.merriam-webster.com/audio/prons/en/us/mp3';

export type Notation = 'ipa' | 'mw';

export interface MwPronunciation {
  /** 발음기호 문자열. notation이 무엇인지에 따라 표기 체계가 다르다. */
  phonetic?: string;
  /** 'ipa' = 국제음성기호(Learner's), 'mw' = MW 자체 표기(Collegiate). */
  notation?: Notation;
  /** MW CDN의 mp3 주소. 음원을 우리 쪽에 복사해 두지 않고 이 URL만 저장한다. */
  audioUrl?: string;
  /** 조회어 자신의 발음이 아니라 원형 단어의 발음을 대신 준 경우, 그 원형 단어.
   *  클라이언트가 "OO의 발음"이라고 밝혀 주는 데 쓴다. */
  baseWord?: string;
}

/**
 * 오디오 파일이 들어 있는 하위 디렉터리. MW가 정한 규칙이라 그대로 따라야 한다.
 *  - "bix"로 시작 → bix
 *  - "gg"로 시작  → gg
 *  - 숫자나 기호로 시작 → number
 *  - 그 외 → 첫 글자
 */
export function audioSubdirectory(filename: string): string {
  if (filename.startsWith('bix')) return 'bix';
  if (filename.startsWith('gg')) return 'gg';
  if (/^[^A-Za-z]/.test(filename)) return 'number';
  return filename[0];
}

export function audioUrl(filename: string): string {
  return `${AUDIO_BASE}/${audioSubdirectory(filename)}/${filename}.mp3`;
}

interface MwPrs {
  /** Collegiate 등이 쓰는 MW 자체 표기. */
  mw?: string;
  /** Learner's 등이 쓰는 국제음성기호. */
  ipa?: string;
  sound?: { audio?: string };
}

/** 동형이의어(예: "account"의 명사/동사)가 발음을 공유할 때, 실제 prs 대신 이걸
 *  쓰는 경우가 있다(예: "account for"의 동사 항목). prs와 형태가 같아 그대로
 *  pickPronunciation에 넣을 수 있다. */
type MwAltPrs = MwPrs;

interface MwVariant {
  /** 대체 철자 (예: 영국식 "synthesise"). "*"로 음절이 구분된다. */
  va?: string;
  prs?: MwPrs[];
}

/** 굴절형(복수형, -ly/-ing/-ed 파생형 등). MW는 이런 규칙적인 파생어를 별도
 *  표제어 없이 기본형 표제어의 굴절형으로만 싣는 경우가 많은데, 그때도 자체
 *  발음(prs)이 실려 있으면 그걸 쓸 수 있다. */
interface MwInflection {
  /** 굴절형 표기. 음절 구분에 "*"를 쓴다(표제어와 동일한 관례). */
  if?: string;
  prs?: MwPrs[];
}

/** "undefined run-on" — -ly/-ness처럼 규칙적으로 파생됐지만 뜻을 따로 정의할 필요는
 *  없는 파생어를, MW가 별도 표제어 대신 본표제어 항목 끝에 덧붙이는 방식. ins(굴절형)와
 *  달리 실제 MW 응답에서 successively/irrevocably류가 여기 실린다 — 그리고 ins와 달리
 *  거의 항상 자기 자신의 발음(prs)을 갖고 있다(실제로 확인: irrevocably는 irrevocable과
 *  다른 음원 파일을 쓴다). */
interface MwRunOn {
  /** 파생형 표기. 음절 구분에 "*"를 쓴다(표제어와 동일한 관례). */
  ure?: string;
  prs?: MwPrs[];
}

/** "defined run-on" — account for/depend on/stamp out 같은 구동사·숙어를, MW가 별도
 *  표제어 대신 본표제어 항목 끝에 뜻풀이와 함께 덧붙이는 방식. uros와 이름이 비슷하지만
 *  이쪽은 뜻이 있는(defined) 숙어용이다. 실제 응답으로 확인한 바, 자체 발음(prs)을
 *  가진 경우가 거의 없다 — 구동사 발음이 구성 단어와 다르지 않기 때문으로 보인다.
 *  그래서 ins처럼 표제어 발음을 baseWord와 함께 폴백으로 준다. */
interface MwRunOnPhrase {
  /** 숙어 표기. "on/upon"처럼 "/"로 대체 형태를 함께 싣기도 한다("depend on/upon"). */
  drp?: string;
  prs?: MwPrs[];
}

interface MwEntry {
  meta?: { id?: string };
  hwi?: { hw?: string; prs?: MwPrs[]; altprs?: MwAltPrs[] };
  /** 철자 변형. 미국/영국 철자 차이(-ize/-ise 등)가 있는 단어는 본표제어 자리(hwi.prs)가
   *  비어 있고 여기에만 발음이 실리는 경우가 실제로 많다 (MW 응답으로 직접 확인). */
  vrs?: MwVariant[];
  ins?: MwInflection[];
  uros?: MwRunOn[];
  dros?: MwRunOnPhrase[];
}

/** 표제어를 비교 가능한 형태로. MW는 음절 구분에 "*"를 쓴다 ("syn*the*size"). */
function headwordOf(entry: MwEntry): string {
  const hw = entry.hwi?.hw?.replace(/\*/g, '');
  if (hw) return hw.trim().toLowerCase();
  // hw가 없으면 meta.id로 대체. 동형이의어는 "battle:2"처럼 뒤에 번호가 붙는다.
  return (entry.meta?.id ?? '').split(':')[0].trim().toLowerCase();
}

/** 표제어 자신의 발음 후보(본표제어 prs + altprs + 철자 변형 vrs.prs)를 모은다.
 *  ins/uros/dros가 자체 발음이 없을 때 원형 폴백으로 쓰는 후보와 완전히 같아서
 *  한 곳에 모아 둔다. */
function headwordCandidates(entry: MwEntry): MwPrs[] {
  return [
    ...(entry.hwi?.prs ?? []),
    ...(entry.hwi?.altprs ?? []),
    ...(entry.vrs ?? []).flatMap((v) => v.prs ?? []),
  ];
}

/** 같은 표제어를 쓰는 동형이의어가 여러 항목으로 나뉘어 있을 수 있다(예: "account"의
 *  명사 항목엔 진짜 음원이 있는데, "account for"가 걸린 동사 항목엔 altprs만 있고
 *  음원이 없는 경우 — 실제로 확인한 사례). 한 항목만 보면 음원이 바로 옆 항목에
 *  있어도 놓치므로, 표제어가 같은 모든 항목의 후보를 모아서 pickPronunciation이
 *  그중 음원 있는 걸 고르게 한다. */
function candidatesForHeadword(data: MwEntry[], hw: string): MwPrs[] {
  const out: MwPrs[] = [];
  for (const entry of data) {
    if (!entry || typeof entry !== 'object') continue;
    if (headwordOf(entry) !== hw) continue;
    out.push(...headwordCandidates(entry));
  }
  return out;
}

/** "on/upon"처럼 "/"로 대체 형태를 묶어 쓴 표기를 개별 문자열로 펼친다.
 *  "depend on/upon" → ["depend on", "depend upon"]. "/"가 없으면 그대로 하나. */
function expandSlashVariants(phrase: string): string[] {
  const tokens = phrase.split(' ');
  const slashIndex = tokens.findIndex((t) => t.includes('/'));
  if (slashIndex === -1) return [phrase];
  const [a, b] = tokens[slashIndex].split('/');
  const withA = [...tokens];
  withA[slashIndex] = a;
  const withB = [...tokens];
  withB[slashIndex] = b;
  return [withA.join(' '), withB.join(' ')];
}

/** prs 후보 목록에서 쓸 만한(발음기호 또는 음원이 있는) 것을 뽑는다. 음원이 있는
 *  후보를 항상 우선한다 — 동형이의어의 한 항목엔 텍스트 발음기호만, 다른 항목엔
 *  진짜 음원이 있는 경우(account 사례) 텍스트만 있는 걸 먼저 골라버리면 실제로
 *  존재하는 음원을 놓치게 된다. */
function pickPronunciation(candidates: MwPrs[]): MwPronunciation | null {
  let textOnly: MwPronunciation | null = null;
  for (const p of candidates) {
    // Learner's의 ipa를 우선한다 — 한국 학습자에게는 MW 자체 표기보다 IPA가 읽기 쉽다.
    const phonetic = p.ipa ?? p.mw;
    const notation: Notation | undefined = p.ipa ? 'ipa' : p.mw ? 'mw' : undefined;
    const file = p.sound?.audio;
    if (!phonetic && !file) continue;

    const result = {
      phonetic: phonetic || undefined,
      notation,
      audioUrl: file ? audioUrl(file) : undefined,
    };
    if (file) return result;
    if (!textOnly) textOnly = result;
  }
  return textOnly;
}

/**
 * 조회한 단어와 표제어가 **정확히 일치하는** 항목에서만 발음을 가져온다.
 *
 * MW는 못 찾은 단어에 대해 비슷한 철자를 제안하는데(문자열 배열), 그걸 받아
 * 엉뚱한 단어의 음원을 붙이면 사용자가 틀린 발음을 외우게 된다. 이 앱에서는
 * 그게 가장 나쁜 실패이므로, 애매하면 발음을 주지 않는 쪽을 택한다.
 */
export function extractPronunciation(data: unknown, query: string): MwPronunciation | null {
  if (!Array.isArray(data) || data.length === 0) return null;
  // 단어를 못 찾으면 MW는 철자 추천 문자열의 배열을 돌려준다.
  if (typeof data[0] === 'string') return null;

  const want = query.trim().toLowerCase();
  // 조회어 자체엔 발음이 없지만, MW가 이 조회어를 어떤 표제어의 규칙적인 파생형
  // (굴절형)으로는 확실히 인식한 경우에 한해 그 표제어(원형) 발음을 폴백으로 쓴다.
  // "엉뚱한 단어" 위험이 없는 이유: MW 자신이 이 조회어=이 표제어의 파생형이라고
  // 이미 밝힌 뒤이기 때문이다(굴절형 문자열이 정확히 일치할 때만 후보로 삼는다).
  let baseFallback: MwPronunciation | null = null;
  const entries = data as MwEntry[];

  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') continue;
    const hw = headwordOf(entry);

    // 표제어(meta.id/hwi.hw)가 정확히 일치하는 항목이면, 본표제어 발음이 우선이고
    // 없으면 철자 변형(vrs)의 발음을 쓴다. MW 문서상 vrs.prs는 "그 변형 철자에 대한
    // 것"이라 원칙적으로 본표제어 발음은 아니지만, 실제로는 -ize/-ise처럼 소리가
    // 사실상 같은 스펠링 변형에서 본표제어 쪽이 비어 있고 vrs 쪽에만 발음이 실리는
    // 경우가 흔하다(예: synthesize). 이미 표제어 자체는 위에서 확인했으므로
    // "엉뚱한 단어" 위험 없이 커버리지만 늘어난다. 동형이의어로 항목이 나뉜 경우
    // (예: "account"의 명사/동사)엔 같은 표제어를 쓰는 다른 항목의 음원도 같이 본다.
    if (hw === want) {
      const found = pickPronunciation(candidatesForHeadword(entries, hw));
      if (found) return found;
    }

    // 표제어 자체는 다른 단어(예: "quick")여도, 그 안의 굴절형(예: "quickly")이
    // 조회어와 정확히 일치하면 그 굴절형의 발음을 쓴다. MW는 -ly/-ing/-ed처럼
    // 규칙적으로 파생된 단어를 별도 표제어 없이 굴절형(ins)으로만 싣는 경우가
    // 많아서, 이걸 안 보면 흔한 부사·활용형이 통째로 "발음 없음"이 된다. 굴절형
    // 문자열 자체를 정확히 비교하므로 엉뚱한 단어 위험은 없다.
    for (const inflection of entry.ins ?? []) {
      const inflectionWord = inflection.if?.replace(/\*/g, '').trim().toLowerCase();
      if (inflectionWord !== want) continue;
      const found = pickPronunciation(inflection.prs ?? []);
      if (found) return found;

      // 굴절형 자체엔(quickly처럼) 자체 발음이 없다 — 표제어(원형) 발음이 있으면
      // 폴백 후보로 남겨 둔다. 정확한 일치가 끝까지 하나도 안 나오면 이걸 대신 쓴다.
      if (!baseFallback && hw) {
        const hwFound = pickPronunciation(candidatesForHeadword(entries, hw));
        if (hwFound) baseFallback = { ...hwFound, baseWord: hw };
      }
    }

    // successively/irrevocably/astoundingly류의 실제 위치 — 굴절형(ins)이 아니라
    // "undefined run-on"(uros)이다. ins와 달리 거의 항상 자기 발음을 직접 갖고
    // 있으므로(원형과 다른 별도 음원), 찾으면 폴백이 아니라 바로 확정해 돌려준다.
    for (const runOn of entry.uros ?? []) {
      const runOnWord = runOn.ure?.replace(/\*/g, '').trim().toLowerCase();
      if (runOnWord !== want) continue;
      const found = pickPronunciation(runOn.prs ?? []);
      if (found) return found;

      // 드물게 run-on 자체엔 발음이 없는 경우에 대비해 ins와 동일하게 원형 폴백을 남긴다.
      if (!baseFallback && hw) {
        const hwFound = pickPronunciation(candidatesForHeadword(entries, hw));
        if (hwFound) baseFallback = { ...hwFound, baseWord: hw };
      }
    }

    // account for/depend on/stamp out류 구동사·숙어의 실제 위치 — "defined run-on
    // phrase"(dros)다. 실제 응답으로 확인한 바 자체 발음을 거의 안 갖고 있어서(구동사
    // 발음이 구성 단어와 다르지 않기 때문으로 보인다), 표제어(핵심 동사) 발음을
    // baseWord와 함께 폴백으로 준다 — "account for"엔 "account"의 발음을 보여주는 식.
    // account처럼 동형이의어로 항목이 나뉘어 있으면(동사 항목엔 altprs만, 명사
    // 항목엔 진짜 음원) 표제어가 같은 모든 항목을 같이 본다.
    for (const runOnPhrase of entry.dros ?? []) {
      if (!runOnPhrase.drp) continue;
      const variants = expandSlashVariants(runOnPhrase.drp.replace(/\*/g, '').trim().toLowerCase());
      if (!variants.includes(want)) continue;

      const found = pickPronunciation(runOnPhrase.prs ?? []);
      if (found) return found;

      if (!baseFallback && hw) {
        const hwFound = pickPronunciation(candidatesForHeadword(entries, hw));
        if (hwFound) baseFallback = { ...hwFound, baseWord: hw };
      }
    }
  }
  return baseFallback;
}

/** MW 조회 URL. 키는 절대 클라이언트로 나가면 안 되므로 Edge Function에서만 부른다. */
export function lookupUrl(
  reference: 'learners' | 'collegiate',
  word: string,
  key: string,
): string {
  const path = reference === 'learners' ? 'learners' : 'collegiate';
  return `https://www.dictionaryapi.com/api/v3/references/${path}/json/${encodeURIComponent(
    word,
  )}?key=${encodeURIComponent(key)}`;
}
