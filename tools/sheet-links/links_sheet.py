#!/usr/bin/env python3
"""Разбор листа таблицы «Воронки ссылки».

Здесь только чистые функции над списками строк — ни сети, ни базы. Чтение
таблицы живёт отдельно (links_fetch), чтобы разбор можно было тестировать
без сервисного аккаунта.

Разметка листа, одинаковая на всех 26 видимых:

    A  теги в тарифах, признак «отключена»
    B  [Название воронки] либо маркер дня «1 день»…«5 день»
    C  ссылка на вебинар          → комната
    E  ссылка на повтор           → комната
    F  ссылка на продажную стр.   → блок «Тарифы»          (t.ksamata.ru)
    G  подпись, справочно
    H  страница в ГК для тарифов  → блок «Оформление заявки» (gc.ksamata.ru)
"""

import re
from dataclasses import dataclass, field

from links_settings import DEAD_MARKERS

COL_TAG, COL_DAY, COL_WEBINAR = 0, 1, 2
COL_REPLAY, COL_TARIFF, COL_NOTE, COL_APP = 4, 5, 6, 7

# Комната — это ОДИН сегмент пути. Адрес заявки gc.ksamata.ru/dbo/tarif/curator-y
# тоже начинается с gc.ksamata.ru, и без якоря на конец он бы сюда попал.
ROOM_RE = re.compile(
    r'^https?://(?:gc\.ksamata\.ru|web\.ksamatacenter\.com/room)'
    r'/([A-Za-z0-9_-]+)/?$')


@dataclass(frozen=True)
class Link:
    row: int
    url: str
    anchor: str | None   # слаг комнаты, по которому потом узнаётся слот
    note: str


@dataclass
class SheetBlock:
    sheet: str
    name: str
    row: int
    dead: bool = False
    rooms: set = field(default_factory=set)
    tariffs: list = field(default_factory=list)
    apps: list = field(default_factory=list)


def cell(row, i):
    return (row[i] if i < len(row) else '').strip()


def room_slug(url):
    m = ROOM_RE.match((url or '').strip())
    return m.group(1).lower() if m else None


def _head_name(value):
    v = (value or '').strip()
    if len(v) > 2 and v.startswith('[') and v.endswith(']'):
        return v[1:-1].strip()
    return None


def _looks_dead(rows, head_row):
    """head_row — номер строки-заголовка, 1-based.

    Окно — до четырёх строк, но не дальше следующего заголовка [Название]:
    строки следующего блока — не его строки, и их маркер (в т.ч. маркер,
    затесавшийся в само имя следующего блока) не должен красить текущий.
    """
    texts = []
    for n in range(head_row - 1, min(head_row + 3, len(rows))):
        row = rows[n]
        if n > head_row - 1:
            next_head = (_head_name(cell(row, COL_TAG))
                         or _head_name(cell(row, COL_DAY)))
            if next_head:
                break
        texts.extend(cell(row, i) for i in (COL_TAG, COL_DAY, COL_WEBINAR))
    text = ' '.join(texts).lower()
    return any(m in text for m in DEAD_MARKERS)


def parse_blocks(sheet_title, rows):
    """Список блоков листа. Блок начинается со строки [Название] в A или B."""
    blocks = []
    cur = None
    last_slug = None
    for n, row in enumerate(rows, 1):
        head = _head_name(cell(row, COL_TAG)) or _head_name(cell(row, COL_DAY))
        if head:
            cur = SheetBlock(sheet=sheet_title, name=head, row=n)
            blocks.append(cur)
            last_slug = None      # якорь не перетекает в следующий блок
            continue
        if cur is None:
            continue
        webinar_slug = room_slug(cell(row, COL_WEBINAR))
        replay_slug = room_slug(cell(row, COL_REPLAY))
        slug = webinar_slug or replay_slug
        if webinar_slug:
            cur.rooms.add(webinar_slug)
        if replay_slug:
            cur.rooms.add(replay_slug)
        if slug:
            last_slug = slug
        note = cell(row, COL_NOTE)
        for col, bucket in ((COL_TARIFF, cur.tariffs), (COL_APP, cur.apps)):
            url = cell(row, col)
            if url.lower().startswith(('http://', 'https://')):
                bucket.append(Link(row=n, url=url, anchor=last_slug,
                                   note=note))
    for block in blocks:
        block.dead = _looks_dead(rows, block.row)
    return blocks
