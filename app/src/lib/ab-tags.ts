export type AbAxes = {
  product: string;
  contractor: string;
  channel: string;
  direction: string;
};

const AXIS_PREFIXES = {
  product: 'АВ Продукт: ',
  contractor: 'АВ Подрядчик: ',
  channel: 'АВ Канал: ',
  direction: 'АВ Направление: ',
} as const satisfies Record<keyof AbAxes, string>;

// Both autofunnel tags accompany every scenario set: the legacy plain
// `автоворонки` tag plus the AV-prefixed `АВ Автоворонка`.
const COMMON_TAGS = ['автоворонки', 'АВ Автоворонка'];

/**
 * Build АВ tag-name lists for the reg, time19, time15, and messenger funnel
 * scenarios from the 4 axis values.
 */
export function axesToTagNames(axes: AbAxes): {
  reg: string[];
  time19: string[];
  time15: string[];
  messenger: string[];
} {
  // Only emit a tag for an axis that actually has a value. An empty axis (e.g. a
  // freshly-created draft, or a partial PATCH that touches only one axis) must
  // NOT create placeholder tags like "АВ Продукт: " — those would pollute the
  // `tags` table with permanent orphan rows. On read-back, a missing axis tag
  // already reconstructs as '' (see tagNamesToAxes), so the round-trip holds.
  const axisTags = (
    [
      ['product', axes.product],
      ['contractor', axes.contractor],
      ['channel', axes.channel],
      ['direction', axes.direction],
    ] as [keyof AbAxes, string][]
  )
    .filter(([, value]) => value.trim() !== '')
    .map(([axis, value]) => `${AXIS_PREFIXES[axis]}${value}`);

  const reg: string[] = [
    ...COMMON_TAGS,
    'АВ Этап: Регистрация',
    ...axisTags,
  ];

  const time19: string[] = [
    ...COMMON_TAGS,
    'АВ Этап: Оплата',
    'АВ Время: 19',
    ...axisTags,
  ];

  const time15: string[] = [
    ...COMMON_TAGS,
    'АВ Этап: Оплата',
    'АВ Время: 15',
    ...axisTags,
  ];

  const messenger: string[] = [
    ...COMMON_TAGS,
    'АВ Этап: Мессенджер',
    ...axisTags,
  ];

  return { reg, time19, time15, messenger };
}

/**
 * Parse the 4 axis values back out of a tag-name list (typically the reg list).
 * Tags that don't match any axis prefix are ignored.
 * Missing axis → empty string.
 */
export function tagNamesToAxes(tagNames: string[]): AbAxes {
  const result: AbAxes = { product: '', contractor: '', channel: '', direction: '' };

  for (const name of tagNames) {
    for (const [axis, prefix] of Object.entries(AXIS_PREFIXES) as [keyof AbAxes, string][]) {
      if (name.startsWith(prefix)) {
        result[axis] = name.slice(prefix.length);
        break;
      }
    }
  }

  return result;
}
