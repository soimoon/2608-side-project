/**
 * 영단어 → 한글 뜻 조회 Edge Function.
 *
 * pronounce Edge Function과 설계가 같다(공유 캐시, service role로만 쓰기, 로그인
 * 필수). 다른 점은 호출 시점 — 단어를 입력한다고 자동으로 안 부른다. 사용자가
 * "뜻 검색" 버튼을 눌렀을 때만 호출된다. 출시 전 무료로 주변 사람과 테스트하는
 * 동안 외부 API(SerpApi 경유 네이버사전) 호출을 최소화하고 싶다는 요청이었다.
 *
 * 배포:
 *   supabase functions deploy define
 *   supabase secrets set SERPAPI_KEY=...
 */
import { createClient } from 'jsr:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

interface DefinitionRow {
  en: string;
  meanings: string[];
  source: string;
}

interface SerpApiDefinition {
  position?: number;
  description?: string;
}

interface SerpApiResponse {
  dictionary_result?: {
    definitions?: SerpApiDefinition[];
  };
}

/**
 * SerpApi로 네이버 검색 결과를 조회해 사전 카드(dictionary_result)에서 한글
 * 뜻을 뽑는다. 못 찾으면 빈 배열 — 예외는 호출부가 처리한다(한 단어 실패가
 * 전체 요청을 막으면 안 된다).
 *
 * engine 파라미터는 'naver_dictionary'가 아니라 그냥 'naver'다(일반 네이버 검색 —
 * 검색어에 사전 결과가 있으면 dictionary_result가 자동으로 딸려 온다). 실제
 * 응답으로 확인한 값이니 바꾸지 말 것.
 *
 * 검색어 그대로("apple")만 던지면 브랜드명 등과 겹치는 흔한 단어는 네이버가
 * 쇼핑/뉴스 카드를 우선 보여주고 사전 카드를 아예 안 줄 때가 많다(실제로
 * "apple"에서 확인). 끝에 "뜻"을 붙이면("apple 뜻") 사전 의도가 명확해져 카드가
 * 훨씬 안정적으로 뜬다 — 여러 단어로 실측 확인.
 *
 * "(→관련어)", "(=동의어)", "(↔반의어)" 같은 참조가 뜻풀이 끝에 붙어 나올 때가
 * 있는데, 여기서 미리 안 지운다 — 보여줄지 말지는 사용자 토글에 달렸다(관련어·
 * 유의어·반의어가 공부에 도움 된다는 사람도, 지저분해 싫다는 사람도 있다). 원본 하나만
 * 캐시해 두면 클라이언트가 로컬 토글에 따라 그때그때 정리한다(defineApi.ts의
 * stripReferences 참고) — 토글을 껐다 켰다 해도 재조회가 필요 없다.
 */
async function lookupMeanings(word: string, apiKey: string): Promise<string[]> {
  const url = `https://serpapi.com/search.json?engine=naver&query=${encodeURIComponent(
    `${word} 뜻`,
  )}&api_key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url);
  if (!res.ok) return [];
  const data = (await res.json()) as SerpApiResponse;
  const defs = data.dictionary_result?.definitions ?? [];
  return defs
    .slice()
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
    .map((d) => d.description?.trim())
    .filter((d): d is string => Boolean(d));
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'POST만 허용' }, 405);

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ error: '로그인이 필요합니다' }, 401);

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;

  // 호출자가 실제 로그인 사용자인지 확인한다. API 할당량을 아무나 못 태우게.
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData.user) return json({ error: '로그인이 필요합니다' }, 401);

  let word: string;
  try {
    const body = await req.json();
    word = String(body?.word ?? '').trim().toLowerCase();
  } catch {
    return json({ error: '잘못된 요청 형식' }, 400);
  }
  if (!word) return json({ error: '단어가 비어 있습니다' }, 400);

  // service role은 RLS를 우회한다 — definitions 쓰기는 이 함수만 할 수 있다.
  const admin = createClient(supabaseUrl, serviceKey);

  const { data: cached, error: cacheErr } = await admin
    .from('definitions')
    .select('en, meanings, source')
    .eq('en', word)
    .maybeSingle();
  if (cacheErr) return json({ error: cacheErr.message }, 500);

  if (cached) {
    const row = cached as DefinitionRow;
    return json({ en: row.en, meanings: row.meanings, source: row.source });
  }

  const apiKey = Deno.env.get('SERPAPI_KEY');
  if (!apiKey) return json({ error: 'SerpApi 키가 설정되지 않았습니다' }, 503);

  let meanings: string[] = [];
  try {
    meanings = await lookupMeanings(word, apiKey);
  } catch (e) {
    console.error('SerpApi 조회 실패', e);
  }

  const source = meanings.length > 0 ? 'naver' : 'none';
  // 캐시 저장이 실패해도 이번 응답은 정상적으로 돌려준다 (다음 요청에서 다시 시도).
  const { error: upsertErr } = await admin
    .from('definitions')
    .upsert({ en: word, meanings, source }, { onConflict: 'en' });
  if (upsertErr) console.error('뜻 캐시 저장 실패', upsertErr);

  return json({ en: word, meanings, source });
});
