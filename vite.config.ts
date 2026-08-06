import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// malssak.com 커스텀 도메인(public/CNAME)으로 루트 경로에서 서빙되므로 기본값 '/'이면
// 충분하다. VITE_BASE는 예전 https://<user>.github.io/<repo>/ 서빙 방식의 흔적으로
// 남겨 둔다 — 커스텀 도메인을 다시 뗄 일이 생기면 그때만 워크플로에서 다시 주입하면 된다.
export default defineConfig({
  base: process.env.VITE_BASE ?? '/',
  plugins: [react()],
});
