/**
 * 퀴즈 효과음(정답·오답·카운트다운). 발음 재생(pronounce.ts)과 달리 이건 로컬
 * 정적 파일이라 네트워크·로그인이 필요 없다.
 *
 * 음원: Kenney.nl Interface Sounds 팩(CC0, 상업적 이용 무료) — public/sfx/LICENSE.txt 참고.
 *
 * 공부 앱이라 "산만하지 않고 조용하게"가 핵심 요구사항이었다 — 전체 볼륨을 낮게
 * 잡고, 카운트다운 tick만 사용자 요청대로 그중에서도 75%로 한 번 더 낮춘다.
 */

const MASTER_VOLUME = 0.5;

const SOUNDS = {
  correct: { file: 'correct.ogg', volume: 1 },
  wrong: { file: 'wrong.ogg', volume: 1 },
  /** 정답/오답보다 한 단계 더 조용하게 — 3초 동안 세 번이나 울리는 소리라 이만큼
   *  낮추지 않으면 정답/오답보다 오히려 더 거슬린다. */
  tick: { file: 'tick.ogg', volume: 0.75 },
} as const satisfies Record<string, { file: string; volume: number }>;

export type SfxName = keyof typeof SOUNDS;

/**
 * 효과음 재생. 매번 새 Audio 인스턴스를 만든다 — pronounce.ts의 playAudio와 달리
 * 여기서는 겹쳐 재생돼야 자연스럽다(예: 그룹게임에서 여러 명이 동시에 정답을
 * 맞히거나, tick이 채 안 끝났는데 다음 tick이 울리는 경우). 실패해도 학습을
 * 막으면 안 되므로 조용히 무시한다.
 */
export function playSfx(name: SfxName): void {
  try {
    const { file, volume } = SOUNDS[name];
    const audio = new Audio(`${import.meta.env.BASE_URL}sfx/${file}`);
    audio.volume = MASTER_VOLUME * volume;
    void audio.play().catch(() => {
      /* 자동재생 차단 등 — 사용자가 이미 입력을 치고 있었을 것이므로 상호작용은 있었을 가능성이 높다 */
    });
  } catch {
    /* 효과음 실패가 학습을 막아서는 안 된다 */
  }
}
