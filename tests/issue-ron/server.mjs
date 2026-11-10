// Synthetic component harness, not authenticated Electron/Supabase acceptance.
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../../', import.meta.url))
const fixture = fileURLToPath(new URL('./', import.meta.url))
const server = await createServer({
  root,
  configFile: false,
  optimizeDeps: { entries: ['tests/issue-ron/description-fixture.tsx'] },
  plugins: [react(), {
    name: 'issue-ron-test-page',
    configureServer(server) {
      server.middlewares.use('/__description-ron', async (_req, res) => {
        res.setHeader('Content-Type', 'text/html')
        res.end(await server.transformIndexHtml('/__description-ron',
          '<html><body><div id="root"></div><script type="module" src="/tests/issue-ron/description-fixture.tsx"></script></body></html>'))
      })
    },
  }],
  resolve: { alias: [
    { find: '@/stores/authStore', replacement: `${fixture}stores.ts` },
    { find: '@/api/supabase', replacement: `${fixture}stores.ts` },
    { find: '@/stores/projectsStore', replacement: `${fixture}stores.ts` },
    { find: '@', replacement: `${root}src` },
  ] },
  server: { host: '127.0.0.1', port: 5188, strictPort: true },
})
await server.listen()
console.log('Synthetic description Ron harness: http://127.0.0.1:5188/__description-ron')
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, async () => { await server.close(); process.exit(0) })
}