#!/usr/bin/env python3
"""Кто из воронок стоит за блоком листа.

Первичный ключ — слаги вебинарных комнат: они лежат и в таблице (C, E), и в
funnel_days. Замер 17.08.2026: сработал на 47 блоках из 135.

Вторичный — адреса тарифов и заявок, уже лежащие в базе: ещё 5 блоков. Он
слабее (адрес теоретически переиспользуем), поэтому применяется только когда
по комнатам пусто, и помечается в отчёте отдельно.

Вторичный ключ засчитывается только при весе **2 и больше** (решение
владельца, по замеру 18.08.2026). Первый живой прогон дал два ложных
матча весом 1 — но у них разные причины, и обеим нужно быть здесь записанными
верно:

- «ЖКТ Ютуб мир» → f8, у которой уже был матч по комнатам весом 6 — вот этот
  случай чинит именно порог. На живых данных веса по комнатам — 6 или 10,
  единицы не бывает: единственный общий адрес не улика тождества, а как раз
  то, что эта сверка ищет — переиспользование адреса между воронками.
- «ЕХ Яндекс РСЯ» → ДЫХАНИЕ чинит **не порог**, а Task 8: единственный общий
  адрес блока был `gc.ksamata.ru/meditation-rsya` — до разделения колонки F
  по хосту он лежал в `block.tariffs` и попадал в `_by_urls`; после Task 8
  такие адреса уходят в `block.upsell`, которую `_by_urls` не сканирует
  (ниже), так что этот блок больше не даёт вообще никакого веса по адресам —
  он орфанится и при пороге 1.

Отсюда следует незаписанное раньше следствие: Task 8 сузил именно **вход**
вторичного ключа. `_by_urls` по-прежнему смотрит только `block.tariffs +
block.apps` — `block.upsell` в него не входит. А вот `links_db.
load_url_owners` (правая, эталонная сторона сравнения — «чей это адрес в
базе») кладёт в один общий словарь адреса **любого** вида блока в базе, в
т.ч. `upsell`, без фильтра по BLOCK_KINDS. Асимметрия: часть колонки F
(дожимные адреса), которая раньше участвовала в подборе кандидата с обеих
сторон, теперь участвует только как цель сравнения, а не как источник
кандидатов. На сегодняшних живых данных это не меняет ни одного исхода при
пороге 2 (проверено по каждому живому блоку в обе стороны) — но это
изменение в поведении матчинга, а не просто следствие переименования, и
заслуживает быть здесь, а не только в отчёте по задаче.

После всей этой правки вторичный ключ на сегодняшних данных не матчит ничего
— это верный результат, а не потеря покрытия.

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
    # block.upsell намеренно не сканируется — см. докстринг модуля про
    # асимметрию с load_url_owners, которая индексирует адреса всех видов
    # блока в базе, включая upsell.
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
