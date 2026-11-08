import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const api = process.env.CROWNFALL_API ?? 'http://localhost:8796';
export default defineConfig({
  plugins: [react()],
  server: { port: 5196, proxy: { '/api': api } },
});
