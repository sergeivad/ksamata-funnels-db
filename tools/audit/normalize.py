#!/usr/bin/env python3
"""Нормализация тегов и разбор АВ-таксономии.

Чистые функции без ввода-вывода: всё остальное в tools/audit строится на них.
"""

import unicodedata

# Четыре оси, образующие ключ склейки предложения с воронкой.
# Порядок значим: он определяет порядок элементов в av_key().
AXES = ('АВ Продукт', 'АВ Подрядчик', 'АВ Канал', 'АВ Направление')

STAGE_PREFIX = 'АВ Этап'
TIME_PREFIX = 'АВ Время'

AUTOFUNNEL_TAG = 'АВ Автоворонка'
LEGACY_AUTOFUNNEL_TAG = 'автоворонки'

# Точное написание, сверено с живой выгрузкой: всё кириллицей.
PREDPISOK_STAGE = 'АВ Этап: Предписок'

STAGE_REG = 'АВ Этап: Регистрация'
STAGE_MESSENGER = 'АВ Этап: Мессенджер'
STAGE_PAYMENT = 'АВ Этап: Оплата'

TIME_19 = 'АВ Время: 19'
TIME_15 = 'АВ Время: 15'

TAG_SEPARATOR = '|'


def normalize_tag(raw):
    """NFC + trim + схлопывание внутренних пробелов. Регистр НЕ трогаем."""
    if raw is None:
        return ''
    text = unicodedata.normalize('NFC', str(raw))
    return ' '.join(text.split())


def parse_tagset(raw):
    """Разбирает значение колонки «Теги предложений» в множество тегов."""
    if raw is None:
        return frozenset()
    parts = (normalize_tag(p) for p in str(raw).split(TAG_SEPARATOR))
    return frozenset(p for p in parts if p)


def fold(tag):
    """Регистронезависимая форма — ТОЛЬКО для сравнения, не для вывода."""
    return normalize_tag(tag).casefold()


def av_value(tags, axis):
    """Значение оси, например av_value(tags, 'АВ Продукт') -> 'ДБО'.

    `tags` — frozenset, порядок обхода которого недетерминирован между
    процессами (рандомизация хеша строк). Если набору соответствует
    несколько тегов одной оси (конфликт, например одновременно
    'АВ Продукт: ДБО' и 'АВ Продукт: ЖКТ'), выбирается лексикографически
    наименьшее значение — стабильно независимо от PYTHONHASHSEED. Сам факт
    конфликта эта функция не сигнализирует и не проверяет.
    """
    prefix = axis + ':'
    values = sorted(
        value
        for tag in tags
        if tag.startswith(prefix)
        for value in (normalize_tag(tag[len(prefix):]),)
        if value
    )
    return values[0] if values else None


def av_key(tags):
    """АВ-четвёрка в порядке AXES. Отсутствующая ось даёт None."""
    return tuple(av_value(tags, axis) for axis in AXES)


def is_complete_key(key):
    return all(part is not None for part in key)


def key_label(key):
    """Читаемая форма ключа для отчёта; пропуски помечаются тире."""
    return ' / '.join(part if part is not None else '—' for part in key)


def classify(tags):
    """Определяет tag_type по этапу и времени.

    Возвращает (tag_type, reason). Ровно одно из двух не None:
      - ('reg' | 'messenger' | 'time_19' | 'time_15', None) — тип выведен;
      - (None, 'no_stage' | 'predpisok' | 'no_time') — почему не выведен.
    """
    if STAGE_REG in tags:
        return 'reg', None
    if STAGE_MESSENGER in tags:
        return 'messenger', None
    if PREDPISOK_STAGE in tags:
        return None, 'predpisok'
    if STAGE_PAYMENT in tags:
        if TIME_19 in tags:
            return 'time_19', None
        if TIME_15 in tags:
            return 'time_15', None
        return None, 'no_time'
    return None, 'no_stage'
