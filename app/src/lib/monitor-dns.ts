/**
 * Куда чекеру ходить нельзя. `normalizeUrl` отсеивает IP-литералы в поле URL,
 * но домен — это обещание, а не адрес: `10.0.0.5.nip.io` выглядит как обычное
 * имя с точками и резолвится в приватную сеть. Поэтому перед каждым соединением
 * хост резолвится, и каждый полученный адрес проходит здесь проверку.
 *
 * Про сеть модуль знает ровно одну функцию — `resolveHostAddresses`;
 * классификатор чистый и потому проверяем без резолвера.
 */

/** Приватные и служебные диапазоны IPv4: [сеть, длина префикса]. */
const RESERVED_V4: ReadonlyArray<readonly [string, number]> = [
  ['0.0.0.0', 8], // «этот хост»
  ['10.0.0.0', 8], // приватная сеть
  ['100.64.0.0', 10], // CGNAT
  ['127.0.0.0', 8], // петля
  ['169.254.0.0', 16], // link-local, здесь же метаданные облака 169.254.169.254
  ['172.16.0.0', 12], // приватная сеть
  ['192.0.0.0', 24], // служебные назначения IETF
  ['192.0.2.0', 24], // TEST-NET-1
  ['192.168.0.0', 16], // приватная сеть
  ['198.18.0.0', 15], // бенчмарк-сети
  ['198.51.100.0', 24], // TEST-NET-2
  ['203.0.113.0', 24], // TEST-NET-3
  ['224.0.0.0', 4], // мультикаст
  ['240.0.0.0', 4], // зарезервировано, включая 255.255.255.255
];

/** Точечная четвёрка → 32-битное число. null, если это не IPv4. */
function parseIpv4(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    value = value * 256 + octet;
  }
  return value;
}

function isReservedV4(value: number): boolean {
  for (const [network, prefix] of RESERVED_V4) {
    const base = parseIpv4(network);
    if (base === null) continue;
    // Сдвиги в JS 32-битные и знаковые, поэтому маскируем делением.
    const size = 2 ** (32 - prefix);
    if (Math.floor(value / size) === Math.floor(base / size)) return true;
  }
  return false;
}

/**
 * IPv6 → восемь 16-битных групп. null, если строку разобрать не удалось.
 * Зона (`fe80::1%eth0`) не разбирается намеренно: такой адрес интересен только
 * внутри хоста, и звать его чекером незачем.
 */
function parseIpv6(ip: string): number[] | null {
  if (ip.includes('%')) return null;
  const halves = ip.split('::');
  if (halves.length > 2) return null;

  const toGroups = (chunk: string): number[] | null => {
    if (chunk === '') return [];
    const out: number[] = [];
    const parts = chunk.split(':');
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      // Хвостовая точечная четвёрка (::ffff:127.0.0.1) занимает две группы.
      if (part.includes('.')) {
        if (i !== parts.length - 1) return null;
        const v4 = parseIpv4(part);
        if (v4 === null) return null;
        out.push(Math.floor(v4 / 65536), v4 % 65536);
        continue;
      }
      if (!/^[0-9a-fA-F]{1,4}$/.test(part)) return null;
      out.push(parseInt(part, 16));
    }
    return out;
  };

  const head = toGroups(halves[0]);
  const tail = halves.length === 2 ? toGroups(halves[1]) : [];
  if (head === null || tail === null) return null;

  if (halves.length === 2) {
    const gap = 8 - head.length - tail.length;
    if (gap < 0) return null;
    return [...head, ...new Array<number>(gap).fill(0), ...tail];
  }
  return head.length === 8 ? head : null;
}

/** Адреса, где IPv4 «завёрнут» в IPv6: судить надо по вложенному адресу. */
function embeddedV4(groups: number[]): number | null {
  const zeroHead = groups.slice(0, 5).every((g) => g === 0);
  // ::ffff:a.b.c.d — IPv4-mapped.
  if (zeroHead && groups[5] === 0xffff) return groups[6] * 65536 + groups[7];
  // 64:ff9b::a.b.c.d — NAT64.
  if (groups[0] === 0x0064 && groups[1] === 0xff9b && groups.slice(2, 6).every((g) => g === 0)) {
    return groups[6] * 65536 + groups[7];
  }
  // 2002:a.b.c.d:: — 6to4.
  if (groups[0] === 0x2002) return groups[1] * 65536 + groups[2];
  return null;
}

/**
 * Пускать ли чекер на этот адрес. Неразобранная строка считается приватной:
 * если мы не поняли адрес, соединяться с ним тем более не стоит.
 */
export function isPrivateAddress(address: string): boolean {
  const ip = address.trim();

  const v4 = parseIpv4(ip);
  if (v4 !== null) return isReservedV4(v4);

  const groups = parseIpv6(ip);
  if (groups === null) return true;

  const nested = embeddedV4(groups);
  if (nested !== null) return isReservedV4(nested);

  if (groups.every((g) => g === 0)) return true; // ::
  if (groups.slice(0, 7).every((g) => g === 0) && groups[7] === 1) return true; // ::1
  if ((groups[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 — ULA
  if ((groups[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 — link-local
  if ((groups[0] & 0xff00) === 0xff00) return true; // ff00::/8 — мультикаст
  return false;
}

/**
 * Резолвер хоста: отдаёт все адреса, к которым может привести соединение.
 * Сама реализация живёт в `monitor-resolver.ts` — она Node-only, а этот модуль
 * обязан оставаться собираемым и для edge-бандла (см. next.config.ts).
 */
export type LookupFn = (hostname: string) => Promise<string[]>;
