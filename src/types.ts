/** 단어 하나의 학습 통계. 취약 단어 우선 출제(SRS 유사 로직)에 쓰인다. */
export interface WordStats {
  seen: number;
  correct: number;
  wrong: number;
  /** 최근 연속 정답 수. 틀리면 0으로 리셋된다. */
  streak: number;
  /** 마지막 출제 시각(epoch ms). 한 번도 안 나왔으면 undefined. */
  lastSeenAt?: number;
}

export interface Word {
  id: string;
  /** 영단어 또는 숙어. 정답 판정은 normalize() 후 비교한다. */
  en: string;
  /**
   * 한글 뜻 목록, 순서대로 1/2/3...으로 표시된다. 붙여넣기로 등록한 단어는 항상
   * 원소 1개짜리 배열이고(파싱은 줄당 하나의 뜻만 뽑는다), 단어 하나에 여러 뜻을
   * 붙이고 싶으면 단어장 관리의 "단어 직접 추가" 폼에서 뜻을 여러 개 입력한다.
   * 뜻 안에 유의어를 쉼표로 나열하는 건 그대로 지원한다 — 배열은 "서로 다른 뜻"을
   * 나누는 용도고, 쉼표는 "같은 뜻의 다른 표현"을 나열하는 용도다.
   */
  ko: string[];
  /** 단어장 이름 (예: "토플 초록책 Day 1"). */
  deck: string;
  createdAt: number;
  /** 마지막으로 이 행이 바뀐 시각. Supabase 동기화의 last-write-wins 병합 기준. */
  updatedAt: number;
  /**
   * 소프트 삭제 시각. 실제로 행을 지우면 아직 동기화 안 된 다른 기기가
   * 다음 push 때 되살릴 수 있어, 삭제도 "삭제됨" 상태로 기록만 한다.
   * 로컬 UI(단어 목록·통계·출제 대상)에서는 이 값이 있으면 없는 것처럼 취급한다.
   */
  deletedAt?: number;
  /**
   * 사용자가 직접 매긴 정렬 키. 순서를 한 번도 안 바꿨으면 없고, 그때는 createdAt을
   * 그대로 정렬 키로 쓴다(`sortKey()`). 값의 눈금을 createdAt과 같은 epoch ms에
   * 맞춰 두었기 때문에, 순서를 바꾼 단어와 안 바꾼 단어가 한 목록에 섞여 있어도
   * 비교가 성립한다 — 그래서 이 필드를 추가하는 데 마이그레이션이 필요 없었다.
   * 두 단어 사이로 끼워 넣을 땐 이웃의 중간값을 쓰므로 정수가 아닐 수 있다.
   */
  order?: number;
  stats: WordStats;
}

export type Strategy = 'weak' | 'random' | 'order';

export interface QuizSettings {
  /** 출제할 단어장. 빈 배열이면 전체. */
  decks: string[];
  /** 이번 퀴즈 문제 수. */
  count: number;
  /** 첫 글자 포함해 공개할 알파벳 비율 (0 ~ 0.4). */
  hintRatio: number;
  /** 단어당 제한 시간(초). */
  seconds: number;
  strategy: Strategy;
  /** 틀리거나 시간 초과했을 때 정답을 보여주고 그대로 따라 치게 할지 (근육기억 강화). */
  retypeOnMiss: boolean;
  /** 틀린 단어를 세션 뒤쪽에 다시 출제할지. */
  requeueWrong: boolean;
  /** 채점되는 순간(정답이든 오답이든) 발음을 자동 재생할지. */
  autoPlayAudio: boolean;
}

/**
 * 한 단어의 발음. Merriam-Webster에서 받아 pronunciations 테이블에 캐시하고,
 * 로컬에도 복사해 두어 오프라인에서도 (음원 파일만 받아졌다면) 발음기호는 볼 수 있게 한다.
 */
export interface Pronunciation {
  /** 소문자 철자. 캐시 키. */
  en: string;
  /**
   * 발음기호. source가 'learners'면 국제음성기호(IPA),
   * 'collegiate'면 MW 자체 표기법이다 — UI에서 구분해 보여준다.
   */
  ipa?: string;
  /** MW CDN의 mp3 주소. 음원을 재호스팅하지 않고 이 URL만 들고 있는다. */
  audioUrl?: string;
  /** 'none'은 "두 사전 모두 확인했지만 없었다" — 다시 조회하지 않기 위해 이것도 캐시한다. */
  source: 'learners' | 'collegiate' | 'none';
  fetchedAt: number;
}

/**
 * 색 테마. 새 테마를 추가할 땐 여기에 이름만 더하면 된다 — styles.css에
 * [data-theme="..."] 블록을 추가하고, Home.tsx의 THEME_LABELS에 표시 이름만
 * 더하면 선택 목록에 자동으로 나타난다.
 */
export const THEMES = ['blue', 'pink', 'cream', 'mint', 'lavender', 'bw-light', 'bw-dark'] as const;
export type Theme = (typeof THEMES)[number];

export type Verdict = 'correct' | 'near' | 'wrong' | 'timeout';

/** 한 문제의 풀이 결과. */
export interface Attempt {
  wordId: string;
  en: string;
  ko: string[];
  input: string;
  verdict: Verdict;
  /** 문제 제시부터 제출까지 걸린 시간(ms). 시간 초과면 제한 시간과 같다. */
  elapsedMs: number;
  /** 재출제로 두 번째 이상 등장한 문제인지. */
  requeued: boolean;
}

export interface SessionResult {
  id: string;
  /** 로컬 기준 YYYY-MM-DD. 향후 출석 기능의 근거 데이터가 된다. */
  date: string;
  startedAt: number;
  finishedAt: number;
  settings: QuizSettings;
  attempts: Attempt[];
}

/** 동기화 진행 커서. 로그인하지 않았거나 한 번도 동기화하지 않았으면 둘 다 0. */
export interface SyncCursor {
  /** 서버에서 이 시각 이후로 바뀐 행만 다시 받아오면 된다. */
  lastPulledAt: number;
  /** 로컬에서 이 시각 이후로 바뀐 행만 서버에 올리면 된다. */
  lastPushedAt: number;
  /**
   * 마지막으로 동기화한 Supabase 계정의 id. 같은 기기에서 다른 계정으로 로그인하면
   * 이 값이 달라지는데, 그때는 커서를 그대로 믿으면 안 된다 — A 계정 기준 커서로
   * B 계정을 pull/push하면 B의 기존 단어를 못 받아오고, A의 로컬 잔여 데이터가
   * 조용히 B 계정에 올라갈 수 있다. 계정이 바뀐 걸 감지해 최초 동기화(병합)로
   * 되돌리기 위한 값이다.
   */
  userId?: string;
}

/** daily_claims.kind와 1:1로 대응. 새 미션이 생기면 여기에 값만 추가하면 된다
 *  (스키마 변경 없음 — kind는 text 컬럼). supabase/schema.sql의 mission_rewards
 *  표와 src/lib/attendance.ts의 MISSIONS 레지스트리에도 같이 추가할 것. */
export type ClaimKind =
  | 'attendance'
  | 'mission_revive'
  | 'mission_volume'
  | 'mission_add'
  | 'mission_accuracy'
  | 'mission_group';

/** 휴지통에 담긴 단어장 하나. 실수로 지운 걸 복원할 수 있게, 삭제해도 바로 못 없앤다. */
export interface DeletedDeck {
  name: string;
  deletedAt: number;
}

export interface DB {
  version: 7;
  words: Word[];
  settings: QuizSettings;
  history: SessionResult[];
  sync: SyncCursor;
  /** 발음 캐시 (소문자 철자 → 발음). 서버 캐시의 로컬 사본이라 언제 지워도 안전하다. */
  pronunciations: Record<string, Pronunciation>;
  /**
   * 단어가 하나도 없어도 미리 만들어 둘 수 있는 단어장 이름 목록. 보통 단어장은
   * words[].deck 값으로부터 자연스럽게 드러나지만, 빈 단어장은 그 방식으로는
   * 존재할 수 없어 따로 저장한다. 이 목록은 아직 계정에 동기화되지 않고 기기
   * 로컬에만 있다 — 단어가 하나라도 들어가는 순간부터는 그 단어를 통해 동기화된다.
   */
  decks: string[];
  /**
   * 단어장 삭제 시 여기로 옮겨진다("휴지통") — 그 단어장 소속 단어들도 같이 소프트
   * 삭제되지만, 완전 삭제를 누르기 전까지는 이 목록에 이름이 남아 복원할 수 있다.
   * decks와 마찬가지로 계정에는 동기화되지 않고 기기 로컬에만 있다.
   */
  deletedDecks: DeletedDeck[];
  /**
   * 선택한 색 테마. 로컬(오프라인 우선, 즉시 반영)에 항상 저장되고, 로그인
   * 상태면 계정(profiles.theme)에도 올라가 다른 기기에서도 마지막에 고른
   * 테마가 그대로 적용된다.
   */
  theme: Theme;
  /**
   * 오늘(KST) 안에 "예전에 틀렸다가 다시 맞힌" 단어의 id 목록. 개수(길이)가 곧
   * 미션 진행률이다. 카운터가 아니라 id 집합인 이유 두 가지:
   * 1) 같은 단어를 하루에 여러 번 다시 맞혀도 한 번만 세야 한다(카운터였다면 매번
   *    올라갔다 — 실제로 있던 버그).
   * 2) id 집합은 revival_events 테이블과 그대로 합집합 병합이 되어(daily_claims와
   *    같은 append-only 패턴) 기기를 바꿔도 오늘 진행률이 유지된다. 날짜가 바뀌면
   *    빈 목록으로 리셋된다.
   */
  dailyMission: { date: string; revivedWordIds: string[] };
  /**
   * "YYYY-MM-DD:kind" 문자열 목록. 출석·미션 보상을 받은 날을 기록한다.
   * append-only라 기기 간에는 그냥 합집합으로 병합하면 된다. 로그인 상태면
   * 계정(daily_claims 테이블)에도 올라간다.
   */
  dailyClaims: string[];
}
