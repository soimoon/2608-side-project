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

interface MwVariant {
  /** 대체 철자 (예: 영국식 "synthesise"). "*"로 음절이 구분된다. */
  va?: string;
  prs?: MwPrs[];
}

interface MwEntry {
  meta?: { id?: string };
  hwi?: { hw?: string; prs?: MwPrs[] };
  /** 철자 변형. 미국/영국 철자 차이(-ize/-ise 등)가 있는 단어는 본표제어 자리(hwi.prs)가
   *  비어 있고 여기에만 발음이 실리는 경우가 실제로 많다 (MW 응답으로 직접 확인). */
  vrs?: MwVariant[];
}

/** 표제어를 비교 가능한 형태로. MW는 음절 구분에 "*"를 쓴다 ("syn*the*size"). */
function headwordOf(entry: MwEntry): string {
  const hw = entry.hwi?.hw?.replace(/\*/g, '');
  if (hw) return hw.trim().toLowerCase();
  // hw가 없으면 meta.id로 대체. 동형이의어는 "battle:2"처럼 뒤에 번호가 붙는다.
  return (entry.meta?.id ?? '').split(':')[0].trim().toLowerCase();
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

  for (const entry of data as MwEntry[]) {
    if (!entry || typeof entry !== 'object') continue;
    // 표제어(meta.id/hwi.hw)가 정확히 일치하는 항목만 쓴다 — 이 판정을 통과하면
    // 그 항목 전체(hwi + vrs)가 "이 단어에 대한 것"이라고 신뢰할 수 있다.
    if (headwordOf(entry) !== want) continue;

    // 본표제어 발음이 우선이고, 없으면 철자 변형(vrs)의 발음을 쓴다. MW 문서상 vrs.prs는
    // "그 변형 철자에 대한 것"이라 원칙적으로 본표제어 발음은 아니지만, 실제로는
    // -ize/-ise처럼 소리가 사실상 같은 스펠링 변형에서 본표제어 쪽이 비어 있고
    // vrs 쪽에만 발음이 실리는 경우가 흔하다(예: synthesize). 이미 표제어 자체는
    // 위에서 확인했으므로 "엉뚱한 단어" 위험 없이 커버리지만 늘어난다.
    const candidates = [...(entry.hwi?.prs ?? []), ...(entry.vrs ?? []).flatMap((v) => v.prs ?? [])];

    for (const p of candidates) {
      // Learner's의 ipa를 우선한다 — 한국 학습자에게는 MW 자체 표기보다 IPA가 읽기 쉽다.
      const phonetic = p.ipa ?? p.mw;
      const notation: Notation | undefined = p.ipa ? 'ipa' : p.mw ? 'mw' : undefined;
      const file = p.sound?.audio;
      if (!phonetic && !file) continue;

      return {
        phonetic: phonetic || undefined,
        notation,
        audioUrl: file ? audioUrl(file) : undefined,
      };
    }
  }
  return null;
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
