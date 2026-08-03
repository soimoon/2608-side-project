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
  /** 한글 뜻. 여러 개면 쉼표로 이어 쓴다. */
  ko: string;
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

export type Verdict = 'correct' | 'near' | 'wrong' | 'timeout';

/** 한 문제의 풀이 결과. */
export interface Attempt {
  wordId: string;
  en: string;
  ko: string;
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
}

export interface DB {
  version: 2;
  words: Word[];
  settings: QuizSettings;
  history: SessionResult[];
  sync: SyncCursor;
  /** 발음 캐시 (소문자 철자 → 발음). 서버 캐시의 로컬 사본이라 언제 지워도 안전하다. */
  pronunciations: Record<string, Pronunciation>;
}
