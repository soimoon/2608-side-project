/**
 * 구글·카카오 로그인 버튼 전용 브랜드 마크. 다른 화면의 장식 아이콘(Icon.tsx,
 * Lucide 기반)과 달리 이 둘은 실제 브랜드를 나타내야 해서 테마 색을 안 따르고
 * 고정된 색을 쓴다. 구글 로고는 구글 Sign-In 버튼 빌더가 내보내는 공식 4색
 * path 그대로다. 카카오는 공식 심볼 대신, 카카오가 허용하는 범위(문서: "카카오
 * 고유의 이미지를 해치지 않는 범위 내에서 버튼을 유동적으로 재구성 가능") 안에서
 * 말풍선 모양을 직접 그렸다 — 저작물을 복제하지 않기 위해서다.
 */

export function GoogleIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  );
}

/** "말싹" 워드마크 옆에 붙는 새싹 심볼. 앱 아이콘·파비콘과 같은 모양이라
 * 랜딩 화면과 브라우저 탭·홈 화면 아이콘이 한눈에 같은 걸로 읽힌다. */
export function SproutMark({ size = 72, color = '#3ddc97' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 128 128" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <path d="M64 108 C64 96 64 86 64 78" stroke={color} strokeWidth="8" strokeLinecap="round" fill="none" />
      <path d="M64,82 C44,82 24,68 30,36 C50,42 64,56 64,82 Z" fill={color} />
      <path d="M64,82 C84,82 104,68 98,36 C78,42 64,56 64,82 Z" fill={color} />
      <ellipse cx="64" cy="109" rx="19" ry="5.5" fill="#ffffff" opacity="0.85" />
    </svg>
  );
}

export function KakaoIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <path
        fill="#191919"
        d="M12 3C6.477 3 2 6.664 2 11.19c0 2.917 1.87 5.484 4.688 6.95-.207.775-.75 2.808-.86 3.244-.135.54.199.533.418.388.172-.114 2.74-1.86 3.85-2.618.615.09 1.253.137 1.904.137 5.523 0 10-3.664 10-8.19S17.523 3 12 3z"
      />
    </svg>
  );
}
