#!/usr/bin/env python3
"""Сборка markdown-отчёта. Возвращает строку и ничего не пишет на диск.

Разделы идут в порядке разбора: сначала то, что можно залить, потом спорное,
потом справочное. Совпавшее не показывается вовсе — отчёт про расхождения,
а не про инвентарь.

Каждый список печатается в детерминированном порядке: владелец сверяет
повторные прогоны глазами, и строки, переставляющиеся местами без изменения
данных, — это шум, который прячет настоящие изменения. `diff_items` в
links_compare группирует slot_differs через пересечение множеств, поэтому
порядок между разными адресами от прогона к прогону не гарантирован —
здесь, при печати, список сортируется явно. links_compare и links_match не
трогаем, они уже проверены и закрыты.
"""

from dataclasses import dataclass

from links_db import label_of


@dataclass(frozen=True)
class FunnelReport:
    label: str
    product_name: str
    block_name: str
    sheet: str
    row: int
    key: str
    has_tariffs: bool
    has_apps: bool
    tariffs: object     # Diff
    apps: object        # Diff


@dataclass(frozen=True)
class Unslotted:
    label: str
    block_name: str
    kind: str
    url: str
    row: int


KIND_TITLE = {'tariffs': 'Тарифы', 'applications': 'Оформление заявки'}


def _pairs(lines, pairs):
    for slot, url in pairs:
        lines.append(f'  - `{slot or "?"}` {url}')


def _is_fillable(rep):
    return ((not rep.has_tariffs and rep.tariffs.only_sheet)
            or (not rep.has_apps and rep.apps.only_sheet))


def _diverges(rep):
    for has, diff in ((rep.has_tariffs, rep.tariffs),
                      (rep.has_apps, rep.apps)):
        if has and (diff.only_sheet or diff.only_db or diff.slot_differs):
            return True
    return False


def build_report(today, sheets_count, result, reports, unslotted, funnels,
                 active_total):
    fillable = [r for r in reports if _is_fillable(r)]
    diverging = [r for r in reports if not _is_fillable(r) and _diverges(r)]
    blocks_total = (len(result.matched) + len(result.ambiguous)
                    + len(result.orphans) + len(result.dead))

    out = [
        '# Тарифы и оформление заявки: таблица ↔ база',
        '',
        f'Прогон {today.isoformat()}. Источник — гугл-таблица «Воронки ссылки», '
        f'читается через сервисный аккаунт. Инструмент ничего не пишет.',
        '',
        '## Сводка',
        '',
        f'- листов: {sheets_count} видимых (скрытые пропущены)',
        f'- блоков в них: {blocks_total}',
        f'- сматчено с воронкой: {len(result.matched)} '
        f'(по комнатам {sum(1 for m in result.matched if m.key == "rooms")}, '
        f'по адресам тарифов {sum(1 for m in result.matched if m.key == "urls")})',
        f'- неоднозначных: {len(result.ambiguous)}',
        f'- живых блоков без воронки: {len(result.orphans)}',
        f'- помечены в таблице отключёнными: {len(result.dead)}',
        f'- активных воронок: {active_total}, из них можно заполнить: '
        f'{len(fillable)}, расходятся: {len(diverging)}',
        '',
    ]

    out += ['## Можно залить', '']
    if not fillable:
        out += ['Нечего.', '']
    for rep in fillable:
        out.append(f'### {rep.label} — {rep.product_name}')
        out.append('')
        out.append(f'Блок таблицы «{rep.block_name}», лист {rep.sheet}, '
                   f'строка {rep.row}.')
        out.append('')
        for kind, has, diff in (('tariffs', rep.has_tariffs, rep.tariffs),
                                ('applications', rep.has_apps, rep.apps)):
            if has or not diff.only_sheet:
                continue
            out.append(f'**{KIND_TITLE[kind]}**')
            _pairs(out, diff.only_sheet)
            out.append('')

    out += ['## Расхождения', '']
    if not diverging:
        out += ['Нет.', '']
    for rep in diverging:
        out.append(f'### {rep.label} — {rep.product_name}')
        out.append('')
        out.append(f'Блок таблицы «{rep.block_name}», лист {rep.sheet}, '
                   f'строка {rep.row}.')
        out.append('')
        for kind, has, diff in (('tariffs', rep.has_tariffs, rep.tariffs),
                                ('applications', rep.has_apps, rep.apps)):
            if not has or not (diff.only_sheet or diff.only_db
                               or diff.slot_differs):
                continue
            out.append(f'**{KIND_TITLE[kind]}** — совпало {diff.same}')
            if diff.only_sheet:
                out.append('')
                out.append('Только в таблице:')
                _pairs(out, diff.only_sheet)
            if diff.only_db:
                out.append('')
                out.append('Только в базе:')
                _pairs(out, diff.only_db)
            if diff.slot_differs:
                out.append('')
                out.append('Разный слот:')
                for url, sheet_slot, db_slot in sorted(diff.slot_differs):
                    out.append(f'  - {url}: в таблице `{sheet_slot}`, '
                               f'в базе `{db_slot}`')
            out.append('')

    out += ['## Неоднозначные блоки', '']
    if not result.ambiguous:
        out += ['Нет.', '']
    for amb in result.ambiguous:
        names = ', '.join(
            f'{label_of(funnels[fid])} ({weight})'
            for fid, weight in amb.candidates if fid in funnels)
        out.append(f'- «{amb.block.name}», лист {amb.block.sheet}, '
                   f'строка {amb.block.row} → {names}')
    out.append('')

    out += ['## Слот не определён', '']
    if not unslotted:
        out += ['Нет.', '']
    for item in unslotted:
        out.append(f'- {item.label} «{item.block_name}», '
                   f'{KIND_TITLE[item.kind]}, строка {item.row}: {item.url}')
    out.append('')

    out += ['## Живые блоки без воронки', '']
    if not result.orphans:
        out += ['Нет.', '']
    for block in result.orphans:
        out.append(f'- «{block.name}», лист {block.sheet}, строка {block.row}: '
                   f'тарифов {len(block.tariffs)}, заявок {len(block.apps)}')
    out.append('')

    out += ['## Отключённые блоки', '',
            f'{len(result.dead)} блоков помечены в таблице отключёнными '
            f'(«отключена», «Комнаты удалены») — в разбор не идут.', '']
    return '\n'.join(out)
