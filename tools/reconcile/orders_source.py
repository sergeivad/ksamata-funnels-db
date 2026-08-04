#!/usr/bin/env python3
"""Выгрузка заказов GetCourse → статистика по связкам.

Заказы — источник ПОЛНОТЫ: живая связка без воронки в базе означает, что
воронки не хватает либо что предложение размечено неверно. Что именно —
решает matching, а не этот модуль.

Читается ОДНА свежая выгрузка. История здесь не нужна: вопрос «что живо
сейчас» отвечается последним срезом, а чтение истории занимает минуты
(в tools/audit она нужна по существу — там есть класс дрейфа).
"""

import os
import re
from dataclasses import dataclass, field

import openpyxl

import combo

# Только каноническое имя, которое даёт сам GetCourse. Всё, что человек
# переименовал или дополнил руками, — не полная выгрузка счетов.
EXPORT_NAME = re.compile(
    r'^deal_export_(\d{4}-\d{2}-\d{2})_(\d{2}-\d{2}-\d{2})\.xlsx$')

# Полная выгрузка этого аккаунта — сотни тысяч строк. Всё, что кратно
# меньше, — выборка по фильтру, и отчёт по ней недостоверен.
MIN_EXPORT_ORDERS = 10_000

TAGS_COLUMN = 'Теги предложений'
CREATED_COLUMN = 'Дата создания'
PAYMENT_COLUMN = 'Дата оплаты'
PAID_COLUMN = 'Оплачен'
PAID_YES = 'Да'


@dataclass
class ComboStat:
    key: tuple
    orders: int = 0
    paid: int = 0
    last_activity: str = ''
    transferred: int = 0
    conflicts: dict = field(default_factory=dict)


def is_transferred(created, paid):
    """Платёж перенесён в новую карточку: оплата раньше создания заказа."""
    return bool(paid) and bool(created) and paid < created


def effective_date(created, paid):
    """Когда воронка на самом деле сработала.

    Обычно это дата создания заказа. Но GetCourse умеет ПЕРЕНОСИТЬ платёж в
    новую карточку пользователя (например, когда у старой была неверная
    почта): у нового заказа дата создания сегодняшняя, а продажа — старая.
    Признак переноса — оплата РАНЬШЕ создания.

    Разбор 04.08 на заказе №7622751: создан 2026-07-13, оплачен 2024-09-10,
    в истории «Платёж перенесён: #6374361 → #7622751». По дате создания
    связка `ДБО / RedBananas / ТГ` выглядела живой, и отчёт требовал завести
    воронку, которой давно нет. В выгрузке таких заказов 242 (0.8%
    оплаченных), разрыв дат до 2146 дней.

    Считать по дате создания нельзя: перенос старого заказа оживил бы любую
    мёртвую связку.
    """
    return paid if is_transferred(created, paid) else created


def newest_export(directory):
    """Самая свежая выгрузка по дате В ИМЕНИ, а не по mtime: mtime сбивается
    копированием.

    Имя должно быть ровно тем, что даёт GetCourse. Маска `deal_export_*`
    здесь не годится: в ~/Downloads лежат `deal_export_with_utm_2026-04-23`,
    `deal_export_2026-07-28_воронки`, `..._utm` и копии `(1)`. Сортировка
    строкой ставит букву ПОСЛЕ цифры, поэтому `with_utm` от апреля
    обыгрывал августовскую выгрузку — а колонки «Теги предложений» в нём
    нет вовсе, и разбор 04.08 упёрся в ValueError на ровном месте.
    """
    dated = []
    for name in os.listdir(directory):
        match = EXPORT_NAME.match(name)
        if match:
            dated.append((match.group(1), match.group(2), name))
    if not dated:
        raise FileNotFoundError(
            f'В {directory} нет ни одной выгрузки вида '
            f'deal_export_ГГГГ-ММ-ДД_ЧЧ-ММ-СС.xlsx')
    return os.path.join(directory, max(dated)[2])


def check_full_export(total_orders, path):
    """Отбить выборку, притворяющуюся полной выгрузкой.

    Имя каноническое, дата свежая, колонки на месте — а строк 523: так
    выглядит экспорт, отфильтрованный в интерфейсе GetCourse. Отчёт по
    такому файлу молча объявляет мёртвыми почти все воронки, и это не
    видно ни по одной цифре в самом отчёте. Проверять надо содержимое:
    по имени такой файл неотличим от настоящего.
    """
    if total_orders < MIN_EXPORT_ORDERS:
        raise ValueError(
            f'В выгрузке {os.path.basename(path)} всего {total_orders} '
            f'заказов — это выборка по фильтру, а не полный экспорт '
            f'(ожидается от {MIN_EXPORT_ORDERS}). Отчёт по ней объявит '
            f'мёртвыми почти все воронки. Возьмите полную выгрузку или '
            f'укажите файл явно через --export.')


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
    idx_payment = header.index(PAYMENT_COLUMN)
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
        payment = str(row[idx_payment] or '').strip()
        effective = effective_date(created, payment)
        if is_transferred(created, payment):
            stat.transferred += 1
        if effective > stat.last_activity:
            stat.last_activity = effective
        stat.conflicts.update(combo.axis_conflicts(tags))

    workbook.close()
    return stats, blind
