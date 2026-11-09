import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

// In dev, /api/lord runs the same code Vercel runs in production (api/lord.ts), with the env from .env.local.
function lordApi(): Plugin {
  return {
    name: 'lord-api',
    configureServer(server) {
      const env = loadEnv('development', process.cwd(), '');
      server.middlewares.use('/api/lord', async (req, res) => {
        let body = '';
        for await (const c of req) body += c;
        const { lord } = await server.ssrLoadModule('/api/lord.ts') as typeof import('./api/lord.ts');
        const r = await lord(req.method ?? 'GET', body, env);
        res.statusCode = r.status;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify(r.body));
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), lordApi()],
  server: { port: 5196 },
});
