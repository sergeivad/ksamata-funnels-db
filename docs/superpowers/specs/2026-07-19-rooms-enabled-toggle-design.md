# Тумблер вкл/выкл блока «Вебинарные комнаты»

**Дата:** 2026-07-19
**Статус:** дизайн утверждён

## Проблема

У блока «Вебинарные комнаты» (`RoomsEditor`) есть тумблер «повтор», но нет
тумблера вкл/выкл, как у остальных блоков (`BlockEditor`). При этом есть
воронки без вебинарных комнат — у них блок всё равно всегда показан в режиме
редактирования и занимает место сеткой дней.

## Решение

Добавить воронке флаг `roomsEnabled` по образцу существующего
`roomsReplayEnabled`, и научить `RoomsEditor` сворачиваться в тонкую строку
(как `BlockEditor`), когда блок выключен.

Ключевые свойства, повторяющие поведение обычных блоков:
- Выключенный блок сворачивается в строку: иконка + заголовок + выключенный
  `Switch`.
- Переключение тумблера **автосохраняется сразу** (как в `BlockEditor`),
  через уже существующий `PATCH /api/funnels/[id]`.
- Выключение **не удаляет данные**: строки в `funnel_days` остаются, просто
  скрываются. Повторное включение возвращает их.

## Модель данных и миграция (Phase-4)

Новая колонка воронки `rooms_enabled INTEGER DEFAULT 1` — зеркало
`rooms_replay_enabled`.

Новая идемпотентная миграция Phase-4 по образцу Phase-2/3 (свои файлы
`migrate-phase4.ts` / `migrate-phase4-data.ts` / `migrate-phase4-runner.cjs`,
подключается в `docker-entrypoint.sh` после Phase-3):

1. `addColumnIfMissing(sqlite, 'funnels', 'rooms_enabled', ddl)` — добавляет
   колонку с `DEFAULT 1`, поэтому все существующие строки стартуют как
   включённые.
2. Одноразовый бэкофилл под маркером в `schema_migrations`
   (name = `phase4_rooms_enabled`):
   `UPDATE funnels SET rooms_enabled = 0 WHERE id NOT IN (SELECT DISTINCT funnel_id FROM funnel_days)`.
   Сворачивает воронки без строк дней, оставляет включёнными те, где данные
   есть. `funnel_days` не трогаем.
3. `DEFAULT 1` означает, что новые воронки стартуют включёнными (совпадает с
   текущим «блок всегда показан»). `createFrom` копирует `source.roomsEnabled`.

Разделение слоёв как в Phase-3: общий DDL/логика в `migrate-phase4-data.ts`,
запуск для tsx/тестов в `migrate-phase4.ts`, `.cjs`-раннер для Docker.

## API и серверная модель

- `src/db/schema.ts`: добавить `roomsEnabled: integer('rooms_enabled').default(1)`.
- `src/lib/funnels.ts`:
  - тип `FunnelDetail`/`Funnel` — поле `roomsEnabled: boolean`;
  - чтение строки → `roomsEnabled: (row.roomsEnabled ?? 1) === 1`;
  - update: `if (data.roomsEnabled !== undefined) scalarUpdate.roomsEnabled = data.roomsEnabled ? 1 : 0;`
  - create (draft) — задать `roomsEnabled: 1` (или опустить, полагаясь на default);
  - `createFrom` — `roomsEnabled: source.roomsEnabled ?? 1`.
- `src/lib/validation.ts`: в `funnelCreateSchema` добавить
  `roomsEnabled: z.boolean().optional()` (partial-схема апдейта наследует).
- Новый endpoint не нужен: `RoomsEditor` уже делает `PATCH /api/funnels/[id]`
  для `roomsReplayEnabled`; `roomsEnabled` едет тем же запросом.

## UI

- `RoomsEditor`:
  - новый проп `enabled: boolean` + локальный стейт `enabled`;
  - когда **выключен** — рендерит свёрнутую строку в точности как
    `BlockEditor` в disabled-состоянии (иконка `Tv` + «Вебинарные комнаты» +
    выключенный `Switch`), тумблер автосохраняет (`PATCH { roomsEnabled: v }`);
  - когда **включён** — в шапке два переключателя: новый вкл/выкл `Switch`
    (крайний справа, как у блоков) и существующий «повтор»;
  - `dirty` и payload сохранения включают `roomsEnabled` (на случай изменения
    вместе с ручным «Сохранить»);
  - выключение сохраняет строки дней в БД (не очищает `funnel_days`).
- `FunnelSections`: передать `enabled={funnel.roomsEnabled}` в `RoomsEditor`.
- `FunnelCompactView` (режим «Просмотр»): показывать комнаты только когда
  `funnel.roomsEnabled && dayGroups.length > 0`.

### Автосохранение свёрнутой строки

Тумблер в свёрнутой строке автосохраняет — как в `BlockEditor` — чтобы
случайное/намеренное выключение сразу отражалось в БД без отдельного нажатия
«Сохранить». Это утверждено.

## Тестирование

- Юнит: бэкофилл Phase-4 (воронка с днями → 1, без дней → 0; повторный запуск
  идемпотентен, маркер не даёт пере-запуска).
- `funnels.ts`: round-trip `roomsEnabled` (create/read/update).
- `createFrom` копирует `roomsEnabled`.
- Следовать существующим паттернам тестов в `app/tests`.

## Вне рамок (YAGNI)

- Не добавляем отдельный endpoint для комнат.
- Не мигрируем/не чистим `funnel_days` при выключении.
- Не меняем логику режима «Просмотр» сверх условия `roomsEnabled && days>0`.
