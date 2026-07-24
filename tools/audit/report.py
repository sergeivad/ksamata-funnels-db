#!/usr/bin/env python3
"""Запись карты расхождений в XLSX.

Лист на каждый класс заводится всегда, даже пустой: «ноль находок» должен
быть виден явно, иначе отсутствие листа читается как забытая проверка.
"""

from collections import defaultdict

import openpyxl
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter

from db_source import label_of
from findings import CLASS_TITLES

SUMMARY_SHEET = 'Сводка'
SOURCES_SHEET = 'Источники'

CLASS_HEADERS = [
    'Воронка', 'Тип', 'Находка', 'Подробности',
    'Свидетельство', 'Первое наблюдение', 'Последнее наблюдение',
    'Заказов', 'Решение',
]

HEADER_FILL = PatternFill('solid', fgColor='DDDDDD')
HEADER_FONT = Font(bold=True)
TITLE_FONT = Font(bold=True, size=12)


def build_summary_rows(findings, funnels):
    """Строка на воронку, колонка на класс. Первая строка — заголовок."""
    classes = sorted(CLASS_TITLES)
    header = ['Воронка', 'Продукт', 'Статус'] + [f'Класс {c}' for c in classes] + ['Всего']

    counts = defaultdict(lambda: defaultdict(int))
    for item in findings:
        counts[item.funnel][item.cls] += 1

    rows = [header]
    for row in funnels:
        label = label_of(row)
        per_class = [counts[label][c] for c in classes]
        rows.append([label, row.product_name, row.status] + per_class + [sum(per_class)])
    return rows


def _write_sheet(ws, title, headers, rows):
    ws['A1'] = title
    ws['A1'].font = TITLE_FONT
    ws.append([])
    ws.append(headers)
    for cell in ws[3]:
        cell.font = HEADER_FONT
        cell.fill = HEADER_FILL
    for row in rows:
        ws.append(row)
    ws.freeze_panes = 'A4'
    for index, _ in enumerate(headers, start=1):
        ws.column_dimensions[get_column_letter(index)].width = 24


def write_report(path, findings, funnels, sources):
    wb = openpyxl.Workbook()

    summary = wb.active
    summary.title = SUMMARY_SHEET
    rows = build_summary_rows(findings, funnels)
    summary.append(rows[0])
    for cell in summary[1]:
        cell.font = HEADER_FONT
        cell.fill = HEADER_FILL
        cell.alignment = Alignment(wrap_text=True, vertical='top')
    for row in rows[1:]:
        summary.append(row)
    summary.freeze_panes = 'B2'

    by_class = defaultdict(list)
    for item in findings:
        by_class[item.cls].append(item)

    for cls in sorted(CLASS_TITLES):
        ws = wb.create_sheet(f'Класс {cls}')
        body = [
            [
                item.funnel, item.tag_type, item.subject, item.detail,
                item.evidence, item.first_seen, item.last_seen, item.deals, None,
            ]
            for item in by_class.get(cls, [])
        ]
        _write_sheet(ws, f'Класс {cls}. {CLASS_TITLES[cls]}', CLASS_HEADERS, body)

    ws = wb.create_sheet(SOURCES_SHEET)
    body = [[s.get('kind', ''), s.get('name', ''), s.get('detail', '')] for s in sources]
    _write_sheet(ws, 'Источники прогона', ['Тип', 'Имя', 'Подробности'], body)

    wb.save(path)
