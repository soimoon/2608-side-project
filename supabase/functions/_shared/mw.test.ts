import { describe, expect, it } from 'vitest';
import { audioSubdirectory, audioUrl, extractPronunciation, lookupUrl } from './mw';

describe('audioSubdirectory (MW가 정한 규칙)', () => {
  it('bix로 시작하면 bix', () => {
    expect(audioSubdirectory('bixcuit01')).toBe('bix');
  });
  it('gg로 시작하면 gg', () => {
    expect(audioSubdirectory('ggabby01')).toBe('gg');
  });
  it('숫자나 기호로 시작하면 number', () => {
    expect(audioSubdirectory('3d000001')).toBe('number');
    expect(audioSubdirectory('_ampers')).toBe('number');
  });
  it('그 외에는 첫 글자', () => {
    expect(audioSubdirectory('pajama02')).toBe('p');
    expect(audioSubdirectory('synthe02')).toBe('s');
  });
});

describe('audioUrl', () => {
  it('MW 문서의 예시와 정확히 일치한다', () => {
    expect(audioUrl('pajama02')).toBe(
      'https://media.merriam-webster.com/audio/prons/en/us/mp3/p/pajama02.mp3',
    );
  });
  it('number 디렉터리도 올바르게 만든다', () => {
    expect(audioUrl('3d000001')).toBe(
      'https://media.merriam-webster.com/audio/prons/en/us/mp3/number/3d000001.mp3',
    );
  });
});

describe('extractPronunciation', () => {
  const learnersEntry = {
    meta: { id: 'synthesize' },
    hwi: {
      hw: 'syn*the*size',
      prs: [{ ipa: 'ˈsɪnθəˌsaɪz', sound: { audio: 'synthe02' } }],
    },
  };

  it('Learner\'s 응답에서 IPA와 음원 URL을 뽑는다', () => {
    const got = extractPronunciation([learnersEntry], 'synthesize');
    expect(got).toEqual({
      phonetic: 'ˈsɪnθəˌsaɪz',
      notation: 'ipa',
      audioUrl: 'https://media.merriam-webster.com/audio/prons/en/us/mp3/s/synthe02.mp3',
    });
  });

  it('Collegiate 응답(mw 표기)도 표기 체계를 붙여 뽑는다', () => {
    const data = [
      {
        meta: { id: 'acute' },
        hwi: { hw: 'acute', prs: [{ mw: 'ə-ˈkyüt', sound: { audio: 'acute001' } }] },
      },
    ];
    const got = extractPronunciation(data, 'acute');
    expect(got?.notation).toBe('mw');
    expect(got?.phonetic).toBe('ə-ˈkyüt');
  });

  it('표제어의 음절 구분 "*"를 무시하고 일치시킨다', () => {
    expect(extractPronunciation([learnersEntry], 'SYNTHESIZE')).not.toBeNull();
  });

  it('동형이의어 번호(meta.id "battle:2")를 떼고 비교한다', () => {
    const data = [
      { meta: { id: 'battle:2' }, hwi: { prs: [{ ipa: 'ˈbætl̟', sound: { audio: 'battle01' } }] } },
    ];
    expect(extractPronunciation(data, 'battle')?.phonetic).toBe('ˈbætl̟');
  });

  // 이 앱에서 가장 나쁜 실패는 "엉뚱한 단어의 발음을 알려주는 것"이라, 아래 경우는
  // 반드시 null이어야 한다. 발음이 없는 것보다 틀린 발음이 훨씬 해롭다.
  it('표제어가 정확히 일치하지 않으면 발음을 주지 않는다', () => {
    const got = extractPronunciation([learnersEntry], 'synthesis');
    expect(got).toBeNull();
  });

  it('철자 추천(문자열 배열)이 오면 발음을 주지 않는다', () => {
    expect(extractPronunciation(['synthesize', 'synthesis'], 'sinthesize')).toBeNull();
  });

  it('빈 응답·잘못된 응답에도 죽지 않고 null을 준다', () => {
    expect(extractPronunciation([], 'acute')).toBeNull();
    expect(extractPronunciation(null, 'acute')).toBeNull();
    expect(extractPronunciation({ nope: true }, 'acute')).toBeNull();
  });

  it('발음 정보가 아예 없는 항목은 건너뛴다', () => {
    const data = [{ meta: { id: 'acute' }, hwi: { hw: 'acute' } }];
    expect(extractPronunciation(data, 'acute')).toBeNull();
  });

  it('음원 없이 발음기호만 있어도 가져온다', () => {
    const data = [{ meta: { id: 'acute' }, hwi: { hw: 'acute', prs: [{ ipa: 'əˈkjut' }] } }];
    const got = extractPronunciation(data, 'acute');
    expect(got?.phonetic).toBe('əˈkjut');
    expect(got?.audioUrl).toBeUndefined();
  });

  it('숙어(공백 포함)도 그대로 일치시킨다', () => {
    const data = [
      { meta: { id: 'give up' }, hwi: { hw: 'give up', prs: [{ ipa: 'ɡɪv ˈʌp' }] } },
    ];
    expect(extractPronunciation(data, 'give up')?.phonetic).toBe('ɡɪv ˈʌp');
  });
});

describe('lookupUrl', () => {
  it('사전별 경로와 키를 붙인다', () => {
    expect(lookupUrl('learners', 'synthesize', 'KEY')).toBe(
      'https://www.dictionaryapi.com/api/v3/references/learners/json/synthesize?key=KEY',
    );
    expect(lookupUrl('collegiate', 'acute', 'K2')).toContain('/references/collegiate/json/acute');
  });

  it('공백이 든 숙어를 URL 인코딩한다', () => {
    expect(lookupUrl('learners', 'give up', 'KEY')).toContain('/json/give%20up?key=KEY');
  });
});
