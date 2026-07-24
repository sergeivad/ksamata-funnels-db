#!/usr/bin/env python3
"""Чтение ожиданий из ksamata_funnels.db.

База открывается ТОЛЬКО на чтение. Источник ожиданий — funnel_tags
(материализованный результат «шаблон + оверрайды»), а не raw-строки *_raw:
те импортно-экспортные артефакты и источником истины не являются.
"""

import sqlite3
from collections import defaultdict
from dataclasses import dataclass

from normalize import av_key, is_complete_key, normalize_tag


@dataclass(frozen=True)
class FunnelRow:
    funnel_id: int
    num: int
    front_code: str
    product_name: str
    status: str


@dataclass(frozen=True)
class Expectation:
    funnel_id: int
    num: int
    front_code: str
    product_name: str
    status: str
    tag_type: str
    tags: frozenset


def _connect(db_path):
    """Только чтение. Запись в живую базу запрещена спеком."""
    return sqlite3.connect(f'file:{db_path}?mode=ro', uri=True)


def label_of(row):
    """Человекочитаемая метка воронки; front_code бывает пустым."""
    return row.front_code if row.front_code else f'#{row.num}'


def load_funnels(db_path):
    con = _connect(db_path)
    try:
        rows = con.execute(
            'SELECT id, num, front_code, product_name, status FROM funnels ORDER BY num'
        ).fetchall()
    finally:
        con.close()
    return [
        FunnelRow(
            funnel_id=r[0],
            num=r[1],
            front_code=normalize_tag(r[2] or ''),
            product_name=normalize_tag(r[3] or ''),
            status=r[4] or '',
        )
        for r in rows
    ]


def load_expectations(db_path):
    con = _connect(db_path)
    try:
        rows = con.execute(
            """
            SELECT f.id, f.num, f.front_code, f.product_name, f.status,
                   ft.tag_type, t.name
            FROM funnel_tags ft
            JOIN funnels f ON f.id = ft.funnel_id
            JOIN tags t ON t.id = ft.tag_id
            ORDER BY f.num, ft.tag_type, ft.position
            """
        ).fetchall()
    finally:
        con.close()

    grouped = defaultdict(set)
    meta = {}
    for fid, num, code, pname, status, tag_type, tag_name in rows:
        grouped[(fid, tag_type)].add(normalize_tag(tag_name))
        meta[fid] = (num, normalize_tag(code or ''), normalize_tag(pname or ''), status or '')

    result = []
    for (fid, tag_type), tags in grouped.items():
        num, code, pname, status = meta[fid]
        result.append(
            Expectation(
                funnel_id=fid,
                num=num,
                front_code=code,
                product_name=pname,
                status=status,
                tag_type=tag_type,
                tags=frozenset(tags),
            )
        )
    result.sort(key=lambda e: (e.num, e.tag_type))
    return result


def load_tag_vocabulary(db_path):
    """Все имена из таблицы tags — словарь, который база вообще знает."""
    con = _connect(db_path)
    try:
        rows = con.execute('SELECT name FROM tags').fetchall()
    finally:
        con.close()
    return frozenset(normalize_tag(r[0]) for r in rows if r[0])


def build_av_index(expectations):
    """АВ-ключ -> множество funnel_id. Неполные ключи отбрасываются."""
    index = defaultdict(set)
    for exp in expectations:
        key = av_key(exp.tags)
        if is_complete_key(key):
            index[key].add(exp.funnel_id)
    return dict(index)


def find_key_collisions(index):
    """Ключи, указывающие больше чем на одну воронку. Угадывать нельзя."""
    return {key: fids for key, fids in index.items() if len(fids) > 1}
