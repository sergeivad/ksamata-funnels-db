/**
 * Боевой резолвер хоста — единственная Node-only точка в цепочке мониторинга
 * помимо `db/client.ts`. Вынесен в отдельный файл именно поэтому: `next.config.ts`
 * глушит его для edge-бандла точечным алиасом, и `monitor-dns.ts` с чистым
 * классификатором адресов остаётся собираемым везде.
 *
 * Здесь не должно появиться ничего, кроме резолва: всё, что можно проверить
 * без сети, живёт в `monitor-dns.ts`.
 */
import { lookup } from 'node:dns/promises';
import type { LookupFn } from './monitor-dns';

export const resolveHostAddresses: LookupFn = async (hostname) => {
  // all: true — соединение может уйти на любой из адресов, проверять надо все.
  const found = await lookup(hostname, { all: true, verbatim: true });
  return found.map((entry) => entry.address);
};
