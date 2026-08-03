/**
 * 단어 가리기(마스킹) 로직.
 *
 * 규칙:
 *  - 첫 알파벳은 항상 공개한다 (동의어가 많아 뜻만으로는 좁혀지지 않으므로).
 *  - 공백/하이픈 같은 비알파벳 문자는 항상 공개한다 ("give up", "well-known").
 *  - 나머지는 hintRatio 비율만큼 "골고루 흩어서" 공개한다.
 *    한쪽에 몰려 나오면 힌트 가치가 떨어지므로 구간을 나눠 구간마다 하나씩 뽑는다.
 *  - 같은 단어라도 세션 시드가 바뀌면 공개 위치가 달라져 위치 자체를 외우는 걸 막는다.
 */

/** 결정론적 PRNG (mulberry32). 같은 시드 → 같은 수열. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function isLetter(ch: string): boolean {
  return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z');
}

/**
 * 각 글자를 공개할지 여부를 반환한다. 길이는 word.length와 같다.
 *
 * @param ratio 첫 글자를 포함해 공개할 알파벳 비율. 0이면 첫 글자만.
 * @param seed  세션마다 달라지는 시드.
 */
export function maskWord(word: string, ratio: number, seed: number): boolean[] {
  const chars = [...word];
  const revealed = chars.map((c) => !isLetter(c));

  const letterIdx: number[] = [];
  chars.forEach((c, i) => {
    if (isLetter(c)) letterIdx.push(i);
  });
  if (letterIdx.length === 0) return revealed;

  revealed[letterIdx[0]] = true;

  // 첫 글자를 포함한 총 공개 글자 수.
  const target = Math.max(1, Math.round(letterIdx.length * ratio));
  const extra = Math.min(target - 1, letterIdx.length - 1);
  if (extra <= 0) return revealed;

  // 첫 글자를 뺀 나머지를 extra개 구간으로 균등 분할하고, 구간마다 한 자리씩 뽑는다.
  const pool = letterIdx.slice(1);
  const rand = mulberry32(hashString(word) ^ seed);
  const bucket = pool.length / extra;
  for (let b = 0; b < extra; b++) {
    const start = Math.floor(b * bucket);
    const end = Math.max(start + 1, Math.floor((b + 1) * bucket));
    revealed[pool[start + Math.floor(rand() * (end - start))]] = true;
  }
  return revealed;
}

/** "s _ n t _ _ _ _ _ e" 형태의 미리보기 문자열. UI 렌더링이 아닌 설명·테스트용. */
export function maskPreview(word: string, ratio: number, seed = 0): string {
  const revealed = maskWord(word, ratio, seed);
  return [...word].map((c, i) => (revealed[i] ? c : '_')).join(' ');
}
