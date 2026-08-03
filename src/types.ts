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

export interface DB {
  version: 1;
  words: Word[];
  settings: QuizSettings;
  history: SessionResult[];
}
