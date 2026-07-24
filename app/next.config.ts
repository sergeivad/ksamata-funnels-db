import type { NextConfig } from "next";
import { fileURLToPath } from "url";
import path from "path";

// next.config.ts — TypeScript ESM, поэтому __dirname недоступен напрямую;
// восстанавливаем его из import.meta.url.
const dirname = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  output: 'standalone',
  webpack: (config, { nextRuntime }) => {
    // middleware.ts работает на Edge, поэтому Next дополнительно собирает
    // src/instrumentation.ts edge-компилятором (Node-инстанс инструментации
    // не вырезается, если рядом уже есть edge-entry от middleware — см.
    // next/dist/build/entries.js). Рантайм-проверка внутри register() не
    // спасает: webpack всё равно статически резолвит модуль динамического
    // import() для построения графа чанков, и пытается добраться до
    // src/db/client.ts (а через него до better-sqlite3/fs/path) — это и
    // валит edge-сборку, хотя этот код там никогда не выполняется.
    // Вместо того чтобы глушить fs/path целиком для всего edge-бандла (что
    // спрятало бы будущий случайный Node-импорт где угодно, включая
    // middleware.ts с его basic-auth), режем граф точечно: db/client.ts —
    // единственная точка входа в Node-only территорию, и алиас на false
    // резолвится webpack'ом в пустой модуль именно для этого файла. Любой
    // другой Node-only импорт в edge-бандле по-прежнему упадёт громко.
    if (nextRuntime === 'edge') {
      config.resolve.alias = {
        ...config.resolve.alias,
        [path.resolve(dirname, 'src/db/client.ts')]: false,
      };
    }
    return config;
  },
};

export default nextConfig;
