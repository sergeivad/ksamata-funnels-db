#!/usr/bin/env python3
"""Слоты и сравнение адресов. Чистый модуль: ни сети, ни базы.

Слот ссылки берётся у комнаты из её строки, каким его знает база, а НЕ из
секций листа. Позиционной разметке времени доверять нельзя: замер 17.08.2026
показал, что на строке «1 день» отметка стоит то в колонке M (274 раза), то в
A (171), а в 244 случаях её нет вовсе. Плюс значений времени в таблице
четыре — 15:00, 19:00, 20:00 и 17:00 (лист «ЖКТ (4 времени)»), — а
funnel_days.time_slot знает только 15 и 19.
"""

from dataclasses import dataclass

KIND_FIELD = {'tariffs': 'tariffs', 'applications': 'apps'}


@dataclass(frozen=True)
class Diff:
    only_sheet: list      # [(слот, адрес)] — есть в таблице, нет в базе
    only_db: list         # [(слот, адрес)] — есть в базе, нет в таблице
    slot_differs: list    # [(адрес, слот в таблице, слот в базе)]
    same: int


def normalize_url(url):
    u = (url or '').strip().lower()
    while u.endswith('/'):
        u = u[:-1]
    return u


def sheet_items(block, kind, room_slots):
    """Пары (слот, адрес) блока по виду. Порядок листа сохранён, дубли сняты.

    Слот — None, если якорной комнаты нет или база её не знает.
    """
    links = getattr(block, KIND_FIELD[kind])
    out, seen = [], set()
    for link in links:
        slot = room_slots.get(link.anchor) if link.anchor else None
        key = (slot, normalize_url(link.url))
        if key in seen:
            continue
        seen.add(key)
        out.append((slot, link.url))
    return out


def diff_items(sheet_pairs, db_items):
    """Различия между таблицей и базой по одному виду блока."""
    sheet_by_url = {}
    for slot, url in sheet_pairs:
        sheet_by_url.setdefault(normalize_url(url), (slot, url))
    db_by_url = {}
    for item in db_items:
        db_by_url.setdefault(normalize_url(item.url), (item.slot, item.url))

    only_sheet = [v for k, v in sheet_by_url.items() if k not in db_by_url]
    only_db = [v for k, v in db_by_url.items() if k not in sheet_by_url]
    slot_differs, same = [], 0
    for k, (slot, url) in sheet_by_url.items():
        if k not in db_by_url:
            continue
        db_slot = db_by_url[k][0]
        # Неизвестный слот — незнание, а не расхождение: молча считаем совпавшим.
        if slot and db_slot and slot != db_slot:
            slot_differs.append((url, slot, db_slot))
        else:
            same += 1
    return Diff(only_sheet, only_db, slot_differs, same)
