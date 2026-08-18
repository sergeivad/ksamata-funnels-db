#!/usr/bin/env python3
"""План заливки: что из отчёта можно записать в блоки воронки как есть.

Чистый модуль — ни сети, ни базы, ни диска. На вход отчётные структуры
`links_report.FunnelReport`, на выход список блоков, готовых уехать в
`PUT /api/funnels/{id}/blocks/{kind}`.

Заливаем ТОЛЬКО вид, которого в базе нет вовсе (`KindReport.has_block ==
False`). У такого вида `diff_items` сравнивала список таблицы с пустой
базой, поэтому `diff.only_sheet` — это в точности пары (слот, адрес) листа,
в исходном порядке. Расхождения не чиним: непустой блок правит человек.

## Режим блока и слот — по замеру живой базы 18.08.2026, не по догадке

`tariffs` и `applications` — режим «по времени», слот ровно тот, что стоит
в таблице. Соблазнительная догадка «адрес без времени в слаге обслуживает
оба эфира, надо продублировать» **опровергнута**: из 146 случаев, где
таблица даёт адрес под одним слотом, база держит его под тем же одним
слотом в 146. Ни одного дубля. Зеркалить нельзя.

`upsell` — режим «общее», слот снимается в None. В таблице дожимная ссылка
физически лежит в 19-й половине блока, и `sheet_items` честно отдаёт ей
слот 19, но это свойство строки, а не времени: все 20 сматченных блоков
допродаж, которые в базе уже есть, лежат там как «Общее» без слота, и
исключений нет. Поэтому слот здесь именно снимается, а не переносится.

`enabled` — всегда True: все 64 блока этих трёх видов в базе включены,
выключенных нет. Заливать выключенный блок значило бы спрятать только что
залитое.

Подпись — пустая строка. В базе у позиций всех трёх видов подписей нет
(поле `fields: 1` у этих видов в `app/src/lib/blocks.ts` — редактор рисует
только адрес). Подпись из колонки G листа остаётся справочной и в план не
едет.

## Смешанный блок не заливаем

Блок, где часть адресов со слотом, а часть без, в план не попадает: в
режиме «по времени» бесслотовая строка потеряла бы привязку, а в «общем»
её потеряли бы все остальные. Замер 18.08.2026: таких блоков ноль, но
правило нужно — оно про завтрашнюю таблицу, а не про сегодняшнюю.
"""

from dataclasses import dataclass

# Виды, у которых слот в таблице отражает реальное разделение по эфирам.
BY_TIME_KINDS = ('tariffs', 'applications')

# Виды, у которых слот в таблице — артефакт места строки в блоке.
COMMON_KINDS = ('upsell',)


@dataclass(frozen=True)
class PlanBlock:
    """Один блок к заливке. `items` — [(слот, адрес)], слот None или '15'/'19'."""
    label: str          # F-код воронки; id не используем — на проде своя нумерация
    kind: str
    mode: str           # 'by_time' | 'common'
    items: list


@dataclass(frozen=True)
class PlanSkip:
    """Вид, который таблица даёт, но заливать его нельзя. `reason` — человеку."""
    label: str
    kind: str
    reason: str


def block_plan(label, kind, pairs):
    """(PlanBlock, None) либо (None, PlanSkip) для одного вида блока.

    `pairs` — [(слот, адрес)] из таблицы. Пустой список — не блок, а нечего
    заливать: возвращаем (None, None), это не пропуск и не ошибка.
    """
    if not pairs:
        return None, None

    if kind in COMMON_KINDS:
        # Слот снимаем сознательно — см. докстринг модуля.
        return PlanBlock(label, kind, 'common',
                         [(None, url) for _, url in pairs]), None

    slots = {slot for slot, _ in pairs}
    if None not in slots:
        return PlanBlock(label, kind, 'by_time', list(pairs)), None
    if slots == {None}:
        return PlanBlock(label, kind, 'common', list(pairs)), None
    known = sorted(s for s in slots if s)
    return None, PlanSkip(
        label, kind,
        f'часть адресов без слота (есть {", ".join(known)} и без слота) — '
        f'режим блока не определить')


def build_plan(reports):
    """(blocks, skips) по списку FunnelReport. Порядок отчёта сохраняется."""
    blocks, skips = [], []
    for rep in reports:
        for kind, kind_report in rep.kinds.items():
            if kind_report.has_block:
                continue
            block, skip = block_plan(rep.label, kind,
                                     kind_report.diff.only_sheet)
            if block is not None:
                blocks.append(block)
            if skip is not None:
                skips.append(skip)
    return blocks, skips


def plan_json(today, blocks):
    """Структура для json.dump — то, что читает скрипт заливки."""
    return {
        'generated': today.isoformat(),
        'source': 'гугл-таблица «Воронки ссылки», раздел «Можно залить»',
        'blocks': [
            {
                'funnel': b.label,
                'kind': b.kind,
                'mode': b.mode,
                'enabled': True,
                'items': [{'slot': slot, 'label': '', 'url': url}
                          for slot, url in b.items],
            }
            for b in blocks
        ],
    }
