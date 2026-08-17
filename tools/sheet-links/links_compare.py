#!/usr/bin/env python3
"""Слоты и сравнение адресов. Чистый модуль: ни сети, ни базы.

Слот ссылки берётся у комнаты из её строки, каким его знает база, а НЕ из
секций листа. Позиционной разметке времени доверять нельзя: замер 17.08.2026
показал, что на строке «1 день» отметка стоит то в колонке M (274 раза), то в
A (171), а в 244 случаях её нет вовсе. Плюс значений времени в таблице
четыре — 15:00, 19:00, 20:00 и 17:00 (лист «ЖКТ (4 времени)»), — а
funnel_days.time_slot знает только 15 и 19.
"""

from collections import defaultdict
from dataclasses import dataclass

KIND_FIELD = {'tariffs': 'tariffs', 'applications': 'apps', 'upsell': 'upsell'}


@dataclass(frozen=True)
class Diff:
    # frozen блокирует только переприсваивание полей — списки внутри
    # по-прежнему изменяемы. Не читать frozen как гарантию неизменности.
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
    """Различия между таблицей и базой по одному виду блока.

    Сравнение идёт по ПАРАМ (слот, адрес), а не по голому адресу. Один и тот
    же тарифный адрес законно встречается в двух слотах разом — на f83 и f92
    один адрес обслуживает и 15:00, и 19:00. Сравнение по адресу схлопывало
    бы такую пару в одну запись и произвольно (по порядку появления) решало
    бы, какой слот «выжил» — обе стороны совпадают полностью, а инструмент
    рисовал бы несуществующее расхождение слота. Проверено на живой базе
    17.08.2026: 27 групп (блок, адрес) из 263 несут больше одного слота.

    Шаг 1 — снимаем точные пары (тот же слот, тот же адрес): это `same`.
    Шаг 2 — то, что осталось, группируем по нормализованному адресу и
    разбираем отдельно:
      - на каждой стороне ровно по одной оставшейся записи с известными,
        но разными слотами → это и есть расхождение слота (`slot_differs`);
      - на каждой стороне ровно по одной записи, но слот неизвестен хотя бы
        с одной стороны → неизвестный слот — это незнание, а не
        расхождение, засчитываем в `same`;
      - иначе (на какой-то стороне больше одной оставшейся записи для этого
        адреса) — случай не пытаемся разобрать автоматически и оставляем
        как есть, честными односторонними строками, а не выдумываем
        аккуратную сводку для нетипичного случая.
    Остаток после шага 2 — это `only_sheet` / `only_db`.
    """
    sheet = [{'slot': slot, 'url': url, 'norm': normalize_url(url),
              'resolved': False} for slot, url in sheet_pairs]
    db = [{'slot': item.slot, 'url': item.url, 'norm': normalize_url(item.url),
           'resolved': False} for item in db_items]

    same = 0

    # Шаг 1: точная пара (слот, адрес) совпала — снимаем сразу с обеих сторон.
    for s in sheet:
        for d in db:
            if d['resolved']:
                continue
            if s['norm'] == d['norm'] and s['slot'] == d['slot']:
                s['resolved'] = d['resolved'] = True
                same += 1
                break

    # Шаг 2: остаток группируем по адресу и разбираем расхождение слота.
    sheet_by_norm = defaultdict(list)
    for s in sheet:
        if not s['resolved']:
            sheet_by_norm[s['norm']].append(s)
    db_by_norm = defaultdict(list)
    for d in db:
        if not d['resolved']:
            db_by_norm[d['norm']].append(d)

    slot_differs = []
    for norm in sheet_by_norm.keys() & db_by_norm.keys():
        s_entries, d_entries = sheet_by_norm[norm], db_by_norm[norm]
        if len(s_entries) != 1 or len(d_entries) != 1:
            # На одной из сторон несколько записей на этот адрес — не гадаем,
            # какая какой соответствует, оставляем честными односторонними
            # строками.
            continue
        s, d = s_entries[0], d_entries[0]
        if s['slot'] and d['slot']:
            slot_differs.append((s['url'], s['slot'], d['slot']))
        else:
            # Неизвестный слот хотя бы с одной стороны — незнание, а не
            # расхождение: молча считаем совпавшим.
            same += 1
        s['resolved'] = d['resolved'] = True

    only_sheet = [(s['slot'], s['url']) for s in sheet if not s['resolved']]
    only_db = [(d['slot'], d['url']) for d in db if not d['resolved']]
    return Diff(only_sheet, only_db, slot_differs, same)
