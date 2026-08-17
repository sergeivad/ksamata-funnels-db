#!/usr/bin/env python3
"""Чтение ksamata_funnels.db. ТОЛЬКО на чтение.

mode=ro, как в tools/audit и tools/reconcile: обычный connect создал бы
пустую базу на месте отсутствующей и упал бы на первом SELECT — то есть
соврал бы про пустой результат вместо честной ошибки. Отдельная проверка
существования файла нужна ради внятного сообщения: mode=ro на несуществующем
файле даёт «unable to open database file».
"""

import os
import sqlite3
from collections import defaultdict
from dataclasses import dataclass

from links_compare import normalize_url
from links_sheet import room_slug

BLOCK_KINDS = ('tariffs', 'applications', 'upsell')


@dataclass(frozen=True)
class FunnelRow:
    funnel_id: int
    front_code: str
    product_name: str
    status: str


@dataclass(frozen=True)
class BlockItem:
    slot: str | None
    url: str


def connect_ro(db_path):
    if not os.path.exists(db_path):
        raise FileNotFoundError(f'нет базы {db_path}')
    return sqlite3.connect(f'file:{db_path}?mode=ro', uri=True)


def label_of(row):
    """Воронку называем F-кодом. num человеку не показываем никогда."""
    return row.front_code or f'#{row.funnel_id}'


def load_funnels(con):
    out = {}
    for fid, code, pname, status in con.execute(
            'SELECT id, front_code, product_name, status FROM funnels'):
        out[fid] = FunnelRow(fid, (code or '').strip(), pname or '',
                             status or '')
    return out


def load_rooms(con):
    """(воронка → слаги комнат, слаг → слот времени)."""
    by_funnel = defaultdict(set)
    slots = {}
    for fid, slot, gc, web in con.execute(
            'SELECT funnel_id, time_slot, gc_room, web_room FROM funnel_days'):
        for url in (gc, web):
            slug = room_slug(url)
            if not slug:
                continue
            by_funnel[fid].add(slug)
            slots[slug] = slot
    return dict(by_funnel), slots


def load_blocks(con):
    """(воронка, вид) → пункты блока, в порядке position.

    Не фильтрует по `funnel_blocks.enabled` — сегодня это инертно (все 94
    блока трёх видов в живой базе `enabled = 1`), но не безопасно молча:
    отключённый блок с пунктами дал бы `has_block = True` и без
    предупреждения спрятал бы заливаемое предложение из «Можно залить» —
    для владельца это выглядело бы так, будто блок уже заполнен.
    """
    out = defaultdict(list)
    placeholders = ','.join('?' * len(BLOCK_KINDS))
    for fid, kind, slot, url in con.execute(
            'SELECT b.funnel_id, b.kind, i.slot, i.url '
            'FROM funnel_blocks b '
            'JOIN funnel_block_items i ON i.block_id = b.id '
            f'WHERE b.kind IN ({placeholders}) '
            'ORDER BY b.funnel_id, b.kind, i.position', BLOCK_KINDS):
        out[(fid, kind)].append(BlockItem(slot, url or ''))
    return dict(out)


def load_url_owners(con):
    """Нормализованный адрес → воронки, у которых он лежит в блоке.

    Вторичный ключ матчинга — слабее комнат: адрес теоретически может быть
    переиспользован, поэтому в отчёте такой матч помечается отдельно.
    """
    owners = defaultdict(set)
    for fid, url in con.execute(
            'SELECT b.funnel_id, i.url FROM funnel_blocks b '
            'JOIN funnel_block_items i ON i.block_id = b.id '
            "WHERE COALESCE(i.url,'') <> ''"):
        owners[normalize_url(url)].add(fid)
    return dict(owners)
