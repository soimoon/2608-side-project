import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// GitHub Pages는 https://<user>.github.io/<repo>/ 아래에 배포되므로
// 배포 빌드에서만 base 경로를 저장소 이름으로 맞춘다.
// (Actions 워크플로에서 VITE_BASE=/voca-quiz/ 로 주입)
export default defineConfig({
  base: process.env.VITE_BASE ?? '/',
  plugins: [react()],
});
