#!/usr/bin/env python3
"""Кто из воронок стоит за блоком листа.

Первичный ключ — слаги вебинарных комнат: они лежат и в таблице (C, E), и в
funnel_days. Замер 17.08.2026: сработал на 47 блоках из 135.

Вторичный — адреса тарифов и заявок, уже лежащие в базе: ещё 5 блоков. Он
слабее (адрес теоретически переиспользуем), поэтому применяется только когда
по комнатам пусто, и помечается в отчёте отдельно.

Вторичный ключ засчитывается только при весе **2 и больше** (решение
владельца, по замеру 18.08.2026). Оба матча веса 1, которые дал первый живой
прогон, оказались ложными: «ЕХ Яндекс РСЯ» примкнула к воронке ДЫХАНИЕ,
«ЖКТ Ютуб мир» — к f8, у которой уже был матч по комнатам весом 6. На живых
данных веса по комнатам — 6 или 10, единицы не бывает: единственный общий
адрес не улика тождества, а как раз то, что эта сверка ищет — переиспользование
адреса между воронками. После этой правки вторичный ключ на сегодняшних
данных не матчит ничего — это верный результат, а не потеря покрытия.

Неоднозначность инструмент НЕ разрешает: выбор воронки за человеком.
"""

from dataclasses import dataclass

from links_compare import normalize_url


@dataclass(frozen=True)
class Match:
    block: object
    funnel_id: int
    key: str        # 'rooms' | 'urls'
    weight: int


@dataclass(frozen=True)
class Ambiguous:
    block: object
    candidates: list    # [(funnel_id, вес)], сильнейшие первыми


@dataclass(frozen=True)
class MatchResult:
    matched: list
    ambiguous: list
    orphans: list
    dead: list


def _by_rooms(block, funnel_rooms):
    return {fid: len(block.rooms & slugs)
            for fid, slugs in funnel_rooms.items() if block.rooms & slugs}


MIN_URL_WEIGHT = 2


def _by_urls(block, url_owners):
    weights = {}
    for link in list(block.tariffs) + list(block.apps):
        for fid in url_owners.get(normalize_url(link.url), ()):
            weights[fid] = weights.get(fid, 0) + 1
    # Один общий адрес не считается уликой — см. докстринг модуля.
    return {fid: w for fid, w in weights.items() if w >= MIN_URL_WEIGHT}


def match_blocks(blocks, funnel_rooms, url_owners):
    matched, ambiguous, orphans, dead = [], [], [], []
    for block in blocks:
        if block.dead:
            dead.append(block)
            continue
        key = 'rooms'
        weights = _by_rooms(block, funnel_rooms)
        if not weights:
            key = 'urls'
            weights = _by_urls(block, url_owners)
        if not weights:
            orphans.append(block)
            continue
        # По убыванию веса, при равном весе — по id, чтобы порядок был
        # устойчив от прогона к прогону.
        top = sorted(weights.items(), key=lambda kv: (-kv[1], kv[0]))
        if len(top) > 1 and top[0][1] == top[1][1]:
            ambiguous.append(Ambiguous(block, top[:3]))
        else:
            matched.append(Match(block, top[0][0], key, top[0][1]))
    return MatchResult(matched, ambiguous, orphans, dead)
