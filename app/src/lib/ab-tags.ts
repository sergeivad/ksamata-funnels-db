export type AbAxes = {
  product: string;
  contractor: string;
  channel: string;
  direction: string;
};

export const AXIS_PREFIXES = {
  product: 'АВ Продукт: ',
  contractor: 'АВ Подрядчик: ',
  channel: 'АВ Канал: ',
  direction: 'АВ Направление: ',
} as const satisfies Record<keyof AbAxes, string>;

export type Scenario = 'reg' | 'time_15' | 'time_19' | 'messenger';
export const SCENARIOS: Scenario[] = ['reg', 'time_15', 'time_19', 'messenger'];

export type TagChip = { name: string; source: 'axis' | 'default' | 'custom' };
export type ScenarioTags = { tags: TagChip[]; suppressed: string[] };
export type TagSets = Record<Scenario, ScenarioTags>;

export type TemplateMap = Record<Scenario, string[]>;
export type ScenarioOverride = { add: string[]; remove: string[] };
export type OverrideMap = Record<Scenario, ScenarioOverride>;

/** True when a tag name is an auto-derived axis tag (never removable). */
export function isAxisTag(name: string): boolean {
  return Object.values(AXIS_PREFIXES).some((p) => name.startsWith(p));
}

/**
 * Axis tags for a funnel, one per non-empty axis. An empty axis emits nothing
 * (a bare "АВ Продукт: " would pollute the tags table).
 */
export function axisTagNames(axes: AbAxes): string[] {
  return (
    [
      ['product', axes.product],
      ['contractor', axes.contractor],
      ['channel', axes.channel],
      ['direction', axes.direction],
    ] as [keyof AbAxes, string][]
  )
    .filter(([, value]) => value.trim() !== '')
    .map(([axis, value]) => `${AXIS_PREFIXES[axis]}${value}`);
}

/**
 * Пятая ось. `name` — маркер этой воронки (null = тип не выбран),
 * `known` — все имена из справочника типов. Второе нужно, чтобы погасить
 * ЧУЖОЙ маркер: пока он зашит в tag_templates, квизовая воронка иначе
 * получила бы «АВ Автоворонка» вторым маркером.
 *
 * Множество приходит извне, а не зашито здесь, потому что значения типа
 * правятся через справочник — см. funnel-type.ts.
 */
export type FunnelTypeContext = { name: string | null; known: readonly string[] };

/**
 * Effective tag set per scenario from the four layers:
 *   default = template[scenario] ++ axisTagNames(axes) ++ маркер типа
 *   effective = (default − removed) ++ added
 * - Axis tags and the type marker are NEVER suppressed (identity layer).
 * - Dedup by exact name; first occurrence wins (template/axis over add).
 * - `suppressed` lists template defaults currently removed (for the restore UI).
 */
export function computeTagSet(
  template: TemplateMap,
  axes: AbAxes,
  overrides: OverrideMap,
  type: FunnelTypeContext = { name: null, known: [] },
): TagSets {
  const axisTags = axisTagNames(axes);
  const markerNames = new Set(type.known);
  const isIdentity = (name: string) => isAxisTag(name) || markerNames.has(name);
  const out = {} as TagSets;

  for (const scenario of SCENARIOS) {
    const staticTags = template[scenario] ?? [];
    const ov = overrides[scenario] ?? { add: [], remove: [] };
    // Только неидентичные remove считаются — оси и маркер типа неудаляемы.
    const removeSet = new Set(ov.remove.filter((n) => !isIdentity(n)));

    const tags: TagChip[] = [];
    const seen = new Set<string>();

    const pushIfNew = (name: string, source: TagChip['source']) => {
      if (seen.has(name)) return;
      seen.add(name);
      tags.push({ name, source });
    };

    for (const name of staticTags) {
      if (isIdentity(name)) continue; // теги идентичности приходят только своим слоем
      if (removeSet.has(name)) continue;
      pushIfNew(name, 'default');
    }
    for (const name of axisTags) pushIfNew(name, 'axis');
    if (type.name) pushIfNew(type.name, 'axis');
    for (const name of ov.add) {
      if (isIdentity(name)) continue;
      pushIfNew(name, 'custom');
    }

    const suppressed = staticTags.filter((n) => !isIdentity(n) && removeSet.has(n));
    out[scenario] = { tags, suppressed };
  }

  return out;
}

/**
 * Parse the 4 axis values back out of a tag-name list (typically the reg list).
 * Tags that don't match any axis prefix are ignored. Missing axis → ''.
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

