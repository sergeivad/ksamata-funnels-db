#!/usr/bin/env python3
"""Шестнадцать классов находок.

Чистые функции: принимают готовые коллекции, возвращают list[Finding].
Ничего не читают с диска и из сети — поэтому тестируются без моков.
"""

from collections import defaultdict
from dataclasses import dataclass

from db_source import label_of
from normalize import (
    AUTOFUNNEL_TAG,
    AXES,
    PREDPISOK_STAGE,
    av_key,
    classify,
    is_complete_key,
    key_label,
)

CLASS_TITLES = {
    1: 'Тег ожидается в базе, но в GetCourse отсутствует',
    2: 'Ось есть в GetCourse, но её нет в словаре базы',
    3: 'Этап не поддержан моделью базы',
    4: 'Противоречивые легаси-теги на одном предложении',
    5: 'Тип не выводится: оплата без АВ Время или нет АВ Этап',
    6: 'Этап Предписок — типа в модели базы нет',
    7: 'Четвёрка полная, но воронки в базе нет',
    8: 'Коллизия АВ-ключа',
    9: 'АВ-четвёрка есть в GetCourse, но нет ни одной воронки',
    10: 'Предложение с неполной АВ-четвёркой',
    11: 'Ось есть в GetCourse, но отсутствует в словаре базы целиком',
    12: 'Предложение с АВ Этап, но без АВ Автоворонка',
    13: 'Воронка active, но ни одного наблюдения за период',
    14: 'Предложение с АВ-тегами и нулём заказов — кандидат в архив',
    15: 'Дрейф: тег появился или исчез',
    16: 'Покрытие наблюдениями',
}

# Легаси-теги направления: больше одного на предложении — противоречие.
CONTRADICTORY_LEGACY_PREFIXES = ('ВК NR', 'ВК HT', 'IS NR')


@dataclass(frozen=True)
class Finding:
    cls: int
    funnel: str
    tag_type: str
    subject: str
    detail: str
    evidence: str
    first_seen: str
    last_seen: str
    deals: int


@dataclass(frozen=True)
class Group:
    key: tuple
    tag_type: object   # str | None — None, когда тип не выводится
    reason: object     # str | None — причина, когда tag_type равен None
    tags: frozenset
    deals: int
    first_seen: object
    last_seen: object
    files: tuple


def group_observations(observations):
    """Сворачивает наблюдения в тройки (АВ-ключ × тип × набор тегов)."""
    buckets = defaultdict(list)
    for obs in observations:
        tag_type, reason = classify(obs.tags)
        buckets[(av_key(obs.tags), tag_type, reason, obs.tags)].append(obs)

    groups = []
    for (key, tag_type, reason, tags), items in buckets.items():
        dates = [i.file_date for i in items]
        groups.append(
            Group(
                key=key,
                tag_type=tag_type,
                reason=reason,
                tags=tags,
                deals=len(items),
                first_seen=min(dates),
                last_seen=max(dates),
                files=tuple(sorted({i.file_name for i in items})),
            )
        )
    groups.sort(key=lambda g: (-g.deals, key_label(g.key)))
    return groups


def _funnel_label(index, expectations_by_id, key):
    """Метка воронки по АВ-ключу; при коллизии и промахе — прочерк."""
    fids = index.get(key, set())
    if len(fids) != 1:
        return '—'
    exp = expectations_by_id.get(next(iter(fids)))
    return label_of(exp) if exp is not None else '—'


def _by_funnel_id(expectations):
    return {e.funnel_id: e for e in expectations}


def _latest_groups(groups):
    """Для каждой пары (ключ, тип) — только самое свежее наблюдение.

    Спек: сравнивать с базой надо текущее состояние, иначе древние
    наборы уедут в отчёт как ошибки.
    """
    newest = {}
    for group in groups:
        if group.tag_type is None:
            continue
        slot = (group.key, group.tag_type)
        current = newest.get(slot)
        if current is None or group.last_seen > current.last_seen:
            newest[slot] = group
    return list(newest.values())


def find_missing_in_getcourse(groups, expectations, index):
    """Класс 1: база ждёт тег, а в свежем наблюдении его нет."""
    by_id = _by_funnel_id(expectations)
    by_slot = {(av_key(e.tags), e.tag_type): e for e in expectations}

    result = []
    for group in _latest_groups(groups):
        exp = by_slot.get((group.key, group.tag_type))
        if exp is None:
            continue
        missing = exp.tags - group.tags
        if not missing:
            continue
        result.append(
            Finding(
                cls=1,
                funnel=_funnel_label(index, by_id, group.key),
                tag_type=group.tag_type,
                subject=', '.join(sorted(missing)),
                detail=f'Ожидается базой, нет в GetCourse. Ключ: {key_label(group.key)}',
                evidence='; '.join(group.files[:3]),
                first_seen=str(group.first_seen),
                last_seen=str(group.last_seen),
                deals=group.deals,
            )
        )
    return result


def find_extra_axes(groups, vocabulary):
    """Класс 2: в наблюдении есть АВ-тег, которого база не знает."""
    result = []
    for group in _latest_groups(groups):
        unknown = sorted(
            tag for tag in group.tags
            if tag.startswith('АВ ') and tag not in vocabulary
        )
        if not unknown:
            continue
        result.append(
            Finding(
                cls=2,
                funnel='—',
                tag_type=group.tag_type or '',
                subject=', '.join(unknown),
                detail=f'Нет в таблице tags. Ключ: {key_label(group.key)}',
                evidence='; '.join(group.files[:3]),
                first_seen=str(group.first_seen),
                last_seen=str(group.last_seen),
                deals=group.deals,
            )
        )
    return result


def find_unsupported_stage(groups):
    """Класс 3: этап Предписок, для которого в модели базы нет tag_type."""
    result = []
    for group in groups:
        if PREDPISOK_STAGE not in group.tags:
            continue
        result.append(
            Finding(
                cls=3,
                funnel='—',
                tag_type='',
                subject=PREDPISOK_STAGE,
                detail=(
                    'funnel_tags.tag_type разрешает только '
                    'reg/time_19/time_15/messenger. Ключ: ' + key_label(group.key)
                ),
                evidence='; '.join(group.files[:3]),
                first_seen=str(group.first_seen),
                last_seen=str(group.last_seen),
                deals=group.deals,
            )
        )
    return result


def find_contradictory_legacy(groups, expectations, index):
    """Класс 4: два и более взаимоисключающих легаси-тега направления."""
    by_id = _by_funnel_id(expectations)
    result = []
    for group in _latest_groups(groups):
        legacy = sorted(
            tag for tag in group.tags
            if any(tag.startswith(p) for p in CONTRADICTORY_LEGACY_PREFIXES)
        )
        # Один такой тег — норма. Противоречие начинается со второго.
        if len(legacy) < 2:
            continue
        result.append(
            Finding(
                cls=4,
                funnel=_funnel_label(index, by_id, group.key),
                tag_type=group.tag_type,
                subject=f'{len(legacy)} легаси-тега направления одновременно',
                detail=f'Ключ: {key_label(group.key)}',
                evidence=', '.join(legacy),
                first_seen=str(group.first_seen),
                last_seen=str(group.last_seen),
                deals=group.deals,
            )
        )
    return result


def find_unresolved(groups, index):
    """Классы 5, 6, 7 — взаимоисключающие причины неопознания.

    Каждая неопознанная группа попадает ровно в один класс.
    """
    result = []
    for group in groups:
        if group.reason == 'no_time':
            cls, subject = 5, 'Оплата без АВ Время'
        elif group.reason == 'predspisok':
            cls, subject = 6, 'Этап Предписок'
        elif group.reason == 'no_stage':
            cls, subject = 5, 'Нет АВ Этап — тип не выводится'
        elif is_complete_key(group.key) and group.key not in index:
            cls, subject = 7, f'Нет воронки для {key_label(group.key)}'
        else:
            continue

        result.append(
            Finding(
                cls=cls,
                funnel='—',
                tag_type=group.tag_type or '',
                subject=subject,
                detail=f'Ключ: {key_label(group.key)}',
                evidence='; '.join(group.files[:3]),
                first_seen=str(group.first_seen),
                last_seen=str(group.last_seen),
                deals=group.deals,
            )
        )
    return result
