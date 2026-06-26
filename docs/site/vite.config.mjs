import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// hostdoc docs site. Deployed to GitHub Pages at https://jkas2016.github.io/hostdoc/,
// so assets are served under the /hostdoc/ base path.
export default defineConfig({
  base: '/hostdoc/',
  plugins: [react()],
});
