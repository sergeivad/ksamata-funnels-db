#!/usr/bin/env python3
"""Связка воронки — общий язык всех источников.

Пятёрка (Продукт / Подрядчик / Канал / Направление / маркер типа) лежит
и в «Тегах предложений» заказа, и в funnel_tags базы. Разбор берётся из
tools/audit/normalize.py — он уже покрыт тестами и знает про четыре
взаимоисключающих маркера типа воронки.

Здесь добавлено ровно одно, чего в audit нет: детектор КОНФЛИКТОВ осей.
normalize.av_value при нескольких значениях одной оси молча берёт
лексикографически меньшее, поэтому задвоенная ось (реальный случай f55:
одновременно «РСЯ» и «Реклама») через него не видна вообще. Для трека
разметки это отдельный класс находок, и терять его нельзя.
"""

import os
import sys

# В КОНЕЦ sys.path, не в начало. В tools/audit есть свой db_source, и
# вставка в начало отправляла бы `import db_source` в чужой модуль — у него
# нет поля landings, и сверка по лендингам молча ломалась бы. Свой каталог
# обязан оставаться первым.
_AUDIT_DIR = os.path.abspath(
    os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'audit'))
if _AUDIT_DIR not in sys.path:
    sys.path.append(_AUDIT_DIR)

from normalize import (  # noqa: E402
    AXES, MARKER_TAGS, av_key, is_complete_key, key_label, normalize_tag,
    parse_tagset,
)

__all__ = ['key_of', 'is_complete', 'label', 'axis_conflicts', 'parse_tagset',
           'AXES']


def key_of(tags):
    """Связка из набора тегов. Отсутствующая часть даёт None."""
    return av_key(tags)


def is_complete(key):
    """Все четыре оси И маркер типа на месте."""
    return is_complete_key(key)


def label(key):
    """Читаемая форма; пропуски помечаются тире."""
    return key_label(key)


def axis_conflicts(tags):
    """Оси, у которых в наборе больше одного значения.

    Возвращает {ось: [значения...]} — отсортировано, чтобы результат не
    зависел от порядка обхода frozenset (рандомизация хеша строк между
    процессами). Пустой словарь означает «конфликтов нет», а не «осей нет».
    """
    conflicts = {}
    for axis in AXES:
        prefix = axis + ':'
        values = sorted({
            normalize_tag(tag[len(prefix):])
            for tag in tags
            if tag.startswith(prefix) and normalize_tag(tag[len(prefix):])
        })
        if len(values) > 1:
            conflicts[axis] = values

    markers = sorted(MARKER_TAGS & {normalize_tag(t) for t in tags})
    if len(markers) > 1:
        conflicts['тип воронки'] = markers
    return conflicts
