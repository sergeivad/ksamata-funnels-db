#!/usr/bin/env python3
"""Таблица маркетологов «Ссылки для сбора статы» → строки.

Роль таблицы — ПОДТВЕРЖДЕНИЕ: она отвечает на «какие воронки ещё живы» и
«какие у них лендинги». Больше ничего отсюда не берётся.

Комнаты и дашборды не читаются сознательно: таблица копирует мёртвую
колонку room_id_f1, и при расхождении по комнатам правится таблица, а не
база (CLAUDE.md). Добавить их сюда — значит завести сверку с заведомо
неверным эталоном.
"""

from dataclasses import dataclass

import openpyxl

import urls

WORKING_SHEET = 'Рабочие'
FIRST_DATA_ROW = 5

COL_CODE = 0
COL_CONTRACTOR = 1
COL_FUNNEL = 2
COL_STATUS = 3
COL_LANDING = 5

LIVE_STATUS = 'Работает'


@dataclass(frozen=True)
class SheetRow:
    row_num: int
    front_code: str
    contractor: str
    funnel: str
    status: str
    landings: tuple


def apply_landing_rules(rows, rules):
    """Подставить лендинг в строки, где ячейка «Посадочная» пуста.

    Владелец таблицу не правит (решение 04.08), но недостающие адреса
    присылает. Без подстановки такая строка навсегда остаётся «живой
    строкой без воронки»: лендинг — первая и единственная надёжная ступень
    сопоставления, а по «подрядчик + продукт» строка вроде «ВК NR / ДБО
    AdBlogger (посевы)» не сходится ни с чем — у базы там «NR» и «ДБО».

    Дополняем, а не переписываем: заполненная ячейка таблицы главнее.
    Это подстановка данных, а не глушение находки — исчезнет воронка,
    и строка снова всплывёт как надо.
    """
    from decisions import SHEET_LANDING  # локально: избегаем кольца импортов

    supplements = [r for r in rules
                   if r.scope == SHEET_LANDING and r.landing and not r.waiting_for]
    if not supplements:
        return list(rows)

    result = []
    for row in rows:
        if not row.landings:
            for rule in supplements:
                same = (row.contractor.strip().casefold()
                        == rule.row_contractor.strip().casefold()
                        and row.funnel.strip().casefold()
                        == rule.row_funnel.strip().casefold())
                if same:
                    row = SheetRow(
                        row_num=row.row_num, front_code=row.front_code,
                        contractor=row.contractor, funnel=row.funnel,
                        status=row.status,
                        landings=tuple(urls.split_field(rule.landing)))
                    break
        result.append(row)
    return result


def is_live(status):
    """«Работает» против «Стоп». Пустой статус живым не считается."""
    return str(status or '').strip() == LIVE_STATUS


def _text(value):
    return str(value).strip() if value is not None else ''


def load_rows(path, sheet_name=WORKING_SHEET):
    workbook = openpyxl.load_workbook(path, read_only=True, data_only=True)
    sheet = workbook[sheet_name]

    rows = []
    for number, raw in enumerate(sheet.iter_rows(values_only=True), start=1):
        if number < FIRST_DATA_ROW:
            continue
        if not any(cell not in (None, '') for cell in raw):
            continue
        padded = list(raw) + [None] * (COL_LANDING + 1 - len(raw))
        rows.append(SheetRow(
            row_num=number,
            front_code=_text(padded[COL_CODE]).lower(),
            contractor=_text(padded[COL_CONTRACTOR]),
            funnel=_text(padded[COL_FUNNEL]),
            status=_text(padded[COL_STATUS]),
            landings=tuple(urls.split_field(padded[COL_LANDING])),
        ))
    workbook.close()
    return rows
