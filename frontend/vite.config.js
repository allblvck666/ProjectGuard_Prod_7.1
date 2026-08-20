import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Штамп сборки: какой коммит реально собран.
// Render отдаёт RENDER_GIT_COMMIT; локально берём из git.
// Попадает в <meta name="build-commit"> — видно обычным curl,
// пользователю не показывается.
function buildCommit() {
  const fromCi = process.env.RENDER_GIT_COMMIT || process.env.GIT_COMMIT
  if (fromCi) return fromCi.slice(0, 7)
  try {
    // Смотрим в корень проекта: в frontend/ лежит забытый вложенный
    // .git от старого репозитория, он бы дал чужой коммит
    const root = fileURLToPath(new URL('..', import.meta.url))
    return execSync('git rev-parse --short HEAD', { cwd: root, encoding: 'utf8' }).trim()
  } catch {
    return 'unknown'
  }
}

function buildStamp() {
  const commit = buildCommit()
  return {
    name: 'pg-build-stamp',
    transformIndexHtml(html) {
      return html.replace(
        '</head>',
        `  <meta name="build-commit" content="${commit}" />\n  </head>`
      )
    },
  }
}

// === ProjectGuard Mini Vite Config (v6.6) ===
export default defineConfig({
  plugins: [react(), buildStamp()],
  // Тот же коммит доступен коду — по нему приложение понимает, что оно устарело
  define: {
    __PG_BUILD__: JSON.stringify(buildCommit()),
  },
  server: {
    host: '0.0.0.0',   // чтобы открыть с телефона по IP
    port: 5173,        // твой порт разработки
  },
  build: {
    outDir: 'dist',    // продакшн-сборка сюда
    rollupOptions: {
      output: {
        entryFileNames: `assets/[name]-[hash].js`,
        chunkFileNames: `assets/[name]-[hash].js`,
        assetFileNames: `assets/[name]-[hash][extname]`
      }
    }
  },
  preview: {
    host: '0.0.0.0',
    port: 5173,
  },
})
