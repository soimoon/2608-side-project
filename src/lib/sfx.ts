/**
 * 퀴즈 효과음(정답·오답·카운트다운). 발음 재생(pronounce.ts)과 달리 이건 로컬
 * 정적 파일이라 네트워크·로그인이 필요 없다.
 *
 * 음원: Kenney.nl Interface Sounds 팩(CC0, 상업적 이용 무료) — public/sfx/LICENSE.txt 참고.
 *
 * 공부 앱이라 "산만하지 않고 조용하게"가 핵심 요구사항이었다 — 전체 볼륨을 낮게
 * 잡고, 카운트다운 tick은 실사용 피드백으로 한 번 더(75% → 37.5%) 낮췄다 — 3초
 * 동안 세 번이나 울리는 소리라 이만큼 낮추지 않으면 정답/오답보다 오히려 더 거슬린다.
 *
 * 오답음은 처음엔 정답보다 한 단계 낮춘 볼륨(80%)의 error_006을 썼는데, 실사용
 * 피드백으로 "굉장히 거슬린다"는 의견을 받아 같은 팩의 error_007로 교체하고
 * 정답과 같은 볼륨(100%)으로 맞췄다 — 정답과 위화감 없게, 소리 자체가 이미
 * 더 부드러워 굳이 한 단계 낮추지 않아도 된다는 판단.
 */

const MASTER_VOLUME = 0.5;

const SOUNDS = {
  correct: { file: 'correct.ogg', volume: 1 },
  wrong: { file: 'wrong.ogg', volume: 1 },
  tick: { file: 'tick.ogg', volume: 0.375 },
} as const satisfies Record<string, { file: string; volume: number }>;

export type SfxName = keyof typeof SOUNDS;

const ENABLED_KEY = 'voca-quiz/sfx-enabled';

/** 기본값은 켜짐 — 명시적으로 끈 적이 있을 때만 '0'이 저장돼 있다. */
export function isSfxEnabled(): boolean {
  try {
    return localStorage.getItem(ENABLED_KEY) !== '0';
  } catch {
    return true;
  }
}

export function setSfxEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(ENABLED_KEY, enabled ? '1' : '0');
  } catch {
    /* no-op — 저장 안 돼도 이번 세션 내 재생만 막히지 않을 뿐, 치명적이지 않다 */
  }
}

/**
 * 효과음 재생. 매번 새 Audio 인스턴스를 만든다 — pronounce.ts의 playAudio와 달리
 * 여기서는 겹쳐 재생돼야 자연스럽다(예: 그룹게임에서 여러 명이 동시에 정답을
 * 맞히거나, tick이 채 안 끝났는데 다음 tick이 울리는 경우). 실패해도 학습을
 * 막으면 안 되므로 조용히 무시한다.
 *
 * 재생이 끝나면(또는 실패하면) resolve되는 Promise를 돌려준다 — 발음 자동재생이
 * 이 소리와 겹치지 않고 끝난 뒤에 이어서 나오게 하려는 용도다(QuizScreen 참고).
 * 'ended' 이벤트가 어떤 이유로든 안 불릴 경우를 대비해 1.5초 안전망도 둔다.
 * 설정에서 꺼뒀으면 아무 소리도 안 내고 곧바로 resolve한다.
 */
export function playSfx(name: SfxName): Promise<void> {
  if (!isSfxEnabled()) return Promise.resolve();
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve();
    };
    try {
      const { file, volume } = SOUNDS[name];
      const audio = new Audio(`${import.meta.env.BASE_URL}sfx/${file}`);
      audio.volume = MASTER_VOLUME * volume;
      audio.addEventListener('ended', finish, { once: true });
      audio.addEventListener('error', finish, { once: true });
      void audio.play().catch(finish);
      window.setTimeout(finish, 1500);
    } catch {
      finish();
    }
  });
}

/** 퀴즈 시작 시 한 번 불러 둔다 — 브라우저가 파일을 미리 내려받아 두면, 실제로
 *  필요한 순간(정답/오답 판정)에 새 Audio 인스턴스를 만들자마자 곧바로 매끄럽게
 *  재생된다. 실사용 피드백으로 정답음이 "띠, 디딩~"처럼 버벅이는 현상이 있었는데,
 *  재생 시작 시점에 파일을 아직 못 받아온 게 원인일 가능성이 높아서 추가했다. */
export function preloadSfx(): void {
  for (const { file } of Object.values(SOUNDS)) {
    try {
      const audio = new Audio(`${import.meta.env.BASE_URL}sfx/${file}`);
      audio.preload = 'auto';
      audio.load();
    } catch {
      /* no-op — 못 미리 받아도 실제 재생 시점에 다시 시도되니 그만이다 */
    }
  }
}

/**
 * 모바일 브라우저의 "사용자 조작 없이는 소리 재생 금지" 정책을 미리 풀어 둔다.
 * 사용자 제스처(클릭·Enter) 안에서 실제로 재생을 한 번 성공시켜 두면, 이후 타이머
 * 만료처럼 제스처 없이 걸리는 재생(예: 시간 초과)도 대부분의 브라우저에서 잠깐
 * 동안은 계속 허용된다.
 *
 * "잠깐 동안"이 핵심이다 — 이 허용은 브라우저가 페이지 전체에 영구히 부여하는
 * 게 아니라 "최근 조작"에서 시간이 좀 지나면 다시 잠그는 것으로 보인다("퀴즈
 * 시작할 땐 시간초과 소리가 나다가 계속하다 보니 다시 안 들리기 시작한다"는
 * 실사용 피드백으로 확인). 그래서 퀴즈 시작 때 한 번이 아니라, Enter 제출·
 * 일시중지 버튼처럼 세션 내내 반복되는 진짜 사용자 조작이 있을 때마다 매번
 * 다시 불러야 한다(QuizScreen 참고). 거의 무음으로 아주 짧게 재생하고 바로 멈춘다.
 */
export function primeAudio(): void {
  try {
    const audio = new Audio(`${import.meta.env.BASE_URL}sfx/tick.ogg`);
    audio.volume = 0.01;
    void audio
      .play()
      .then(() => {
        audio.pause();
        audio.currentTime = 0;
      })
      .catch(() => {
        /* 실패해도 그만 — 다음 사용자 조작 때 다시 시도될 뿐 치명적이지 않다 */
      });
  } catch {
    /* no-op */
  }
}
