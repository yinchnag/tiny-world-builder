import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// editor 前端构建/Dev 配置（F4 脚手架）。
export default defineConfig({
  plugins: [react()],
});
