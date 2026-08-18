#!/usr/bin/env python3
"""Разбор листа таблицы «Воронки ссылки».

Здесь только чистые функции над списками строк — ни сети, ни базы. Чтение
таблицы живёт отдельно (links_fetch), чтобы разбор можно было тестировать
без сервисного аккаунта.

## Раскладка листа НЕ одинаковая — её надо определять, а не знать

Первая версия этого модуля утверждала обратное («разметка листа, одинаковая
на всех 26 видимых») и читала колонки по жёсткому номеру. Вывод был сделан
по двум листам и распространён на все; замер 18.08.2026 показал, что верен
он для 19 листов из 26:

    обычная (19 листов)  F продажная, G посадочная, H страницы в ГК
    ТКМ                  F ПРЕДСПИСОК, G продажная, H посадочная, I в ГК
    Детокс + ич, Жизнь   сдвиг на одну, колонки «в ГК» нет
    ЗВ, ДББ, РД          повтор в G, продажная в H, колонки «в ГК» нет
    ЧО                   колонки «в ГК» нет, сразу за посадочной идёт ОТО

Цена ошибки не теоретическая: на листе ТКМ колонка F — «Ссылка на
предсписок», и адрес предсписка уезжал в блок «Допродажи / дожим» (правило
разделения колонки F по хосту довершало дело). Две такие ссылки доехали до
прода и были откачены — app/scripts/archive/revert-tkm-upsell-prod-2026-08-18.cjs.

Поэтому колонки определяются для КАЖДОГО листа по его собственной строке
заголовков (`resolve_columns`), а лист без колонки «страницы в ГК для
тарифов» просто не даёт заявок — вместо того чтобы подсунуть вместо них ОТО.

## Заголовок блока — по началу строки, а не по её концу

Блок начинается со строки, где в колонке A или B стоит `[Название]`.
Проверка «строка ЗАКАНЧИВАЕТСЯ на `]`» отбрасывала любой хвост — а хвосты
в таблице обычные: «[БОО сайт] НОВАЯ ЦЕНА», «[ЖКТ Яндекс РСЯ] 4 времени»,
опечатка «[БОО Ютуб органика)». Непризнанный заголовок не просто терял свой
блок: его строки молча приклеивались к предыдущему, и «БОО Ютуб мир»
разрастался до 108 тарифов, проглотив семнадцать чужих блоков. Замер
18.08.2026: невидимыми были 50 блоков из 185, то есть 27%.

Признак — строка НАЧИНАЕТСЯ со скобки. Не «содержит скобки»: строки листа
ЧО вида `https://online.ksamata.ru/room/cho-tw1?[%web%]` скобки содержат,
но заголовками не являются.

Хвост остаётся в имени: «БОО сайт» и «БОО сайт НОВАЯ ЦЕНА» — два разных
блока листа, и в отчёте они не должны читаться одинаково.

## Колонка продажной страницы делится по хосту

`t.ksamata.ru` → блок «Тарифы», `gc.ksamata.ru` → «Допродажи / дожим».
Замер 17.08.2026 на живых листах: t-адреса (289 штук) сплошь лежат в базе
в блоке `tariffs` и никогда в `upsell`, gc-адреса (86) — наоборот. Правило
без исключений на всей выборке; третьего хоста в колонке нет.
"""

import re
from dataclasses import dataclass, field
from urllib.parse import urlsplit

from links_settings import DEAD_MARKERS

# Колонки имени блока и дня фиксированы на всех листах: заголовок ищется
# только в A и B, и ни одна из известных раскладок этого не меняет.
COL_TAG, COL_DAY = 0, 1

# Единственный хост колонки продажной страницы, который идёт в «Тарифы» —
# остальное (на практике только gc.ksamata.ru) идёт в «Допродажи / дожим».
TARIFF_HOST = 't.ksamata.ru'

# Комната — это ОДИН сегмент пути. Адрес заявки gc.ksamata.ru/dbo/tarif/curator-y
# тоже начинается с gc.ksamata.ru, и без якоря на конец он бы сюда попал.
ROOM_RE = re.compile(
    r'^https?://(?:gc\.ksamata\.ru|web\.ksamatacenter\.com/room)'
    r'/([A-Za-z0-9_-]+)/?$')

# Заголовок: строка начинается со скобки, дальше имя, дальше закрывающая
# скобка (в таблице встречается и опечатка `)`), дальше необязательный хвост.
HEAD_RE = re.compile(r'^\[([^\[\]]+?)[\]\)]\s*(.*)$', re.S)


@dataclass(frozen=True)
class SheetLayout:
    """Номера колонок одного листа. `note` и `app` — None, если колонки нет."""
    webinar: int
    replay: int | None
    tariff: int
    note: int | None
    app: int | None


# Раскладка 19 листов из 26. Служит запасной, когда строку заголовков найти
# не удалось (крошечные фикстуры тестов), но на живом прогоне такой лист
# должен быть замечен вызывающим — см. resolve_columns.
STANDARD = SheetLayout(webinar=2, replay=4, tariff=5, note=6, app=7)

# Подстроки, по которым колонка узнаётся в строке заголовков. Ищем именно
# отличительный корень: у ЗВ рядом стоят «Cсылка на запись» (с латинской C)
# и «Ссылка на повтор», и различает их только слово «повтор».
HEADER_HINTS = (
    ('webinar', 'вебинар'),
    ('replay', 'повтор'),
    ('tariff', 'продажн'),
    ('note', 'посадочн'),
    ('app', 'гк для тариф'),
)

# Насколько глубоко ищем строку заголовков. На живых листах она первая или
# вторая; запас нужен на пустые строки сверху.
HEADER_SCAN_ROWS = 12


def cell(row, i):
    return (row[i] if i is not None and i < len(row) else '').strip()


def room_slug(url):
    m = ROOM_RE.match((url or '').strip())
    return m.group(1).lower() if m else None


def _host(url):
    return (urlsplit(url).hostname or '').lower()


def resolve_columns(rows, scan=HEADER_SCAN_ROWS):
    """Раскладка листа по его строке заголовков. None — строку не нашли.

    None означает «этот лист читать по номерам нельзя», и вызывающий обязан
    об этом сказать вслух: молчаливое чтение не с тех колонок — ровно тот
    дефект, ради которого функция и появилась.
    """
    for row in rows[:scan]:
        joined = ' '.join(row).lower()
        if 'продажн' not in joined:
            continue
        found = {}
        for key, hint in HEADER_HINTS:
            for i in range(len(row)):
                if hint in cell(row, i).lower():
                    found[key] = i
                    break
        if 'tariff' not in found or 'webinar' not in found:
            continue
        return SheetLayout(webinar=found['webinar'], replay=found.get('replay'),
                           tariff=found['tariff'], note=found.get('note'),
                           app=found.get('app'))
    return None


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
    upsell: list = field(default_factory=list)
    apps: list = field(default_factory=list)


def _head_name(value):
    """Имя блока или None. Хвост после скобки сохраняется в имени."""
    v = (value or '').strip()
    if not v.startswith('['):
        return None
    m = HEAD_RE.match(v)
    if not m:
        return None
    name, tail = m.group(1).strip(), m.group(2).strip()
    if not name:
        return None
    return f'{name} {tail}' if tail else name


def _looks_dead(rows, head_row, layout):
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
        texts.extend(cell(row, i)
                     for i in (COL_TAG, COL_DAY, layout.webinar))
    text = ' '.join(texts).lower()
    return any(m in text for m in DEAD_MARKERS)


def parse_blocks(sheet_title, rows, layout=None):
    """Список блоков листа. Блок начинается со строки [Название] в A или B.

    `layout` — раскладка колонок; None означает «определи сама», а если и
    это не удалось — обычная раскладка. Живой прогон передаёт раскладку
    явно, определив её через resolve_columns, чтобы нераспознанный лист
    попал в отчёт, а не был прочитан наугад.
    """
    if layout is None:
        layout = resolve_columns(rows) or STANDARD

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
        webinar_slug = room_slug(cell(row, layout.webinar))
        replay_slug = room_slug(cell(row, layout.replay))
        slug = webinar_slug or replay_slug
        if webinar_slug:
            cur.rooms.add(webinar_slug)
        if replay_slug:
            cur.rooms.add(replay_slug)
        if slug:
            last_slug = slug
        note = cell(row, layout.note)
        tariff_url = cell(row, layout.tariff)
        if tariff_url.lower().startswith(('http://', 'https://')):
            link = Link(row=n, url=tariff_url, anchor=last_slug, note=note)
            bucket = cur.tariffs if _host(tariff_url) == TARIFF_HOST else cur.upsell
            bucket.append(link)
        app_url = cell(row, layout.app)
        if app_url.lower().startswith(('http://', 'https://')):
            cur.apps.append(Link(row=n, url=app_url, anchor=last_slug,
                                 note=note))
    for block in blocks:
        block.dead = _looks_dead(rows, block.row, layout)
    return blocks
