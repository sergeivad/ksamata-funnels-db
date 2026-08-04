#!/usr/bin/env python3
"""Сверка источников в один отчёт по этапам разбора.

Запуск из корня репозитория:

    python3 tools/reconcile/run.py

Дизайн: docs/plans/2026-08-04-razbor-design.md

Инструмент ничего не чинит — ни базу, ни GetCourse, ни ЛИК. На выходе
отчёт; решения принимает человек и записывает их в decisions.yaml.
"""

import argparse
import datetime
import os
import sys

_BASE = os.path.dirname(os.path.abspath(__file__))
# Наш каталог первым, audit — в конец: db_source есть и здесь, и там.
sys.path.insert(0, _BASE)
sys.path.append(os.path.abspath(os.path.join(_BASE, '..', 'audit')))

import db_source          # noqa: E402
import decisions          # noqa: E402
import orders_source      # noqa: E402
import paths              # noqa: E402
import report_md          # noqa: E402
import sections           # noqa: E402
import sheet_source       # noqa: E402

DEFAULT_SHEET = 'Ссылки для сбора статы-2.xlsx'


def main(argv=None):
    parser = argparse.ArgumentParser(
        description='Сверка источников по воронкам')
    parser.add_argument('--export', help='выгрузка заказов (по умолчанию — '
                                         'самая свежая в ~/Downloads)')
    parser.add_argument('--sheet', help='таблица маркетологов')
    parser.add_argument('--db', default=paths.DB_PATH)
    parser.add_argument('--out', help='куда положить отчёт '
                                      '(по умолчанию data/generated/)')
    parser.add_argument('--today', help='дата прогона ГГГГ-ММ-ДД, для тестов')
    args = parser.parse_args(argv)

    export_path = args.export or orders_source.newest_export(paths.DOWNLOADS_DIR)
    sheet_path = args.sheet or os.path.join(paths.DOWNLOADS_DIR, DEFAULT_SHEET)
    today = (datetime.date.fromisoformat(args.today) if args.today
             else datetime.date.today())

    print(f'Заказы:  {export_path}')
    combos, blind = orders_source.load_combos(export_path)
    print(f'  связок: {len(combos)}, заказов без осей: {blind["orders"]}')

    print(f'Таблица: {sheet_path}')
    sheet_rows = sheet_source.load_rows(sheet_path)
    print(f'  строк: {len(sheet_rows)}')

    print(f'База:    {args.db}')
    funnels = db_source.load_funnels(args.db)
    print(f'  воронок: {len(funnels)}')

    rules = decisions.load(paths.DECISIONS_PATH)
    report = sections.build(combos, blind, funnels, sheet_rows, rules, today)

    text = report_md.render(report, {
        'export': os.path.basename(export_path),
        'sheet': os.path.basename(sheet_path),
        'today': today.isoformat(),
        'funnels': len(funnels),
        'combos': len(combos),
    })

    out_dir = args.out or paths.OUT_DIR
    os.makedirs(out_dir, exist_ok=True)
    out_path = os.path.join(out_dir, f'reconcile-{today.isoformat()}.md')
    with open(out_path, 'w', encoding='utf-8') as handle:
        handle.write(text)

    print()
    print(f'Отчёт: {out_path}')
    print(f'  не хватает воронок:   {len(report.missing)}')
    print(f'  ошибок разметки в ГК: {len(report.mislabelled)}')
    print(f'  кандидатов в archive: {len(report.dead)}')
    print(f'  расхождений статуса:  {len(report.status_drift)}')
    print(f'  строк таблицы без воронки: {len(report.sheet_only)}')
    print(f'  решено ранее (молчим):     {len(report.settled)}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
