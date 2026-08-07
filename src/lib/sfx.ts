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
