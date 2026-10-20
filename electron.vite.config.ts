import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'dist/electron',
      rollupOptions: {
        external: ['electron', 'electron-playwright-mcp'],
        input: {
          index: resolve(__dirname, 'electron/main.ts')
        }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'dist/electron',
      emptyOutDir: false,
      rollupOptions: {
        input: {
          preload: resolve(__dirname, 'electron/preload.ts'),
          'repair-surface-preload': resolve(__dirname, 'electron/repair-surface-preload.ts')
        }
      }
    }
  },
  renderer: {
    root: '.',
    plugins: [react()],
    resolve: {
      alias: {
        '@': resolve(__dirname, './src'),
        '@catalyst': resolve(__dirname, './src/components/catalyst')
      }
    },
    build: {
      outDir: 'dist/renderer',
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'index.html'),
          'repair-surface': resolve(__dirname, 'repair-surface.html')
        }
      }
    }
  }
})
