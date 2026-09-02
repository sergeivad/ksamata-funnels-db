/**
 * Phase-17 — общие константы: какие осевые FK-колонки следуют за тегами.
 *
 * Префиксы повторяют `AXIS_PREFIXES` из [app/src/lib/ab-tags.ts] дословно, но
 * ОБЪЯВЛЕНЫ ЗДЕСЬ, а не импортированы: раннер собирается esbuild'ом в
 * отдельный .cjs для Docker, и ни одна фаза не тянет в свой бандл `src/`
 * (проверено — так не делает ни одна из шестнадцати). Согласие двух сторон
 * держит [app/tests/migrate-phase17.test.ts] — тем же приёмом, каким
 * `stage-tag-spelling.test.ts` держит написание тега этапа.
 */

export type Phase17Axis = {
  /** Колонка FK на строке funnels. */
  column: 'contractor_id' | 'product_id';
  /** Справочник, куда она ссылается. */
  table: 'contractors' | 'products';
  /** Префикс осевого тега; значение оси — всё, что за ним. */
  prefix: string;
  /** Как ось зовут в логе фазы. */
  label: string;
};

/**
 * Две оси из четырёх — и это ПОЛНЫЙ список.
 *
 * `channel` и `direction` колонок на `funnels` не имеют вовсе (таблицы
 * `channels`/`directions` осиротели ещё до фазы 2), так что расходиться
 * там нечему.
 *
 * `source_id` сюда НЕ входит и входить не может — см. шапку
 * migrate-phase17.ts, раздел «Почему source_id не трогаем».
 *
 * `funnel_type_id` — пятая ось, и она уже согласована по построению:
 * `resolveFunnelTypeId` ищет строку среди существующих, а маркер в теги
 * кладёт `materializeFunnelTags` из той же строки. Замер 02.09.2026 по
 * репозиторной базе: расхождений ноль.
 */
export const PHASE17_AXES: Phase17Axis[] = [
  {
    column: 'contractor_id',
    table: 'contractors',
    prefix: 'АВ Подрядчик: ',
    label: 'подрядчик',
  },
  {
    column: 'product_id',
    table: 'products',
    prefix: 'АВ Продукт: ',
    label: 'продукт',
  },
];
