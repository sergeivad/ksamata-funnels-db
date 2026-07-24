import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: 'standalone',
  webpack: (config, { nextRuntime }) => {
    // middleware.ts работает на Edge, поэтому Next дополнительно собирает
    // src/instrumentation.ts edge-компилятором (Node-инстанс инструментации
    // не вырезается, если рядом уже есть edge-entry от middleware — см.
    // next/dist/build/entries.js). Рантайм-проверка внутри register() не
    // спасает: webpack всё равно статически резолвит модуль динамического
    // import() для построения графа чанков, и попытка добраться до
    // better-sqlite3 (а через него до fs/path) валит именно edge-сборку,
    // хотя этот код там никогда не выполняется. Отдаём fs/path пустышкой
    // только для edge-рантайма — для Node всё остаётся как есть.
    if (nextRuntime === 'edge') {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        path: false,
      };
    }
    return config;
  },
};

export default nextConfig;
