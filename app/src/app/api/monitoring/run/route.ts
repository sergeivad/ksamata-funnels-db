import { NextResponse } from 'next/server';
import { db } from '@/db/client';
import { runMonitorCycle, isCycleRunning } from '@/lib/monitor-run';

export const dynamic = 'force-dynamic';

/**
 * Запускает цикл и отвечает сразу, не дожидаясь конца.
 *
 * Ждать нельзя: на охвате по умолчанию (~43 ленда) цикл занимает секунды, но
 * группу GetCourse (470 целей) включают одним кликом, а одна недоступная цель
 * стоит до 23 с (10 с таймаут + 3 с пауза + 10 с ретрай). При параллельности 8
 * это десятки минут — любой обратный прокси оборвёт такой запрос, страница
 * покажет «Не удалось запустить проверку», хотя цикл идёт, и оператор нажмёт
 * кнопку ещё раз. Поэтому 202 + опрос GET /api/monitoring на стороне страницы.
 */
export async function POST() {
  if (isCycleRunning()) {
    return NextResponse.json({ error: 'Проверка уже идёт' }, { status: 409 });
  }

  // runMonitorCycle поднимает флаг синхронно, до первого await, — к моменту
  // ответа GET /api/monitoring уже отдаёт running=true.
  void runMonitorCycle(db).catch((err: unknown) => {
    // Промис никто не ждёт: без catch отказ стал бы unhandled rejection,
    // а это валит процесс Node целиком.
    console.error('POST /api/monitoring/run: цикл упал', err);
  });

  return NextResponse.json({ started: true }, { status: 202 });
}
