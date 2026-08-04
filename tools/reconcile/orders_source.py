#!/usr/bin/env python3
"""Выгрузка заказов GetCourse → статистика по связкам.

Заказы — источник ПОЛНОТЫ: живая связка без воронки в базе означает, что
воронки не хватает либо что предложение размечено неверно. Что именно —
решает matching, а не этот модуль.

Читается ОДНА свежая выгрузка. История здесь не нужна: вопрос «что живо
сейчас» отвечается последним срезом, а чтение истории занимает минуты
(в tools/audit она нужна по существу — там есть класс дрейфа).
"""

import glob
import os
from dataclasses import dataclass, field

import openpyxl

import combo

TAGS_COLUMN = 'Теги предложений'
CREATED_COLUMN = 'Дата создания'
PAID_COLUMN = 'Оплачен'
PAID_YES = 'Да'


@dataclass
class ComboStat:
    key: tuple
    orders: int = 0
    paid: int = 0
    last_created: str = ''
    conflicts: dict = field(default_factory=dict)


def newest_export(directory):
    """Самая свежая выгрузка deal_export_* по имени файла.

    Имя несёт дату в сортируемом виде (deal_export_ГГГГ-ММ-ДД_ЧЧ-ММ-СС),
    поэтому сортировка строкой корректна и не зависит от mtime, который
    сбивается копированием.
    """
    found = sorted(glob.glob(os.path.join(directory, 'deal_export_*.xlsx')))
    if not found:
        raise FileNotFoundError(
            f'В {directory} нет ни одной выгрузки deal_export_*.xlsx')
    return found[-1]


def load_combos(path):
    """(связка -> ComboStat, слепая зона).

    Слепая зона — заказы, не несущие НИ ОДНОЙ оси. Их нельзя приписать
    никакой воронке, и их размер (21% на замере 04.08) — самостоятельная
    величина отчёта, а не погрешность.
    """
    workbook = openpyxl.load_workbook(path, read_only=True, data_only=True)
    sheet = workbook.worksheets[0]
    rows = sheet.iter_rows(values_only=True)
    header = list(next(rows))

    idx_tags = header.index(TAGS_COLUMN)
    idx_created = header.index(CREATED_COLUMN)
    idx_paid = header.index(PAID_COLUMN)

    stats = {}
    blind = {'orders': 0, 'paid': 0}

    for row in rows:
        tags = combo.parse_tagset(row[idx_tags])
        key = combo.key_of(tags)
        is_paid = str(row[idx_paid] or '').strip() == PAID_YES

        if all(part is None for part in key):
            blind['orders'] += 1
            blind['paid'] += int(is_paid)
            continue

        stat = stats.get(key)
        if stat is None:
            stat = stats[key] = ComboStat(key=key)
        stat.orders += 1
        stat.paid += int(is_paid)
        created = str(row[idx_created] or '').strip()
        if created > stat.last_created:
            stat.last_created = created
        stat.conflicts.update(combo.axis_conflicts(tags))

    workbook.close()
    return stats, blind
