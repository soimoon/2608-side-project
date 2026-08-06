import { useState } from 'react';
import type { CloudSync } from '../lib/useCloudSync';
import { GoogleIcon, KakaoIcon } from './BrandIcons';

interface Props {
  sync: CloudSync;
}

/**
 * 앱의 첫 진입 화면. 로그인 없이 그냥 쓰는 길은 없다 — 게스트도 명시적인 선택지다
 * (익명 로그인이라 데이터가 기기에만 저장된다는 걸 알고 고르게 한다). 이렇게 하면
 * "로그인 안 한 상태로 흘러가다 나중에 데이터를 잃는" 경로 자체가 없어진다.
 *
 * 게스트는 단체게임에서 이미 쓰던 익명 로그인(signInAnonymously)을 그대로 재사용한다
 * — 별도의 "건너뛰기" 경로를 새로 만들지 않는다.
 */
export default function LandingScreen({ sync }: Props) {
  const [googleLoading, setGoogleLoading] = useState(false);
  const [kakaoLoading, setKakaoLoading] = useState(false);
  const [guestLoading, setGuestLoading] = useState(false);
  const [error, setError] = useState('');

  async function startGoogle() {
    setGoogleLoading(true);
    setError('');
    await sync.signInWithGoogle();
    // 성공하면 OAuth 리다이렉트로 페이지 자체가 새로고침되므로 여기로 못 돌아온다.
    // 실패(팝업 차단 등)했을 때만 로딩이 풀린 채로 남는다.
    setGoogleLoading(false);
  }

  async function startKakao() {
    setKakaoLoading(true);
    setError('');
    await sync.signInWithKakao();
    setKakaoLoading(false);
  }

  async function startGuest() {
    setGuestLoading(true);
    setError('');
    const res = await sync.signInAnonymously();
    setGuestLoading(false);
    if (!res.ok) setError(res.error ?? '시작하지 못했습니다.');
  }

  return (
    <div className="screen landing">
      <div className="landing-body">
        <h1 className="landing-title">보카 퀴즈</h1>
        <p className="muted">한글 뜻을 보고 영단어를 직접 타이핑하며 외우는 퀴즈</p>

        <div className="landing-actions">
          <button className="btn oauth google lg" disabled={googleLoading} onClick={startGoogle}>
            <GoogleIcon />
            {googleLoading ? '연결하는 중…' : 'Google로 로그인'}
          </button>

          <button className="btn oauth kakao lg" disabled={kakaoLoading} onClick={startKakao}>
            <KakaoIcon />
            {kakaoLoading ? '연결하는 중…' : '카카오로 로그인'}
          </button>

          <button className="btn ghost lg" disabled={guestLoading} onClick={startGuest}>
            {guestLoading ? '시작하는 중…' : '게스트로 시작하기'}
          </button>
          <p className="muted landing-hint">
            게스트는 이 기기에만 데이터가 저장돼요. 브라우저 데이터를 지우면 단어장을 잃을 수
            있습니다 — 나중에 설정에서 언제든 계정을 연결할 수 있어요.
          </p>
        </div>

        {error && (
          <p className="notice-bar" role="status">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
