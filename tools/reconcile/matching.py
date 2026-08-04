#!/usr/bin/env python3
"""Сопоставление источников. Ключ свой на каждом стыке.

Заказы ↔ база — по связке, ОБЯЗАТЕЛЬНО с поиском ближайшей воронки.
Замер 04.08: из десяти живых связок без воронки семь оказались ошибками
разметки в ГК (нет маркера типа, чужой маркер, задвоенная ось, нет оси
продукта), и только три — действительно новыми воронками. Без расстояния
до ближайшей все десять читаются одинаково, и разбор уходит не туда.

Таблица ↔ база — по лендингу, с падением на «подрядчик + продукт».
Ступень фиксируется в результате: совпадение по второй означает, что
лендинг разошёлся или отсутствует, и это находка, а не деталь реализации.
"""

import re
from dataclasses import dataclass

import combo

AXIS_NAMES = combo.AXES + ('тип воронки',)

# Оси НЕ равны по силе опознания, и это решает, какая воронка «ближайшая».
# Продукт опознаёт воронку сильнее всего: две связки с разными продуктами —
# почти наверняка разные воронки. Маркер типа слабее всех: его сплошь и рядом
# просто не проставляют, и его отсутствие — самая частая ошибка разметки
# (454 заказа f69 на замере 04.08).
#
# Замер 04.08 без весов дал прямую ошибку: связку «ЖКТ / НИМБ / Яндекс / РСЯ /
# АВ Прямые» отнесло к f45 (продукт ЖИВО-суставы) вместо очевидной f8 (тот же
# ЖКТ, отличается только тип) — обе на расстоянии одной оси, а разрешал спор
# алфавит метки.
AXIS_WEIGHT = {
    'АВ Продукт': 5,
    'АВ Подрядчик': 4,
    'АВ Канал': 3,
    'АВ Направление': 2,
    'тип воронки': 1,
}

# Расходиться может максимум ОДНА ось, пусть даже самая тяжёлая. Две — это
# уже другая воронка, а не ошибка разметки: «RedBananas / ТГ» (новый подрядчик
# на новом канале) подавался как «похоже на #18», хотя его просто нет в базе.
MAX_DIFF_WEIGHT = max(AXIS_WEIGHT.values())


def _code_num(label):
    """Числовая часть метки — для устойчивой сортировки.

    Без неё строки сравниваются лексикографически, и 'f45' оказывается
    «меньше» 'f8'.
    """
    digits = re.sub(r'\D', '', label)
    return int(digits) if digits else 0


@dataclass(frozen=True)
class Near:
    funnel: object
    distance: int
    diff: list


@dataclass(frozen=True)
class SheetMatch:
    funnel: object
    tier: str


def _diff(key, other):
    """Позиции, где связки расходятся: [(ось, было, стало), ...]."""
    return [
        (AXIS_NAMES[i], key[i], other[i])
        for i in range(len(AXIS_NAMES))
        if key[i] != other[i]
    ]


def nearest(key, funnels):
    """Ближайшая воронка к связке или None, если расхождение слишком велико.

    «Ближе» = меньше суммарный вес разошедшихся осей, а не их число:
    расхождение по типу воронки почти всегда ошибка разметки, расхождение
    по продукту почти всегда другая воронка. При равном весе выбирается
    меньший номер кода — стабильно между прогонами.
    """
    best = None
    best_rank = None
    for funnel in funnels:
        difference = _diff(key, funnel.key)
        weight = sum(AXIS_WEIGHT[axis] for axis, _, _ in difference)
        if weight > MAX_DIFF_WEIGHT:
            continue
        rank = (weight, _code_num(funnel.label), funnel.label)
        if best_rank is None or rank < best_rank:
            best_rank = rank
            best = Near(funnel=funnel, distance=len(difference),
                        diff=difference)
    return best


def match_sheet_row(row, funnels):
    """Строка таблицы -> воронка базы. Три ступени, ступень фиксируется.

    Порядок ступеней отражает надёжность признака:

      landing — физический объект, две воронки не делят один адрес;
      front_code — надёжен там, где проставлен, но проставлен у половины
        строк, а ячейка «Посадочная» местами держит НЕ адрес, а название
        продукта (строка 5: «БЕЗОПАСНОЕ ОЧИЩЕНИЕ ОРГАНИЗМА»). Без этой
        ступени F37 попадала в «строк таблицы без воронки», хотя она есть;
      contractor_product — последняя попытка; совпадение по ней означает,
        что и лендинг, и код разошлись.
    """
    if row.landings:
        wanted = set(row.landings)
        for funnel in funnels:
            if wanted & set(funnel.landings):
                return SheetMatch(funnel=funnel, tier='landing')

    if row.front_code:
        for funnel in funnels:
            if funnel.front_code and funnel.front_code == row.front_code:
                return SheetMatch(funnel=funnel, tier='front_code')

    contractor = row.contractor.strip().casefold()
    product = row.funnel.strip().casefold()
    if contractor and product:
        for funnel in funnels:
            if (funnel.contractor.strip().casefold() == contractor
                    and funnel.product.strip().casefold() == product):
                return SheetMatch(funnel=funnel, tier='contractor_product')

    return SheetMatch(funnel=None, tier=None)
