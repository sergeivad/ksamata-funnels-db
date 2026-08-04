#!/usr/bin/env python3
"""База → воронки со связками и лендингами. Только чтение.

Связка берётся из funnel_tags — материализованного результата «шаблон +
оверрайды», а не из raw-строк *_raw: те импортно-экспортные артефакты и
источником истины не являются.

Лендинги собираются из ДВУХ мест: funnels.landing_url и блока landings.
Воронка нередко держит второй адрес только в блоке (f84), и чтение одного
поля даёт ложные пропажи.

ВНИМАНИЕ: модуль с тем же именем есть в tools/audit. conftest.py и run.py
кладут наш каталог в sys.path первым, поэтому выигрывает этот файл. Если
он исчезнет, импорт молча разрешится в чужой — там нет поля landings.
"""

import sqlite3
from collections import defaultdict
from dataclasses import dataclass

import combo
import urls


@dataclass(frozen=True)
class Funnel:
    funnel_id: int
    front_code: str
    status: str
    label: str
    key: tuple
    landings: tuple
    contractor: str
    product: str
    start_date: str = ''


def connect(db_path):
    """Только чтение. Запись в живую базу запрещена дизайном."""
    return sqlite3.connect(f'file:{db_path}?mode=ro', uri=True)


def load_funnels(db_path):
    con = connect(db_path)
    try:
        base = con.execute("""
            SELECT f.id, COALESCE(f.front_code, ''), COALESCE(f.status, ''),
                   COALESCE(f.landing_url, ''),
                   COALESCE(c.name, ''), COALESCE(p.name, ''),
                   COALESCE(f.start_date, '')
            FROM funnels f
            LEFT JOIN contractors c ON c.id = f.contractor_id
            LEFT JOIN products p ON p.id = f.product_id
            ORDER BY f.id
        """).fetchall()

        tag_rows = con.execute("""
            SELECT ft.funnel_id, t.name
            FROM funnel_tags ft JOIN tags t ON t.id = ft.tag_id
        """).fetchall()

        block_rows = con.execute("""
            SELECT b.funnel_id, i.url
            FROM funnel_block_items i
            JOIN funnel_blocks b ON b.id = i.block_id
            WHERE b.kind = 'landings' AND COALESCE(i.url, '') <> ''
        """).fetchall()
    finally:
        con.close()

    tags_by_funnel = defaultdict(set)
    for funnel_id, name in tag_rows:
        tags_by_funnel[funnel_id].add(name)

    extra_landings = defaultdict(list)
    for funnel_id, url in block_rows:
        extra_landings[funnel_id].extend(urls.split_field(url))

    result = []
    for (funnel_id, code, status, landing_url, contractor, product,
         start_date) in base:
        collected = urls.split_field(landing_url)
        for address in extra_landings.get(funnel_id, ()):
            if address not in collected:
                collected.append(address)
        result.append(Funnel(
            funnel_id=funnel_id,
            front_code=code.strip().lower(),
            status=status,
            label=code.strip().lower() or f'#{funnel_id}',
            key=combo.key_of(frozenset(tags_by_funnel.get(funnel_id, ()))),
            landings=tuple(collected),
            contractor=contractor,
            product=product,
            start_date=str(start_date)[:10],
        ))
    return result
