import { supabase } from './supabase';

/**
 * 영단어 → 한글 뜻 조회 클라이언트.
 *
 * pronounce.ts와 달리 **자동으로 안 부른다** — "뜻 검색" 버튼을 눌렀을 때만
 * fetchDefinition을 호출한다(AddWordForm 참고). 출시 전 무료로 테스트하는 동안
 * 외부 API 호출을 최소화하고 싶다는 요청이라, 프리페치 없이 딱 필요한 순간에만 부른다.
 */

export interface DefineResult {
  ok: boolean;
  meanings: string[];
  error?: string;
}

interface DefineResponse {
  en: string;
  meanings: string[];
  source: string;
  error?: string;
}

const SHOW_REFS_KEY = 'voca-quiz/show-synonyms';

/** 기본값은 꺼짐 — 처음엔 깔끔한 뜻만 보여준다("지저분해 보인다"는 우려 때문에
 *  기본을 이렇게 잡았다). 관련어·유의어·반의어가 공부에 도움 된다고 느끼는 사람은
 *  켜면 된다. */
export function isShowSynonymsEnabled(): boolean {
  try {
    return localStorage.getItem(SHOW_REFS_KEY) === '1';
  } catch {
    return false;
  }
}

export function setShowSynonymsEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(SHOW_REFS_KEY, enabled ? '1' : '0');
  } catch {
    /* no-op — 저장 안 돼도 이번 세션 내 토글만 안 기억될 뿐, 치명적이지 않다 */
  }
}

/**
 * →/=/↔/≒ 기호를 읽기 쉬운 한글 라벨로 바꾼다. 사용자가 사전 기호 표기 관례를
 * 몰라도 되게 하려는 것과, 폰트에 따라 화살표 글리프가 이상하게 보이는 문제
 * (SUIT 폰트에서 →가 챙 없는 ">" 모양으로 보인다는 실사용 피드백)를 같이 피한다.
 *
 * →는 "바꿔 써도 되는 말"(유의어)이 아니라 "곁들여 볼 만한 다른 표현"이다 — 실제
 * 예시: "사과 (→Adam's apple, Big Apple, cooking apple)"에서 저 셋은 "사과"의
 * 동의어가 아니라 apple이 들어간 별개의 관용구·복합어다. 그래서 =/≒(동의어·유사어)
 * 와는 다른 취급이 맞고, 라벨도 "관련"으로 구분해 둔다. ≒는 유의어와 성격이 겹쳐
 * "유의"에 합친다.
 */
const MARKER_LABELS: Record<string, string> = {
  '→': '관련',
  '=': '유의',
  '↔': '반의',
  '≒': '유의',
};

/**
 * 뜻풀이에서 "(→관련어)", "(=동의어)", "(↔반의어)" 같은 참조 부분을 떼어낸다.
 * 단어 앞쪽에 붙는 "(행동이) 친절한"류 괄호는 뜻풀이 자체의 일부라 안 건드린다 —
 * →·=·↔·≒로 시작하는 괄호만, 문장 안 어디에 있든(보통 끝) 몇 개든 전부 뽑아낸다.
 */
function splitReferences(text: string): { base: string; refs: string[] } {
  const refs: string[] = [];
  const base = text
    .replace(/\s*[,、]?\s*\(([→=↔≒])([^)]*)\)/gu, (_m, marker: string, body: string) => {
      refs.push(`${MARKER_LABELS[marker] ?? '참고'}: ${body.trim()}`);
      return '';
    })
    .trim();
  return { base, refs };
}

/**
 * 참조를 통째로 지우고 핵심 뜻만 남긴다. "관련어·유의어·반의어 함께 보기" 토글이
 * 꺼져 있을 때 화면에 뿌리기 직전에만 쓴다 — 서버 캐시(definitions 테이블)엔
 * 원본이 그대로 남아 있어서, 토글을 다시 켜면 재조회 없이 바로 보여줄 수 있다.
 */
export function stripReferences(text: string): string {
  return splitReferences(text).base;
}

/**
 * 참조를 지우지 않고, →/=/↔/≒ 기호 대신 "관련: ...", "동의어: ..." 같은 한글
 * 라벨로 바꿔서 붙인다. 토글이 켜져 있을 때 쓴다.
 */
export function formatWithReferences(text: string): string {
  const { base, refs } = splitReferences(text);
  if (refs.length === 0) return base;
  return `${base} (${refs.join(' · ')})`;
}

export async function fetchDefinition(word: string): Promise<DefineResult> {
  const trimmed = word.trim();
  if (!trimmed) return { ok: false, meanings: [] };
  if (!supabase) return { ok: false, meanings: [], error: '클라우드 설정이 없습니다.' };

  // 서버에도 없는 걸 새로 조회하려면 로그인이 필요하다(발음 조회와 같은 이유 — 할당량 보호).
  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session) return { ok: false, meanings: [], error: '로그인이 필요합니다.' };

  try {
    const { data, error } = await supabase.functions.invoke<DefineResponse>('define', {
      body: { word: trimmed },
    });
    if (error || !data) {
      return { ok: false, meanings: [], error: error?.message ?? '뜻을 가져오지 못했습니다.' };
    }
    if (data.meanings.length === 0) {
      return { ok: false, meanings: [], error: `"${trimmed}"의 뜻을 찾지 못했습니다.` };
    }
    return { ok: true, meanings: data.meanings };
  } catch (e) {
    return { ok: false, meanings: [], error: String(e) };
  }
}
