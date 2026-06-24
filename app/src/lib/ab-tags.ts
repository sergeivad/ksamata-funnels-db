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

const COMMON_TAGS = ['АВ Автоворонка'];

/**
 * Build АВ tag-name lists for reg, time19, and time15 funnel slots
 * from the 4 axis values.
 */
export function axesToTagNames(axes: AbAxes): {
  reg: string[];
  time19: string[];
  time15: string[];
} {
  const axisTags = [
    `${AXIS_PREFIXES.product}${axes.product}`,
    `${AXIS_PREFIXES.contractor}${axes.contractor}`,
    `${AXIS_PREFIXES.channel}${axes.channel}`,
    `${AXIS_PREFIXES.direction}${axes.direction}`,
  ];

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

  return { reg, time19, time15 };
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
