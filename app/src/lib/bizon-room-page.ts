/**
 * bizon-room-page.ts — что сообщает страница комнаты Бизона. Чистый модуль:
 * ни сети, ни БД, ни node:*.
 *
 * Замер 29.09.2026 на web.ksamatacenter.com/room/<слаг>:
 *  - несуществующая комната отвечает 200 со страницей «Веб-комната не найдена»
 *    (тот же признак, что у мониторинга, — берём его оттуда, а не дублируем);
 *  - у существующей в скрипте лежит `closestDate = +'<мс>'` — начало
 *    ближайшего показа. Час этого показа и есть время повтора: у трёх воронок
 *    «Сосуды»/«Суставы» 15:00 → 19:00 и 9:00, 19:00 → 9:00 и 12:00.
 *    Дата не нужна — повторы ежедневные, нужен только час.
 */
import { SOFT_MISSING } from './monitor-content';

const MISSING = SOFT_MISSING['web.ksamatacenter.com'];
const CLOSEST_RE = /closestDate\s*=\s*\+?'(\d{10,})'/;

/** Москва без перехода на летнее время с 2014 года — смещение постоянное. */
const MSK_OFFSET_MS = 3 * 60 * 60 * 1000;

export type BizonRoomPage = { exists: false } | { exists: true; time: string | null };

export function parseBizonRoomPage(html: string): BizonRoomPage {
  if (MISSING.re.test(html)) return { exists: false };
  const m = CLOSEST_RE.exec(html);
  const ms = m ? Number(m[1]) : 0;
  // Ноль — у комнаты нет ни одного запланированного показа: комната есть,
  // времени нет. Это не «повтора нет».
  if (!ms) return { exists: true, time: null };
  const d = new Date(ms + MSK_OFFSET_MS);
  const hh = d.getUTCHours();
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return { exists: true, time: `${hh}:${mm}` };
}
