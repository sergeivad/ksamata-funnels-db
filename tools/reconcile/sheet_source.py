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
