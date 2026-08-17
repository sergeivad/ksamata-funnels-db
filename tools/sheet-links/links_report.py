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

«Можно залить» и «Расхождения» классифицируют ВИД блока (тарифы, заявки),
а не воронку целиком — у одной воронки тарифы могут быть заливаемы, а
заявки уже разойтись с базой. Секции поэтому не взаимоисключающие: такая
воронка попадает в обе, и в каждой печатается только тот вид, который к
ней относится. Склеивать в одну гибридную запись нельзя — секции отвечают
на разные вопросы владельца («что скопировать» и «что пойти проверить»).
"""

from collections import Counter
from dataclasses import dataclass

from links_db import label_of

# Порядок видов блока — общий для всех циклов печати и для сортировки
# «слот не определён» в run_sheet_links (там же порядок должен совпадать,
# чтобы тарифы шли раньше заявок и допродаж, как в остальных секциях).
KIND_ORDER = ('tariffs', 'applications', 'upsell')


@dataclass(frozen=True)
class KindReport:
    has_block: bool     # блок этого вида есть в базе
    diff: object         # Diff


@dataclass(frozen=True)
class FunnelReport:
    label: str
    product_name: str
    block_name: str
    sheet: str
    row: int
    key: str
    kinds: dict          # вид -> KindReport, в порядке KIND_ORDER


@dataclass(frozen=True)
class Unslotted:
    label: str
    block_name: str
    sheet: str
    kind: str
    url: str
    row: int


KIND_TITLE = {'tariffs': 'Тарифы', 'applications': 'Оформление заявки',
             'upsell': 'Допродажи / дожим'}

# Как воронка была опознана за блоком листа — печатается в заголовке
# каждого разбираемого блока, словами, а не голым значением `key`.
KEY_NOTE = {
    'rooms': 'Воронка определена по вебинарной комнате.',
    'urls': ('Воронка определена по адресу, который уже есть в базе — это '
             'более слабая примета: такой адрес в принципе можно '
             'переиспользовать в другом блоке. Стоит проверить, что блок '
             'действительно относится к этой воронке.'),
}


def _pairs(lines, pairs):
    for slot, url in pairs:
        lines.append(f'  - `{slot or "?"}` {url}')


def _fillable_kinds(rep):
    """Виды блока этой воронки, которых в базе нет, а в таблице есть чем
    заполнить. Классификация идёт по виду, а не по воронке целиком — у
    одной воронки тарифы могут быть заливаемы, а заявки уже разойтись."""
    return [kind for kind in KIND_ORDER
            if not rep.kinds[kind].has_block and rep.kinds[kind].diff.only_sheet]


def _diverging_kinds(rep):
    """Виды блока этой воронки, которые в базе есть и не совпадают с
    таблицей. Независимо от `_fillable_kinds` — см. её докстринг."""
    out = []
    for kind in KIND_ORDER:
        kind_report = rep.kinds[kind]
        if not kind_report.has_block:
            continue
        diff = kind_report.diff
        if diff.only_sheet or diff.only_db or diff.slot_differs:
            out.append(kind)
    return out


def _plural_ru(n, one, few, many):
    """Число + существительное с русским согласованием: 1 блок, 2 блока,
    5 блоков, 11 блоков, 21 блок."""
    n_mod100 = abs(n) % 100
    if 11 <= n_mod100 <= 14:
        word = many
    else:
        last = n_mod100 % 10
        if last == 1:
            word = one
        elif 2 <= last <= 4:
            word = few
        else:
            word = many
    return f'{n} {word}'


def _heading_title(rep):
    """Заголовок записи: имя блока листа — всегда, чтобы две записи одной
    воронки от разных блоков не выглядели одинаково (B2). Имя товара — когда
    оно не пусто; пустое имя товара раньше давало висящее тире («### f84 — »,
    B7), а имя блока — осмысленный заменитель, а не пустая строка."""
    if rep.product_name:
        return f'{rep.product_name} · {rep.block_name}'
    return rep.block_name


def _print_block_heading(out, rep, claim_counts):
    out.append(f'### {rep.label} — {_heading_title(rep)}')
    out.append('')
    out.append(f'Блок таблицы «{rep.block_name}», лист {rep.sheet}, '
               f'строка {rep.row}. {KEY_NOTE.get(rep.key, "")}')
    if claim_counts[rep.label] > 1:
        out.append('')
        out.append(
            f'Внимание: на эту воронку в таблице претендует ещё '
            f'{_plural_ru(claim_counts[rep.label] - 1, "блок", "блока", "блоков")} '
            '— смотрите остальные записи этой воронки в отчёте ниже или '
            'выше; верным может быть только один из них.')
    out.append('')


def build_report(today, sheets_count, result, reports, unslotted, funnels,
                 active_total):
    # Заливаемо и расходится — свойства вида блока (тарифы/заявки), а не
    # воронки целиком: одна и та же воронка может быть заливаема по одному
    # виду и расходиться по другому, и обе секции обязаны её показать —
    # иначе расхождение уходит из отчёта незамеченным.
    fillable = [r for r in reports if _fillable_kinds(r)]
    diverging = [r for r in reports if _diverging_kinds(r)]
    blocks_total = (len(result.matched) + len(result.ambiguous)
                    + len(result.orphans) + len(result.dead))
    # Сколько раз каждая воронка (по F-коду/лейблу) встречается среди
    # опознанных блоков — больше одного значит, что два блока листа
    # претендуют на одну воронку разом (B2), и это стоит сказать в лоб на
    # каждой её записи, а не оставлять владельца гадать по совпавшему имени.
    claim_counts = Counter(r.label for r in reports)

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
        _print_block_heading(out, rep, claim_counts)
        for kind in _fillable_kinds(rep):
            diff = rep.kinds[kind].diff
            out.append(f'**{KIND_TITLE[kind]}**')
            _pairs(out, diff.only_sheet)
            out.append('')

    out += ['## Расхождения', '']
    if not diverging:
        out += ['Нет.', '']
    for rep in diverging:
        _print_block_heading(out, rep, claim_counts)
        for kind in _diverging_kinds(rep):
            diff = rep.kinds[kind].diff
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
        known = [(fid, weight) for fid, weight in amb.candidates
                 if fid in funnels]
        if known:
            names = ', '.join(
                f'{label_of(funnels[fid])} (совпадений: {weight})'
                for fid, weight in known)
            tail = f' → {names}'
        else:
            ids = ', '.join(str(fid) for fid, _ in amb.candidates)
            tail = (f' → кандидаты не опознаны: воронки с id {ids} '
                   'в базе не найдены')
        out.append(f'- «{amb.block.name}», лист {amb.block.sheet}, '
                   f'строка {amb.block.row}{tail}')
    out.append('')

    out += ['## Слот не определён', '']
    if not unslotted:
        out += ['Нет.', '']
    for item in unslotted:
        out.append(f'- {item.label} «{item.block_name}», лист {item.sheet}, '
                   f'{KIND_TITLE[item.kind]}, строка {item.row}: {item.url}')
    out.append('')

    out += ['## Живые блоки без воронки', '']
    if not result.orphans:
        out += ['Нет.', '']
    for block in result.orphans:
        out.append(f'- «{block.name}», лист {block.sheet}, строка {block.row}: '
                   f'тарифов {len(block.tariffs)}, допродаж {len(block.upsell)}, '
                   f'заявок {len(block.apps)}')
    out.append('')

    out += ['## Отключённые блоки', '',
            f'Помечено отключёнными в таблице: '
            f'{_plural_ru(len(result.dead), "блок", "блока", "блоков")} '
            f'(«отключена», «Комнаты удалены») — в разбор не идут.', '']
    return '\n'.join(out)
