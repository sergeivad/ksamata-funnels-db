#!/usr/bin/env python3
"""Сверка тарифов, оформления заявки и допродаж: таблица «Воронки ссылки» ↔ база.

Запуск из корня репозитория:

    python3 tools/sheet-links/run_sheet_links.py

Спека: docs/superpowers/specs/2026-08-17-sheet-links-design.md

Инструмент ничего не пишет — ни в базу, ни в таблицу. На выходе markdown;
решения по нему принимает человек.
"""

import argparse
import datetime
import os
import sys

_BASE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, _BASE)

import links_compare    # noqa: E402
import links_db         # noqa: E402
import links_fetch      # noqa: E402
import links_match      # noqa: E402
import links_report     # noqa: E402
import links_settings   # noqa: E402
import links_sheet      # noqa: E402

ACTIVE = 'active'


def _label_key(label):
    """По числу в F-коде: иначе f11 встаёт раньше f2. Воронки без кода — в
    конец (первый элемент кортежа 1 против 0 у кодовых)."""
    if label.startswith('f') and label[1:].isdigit():
        return (0, int(label[1:]), '')
    return (1, 0, label)


def _sort_key(rep):
    return _label_key(rep.label)


# Порядок видов блока — тот же, что и в links_report.KIND_ORDER, чтобы «слот
# не определён» шёл в том же порядке, в котором остальные секции показывают
# тарифы раньше заявок раньше допродаж.
_KIND_RANK = {kind: i for i, kind in enumerate(links_report.KIND_ORDER)}


def _unslotted_key(item):
    return _label_key(item.label) + (
        _KIND_RANK.get(item.kind, len(_KIND_RANK)), item.row)


def _orphan_key(block):
    return (block.sheet, block.row)


def _ambiguous_key(amb):
    return (amb.block.sheet, amb.block.row)


def collect(sheets, db_path):
    blocks = []
    for title, rows in sheets.items():
        blocks += links_sheet.parse_blocks(title, rows)

    con = links_db.connect_ro(db_path)
    try:
        funnels = links_db.load_funnels(con)
        funnel_rooms, room_slots = links_db.load_rooms(con)
        db_blocks = links_db.load_blocks(con)
        url_owners = links_db.load_url_owners(con)
    finally:
        con.close()

    result = links_match.match_blocks(blocks, funnel_rooms, url_owners)
    active_total = sum(1 for f in funnels.values() if f.status == ACTIVE)

    # Каждый список, который дальше уходит в build_report, печатается в
    # детерминированном порядке — build_report сознательно не сортирует
    # (см. её докстринг), владелец сверяет повторные прогоны глазами, и
    # порядок, который меняется без изменения данных, — это шум.
    result.orphans.sort(key=_orphan_key)
    result.ambiguous.sort(key=_ambiguous_key)

    reports, unslotted = [], []
    for match in result.matched:
        funnel = funnels.get(match.funnel_id)
        if funnel is None or funnel.status != ACTIVE:
            continue
        label = links_db.label_of(funnel)
        kinds = {}
        for kind in links_report.KIND_ORDER:
            pairs = links_compare.sheet_items(match.block, kind, room_slots)
            db_items = db_blocks.get((match.funnel_id, kind), [])
            kinds[kind] = links_report.KindReport(
                has_block=bool(db_items),
                diff=links_compare.diff_items(pairs, db_items))
            # Слот ссылки без якорной комнаты берём с самой ссылки
            # (Link.row), а не со строки заголовка блока (match.block.row):
            # sheet_items уже свернул пары (слот, адрес) и потерял, на какой
            # именно строке лежит конкретный адрес, а владельца в раздел
            # «слот не определён» нужно привести к строке, где адрес
            # действительно лежит.
            field_name = links_compare.KIND_FIELD[kind]
            for link in getattr(match.block, field_name):
                slot = room_slots.get(link.anchor) if link.anchor else None
                if slot is None:
                    unslotted.append(links_report.Unslotted(
                        label=label, block_name=match.block.name,
                        sheet=match.block.sheet, kind=kind,
                        url=link.url, row=link.row))
        reports.append(links_report.FunnelReport(
            label=label, product_name=funnel.product_name,
            block_name=match.block.name, sheet=match.block.sheet,
            row=match.block.row, key=match.key, kinds=kinds))
    reports.sort(key=_sort_key)
    unslotted.sort(key=_unslotted_key)
    return result, reports, unslotted, funnels, active_total


def _cache_age_str(mtime):
    """Возраст файла кеша словами, не точным таймстампом — для консоли."""
    delta = datetime.datetime.now() - datetime.datetime.fromtimestamp(mtime)
    minutes = int(delta.total_seconds() // 60)
    if minutes < 1:
        return 'меньше минуты'
    if minutes < 60:
        return f'{minutes} мин'
    hours, minutes = divmod(minutes, 60)
    if hours < 24:
        return f'{hours} ч {minutes} мин'
    days, hours = divmod(hours, 24)
    return f'{days} дн {hours} ч'


def main(argv=None):
    parser = argparse.ArgumentParser(
        description='Тарифы, оформление заявки и допродажи: таблица ↔ база')
    parser.add_argument('--db', default=links_settings.DB_PATH)
    parser.add_argument('--out', help='куда положить отчёт '
                                      '(по умолчанию data/generated/)')
    parser.add_argument('--cache', help='файл кеша таблицы; если есть — '
                                        'читается он, в сеть не идём')
    parser.add_argument('--refresh', action='store_true',
                        help='не читать существующий кеш — забрать таблицу '
                             'из сети заново и перезаписать файл кеша')
    parser.add_argument('--today', help='дата прогона ГГГГ-ММ-ДД, для тестов')
    args = parser.parse_args(argv)

    today = (datetime.date.fromisoformat(args.today) if args.today
             else datetime.date.today())

    cache = args.cache
    # from_cache/cache_mtime читаются ДО фетча и ДО --refresh: возраст
    # печатается только когда прогон реально читает старый файл, а не идёт
    # в сеть.
    from_cache = bool(cache) and os.path.exists(cache) and not args.refresh
    cache_mtime = os.path.getmtime(cache) if from_cache else None

    if args.refresh and cache:
        # B1: сначала забираем свежие данные, потом перезаписываем файл —
        # никогда наоборот. Раньше кеш стирался ДО похода в сеть: неудачный
        # фетч (таблица расшарена не туда, ноутбук офлайн) уничтожал
        # единственный рабочий снимок именно тогда, когда он нужнее всего, и
        # инструмент переставал запускаться вовсе. _write_cache сама
        # атомарна (пишет во временный файл и переименовывает), так что
        # порядок «фетч → запись» ничем не платит за надёжность.
        sheets = links_fetch._fetch_from_api()
        links_fetch._write_cache(cache, sheets)
    else:
        sheets = links_fetch.load_sheets(cache)
    print(f'Листов видимых: {len(sheets)}')
    if from_cache:
        print(f'Таблица взята из кеша {cache}, возраст снимка: '
              f'{_cache_age_str(cache_mtime)}. Свежий снимок — флаг --refresh.')

    result, reports, unslotted, funnels, active_total = collect(
        sheets, args.db)
    print(f'Блоков сматчено: {len(result.matched)}, '
          f'неоднозначных: {len(result.ambiguous)}, '
          f'сирот: {len(result.orphans)}, отключённых: {len(result.dead)}')

    text = links_report.build_report(today, len(sheets), result, reports,
                                     unslotted, funnels, active_total)
    out_path = args.out or os.path.join(
        links_settings.OUT_DIR, f'sheet-links-{today.isoformat()}.md')
    out_dir = os.path.dirname(out_path)
    if out_dir:
        # B4: bare-имя файла (--out report.md) даёт dirname('') == '' —
        # makedirs('') падает FileNotFoundError. Пустой dirname значит
        # «текущая директория», её создавать не нужно и незачем пытаться.
        os.makedirs(out_dir, exist_ok=True)
    with open(out_path, 'w', encoding='utf-8') as fh:
        fh.write(text)
    print(f'Отчёт: {out_path}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
