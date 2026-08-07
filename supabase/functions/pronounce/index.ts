/**
 * 발음 조회 Edge Function.
 *
 * 클라이언트가 MW를 직접 부르지 않는 이유는 두 가지다.
 *  1) API 키가 클라이언트 번들에 들어가면 그대로 노출된다.
 *  2) MW 무료 티어는 사전당 1000회/일이라, 결과를 전 사용자가 공유하는
 *     pronunciations 테이블에 캐시해야 한다. 그러면 단어 하나당 평생 최대 2회만 부른다.
 *
 * 배포:
 *   supabase functions deploy pronounce
 *   supabase secrets set MW_LEARNERS_KEY=... MW_COLLEGIATE_KEY=...
 */
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { extractPronunciation, lookupUrl, type MwPronunciation } from '../_shared/mw.ts';

/**
 * 한 요청에서 새로 조회할 단어 수 상한. 캐시에 있는 건 몇 개든 바로 돌려주고,
 * 이 상한은 "MW를 실제로 부르는" 단어에만 적용된다. 실수로 수백 개를 한 번에
 * 요청해도 하루 할당량을 한 번에 태우지 않게 하는 안전장치다.
 */
const MAX_LOOKUPS_PER_REQUEST = 60;
/** MW에 동시에 던지는 요청 수. */
const CONCURRENCY = 5;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface PronunciationRow {
  en: string;
  ipa: string | null;
  audio_url: string | null;
  /** 'learners' | 'collegiate' | 'none'. 'none'은 "MW에 없음을 확인함" — 재조회를 막는다. */
  source: string;
  /** null이 아니면 조회어 자신이 아니라 이 원형 단어의 발음을 대신 준 것. */
  base_word: string | null;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

/** MW 한 단어 조회. 실패하면 null — 한 단어가 죽어도 나머지는 살아야 한다. */
async function lookupOne(
  word: string,
  keys: { learners?: string; collegiate?: string },
): Promise<{ result: MwPronunciation | null; source: string }> {
  const references: ('learners' | 'collegiate')[] = ['learners', 'collegiate'];

  for (const ref of references) {
    const key = ref === 'learners' ? keys.learners : keys.collegiate;
    if (!key) continue;
    try {
      const res = await fetch(lookupUrl(ref, word, key));
      if (!res.ok) continue;
      const found = extractPronunciation(await res.json(), word);
      if (found) return { result: found, source: ref };
    } catch (e) {
      console.error(`MW ${ref} 조회 실패: ${word}`, e);
    }
  }
  // 두 사전 모두 확인했지만 없었다 — 이것도 캐시해 다음에 다시 부르지 않는다.
  return { result: null, source: 'none' };
}

/** 배열을 size개씩 끊어 순차 처리한다 (MW에 한꺼번에 몰아치지 않도록). */
async function inBatches<T, R>(
  items: T[],
  size: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(...(await Promise.all(items.slice(i, i + size).map(fn))));
  }
  return out;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'POST만 허용' }, 405);

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ error: '로그인이 필요합니다' }, 401);

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;

  // 호출자가 실제 로그인 사용자인지 확인한다. MW 할당량을 아무나 태우지 못하게.
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData.user) return json({ error: '로그인이 필요합니다' }, 401);

  let words: string[];
  try {
    const body = await req.json();
    words = Array.isArray(body?.words) ? body.words : [];
  } catch {
    return json({ error: '잘못된 요청 형식' }, 400);
  }

  // 정규화 + 중복 제거. 캐시 키는 항상 소문자다.
  const wanted = [...new Set(words.map((w) => String(w).trim().toLowerCase()).filter(Boolean))];
  if (wanted.length === 0) return json({ pronunciations: [] });

  // service role은 RLS를 우회한다 — pronunciations 쓰기는 이 함수만 할 수 있다.
  const admin = createClient(supabaseUrl, serviceKey);

  const { data: cached, error: cacheErr } = await admin
    .from('pronunciations')
    .select('en, ipa, audio_url, source, base_word')
    .in('en', wanted);
  if (cacheErr) return json({ error: cacheErr.message }, 500);

  const rows: PronunciationRow[] = (cached as PronunciationRow[]) ?? [];
  const have = new Set(rows.map((r) => r.en));
  const missing = wanted.filter((w) => !have.has(w)).slice(0, MAX_LOOKUPS_PER_REQUEST);

  if (missing.length > 0) {
    const keys = {
      learners: Deno.env.get('MW_LEARNERS_KEY') ?? undefined,
      collegiate: Deno.env.get('MW_COLLEGIATE_KEY') ?? undefined,
    };
    if (!keys.learners && !keys.collegiate) {
      return json({ error: 'MW API 키가 설정되지 않았습니다' }, 503);
    }

    const fetched = await inBatches(missing, CONCURRENCY, async (word) => {
      const { result, source } = await lookupOne(word, keys);
      return {
        en: word,
        ipa: result?.phonetic ?? null,
        audio_url: result?.audioUrl ?? null,
        source,
        base_word: result?.baseWord ?? null,
      } satisfies PronunciationRow;
    });

    // 캐시 저장이 실패해도 이번 응답은 정상적으로 돌려준다 (다음 요청에서 다시 시도).
    const { error: upsertErr } = await admin
      .from('pronunciations')
      .upsert(fetched, { onConflict: 'en' });
    if (upsertErr) console.error('발음 캐시 저장 실패', upsertErr);

    rows.push(...fetched);
  }

  return json({
    pronunciations: rows.map((r) => ({
      en: r.en,
      ipa: r.ipa ?? undefined,
      audioUrl: r.audio_url ?? undefined,
      source: r.source,
      baseWord: r.base_word ?? undefined,
    })),
    // 상한에 걸려 아직 조회하지 못한 단어 수. 클라이언트가 나눠서 다시 요청하면 된다.
    remaining: Math.max(0, wanted.length - rows.length),
  });
});
