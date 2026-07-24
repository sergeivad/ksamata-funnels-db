/**
 * Хук старта сервера Next. Вызывается один раз на процесс.
 * Планировщик поднимаем только на Node-рантайме: на Edge нет ни таймеров
 * нужного вида, ни доступа к better-sqlite3.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { startMonitorScheduler } = await import('./lib/monitor-scheduler');
  startMonitorScheduler();
}
