import type { Pronunciation } from '../types';
import { playAudio } from '../lib/pronounce';

interface Props {
  pron?: Pronunciation;
  /** 발음기호까지 함께 보여줄지. 좁은 표에서는 끈다. */
  showPhonetic?: boolean;
  size?: 'sm' | 'md';
}

/**
 * 발음 재생 버튼.
 *
 * 아직 조회 전(pron === undefined)이면 아무것도 그리지 않는다 — 로딩 자리표시자가
 * 깜빡이면 타이머 퀴즈에서 시선을 뺏는다.
 *
 * MW에 음원이 없으면(source === 'none' 또는 audioUrl 없음) TTS로 대체하지 않고
 * "발음 없음"이라고 밝힌다. 합성 발음을 진짜처럼 들려주면 사용자가 틀린 발음을
 * 외우게 되고, 그건 이 앱이 하려는 일과 정반대다.
 */
export default function PronounceButton({ pron, showPhonetic = true, size = 'md' }: Props) {
  if (!pron) return null;

  const phonetic = showPhonetic && pron.ipa ? pron.ipa : null;
  // Learner's는 국제음성기호(IPA), Collegiate는 MW 자체 표기 — 어느 쪽인지 밝혀 준다.
  const notationLabel = pron.source === 'collegiate' ? 'MW 표기' : 'IPA';

  if (!pron.audioUrl) {
    return (
      <span className={`pron ${size}`}>
        {phonetic && (
          <span className="pron-ipa" title={notationLabel}>
            {phonetic}
          </span>
        )}
        <span
          className="pron-none muted"
          title="Merriam-Webster 사전에서 확인했지만 이 단어(숙어 등)는 별도 발음 녹음이 없습니다"
        >
          발음 없음
        </span>
      </span>
    );
  }

  return (
    <span className={`pron ${size}`}>
      <button
        type="button"
        className="pron-play"
        onClick={(e) => {
          // 퀴즈 화면에서 입력칸 포커스를 뺏기지 않도록.
          e.preventDefault();
          e.currentTarget.blur();
          playAudio(pron.audioUrl!);
        }}
        title={`발음 듣기 (미국식${phonetic ? ` · ${notationLabel} ${phonetic}` : ''})`}
        aria-label={`${pron.en} 발음 듣기`}
      >
        🔊
      </button>
      {phonetic && (
        <span className="pron-ipa" title={notationLabel}>
          {phonetic}
        </span>
      )}
    </span>
  );
}
