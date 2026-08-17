# Sheet Links Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Собрать read-only инструмент `tools/sheet-links/`, который сверяет тарифы и ссылки на оформление заявки из гугл-таблицы «Воронки ссылки» с блоками `tariffs`/`applications` активных воронок базы и выдаёт один markdown-отчёт.

**Architecture:** Пять плоских модулей с разделёнными ответственностями: разбор листа (чистый, без сети), чтение таблицы через сервисный аккаунт, чтение базы `mode=ro`, матчинг блока с воронкой, сравнение и сборка отчёта. Разбор и сравнение — чистые функции над списками строк, поэтому тестируются без сети и без живой базы.

**Tech Stack:** Python 3, стандартная библиотека, `google-auth` (уже стоит), pytest. Клиент Google Sheets переиспользуется по абсолютному пути из соседнего проекта.

**Spec:** [docs/superpowers/specs/2026-08-17-sheet-links-design.md](../specs/2026-08-17-sheet-links-design.md)

## Global Constraints

- **Инструмент ничего не пишет** — ни в базу, ни в таблицу, ни в GetCourse, ни в ЛИК. База открывается только `mode=ro`.
- **Имена модулей начинаются с `links_`.** Все каталоги под `tools/` лежат в одном `sys.path`, импорты плоские, и при совпадении имён побеждает импортированный первым — молча и по-разному в разных прогонах. Занятые соседями имена: `paths`, `db_source`, `report`, `normalize`, `settings`, `funnels_source`, `report_md`, `sheet_source`, `matching`, `urls`, `run`.
- **Пути резолвятся от корня репозитория**, а не от рабочего каталога — через `os.path.dirname(os.path.abspath(__file__))`.
- **Таблица читается только через сервисный аккаунт** `leak-281@personal-chief-501813.iam.gserviceaccount.com`, никогда через браузер.
- **Скрытые листы пропускаются** — их шесть, они черновые.
- **Слот ссылки берётся у комнаты из её строки**, каким его знает база, а не из секций листа.
- Идентификатор таблицы: `1TTFjAAwE2g0D0BUNyOcMkuybuhbqUHf3EirM4GU2xYI`.
- Тесты запускаются командой `python3 -m pytest tools/sheet-links/tests` из корня репозитория.
- Ключ сервисного аккаунта не коммитить и не печатать.

---

### Task 1: Каркас и разбор листа

Разбор — сердце инструмента и единственная часть, где легко ошибиться молча. Делаем его первым и целиком на чистых функциях: на вход список списков строк, на выход блоки. Ни сети, ни базы.

**Files:**
- Create: `tools/sheet-links/links_settings.py`
- Create: `tools/sheet-links/links_sheet.py`
- Create: `tools/sheet-links/conftest.py`
- Test: `tools/sheet-links/tests/test_links_sheet.py`

**Interfaces:**
- Consumes: ничего.
- Produces:
  - `links_settings.DB_PATH`, `.OUT_DIR`, `.SPREADSHEET_ID`, `.GSHEETS_PROJECT`, `.GSHEETS_CLIENT_DIR`, `.READ_RANGE`, `.DEAD_MARKERS`
  - `links_sheet.cell(row: list, i: int) -> str`
  - `links_sheet.room_slug(url: str) -> str | None`
  - `links_sheet.Link(row: int, url: str, anchor: str | None, note: str)` — frozen dataclass
  - `links_sheet.SheetBlock(sheet: str, name: str, row: int, dead: bool, rooms: set[str], tariffs: list[Link], apps: list[Link])` — dataclass
  - `links_sheet.parse_blocks(sheet_title: str, rows: list[list[str]]) -> list[SheetBlock]`

- [ ] **Step 1: Создать каталоги и conftest**

```bash
mkdir -p tools/sheet-links/tests
```

`tools/sheet-links/conftest.py`:

```python
"""Кладёт tools/sheet-links в sys.path — импорты плоские.

Имена модулей здесь начинаются с links_ и не должны совпадать с именами в
tools/audit и tools/reconcile: все три каталога лежат в одном sys.path, и при
совпадении победил бы тот, что импортирован первым — молча и по-разному в
разных прогонах.
"""

import os
import sys

BASE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, BASE)
```

- [ ] **Step 2: Написать links_settings.py**

```python
#!/usr/bin/env python3
"""Пути и константы. Всё резолвится от корня репозитория, а не от cwd.

Называется links_settings, а не settings: модуль settings есть в
tools/reconcile, оба каталога лежат в одном sys.path, и при совпадении имён
победил бы импортированный первым.
"""

import os

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT_DIR = os.path.abspath(os.path.join(BASE_DIR, '..', '..'))

DB_PATH = os.path.join(ROOT_DIR, 'ksamata_funnels.db')
OUT_DIR = os.path.join(ROOT_DIR, 'data', 'generated')

# Таблица «Воронки ссылки». Читается ТОЛЬКО через сервисный аккаунт —
# общее правило ~/.claude/rules/google-sheets.md. Через браузер не работает:
# \t уходит символом, а синтетический Cmd+V до Sheets не доходит.
SPREADSHEET_ID = '1TTFjAAwE2g0D0BUNyOcMkuybuhbqUHf3EirM4GU2xYI'

# Клиент и ключ сервисного аккаунта живут в соседнем проекте. Путь
# абсолютный: клиент работает из любого места, зависимость одна — google-auth.
GSHEETS_PROJECT = '/Users/sergeielkin/dev/ksamata/deal_exp_analytic'
GSHEETS_CLIENT_DIR = os.path.join(GSHEETS_PROJECT, 'scripts')

# До R — дальше в листах пусто; 3000 строк с запасом на самый длинный лист
# (ЖКТ, 2081 строка).
READ_RANGE = 'A1:R3000'

# Блок считается мёртвым, если любой из маркеров встретился в первых четырёх
# его строках, колонки A-C. Замер 17.08.2026: таких блоков 42 из 135.
DEAD_MARKERS = ('отключен', 'комнаты удален', 'не использ', 'архив', 'удален')
```

- [ ] **Step 3: Написать падающий тест разбора**

`tools/sheet-links/tests/test_links_sheet.py`:

```python
import pytest

from links_sheet import cell, parse_blocks, room_slug


def test_room_slug_takes_one_segment_hosts():
    assert room_slug('https://gc.ksamata.ru/svs1-vk') == 'svs1-vk'
    assert room_slug('https://web.ksamatacenter.com/room/svs1-vk') == 'svs1-vk'
    assert room_slug('https://gc.ksamata.ru/svs1-vk/') == 'svs1-vk'


def test_room_slug_rejects_tariff_pages():
    """Адрес заявки — три сегмента, и комнатой он не является."""
    assert room_slug('https://gc.ksamata.ru/dbo/tarif/curator-y') is None
    assert room_slug('https://t.ksamata.ru/svs/tarif-1vk') is None
    assert room_slug('') is None
    assert room_slug(None) is None


def test_room_slug_lowercases():
    assert room_slug('https://gc.ksamata.ru/SVS1-VK') == 'svs1-vk'


def test_cell_beyond_row_end_is_empty():
    assert cell(['a', 'b'], 5) == ''
    assert cell(['  x  '], 0) == 'x'


def test_block_starts_from_marker_in_a_or_b():
    rows = [
        ['теги в тарифах', '', 'ссылка на вебинар'],
        ['', '[ДБО ВК]'],
        ['', '1 день', 'https://gc.ksamata.ru/dbo1-vk'],
        ['[ДБО ТГ]'],
        ['', '1 день', 'https://gc.ksamata.ru/dbo1-tg'],
    ]
    blocks = parse_blocks('ДБО', rows)
    assert [b.name for b in blocks] == ['ДБО ВК', 'ДБО ТГ']
    assert blocks[0].sheet == 'ДБО'
    assert blocks[0].row == 2
    assert blocks[0].rooms == {'dbo1-vk'}
    assert blocks[1].rooms == {'dbo1-tg'}


def test_rows_before_first_marker_are_ignored():
    rows = [
        ['', '', 'https://gc.ksamata.ru/sirota'],
        ['', '[ДБО ВК]'],
        ['', '1 день', 'https://gc.ksamata.ru/dbo1-vk'],
    ]
    blocks = parse_blocks('ДБО', rows)
    assert len(blocks) == 1
    assert blocks[0].rooms == {'dbo1-vk'}


def test_tariff_goes_to_f_application_to_h():
    rows = [
        ['', '[ДБО ВК]'],
        ['', '1 день', 'https://gc.ksamata.ru/dbo1-vk', '', '',
         'https://t.ksamata.ru/dbo/tarif-1vk', '',
         'https://gc.ksamata.ru/dbo/tarif/curator-vk'],
    ]
    block = parse_blocks('ДБО', rows)[0]
    assert [l.url for l in block.tariffs] == ['https://t.ksamata.ru/dbo/tarif-1vk']
    assert [l.url for l in block.apps] == [
        'https://gc.ksamata.ru/dbo/tarif/curator-vk']


def test_link_anchors_to_room_of_its_own_row():
    rows = [
        ['', '[ДБО ВК]'],
        ['', '1 день', 'https://gc.ksamata.ru/dbo1-vk', '', '',
         'https://t.ksamata.ru/dbo/tarif-1vk'],
        ['', '2 день', 'https://gc.ksamata.ru/dbo2-vk', '', '',
         'https://t.ksamata.ru/dbo/tarif-2vk'],
    ]
    block = parse_blocks('ДБО', rows)[0]
    assert [l.anchor for l in block.tariffs] == ['dbo1-vk', 'dbo2-vk']


def test_link_without_room_falls_back_to_nearest_room_above():
    rows = [
        ['', '[ДБО ВК]'],
        ['', '1 день', 'https://gc.ksamata.ru/dbo1-vk'],
        ['', '', '', '', '', 'https://t.ksamata.ru/dbo/tarif-1vk'],
    ]
    block = parse_blocks('ДБО', rows)[0]
    assert block.tariffs[0].anchor == 'dbo1-vk'


def test_link_before_any_room_has_no_anchor():
    rows = [
        ['', '[ДБО ВК]'],
        ['', '', '', '', '', 'https://t.ksamata.ru/dbo/tarif-1vk'],
    ]
    block = parse_blocks('ДБО', rows)[0]
    assert block.tariffs[0].anchor is None


def test_anchor_does_not_leak_across_blocks():
    rows = [
        ['', '[ДБО ВК]'],
        ['', '1 день', 'https://gc.ksamata.ru/dbo1-vk'],
        ['', '[ДБО ТГ]'],
        ['', '', '', '', '', 'https://t.ksamata.ru/dbo/tarif-tg'],
    ]
    blocks = parse_blocks('ДБО', rows)
    assert blocks[1].tariffs[0].anchor is None


def test_note_from_column_g_is_kept():
    rows = [
        ['', '[ДБО ВК]'],
        ['', '2 день', 'https://gc.ksamata.ru/dbo2-vk', '', '',
         'https://t.ksamata.ru/dbo/tarif-z', 'тарифы с записью ГЛАВНОГО занятия'],
    ]
    block = parse_blocks('ДБО', rows)[0]
    assert block.tariffs[0].note == 'тарифы с записью ГЛАВНОГО занятия'


def test_non_url_cells_are_not_links():
    rows = [
        ['', '[ДБО ВК]'],
        ['', '1 день', 'https://gc.ksamata.ru/dbo1-vk', '', '', 'сайты', '',
         'геткурс'],
    ]
    block = parse_blocks('ДБО', rows)[0]
    assert block.tariffs == []
    assert block.apps == []


def test_replay_room_in_column_e_counts():
    rows = [
        ['', '[ДБО ВК]'],
        ['', '4 день', 'https://gc.ksamata.ru/dbo4-vk', '',
         'https://gc.ksamata.ru/dbo4r-vk'],
    ]
    block = parse_blocks('ДБО', rows)[0]
    assert block.rooms == {'dbo4-vk', 'dbo4r-vk'}


def test_dead_marker_in_head_row_marks_block():
    rows = [
        ['отключена', '[ДБО ВК]'],
        ['', '1 день', 'https://gc.ksamata.ru/dbo1-vk'],
    ]
    assert parse_blocks('ДБО', rows)[0].dead is True


def test_dead_marker_within_first_four_rows():
    rows = [
        ['', '[ДБО ВК]'],
        ['', '', 'Комнаты удалены'],
        ['', '1 день', 'https://gc.ksamata.ru/dbo1-vk'],
    ]
    assert parse_blocks('ДБО', rows)[0].dead is True


@pytest.mark.parametrize('marker', [
    'отключена', 'Комнаты удалены', 'не используется', 'архив', 'удалено'])
def test_every_dead_marker_is_recognised(marker):
    rows = [
        [marker, '[ДБО ВК]'],
        ['', '1 день', 'https://gc.ksamata.ru/dbo1-vk'],
    ]
    assert parse_blocks('ДБО', rows)[0].dead is True


def test_live_block_is_not_dead():
    rows = [
        ['', '[ДБО ВК]'],
        ['', '1 день', 'https://gc.ksamata.ru/dbo1-vk'],
    ]
    assert parse_blocks('ДБО', rows)[0].dead is False


def test_dead_marker_below_the_first_four_rows_does_not_count():
    """Иначе пометка следующего блока красила бы предыдущий."""
    rows = [
        ['', '[ДБО ВК]'],
        ['', '1 день', 'https://gc.ksamata.ru/dbo1-vk'],
        ['', '2 день', 'https://gc.ksamata.ru/dbo2-vk'],
        ['', '3 день', 'https://gc.ksamata.ru/dbo3-vk'],
        ['отключена', '4 день', 'https://gc.ksamata.ru/dbo4-vk'],
    ]
    assert parse_blocks('ДБО', rows)[0].dead is False
```

- [ ] **Step 4: Прогнать тест и убедиться, что падает**

Run: `python3 -m pytest tools/sheet-links/tests/test_links_sheet.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'links_sheet'`

- [ ] **Step 5: Написать links_sheet.py**

```python
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
    """head_row — номер строки-заголовка, 1-based."""
    text = ' '.join(
        cell(rows[n], i)
        for n in range(head_row - 1, min(head_row + 3, len(rows)))
        for i in (COL_TAG, COL_DAY, COL_WEBINAR)).lower()
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
        slug = room_slug(cell(row, COL_WEBINAR)) or room_slug(cell(row, COL_REPLAY))
        if slug:
            cur.rooms.add(slug)
            last_slug = slug
        note = cell(row, COL_NOTE)
        for col, bucket in ((COL_TARIFF, cur.tariffs), (COL_APP, cur.apps)):
            url = cell(row, col)
            if url.lower().startswith('http'):
                bucket.append(Link(row=n, url=url, anchor=slug or last_slug,
                                   note=note))
    for block in blocks:
        block.dead = _looks_dead(rows, block.row)
    return blocks
```

- [ ] **Step 6: Прогнать тест и убедиться, что проходит**

Run: `python3 -m pytest tools/sheet-links/tests/test_links_sheet.py -v`
Expected: PASS, 23 теста (5 из них параметризованы)

- [ ] **Step 7: Коммит**

```bash
git add tools/sheet-links/
git commit -m "feat(sheet-links): разбор листа «Воронки ссылки»

Чистые функции над строками: блоки по маркеру [Название], комнаты из C и E,
тарифы из F, заявки из H. Якорь ссылки — комната своей строки, иначе
ближайшая выше в пределах блока; через границу блока не перетекает.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Чтение таблицы через сервисный аккаунт

**Files:**
- Create: `tools/sheet-links/links_fetch.py`
- Test: `tools/sheet-links/tests/test_links_fetch.py`

**Interfaces:**
- Consumes: `links_settings.SPREADSHEET_ID`, `.GSHEETS_PROJECT`, `.GSHEETS_CLIENT_DIR`, `.READ_RANGE`
- Produces:
  - `links_fetch.load_sheets(cache_path: str | None = None) -> dict[str, list[list[str]]]` — заголовок листа → строки, только видимые листы
  - `links_fetch.visible_titles(meta: dict) -> list[str]` — чистая, тестируется без сети

- [ ] **Step 1: Написать падающий тест**

`tools/sheet-links/tests/test_links_fetch.py`:

```python
import json

import pytest

from links_fetch import load_sheets, visible_titles


def test_visible_titles_skips_hidden():
    meta = {'sheets': [
        {'properties': {'sheetId': 1, 'title': 'ДБО'}},
        {'properties': {'sheetId': 2, 'title': 'ЩЗ', 'hidden': True}},
        {'properties': {'sheetId': 3, 'title': 'БОО', 'hidden': False}},
    ]}
    assert visible_titles(meta) == ['ДБО', 'БОО']


def test_visible_titles_on_empty_meta():
    assert visible_titles({}) == []


def test_load_sheets_reads_cache_without_network(tmp_path):
    cache = tmp_path / 'sheets.json'
    cache.write_text(json.dumps({'ДБО': [['a', 'b']]}), encoding='utf-8')
    assert load_sheets(str(cache)) == {'ДБО': [['a', 'b']]}


def test_load_sheets_without_cache_needs_network(monkeypatch, tmp_path):
    """Кеша нет — идём в сеть. Проверяем, что путь именно туда, а не молча пусто."""
    calls = []

    def fake_fetch():
        calls.append(1)
        return {'ДБО': [['x']]}

    monkeypatch.setattr('links_fetch._fetch_from_api', fake_fetch)
    cache = tmp_path / 'missing.json'
    assert load_sheets(str(cache)) == {'ДБО': [['x']]}
    assert calls == [1]
    # и результат осел в кеше
    assert json.loads(cache.read_text(encoding='utf-8')) == {'ДБО': [['x']]}
```

- [ ] **Step 2: Прогнать тест и убедиться, что падает**

Run: `python3 -m pytest tools/sheet-links/tests/test_links_fetch.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'links_fetch'`

- [ ] **Step 3: Написать links_fetch.py**

```python
#!/usr/bin/env python3
"""Чтение таблицы «Воронки ссылки» через сервисный аккаунт.

Только через API: заполнять и читать гуглтаблицы через браузер не работает
(проверено 16.08.2026, ~/.claude/rules/google-sheets.md). Клиент берём
готовый из соседнего проекта — путь абсолютный, зависимость одна: google-auth.

403 или 404 на существующую таблицу означает, что она не расшарена на
сервисный аккаунт. Правильное действие — попросить владельца дать доступ
leak-281@personal-chief-501813.iam.gserviceaccount.com, а не искать обход.
"""

import json
import os
import sys

from links_settings import (
    GSHEETS_CLIENT_DIR,
    GSHEETS_PROJECT,
    READ_RANGE,
    SPREADSHEET_ID,
)


def _client():
    if GSHEETS_CLIENT_DIR not in sys.path:
        sys.path.insert(0, GSHEETS_CLIENT_DIR)
    import gsheets_client
    return gsheets_client


def visible_titles(meta):
    """Заголовки нескрытых листов в порядке таблицы."""
    out = []
    for sheet in meta.get('sheets') or []:
        props = sheet.get('properties') or {}
        if props.get('hidden'):
            continue
        out.append(props.get('title'))
    return out


def _fetch_from_api():
    g = _client()
    gs = g.Sheets(GSHEETS_PROJECT)
    # Списка листов в клиенте нет — берём метаданные тем же низкоуровневым
    # запросом, что и sheet_title(). Править чужой клиент ради одного поля
    # не станем: он общий с deal_exp_analytic.
    meta = g._req(
        f'{g.API}/{SPREADSHEET_ID}?fields=sheets.properties(sheetId,title,hidden)',
        headers=gs._h())
    return {title: gs.read(SPREADSHEET_ID, title, READ_RANGE)
            for title in visible_titles(meta)}


def load_sheets(cache_path=None):
    """Видимые листы: заголовок → строки. С кешем, чтобы повторные прогоны
    и тесты не ходили в сеть."""
    if cache_path and os.path.exists(cache_path):
        with open(cache_path, encoding='utf-8') as fh:
            return json.load(fh)
    sheets = _fetch_from_api()
    if cache_path:
        with open(cache_path, 'w', encoding='utf-8') as fh:
            json.dump(sheets, fh, ensure_ascii=False)
    return sheets
```

- [ ] **Step 4: Прогнать тест и убедиться, что проходит**

Run: `python3 -m pytest tools/sheet-links/tests/test_links_fetch.py -v`
Expected: PASS, 4 теста

- [ ] **Step 5: Проверить на живой таблице и сохранить кеш**

Run:
```bash
python3 -c "
import sys; sys.path.insert(0, 'tools/sheet-links')
from links_fetch import load_sheets
s = load_sheets('/private/tmp/claude-501/-Users-sergeielkin-dev-ksamata-Ksamata-ksamata-funnels-db/3990599d-d122-44a4-b263-034d2b0971a6/scratchpad/sheets_cache.json')
print(len(s), 'листов'); print(sorted(s)[:5])
"
```
Expected: `26 листов` и список заголовков. Если 403 — таблица не расшарена, остановиться и сказать владельцу.

- [ ] **Step 6: Коммит**

```bash
git add tools/sheet-links/links_fetch.py tools/sheet-links/tests/test_links_fetch.py
git commit -m "feat(sheet-links): чтение таблицы через сервисный аккаунт

Видимые листы читаются целиком, скрытые шесть пропускаются. Кеш на диск,
чтобы повторные прогоны и тесты не ходили в сеть.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Сравнение адресов и разрешение слотов

Чистый модуль, ни базы, ни сети: на вход блок и словарь «слаг комнаты → слот», на выход пары `(слот, адрес)` и различия с базой.

**Files:**
- Create: `tools/sheet-links/links_compare.py`
- Test: `tools/sheet-links/tests/test_links_compare.py`

**Interfaces:**
- Consumes: `links_sheet.Link`, `links_sheet.SheetBlock`
- Produces:
  - `links_compare.normalize_url(url: str) -> str`
  - `links_compare.sheet_items(block: SheetBlock, kind: str, room_slots: dict[str, str]) -> list[tuple[str | None, str]]` — `kind` это `'tariffs'` или `'applications'`
  - `links_compare.Diff(only_sheet: list, only_db: list, slot_differs: list, same: int)` — frozen dataclass
  - `links_compare.diff_items(sheet_pairs: list[tuple], db_items: list) -> Diff` — `db_items` это список объектов с полями `.slot` и `.url`

- [ ] **Step 1: Написать падающий тест**

`tools/sheet-links/tests/test_links_compare.py`:

```python
from dataclasses import dataclass

from links_compare import diff_items, normalize_url, sheet_items
from links_sheet import parse_blocks


@dataclass(frozen=True)
class FakeItem:
    slot: str
    url: str


def test_normalize_url_lowercases_and_drops_trailing_slash():
    assert normalize_url('HTTPS://T.Ksamata.RU/dbo/Tarif-1/') == \
        'https://t.ksamata.ru/dbo/tarif-1'


def test_normalize_url_keeps_query():
    """В адресах ГК встречаются осмысленные ?id= — их терять нельзя."""
    assert normalize_url('https://gc.ksamata.ru/pl/tasks/mission/process?id=1607990') \
        == 'https://gc.ksamata.ru/pl/tasks/mission/process?id=1607990'


def test_normalize_url_on_empty():
    assert normalize_url('') == ''
    assert normalize_url(None) == ''


ROWS = [
    ['', '[ДБО ВК]'],
    ['', '1 день', 'https://gc.ksamata.ru/dbo1-vk', '', '',
     'https://t.ksamata.ru/dbo/tarif-19', '',
     'https://gc.ksamata.ru/dbo/tarif/curator-19'],
    ['', '1 день', 'https://gc.ksamata.ru/1dbo-vk', '', '',
     'https://t.ksamata.ru/dbo/tarif-15'],
]
SLOTS = {'dbo1-vk': '19', '1dbo-vk': '15'}


def test_sheet_items_take_slot_from_room_of_the_row():
    block = parse_blocks('ДБО', ROWS)[0]
    assert sheet_items(block, 'tariffs', SLOTS) == [
        ('19', 'https://t.ksamata.ru/dbo/tarif-19'),
        ('15', 'https://t.ksamata.ru/dbo/tarif-15'),
    ]


def test_sheet_items_reads_applications_kind():
    block = parse_blocks('ДБО', ROWS)[0]
    assert sheet_items(block, 'applications', SLOTS) == [
        ('19', 'https://gc.ksamata.ru/dbo/tarif/curator-19'),
    ]


def test_sheet_items_slot_is_none_when_room_unknown_to_db():
    block = parse_blocks('ДБО', ROWS)[0]
    assert sheet_items(block, 'tariffs', {}) == [
        (None, 'https://t.ksamata.ru/dbo/tarif-19'),
        (None, 'https://t.ksamata.ru/dbo/tarif-15'),
    ]


def test_sheet_items_dedupe_same_url_same_slot():
    rows = [
        ['', '[ДБО ВК]'],
        ['', '1 день', 'https://gc.ksamata.ru/dbo1-vk', '', '',
         'https://t.ksamata.ru/dbo/tarif-19'],
        ['', '2 день', 'https://gc.ksamata.ru/dbo1-vk', '', '',
         'https://T.ksamata.ru/dbo/tarif-19/'],
    ]
    block = parse_blocks('ДБО', rows)[0]
    assert sheet_items(block, 'tariffs', SLOTS) == [
        ('19', 'https://t.ksamata.ru/dbo/tarif-19')]


def test_diff_all_new_when_db_empty():
    d = diff_items([('19', 'https://t.ksamata.ru/a')], [])
    assert d.only_sheet == [('19', 'https://t.ksamata.ru/a')]
    assert d.only_db == []
    assert d.slot_differs == []
    assert d.same == 0


def test_diff_identical_is_silent():
    d = diff_items([('19', 'https://t.ksamata.ru/a')],
                   [FakeItem('19', 'https://t.ksamata.ru/A/')])
    assert d.only_sheet == [] and d.only_db == []
    assert d.same == 1


def test_diff_reports_both_sides():
    d = diff_items([('19', 'https://t.ksamata.ru/a')],
                   [FakeItem('19', 'https://t.ksamata.ru/b')])
    assert d.only_sheet == [('19', 'https://t.ksamata.ru/a')]
    assert d.only_db == [('19', 'https://t.ksamata.ru/b')]
    assert d.same == 0


def test_diff_same_url_different_slot_is_its_own_bucket():
    d = diff_items([('19', 'https://t.ksamata.ru/a')],
                   [FakeItem('15', 'https://t.ksamata.ru/a')])
    assert d.only_sheet == [] and d.only_db == []
    assert d.slot_differs == [('https://t.ksamata.ru/a', '19', '15')]
    assert d.same == 0


def test_diff_unknown_sheet_slot_does_not_count_as_disagreement():
    """Слот не определён — это незнание, а не расхождение."""
    d = diff_items([(None, 'https://t.ksamata.ru/a')],
                   [FakeItem('15', 'https://t.ksamata.ru/a')])
    assert d.slot_differs == []
    assert d.same == 1
```

- [ ] **Step 2: Прогнать тест и убедиться, что падает**

Run: `python3 -m pytest tools/sheet-links/tests/test_links_compare.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'links_compare'`

- [ ] **Step 3: Написать links_compare.py**

```python
#!/usr/bin/env python3
"""Слоты и сравнение адресов. Чистый модуль: ни сети, ни базы.

Слот ссылки берётся у комнаты из её строки, каким его знает база, а НЕ из
секций листа. Позиционной разметке времени доверять нельзя: замер 17.08.2026
показал, что на строке «1 день» отметка стоит то в колонке M (274 раза), то в
A (171), а в 244 случаях её нет вовсе. Плюс значений времени в таблице
четыре — 15:00, 19:00, 20:00 и 17:00 (лист «ЖКТ (4 времени)»), — а
funnel_days.time_slot знает только 15 и 19.
"""

from dataclasses import dataclass

KIND_FIELD = {'tariffs': 'tariffs', 'applications': 'apps'}


@dataclass(frozen=True)
class Diff:
    only_sheet: list      # [(слот, адрес)] — есть в таблице, нет в базе
    only_db: list         # [(слот, адрес)] — есть в базе, нет в таблице
    slot_differs: list    # [(адрес, слот в таблице, слот в базе)]
    same: int


def normalize_url(url):
    u = (url or '').strip().lower()
    while u.endswith('/'):
        u = u[:-1]
    return u


def sheet_items(block, kind, room_slots):
    """Пары (слот, адрес) блока по виду. Порядок листа сохранён, дубли сняты.

    Слот — None, если якорной комнаты нет или база её не знает.
    """
    links = getattr(block, KIND_FIELD[kind])
    out, seen = [], set()
    for link in links:
        slot = room_slots.get(link.anchor) if link.anchor else None
        key = (slot, normalize_url(link.url))
        if key in seen:
            continue
        seen.add(key)
        out.append((slot, link.url))
    return out


def diff_items(sheet_pairs, db_items):
    """Различия между таблицей и базой по одному виду блока."""
    sheet_by_url = {}
    for slot, url in sheet_pairs:
        sheet_by_url.setdefault(normalize_url(url), (slot, url))
    db_by_url = {}
    for item in db_items:
        db_by_url.setdefault(normalize_url(item.url), (item.slot, item.url))

    only_sheet = [v for k, v in sheet_by_url.items() if k not in db_by_url]
    only_db = [v for k, v in db_by_url.items() if k not in sheet_by_url]
    slot_differs, same = [], 0
    for k, (slot, url) in sheet_by_url.items():
        if k not in db_by_url:
            continue
        db_slot = db_by_url[k][0]
        # Неизвестный слот — незнание, а не расхождение: молча считаем совпавшим.
        if slot and db_slot and slot != db_slot:
            slot_differs.append((url, slot, db_slot))
        else:
            same += 1
    return Diff(only_sheet, only_db, slot_differs, same)
```

- [ ] **Step 4: Прогнать тест и убедиться, что проходит**

Run: `python3 -m pytest tools/sheet-links/tests/test_links_compare.py -v`
Expected: PASS, 12 тестов

- [ ] **Step 5: Коммит**

```bash
git add tools/sheet-links/links_compare.py tools/sheet-links/tests/test_links_compare.py
git commit -m "feat(sheet-links): слоты по комнате строки и сравнение адресов

Слот берётся у комнаты из той же строки, а не из секций листа: разметка
времени в листах неровная, а значений времени там четыре против двух в базе.
Расхождение по слоту при совпавшем адресе — своя корзина, не двойная запись.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Чтение базы

**Files:**
- Create: `tools/sheet-links/links_db.py`
- Test: `tools/sheet-links/tests/test_links_db.py`

**Interfaces:**
- Consumes: `links_compare.normalize_url`
- Produces:
  - `links_db.FunnelRow(funnel_id: int, front_code: str, product_name: str, status: str)` — frozen dataclass
  - `links_db.BlockItem(slot: str | None, url: str, label: str)` — frozen dataclass
  - `links_db.connect_ro(db_path: str) -> sqlite3.Connection`
  - `links_db.load_funnels(con) -> dict[int, FunnelRow]`
  - `links_db.load_rooms(con) -> tuple[dict[int, set[str]], dict[str, str]]` — воронка→слаги, слаг→слот
  - `links_db.load_blocks(con) -> dict[tuple[int, str], list[BlockItem]]` — ключ `(funnel_id, kind)`
  - `links_db.load_url_owners(con) -> dict[str, set[int]]` — нормализованный адрес → воронки
  - `links_db.label_of(row: FunnelRow) -> str` — `front_code` либо `#id`

- [ ] **Step 1: Написать падающий тест**

`tools/sheet-links/tests/test_links_db.py`:

```python
import sqlite3

import pytest

from links_db import (
    connect_ro,
    label_of,
    load_blocks,
    load_funnels,
    load_rooms,
    load_url_owners,
)

SCHEMA = """
CREATE TABLE funnels (
    id INTEGER PRIMARY KEY, front_code TEXT DEFAULT '',
    product_name TEXT DEFAULT '', status TEXT DEFAULT 'active'
);
CREATE TABLE funnel_days (
    id INTEGER PRIMARY KEY, funnel_id INTEGER, time_slot TEXT,
    day_num INTEGER, gc_room TEXT, web_room TEXT
);
CREATE TABLE funnel_blocks (
    id INTEGER PRIMARY KEY, funnel_id INTEGER, kind TEXT,
    enabled INTEGER DEFAULT 1, mode TEXT DEFAULT 'by_time'
);
CREATE TABLE funnel_block_items (
    id INTEGER PRIMARY KEY, block_id INTEGER, slot TEXT,
    label TEXT DEFAULT '', url TEXT DEFAULT '', position INTEGER DEFAULT 0
);
"""


def make_db(tmp_path, funnels=(), days=(), blocks=(), items=()):
    path = tmp_path / 'test.db'
    con = sqlite3.connect(path)
    con.executescript(SCHEMA)
    con.executemany(
        'INSERT INTO funnels (id,front_code,product_name,status) '
        'VALUES (?,?,?,?)', funnels)
    con.executemany(
        'INSERT INTO funnel_days (funnel_id,time_slot,day_num,gc_room,web_room) '
        'VALUES (?,?,?,?,?)', days)
    con.executemany(
        'INSERT INTO funnel_blocks (id,funnel_id,kind) VALUES (?,?,?)', blocks)
    con.executemany(
        'INSERT INTO funnel_block_items (block_id,slot,label,url,position) '
        'VALUES (?,?,?,?,?)', items)
    con.commit()
    con.close()
    return str(path)


def test_connect_ro_refuses_missing_file(tmp_path):
    with pytest.raises(FileNotFoundError):
        connect_ro(str(tmp_path / 'nope.db'))


def test_connect_ro_is_read_only(tmp_path):
    path = make_db(tmp_path, funnels=[(1, 'f1', 'ДБО ВК', 'active')])
    con = connect_ro(path)
    with pytest.raises(sqlite3.OperationalError):
        con.execute("UPDATE funnels SET status='archive'")
    con.close()


def test_load_funnels(tmp_path):
    path = make_db(tmp_path, funnels=[
        (1, 'f1', 'ДБО ВК', 'active'),
        (2, '', 'БОО ТГ', 'archive'),
    ])
    con = connect_ro(path)
    rows = load_funnels(con)
    con.close()
    assert rows[1].front_code == 'f1'
    assert rows[1].status == 'active'
    assert rows[2].product_name == 'БОО ТГ'


def test_label_of_falls_back_to_id(tmp_path):
    path = make_db(tmp_path, funnels=[(1, '', 'БОО ТГ', 'active'),
                                      (2, 'f9', 'ДБО ВК', 'active')])
    con = connect_ro(path)
    rows = load_funnels(con)
    con.close()
    assert label_of(rows[1]) == '#1'
    assert label_of(rows[2]) == 'f9'


def test_load_rooms_gives_slugs_and_slots(tmp_path):
    path = make_db(tmp_path,
                   funnels=[(1, 'f1', 'ДБО ВК', 'active')],
                   days=[(1, '19', 1, 'https://gc.ksamata.ru/dbo1-vk',
                          'https://web.ksamatacenter.com/room/dbo1-vk'),
                         (1, '15', 1, 'https://gc.ksamata.ru/1dbo-vk', '')])
    con = connect_ro(path)
    by_funnel, slots = load_rooms(con)
    con.close()
    assert by_funnel[1] == {'dbo1-vk', '1dbo-vk'}
    assert slots['dbo1-vk'] == '19'
    assert slots['1dbo-vk'] == '15'


def test_load_rooms_ignores_empty_and_non_room_urls(tmp_path):
    path = make_db(tmp_path,
                   funnels=[(1, 'f1', 'ДБО ВК', 'active')],
                   days=[(1, '19', 1, '', ''),
                         (1, '19', 2, 'https://gc.ksamata.ru/dbo/tarif/x', '')])
    con = connect_ro(path)
    by_funnel, slots = load_rooms(con)
    con.close()
    assert by_funnel == {}
    assert slots == {}


def test_load_blocks_groups_by_funnel_and_kind(tmp_path):
    path = make_db(
        tmp_path,
        funnels=[(1, 'f1', 'ДБО ВК', 'active')],
        blocks=[(10, 1, 'tariffs'), (11, 1, 'applications'), (12, 1, 'bonuses')],
        items=[(10, '19', '', 'https://t.ksamata.ru/a', 0),
               (10, '15', '', 'https://t.ksamata.ru/b', 1),
               (11, '19', '', 'https://gc.ksamata.ru/dbo/tarif/c', 0),
               (12, '19', '', 'https://gc.ksamata.ru/bonus', 0)])
    con = connect_ro(path)
    blocks = load_blocks(con)
    con.close()
    assert [i.url for i in blocks[(1, 'tariffs')]] == [
        'https://t.ksamata.ru/a', 'https://t.ksamata.ru/b']
    assert len(blocks[(1, 'applications')]) == 1
    assert (1, 'bonuses') not in blocks


def test_load_url_owners_normalizes(tmp_path):
    path = make_db(
        tmp_path,
        funnels=[(1, 'f1', 'ДБО ВК', 'active')],
        blocks=[(10, 1, 'tariffs')],
        items=[(10, '19', '', 'https://T.Ksamata.ru/a/', 0)])
    con = connect_ro(path)
    owners = load_url_owners(con)
    con.close()
    assert owners['https://t.ksamata.ru/a'] == {1}
```

- [ ] **Step 2: Прогнать тест и убедиться, что падает**

Run: `python3 -m pytest tools/sheet-links/tests/test_links_db.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'links_db'`

- [ ] **Step 3: Написать links_db.py**

```python
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

BLOCK_KINDS = ('tariffs', 'applications')


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
    label: str


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
    """(воронка, вид) → пункты блока, в порядке position."""
    out = defaultdict(list)
    placeholders = ','.join('?' * len(BLOCK_KINDS))
    for fid, kind, slot, label, url in con.execute(
            'SELECT b.funnel_id, b.kind, i.slot, i.label, i.url '
            'FROM funnel_blocks b '
            'JOIN funnel_block_items i ON i.block_id = b.id '
            f'WHERE b.kind IN ({placeholders}) '
            'ORDER BY b.funnel_id, b.kind, i.position', BLOCK_KINDS):
        out[(fid, kind)].append(BlockItem(slot, url or '', label or ''))
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
```

- [ ] **Step 4: Прогнать тест и убедиться, что проходит**

Run: `python3 -m pytest tools/sheet-links/tests/test_links_db.py -v`
Expected: PASS, 8 тестов

- [ ] **Step 5: Коммит**

```bash
git add tools/sheet-links/links_db.py tools/sheet-links/tests/test_links_db.py
git commit -m "feat(sheet-links): чтение базы на mode=ro

Комнаты со слотами, блоки tariffs/applications, владельцы адресов для
вторичного ключа. Тесты строят свою базу из схемы — живой файл не копируется.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Матчинг блока с воронкой

**Files:**
- Create: `tools/sheet-links/links_match.py`
- Test: `tools/sheet-links/tests/test_links_match.py`

**Interfaces:**
- Consumes: `links_compare.normalize_url`, `links_sheet.SheetBlock`
- Produces:
  - `links_match.Match(block: SheetBlock, funnel_id: int, key: str, weight: int)` — `key` это `'rooms'` или `'urls'`
  - `links_match.Ambiguous(block: SheetBlock, candidates: list[tuple[int, int]])`
  - `links_match.MatchResult(matched: list[Match], ambiguous: list[Ambiguous], orphans: list[SheetBlock], dead: list[SheetBlock])`
  - `links_match.match_blocks(blocks: list[SheetBlock], funnel_rooms: dict[int, set[str]], url_owners: dict[str, set[int]]) -> MatchResult`

- [ ] **Step 1: Написать падающий тест**

`tools/sheet-links/tests/test_links_match.py`:

```python
from links_match import match_blocks
from links_sheet import SheetBlock, Link


def block(name, rooms=(), tariffs=(), dead=False):
    return SheetBlock(sheet='ДБО', name=name, row=1, dead=dead,
                      rooms=set(rooms),
                      tariffs=[Link(2, u, None, '') for u in tariffs],
                      apps=[])


def test_matches_by_room_slug():
    result = match_blocks([block('ДБО ВК', rooms=['dbo1-vk'])],
                          {7: {'dbo1-vk', '1dbo-vk'}}, {})
    assert len(result.matched) == 1
    assert result.matched[0].funnel_id == 7
    assert result.matched[0].key == 'rooms'
    assert result.matched[0].weight == 1


def test_strongest_room_overlap_wins():
    result = match_blocks(
        [block('ДБО ВК', rooms=['a', 'b', 'c'])],
        {7: {'a'}, 8: {'a', 'b', 'c'}}, {})
    assert result.matched[0].funnel_id == 8
    assert result.matched[0].weight == 3


def test_equal_weight_is_ambiguous_not_a_guess():
    result = match_blocks([block('БОО Ютуб мир', rooms=['a'])],
                          {7: {'a'}, 8: {'a'}}, {})
    assert result.matched == []
    assert len(result.ambiguous) == 1
    assert sorted(f for f, _ in result.ambiguous[0].candidates) == [7, 8]


def test_secondary_key_used_only_when_rooms_find_nothing():
    result = match_blocks(
        [block('ДБО ВК', rooms=['unknown'],
               tariffs=['https://t.ksamata.ru/a'])],
        {}, {'https://t.ksamata.ru/a': {5}})
    assert result.matched[0].funnel_id == 5
    assert result.matched[0].key == 'urls'


def test_rooms_beat_urls_when_both_available():
    result = match_blocks(
        [block('ДБО ВК', rooms=['dbo1-vk'],
               tariffs=['https://t.ksamata.ru/a'])],
        {7: {'dbo1-vk'}}, {'https://t.ksamata.ru/a': {5}})
    assert result.matched[0].funnel_id == 7
    assert result.matched[0].key == 'rooms'


def test_secondary_key_normalizes_url():
    result = match_blocks(
        [block('ДБО ВК', tariffs=['https://T.Ksamata.ru/a/'])],
        {}, {'https://t.ksamata.ru/a': {5}})
    assert result.matched[0].funnel_id == 5


def test_block_with_nothing_matching_is_orphan():
    result = match_blocks([block('ЗП Яндекс РСЯ', rooms=['zp1-15-rsya'])],
                          {7: {'dbo1-vk'}}, {})
    assert result.orphans and result.orphans[0].name == 'ЗП Яндекс РСЯ'
    assert result.matched == []


def test_dead_block_is_set_aside_without_matching():
    result = match_blocks([block('ДБО ВК', rooms=['dbo1-vk'], dead=True)],
                          {7: {'dbo1-vk'}}, {})
    assert result.dead and result.dead[0].name == 'ДБО ВК'
    assert result.matched == [] and result.orphans == []
```

- [ ] **Step 2: Прогнать тест и убедиться, что падает**

Run: `python3 -m pytest tools/sheet-links/tests/test_links_match.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'links_match'`

- [ ] **Step 3: Написать links_match.py**

```python
#!/usr/bin/env python3
"""Кто из воронок стоит за блоком листа.

Первичный ключ — слаги вебинарных комнат: они лежат и в таблице (C, E), и в
funnel_days. Замер 17.08.2026: сработал на 47 блоках из 135.

Вторичный — адреса тарифов и заявок, уже лежащие в базе: ещё 5 блоков. Он
слабее (адрес теоретически переиспользуем), поэтому применяется только когда
по комнатам пусто, и помечается в отчёте отдельно.

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


def _by_urls(block, url_owners):
    weights = {}
    for link in list(block.tariffs) + list(block.apps):
        for fid in url_owners.get(normalize_url(link.url), ()):
            weights[fid] = weights.get(fid, 0) + 1
    return weights


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
```

- [ ] **Step 4: Прогнать тест и убедиться, что проходит**

Run: `python3 -m pytest tools/sheet-links/tests/test_links_match.py -v`
Expected: PASS, 8 тестов

- [ ] **Step 5: Коммит**

```bash
git add tools/sheet-links/links_match.py tools/sheet-links/tests/test_links_match.py
git commit -m "feat(sheet-links): матчинг блока листа с воронкой

Первичный ключ — слаги комнат, вторичный — адреса тарифов из базы, и только
когда по комнатам пусто. Равный вес не разрешается молча: блок уходит в
неоднозначные с перечнем кандидатов.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Сборка отчёта

**Files:**
- Create: `tools/sheet-links/links_report.py`
- Test: `tools/sheet-links/tests/test_links_report.py`

**Interfaces:**
- Consumes: `links_compare.Diff`, `links_db.FunnelRow`, `links_db.label_of`, `links_match.MatchResult`
- Produces:
  - `links_report.FunnelReport(label: str, product_name: str, block_name: str, sheet: str, row: int, key: str, has_tariffs: bool, has_apps: bool, tariffs: Diff, apps: Diff)` — frozen dataclass
  - `links_report.Unslotted(label: str, block_name: str, kind: str, url: str, row: int)` — frozen dataclass
  - `links_report.build_report(today: datetime.date, sheets_count: int, result: MatchResult, reports: list[FunnelReport], unslotted: list[Unslotted], funnels: dict[int, FunnelRow], active_total: int) -> str`

- [ ] **Step 1: Написать падающий тест**

`tools/sheet-links/tests/test_links_report.py`:

```python
import datetime

from links_compare import Diff
from links_db import FunnelRow
from links_match import MatchResult
from links_report import FunnelReport, Unslotted, build_report
from links_sheet import SheetBlock

TODAY = datetime.date(2026, 8, 17)
EMPTY = Diff([], [], [], 0)


def empty_result():
    return MatchResult(matched=[], ambiguous=[], orphans=[], dead=[])


def report(label='f11', has_tariffs=False, has_apps=False,
           tariffs=EMPTY, apps=EMPTY):
    return FunnelReport(label=label, product_name='ДБО NR ВК',
                        block_name='ДБО ВК', sheet='ДБО', row=51, key='rooms',
                        has_tariffs=has_tariffs, has_apps=has_apps,
                        tariffs=tariffs, apps=apps)


def test_header_carries_date_and_counts():
    text = build_report(TODAY, 26, empty_result(), [], [], {}, active_total=54)
    assert '2026-08-17' in text
    assert 'листов: 26' in text
    assert 'активных воронок: 54' in text


def test_fillable_section_lists_urls_by_slot():
    rep = report(tariffs=Diff([('19', 'https://t.ksamata.ru/a'),
                               ('15', 'https://t.ksamata.ru/b')], [], [], 0))
    text = build_report(TODAY, 26, empty_result(), [rep], [], {}, 54)
    assert 'Можно залить' in text
    assert 'https://t.ksamata.ru/a' in text
    assert 'https://t.ksamata.ru/b' in text
    assert '19' in text and '15' in text


def test_funnel_with_matching_block_is_silent():
    rep = report(has_tariffs=True, has_apps=True,
                 tariffs=Diff([], [], [], 3), apps=Diff([], [], [], 2))
    text = build_report(TODAY, 26, empty_result(), [rep], [], {}, 54)
    assert 'f11' not in text


def test_divergence_shows_both_sides():
    rep = report(has_tariffs=True,
                 tariffs=Diff([('19', 'https://t.ksamata.ru/new')],
                              [('19', 'https://t.ksamata.ru/old')], [], 1))
    text = build_report(TODAY, 26, empty_result(), [rep], [], {}, 54)
    assert 'Расхождения' in text
    assert 'https://t.ksamata.ru/new' in text
    assert 'https://t.ksamata.ru/old' in text


def test_slot_disagreement_is_shown():
    rep = report(has_tariffs=True,
                 tariffs=Diff([], [], [('https://t.ksamata.ru/a', '19', '15')], 0))
    text = build_report(TODAY, 26, empty_result(), [rep], [], {}, 54)
    assert 'https://t.ksamata.ru/a' in text
    assert '19' in text and '15' in text


def test_ambiguous_section_names_candidates():
    block = SheetBlock(sheet='БОО', name='БОО Ютуб мир', row=477)
    from links_match import Ambiguous
    result = MatchResult(matched=[], ambiguous=[Ambiguous(block, [(1, 10), (2, 10)])],
                         orphans=[], dead=[])
    funnels = {1: FunnelRow(1, 'f70', 'БОО Ютуб', 'active'),
               2: FunnelRow(2, 'f69', 'БОО Ютуб мир', 'active')}
    text = build_report(TODAY, 26, result, [], [], funnels, 54)
    assert 'БОО Ютуб мир' in text
    assert 'f70' in text and 'f69' in text


def test_orphans_section_lists_block_and_sheet():
    block = SheetBlock(sheet='ЗП', name='ЗП Яндекс РСЯ', row=2)
    result = MatchResult(matched=[], ambiguous=[], orphans=[block], dead=[])
    text = build_report(TODAY, 26, result, [], [], {}, 54)
    assert 'ЗП Яндекс РСЯ' in text
    assert 'ЗП' in text


def test_dead_blocks_are_only_a_number():
    block = SheetBlock(sheet='ДБО', name='ДБО старая', row=2, dead=True)
    result = MatchResult(matched=[], ambiguous=[], orphans=[], dead=[block])
    text = build_report(TODAY, 26, result, [], [], {}, 54)
    assert 'ДБО старая' not in text
    assert 'отключ' in text.lower()


def test_unslotted_section():
    un = [Unslotted(label='f11', block_name='ДБО ВК', kind='tariffs',
                    url='https://t.ksamata.ru/x', row=60)]
    text = build_report(TODAY, 26, empty_result(), [], un, {}, 54)
    assert 'Слот не определён' in text
    assert 'https://t.ksamata.ru/x' in text


def test_empty_run_still_produces_all_sections():
    """Пустой прогон не должен выглядеть как обрезанный отчёт."""
    text = build_report(TODAY, 26, empty_result(), [], [], {}, 54)
    for title in ('Сводка', 'Можно залить', 'Расхождения',
                  'Неоднозначные блоки', 'Слот не определён',
                  'Живые блоки без воронки', 'Отключённые блоки'):
        assert f'## {title}' in text
```

- [ ] **Step 2: Прогнать тест и убедиться, что падает**

Run: `python3 -m pytest tools/sheet-links/tests/test_links_report.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'links_report'`

- [ ] **Step 3: Написать links_report.py**

```python
#!/usr/bin/env python3
"""Сборка markdown-отчёта. Возвращает строку и ничего не пишет на диск.

Разделы идут в порядке разбора: сначала то, что можно залить, потом спорное,
потом справочное. Совпавшее не показывается вовсе — отчёт про расхождения,
а не про инвентарь.
"""

from dataclasses import dataclass

from links_db import label_of


@dataclass(frozen=True)
class FunnelReport:
    label: str
    product_name: str
    block_name: str
    sheet: str
    row: int
    key: str
    has_tariffs: bool
    has_apps: bool
    tariffs: object     # Diff
    apps: object        # Diff


@dataclass(frozen=True)
class Unslotted:
    label: str
    block_name: str
    kind: str
    url: str
    row: int


KIND_TITLE = {'tariffs': 'Тарифы', 'applications': 'Оформление заявки'}


def _pairs(lines, pairs):
    for slot, url in pairs:
        lines.append(f'  - `{slot or "?"}` {url}')


def _is_fillable(rep):
    return ((not rep.has_tariffs and rep.tariffs.only_sheet)
            or (not rep.has_apps and rep.apps.only_sheet))


def _diverges(rep):
    for has, diff in ((rep.has_tariffs, rep.tariffs),
                      (rep.has_apps, rep.apps)):
        if has and (diff.only_sheet or diff.only_db or diff.slot_differs):
            return True
    return False


def build_report(today, sheets_count, result, reports, unslotted, funnels,
                 active_total):
    fillable = [r for r in reports if _is_fillable(r)]
    diverging = [r for r in reports if not _is_fillable(r) and _diverges(r)]
    blocks_total = (len(result.matched) + len(result.ambiguous)
                    + len(result.orphans) + len(result.dead))

    out = [
        '# Тарифы и оформление заявки: таблица ↔ база',
        '',
        f'Прогон {today.isoformat()}. Источник — гугл-таблица «Воронки ссылки», '
        f'читается через сервисный аккаунт. Инструмент ничего не пишет.',
        '',
        '## Сводка',
        '',
        f'- листов: {sheets_count} видимых (скрытые пропущены)',
        f'- блоков в них: {blocks_total}',
        f'- сматчено с воронкой: {len(result.matched)} '
        f'(по комнатам {sum(1 for m in result.matched if m.key == "rooms")}, '
        f'по адресам тарифов {sum(1 for m in result.matched if m.key == "urls")})',
        f'- неоднозначных: {len(result.ambiguous)}',
        f'- живых блоков без воронки: {len(result.orphans)}',
        f'- помечены в таблице отключёнными: {len(result.dead)}',
        f'- активных воронок: {active_total}, из них можно заполнить: '
        f'{len(fillable)}, расходятся: {len(diverging)}',
        '',
    ]

    out += ['## Можно залить', '']
    if not fillable:
        out += ['Нечего.', '']
    for rep in fillable:
        out.append(f'### {rep.label} — {rep.product_name}')
        out.append('')
        out.append(f'Блок таблицы «{rep.block_name}», лист {rep.sheet}, '
                   f'строка {rep.row}.')
        out.append('')
        for kind, has, diff in (('tariffs', rep.has_tariffs, rep.tariffs),
                                ('applications', rep.has_apps, rep.apps)):
            if has or not diff.only_sheet:
                continue
            out.append(f'**{KIND_TITLE[kind]}**')
            _pairs(out, diff.only_sheet)
            out.append('')

    out += ['## Расхождения', '']
    if not diverging:
        out += ['Нет.', '']
    for rep in diverging:
        out.append(f'### {rep.label} — {rep.product_name}')
        out.append('')
        out.append(f'Блок таблицы «{rep.block_name}», лист {rep.sheet}, '
                   f'строка {rep.row}.')
        out.append('')
        for kind, has, diff in (('tariffs', rep.has_tariffs, rep.tariffs),
                                ('applications', rep.has_apps, rep.apps)):
            if not has or not (diff.only_sheet or diff.only_db
                               or diff.slot_differs):
                continue
            out.append(f'**{KIND_TITLE[kind]}** — совпало {diff.same}')
            if diff.only_sheet:
                out.append('')
                out.append('Только в таблице:')
                _pairs(out, diff.only_sheet)
            if diff.only_db:
                out.append('')
                out.append('Только в базе:')
                _pairs(out, diff.only_db)
            if diff.slot_differs:
                out.append('')
                out.append('Разный слот:')
                for url, sheet_slot, db_slot in diff.slot_differs:
                    out.append(f'  - {url}: в таблице `{sheet_slot}`, '
                               f'в базе `{db_slot}`')
            out.append('')

    out += ['## Неоднозначные блоки', '']
    if not result.ambiguous:
        out += ['Нет.', '']
    for amb in result.ambiguous:
        names = ', '.join(
            f'{label_of(funnels[fid])} ({weight})'
            for fid, weight in amb.candidates if fid in funnels)
        out.append(f'- «{amb.block.name}», лист {amb.block.sheet}, '
                   f'строка {amb.block.row} → {names}')
    out.append('')

    out += ['## Слот не определён', '']
    if not unslotted:
        out += ['Нет.', '']
    for item in unslotted:
        out.append(f'- {item.label} «{item.block_name}», '
                   f'{KIND_TITLE[item.kind]}, строка {item.row}: {item.url}')
    out.append('')

    out += ['## Живые блоки без воронки', '']
    if not result.orphans:
        out += ['Нет.', '']
    for block in result.orphans:
        out.append(f'- «{block.name}», лист {block.sheet}, строка {block.row}: '
                   f'тарифов {len(block.tariffs)}, заявок {len(block.apps)}')
    out.append('')

    out += ['## Отключённые блоки', '',
            f'{len(result.dead)} блоков помечены в таблице отключёнными '
            f'(«отключена», «Комнаты удалены») — в разбор не идут.', '']
    return '\n'.join(out)
```

- [ ] **Step 4: Прогнать тест и убедиться, что проходит**

Run: `python3 -m pytest tools/sheet-links/tests/test_links_report.py -v`
Expected: PASS, 10 тестов

- [ ] **Step 5: Коммит**

```bash
git add tools/sheet-links/links_report.py tools/sheet-links/tests/test_links_report.py
git commit -m "feat(sheet-links): сборка markdown-отчёта

Разделы по порядку разбора: можно залить, расхождения, неоднозначные,
слот не определён, сироты, отключённые числом. Совпавшее не показывается.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: CLI, README и живой прогон

**Files:**
- Create: `tools/sheet-links/run_sheet_links.py`
- Create: `tools/sheet-links/README.md`
- Test: `tools/sheet-links/tests/test_run_sheet_links.py`
- Modify: `CLAUDE.md` — строка про `tools/sheet-links/` в таблице «Repository layout»
- Modify: `docs/README.md` — ссылка на спеку и план

**Interfaces:**
- Consumes: всё предыдущее
- Produces:
  - `run_sheet_links.collect(sheets: dict, db_path: str) -> tuple[MatchResult, list[FunnelReport], list[Unslotted], dict[int, FunnelRow], int]`
  - `run_sheet_links.main(argv: list[str] | None = None) -> int`

- [ ] **Step 1: Написать падающий тест**

`tools/sheet-links/tests/test_run_sheet_links.py`:

```python
import json
import sqlite3

from run_sheet_links import collect, main

# Схема повторена намеренно: каталог tests не пакет, и импорт из соседнего
# тестового файла зависел бы от того, как pytest собрал sys.path.
SCHEMA = """
CREATE TABLE funnels (
    id INTEGER PRIMARY KEY, front_code TEXT DEFAULT '',
    product_name TEXT DEFAULT '', status TEXT DEFAULT 'active'
);
CREATE TABLE funnel_days (
    id INTEGER PRIMARY KEY, funnel_id INTEGER, time_slot TEXT,
    day_num INTEGER, gc_room TEXT, web_room TEXT
);
CREATE TABLE funnel_blocks (
    id INTEGER PRIMARY KEY, funnel_id INTEGER, kind TEXT,
    enabled INTEGER DEFAULT 1, mode TEXT DEFAULT 'by_time'
);
CREATE TABLE funnel_block_items (
    id INTEGER PRIMARY KEY, block_id INTEGER, slot TEXT,
    label TEXT DEFAULT '', url TEXT DEFAULT '', position INTEGER DEFAULT 0
);
"""


def make_db(tmp_path):
    path = tmp_path / 'live.db'
    con = sqlite3.connect(path)
    con.executescript(SCHEMA)
    con.execute("INSERT INTO funnels (id,front_code,product_name,status) "
                "VALUES (1,'f11','ДБО NR ВК','active')")
    con.execute("INSERT INTO funnels (id,front_code,product_name,status) "
                "VALUES (2,'f99','БОО архив','archive')")
    con.execute("INSERT INTO funnel_days (funnel_id,time_slot,day_num,gc_room,"
                "web_room) VALUES (1,'19',1,'https://gc.ksamata.ru/dbo1-vk','')")
    # У архивной воронки комната тоже есть — иначе тест про архив прошёл бы
    # по ложной причине: блок стал бы сиротой, а не отсеялся по статусу.
    con.execute("INSERT INTO funnel_days (funnel_id,time_slot,day_num,gc_room,"
                "web_room) VALUES (2,'19',1,'https://gc.ksamata.ru/boo-arch','')")
    con.commit()
    con.close()
    return str(path)


SHEETS = {'ДБО': [
    ['', '[ДБО ВК]'],
    ['', '1 день', 'https://gc.ksamata.ru/dbo1-vk', '', '',
     'https://t.ksamata.ru/dbo/tarif-19', '',
     'https://gc.ksamata.ru/dbo/tarif/curator-19'],
]}


def test_collect_matches_and_fills(tmp_path):
    result, reports, unslotted, funnels, active = collect(SHEETS,
                                                          make_db(tmp_path))
    assert len(result.matched) == 1
    assert active == 1
    assert reports[0].label == 'f11'
    assert reports[0].has_tariffs is False
    assert reports[0].tariffs.only_sheet == [
        ('19', 'https://t.ksamata.ru/dbo/tarif-19')]
    assert unslotted == []


def test_collect_skips_non_active_funnels(tmp_path):
    """Архив в подробную часть не идёт — охват задачи это активные."""
    sheets = {'БОО': [['', '[БОО архив]'],
                      ['', '1 день', 'https://gc.ksamata.ru/boo-arch', '', '',
                       'https://t.ksamata.ru/boo/tarif']]}
    result, reports, _, _, _ = collect(sheets, make_db(tmp_path))
    assert len(result.matched) == 1        # блок опознан...
    assert result.matched[0].funnel_id == 2
    assert reports == []                   # ...но в отчёт не попал


def test_main_writes_report_and_leaves_db_untouched(tmp_path, capsys):
    db = make_db(tmp_path)
    before = open(db, 'rb').read()
    cache = tmp_path / 'cache.json'
    cache.write_text(json.dumps(SHEETS), encoding='utf-8')
    out = tmp_path / 'report.md'
    code = main(['--db', db, '--cache', str(cache), '--out', str(out),
                 '--today', '2026-08-17'])
    assert code == 0
    text = out.read_text(encoding='utf-8')
    assert '2026-08-17' in text
    assert 'https://t.ksamata.ru/dbo/tarif-19' in text
    assert open(db, 'rb').read() == before
```

- [ ] **Step 2: Прогнать тест и убедиться, что падает**

Run: `python3 -m pytest tools/sheet-links/tests/test_run_sheet_links.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'run_sheet_links'`

- [ ] **Step 3: Написать run_sheet_links.py**

```python
#!/usr/bin/env python3
"""Сверка тарифов и оформления заявки: таблица «Воронки ссылки» ↔ база.

Запуск из корня репозитория:

    python3 tools/sheet-links/run_sheet_links.py

Спека: docs/superpowers/specs/2026-08-17-sheet-links-design.md

Инструмент ничего не пишет — ни в базу, ни в таблицу. На выходе markdown;
решения по нему принимает человек.
"""

import argparse
import datetime
import os
import sys

_BASE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, _BASE)

import links_compare    # noqa: E402
import links_db         # noqa: E402
import links_fetch      # noqa: E402
import links_match      # noqa: E402
import links_report     # noqa: E402
import links_settings   # noqa: E402
import links_sheet      # noqa: E402

ACTIVE = 'active'


def _sort_key(rep):
    """По числу в F-коде: иначе f11 встаёт раньше f2. Воронки без кода — в конец."""
    label = rep.label
    if label.startswith('f') and label[1:].isdigit():
        return (0, int(label[1:]), '')
    return (1, 0, label)


def collect(sheets, db_path):
    blocks = []
    for title, rows in sheets.items():
        blocks += links_sheet.parse_blocks(title, rows)

    con = links_db.connect_ro(db_path)
    try:
        funnels = links_db.load_funnels(con)
        funnel_rooms, room_slots = links_db.load_rooms(con)
        db_blocks = links_db.load_blocks(con)
        url_owners = links_db.load_url_owners(con)
    finally:
        con.close()

    result = links_match.match_blocks(blocks, funnel_rooms, url_owners)
    active_total = sum(1 for f in funnels.values() if f.status == ACTIVE)

    reports, unslotted = [], []
    for match in result.matched:
        funnel = funnels.get(match.funnel_id)
        if funnel is None or funnel.status != ACTIVE:
            continue
        label = links_db.label_of(funnel)
        diffs = {}
        for kind in ('tariffs', 'applications'):
            pairs = links_compare.sheet_items(match.block, kind, room_slots)
            diffs[kind] = links_compare.diff_items(
                pairs, db_blocks.get((match.funnel_id, kind), []))
            for slot, url in pairs:
                if slot is None:
                    unslotted.append(links_report.Unslotted(
                        label=label, block_name=match.block.name, kind=kind,
                        url=url, row=match.block.row))
        reports.append(links_report.FunnelReport(
            label=label, product_name=funnel.product_name,
            block_name=match.block.name, sheet=match.block.sheet,
            row=match.block.row, key=match.key,
            has_tariffs=bool(db_blocks.get((match.funnel_id, 'tariffs'))),
            has_apps=bool(db_blocks.get((match.funnel_id, 'applications'))),
            tariffs=diffs['tariffs'], apps=diffs['applications']))
    reports.sort(key=_sort_key)
    return result, reports, unslotted, funnels, active_total


def main(argv=None):
    parser = argparse.ArgumentParser(
        description='Тарифы и оформление заявки: таблица ↔ база')
    parser.add_argument('--db', default=links_settings.DB_PATH)
    parser.add_argument('--out', help='куда положить отчёт '
                                      '(по умолчанию data/generated/)')
    parser.add_argument('--cache', help='файл кеша таблицы; если есть — '
                                        'читается он, в сеть не идём')
    parser.add_argument('--today', help='дата прогона ГГГГ-ММ-ДД, для тестов')
    args = parser.parse_args(argv)

    today = (datetime.date.fromisoformat(args.today) if args.today
             else datetime.date.today())
    sheets = links_fetch.load_sheets(args.cache)
    print(f'Листов видимых: {len(sheets)}')

    result, reports, unslotted, funnels, active_total = collect(
        sheets, args.db)
    print(f'Блоков сматчено: {len(result.matched)}, '
          f'неоднозначных: {len(result.ambiguous)}, '
          f'сирот: {len(result.orphans)}, отключённых: {len(result.dead)}')

    text = links_report.build_report(today, len(sheets), result, reports,
                                     unslotted, funnels, active_total)
    out_path = args.out or os.path.join(
        links_settings.OUT_DIR, f'sheet-links-{today.isoformat()}.md')
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, 'w', encoding='utf-8') as fh:
        fh.write(text)
    print(f'Отчёт: {out_path}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
```

- [ ] **Step 4: Прогнать тест и убедиться, что проходит**

Run: `python3 -m pytest tools/sheet-links/tests/test_run_sheet_links.py -v`
Expected: PASS, 3 теста

- [ ] **Step 5: Прогнать весь набор и соседние наборы**

Соседние наборы обязательны: они проверяют, что имена модулей не столкнулись в общем `sys.path`.

Run: `python3 -m pytest tools/sheet-links/tests tools/audit/tests tools/reconcile/tests`
Expected: всё зелёное. Если падает `module 'X' has no attribute ...` — столкнулись имена, переименовать свой модуль.

- [ ] **Step 6: Живой прогон**

```bash
python3 tools/sheet-links/run_sheet_links.py
```
Expected: `Листов видимых: 26`, `Блоков сматчено: 52`, сирот 41, отключённых 42, отчёт в `data/generated/sheet-links-2026-08-17.md`. Прочитать отчёт глазами: разделы на месте, адреса не поехали.

- [ ] **Step 7: Убедиться, что база не тронута**

```bash
git status --porcelain ksamata_funnels.db
sqlite3 ksamata_funnels.db "select count(*) from monitor_targets;"
```
Expected: первая команда молчит, вторая печатает `0`.

- [ ] **Step 8: Написать README.md**

```markdown
# Тарифы и оформление заявки из таблицы «Воронки ссылки»

Сверяет гугл-таблицу [«Воронки ссылки»][sheet] с блоками `tariffs` и
`applications` активных воронок базы и кладёт markdown-отчёт в
`data/generated/`.

Инструмент **ничего не пишет** — ни в базу, ни в таблицу. Решения по отчёту
принимает человек.

Дизайн: [docs/superpowers/specs/2026-08-17-sheet-links-design.md](../../docs/superpowers/specs/2026-08-17-sheet-links-design.md)

[sheet]: https://docs.google.com/spreadsheets/d/1TTFjAAwE2g0D0BUNyOcMkuybuhbqUHf3EirM4GU2xYI/edit

## Запуск

Из корня репозитория:

```sh
python3 tools/sheet-links/run_sheet_links.py
```

Флаги: `--db`, `--out`, `--cache`, `--today`.

`--cache FILE` кладёт сырой ответ таблицы в файл и при следующем прогоне
читает его вместо сети — удобно, пока правишь отчёт.

Тесты: `python3 -m pytest tools/sheet-links/tests`

## Доступ к таблице

Только через сервисный аккаунт `leak-281@personal-chief-501813.iam.gserviceaccount.com`,
никогда через браузер. Клиент и ключ живут в соседнем проекте
`deal_exp_analytic`, путь к ним абсолютный.

403 или 404 на существующую таблицу означает, что она не расшарена на
сервисный аккаунт. Правильное действие — попросить владельца выдать доступ,
а не искать обход.

## Что откуда берётся

| Колонка листа | Что | Куда |
|---|---|---|
| C, E | комнаты вебинара и повтора | ключ матчинга и слот |
| F | «ссылка на продажную страницу» (`t.ksamata.ru`) | блок «Тарифы» |
| H | «страница в ГК для тарифов» (`gc.ksamata.ru/…/tarif/…`) | блок «Оформление заявки» |

Скрытые листы пропускаются. Блок считается мёртвым по маркерам «отключена»,
«Комнаты удалены» в первых четырёх строках.

## Слот берётся у комнаты, а не у секции листа

Разметка времени в листах неровная: на строке «1 день» отметка стоит то в
колонке M, то в A, а в 244 случаях её нет вовсе. Значений времени в таблице
четыре (15:00, 19:00, 20:00, 17:00), а `funnel_days.time_slot` знает два.
Поэтому слот ссылки — это слот комнаты из её строки, каким его знает база.
Ссылки без якорной комнаты уходят в отдельный раздел отчёта.

## Имена модулей с префиксом `links_`

Все каталоги под `tools/` лежат в одном `sys.path`, импорты плоские, и при
совпадении имён побеждает импортированный первым — молча. Поэтому чтение базы
называется `links_db`, а не `db_source`, а настройки — `links_settings`.
```

- [ ] **Step 9: Дописать строку в CLAUDE.md**

В таблице «Repository layout», после строки про `tools/reconcile/`:

```markdown
| `tools/sheet-links/` | **Тарифы и оформление заявки из таблицы «Воронки ссылки»** — сверка гугл-таблицы маркетологов с блоками `tariffs`/`applications` активных воронок. Read-only, отчёт в `data/generated/`. См. [tools/sheet-links/README.md](tools/sheet-links/README.md). |
```

- [ ] **Step 10: Дописать ссылку в docs/README.md**

В раздел живых планов и спек — ссылку на
`docs/superpowers/specs/2026-08-17-sheet-links-design.md` с пометкой, что
заливка результата в прод остаётся открытой задачей.

- [ ] **Step 11: Финальная проверка**

Run: `python3 -m pytest tools/sheet-links/tests tools/audit/tests tools/reconcile/tests -q`
Expected: всё зелёное.

Run: `git status --porcelain`
Expected: только ожидаемые файлы; `ksamata_funnels.db` в списке быть не должно.

- [ ] **Step 12: Коммит**

```bash
git add tools/sheet-links/ CLAUDE.md docs/README.md
git commit -m "feat(sheet-links): CLI, README и место в карте репозитория

Прогон из корня: python3 tools/sheet-links/run_sheet_links.py. Отчёт в
data/generated/. Подробная часть — только активные воронки.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Что этот план сознательно не делает

**Заливку.** Отчёт — это первый шаг из двух, так решил владелец. Заливка
пойдёт **в прод через его HTTP API**, а не в репозиторную базу: `/data`
сеется из `app/seed/` только при первом старте контейнера, поэтому правка
репозиторного файла до людей в админке не доезжает. Перед записью адреса
надо будет прогнать через `checkUrlField` — `replaceBlock` их не проверяет, а
админка потом откажется сохранять карточку, на которой человек ничего не
трогал. Это отдельная задача со своей спекой.

**Четыре времени.** Ссылки листа «ЖКТ (4 времени)» с отметками 20:00 и 17:00
попадут в раздел «слот не определён»: база таких слотов не знает. Расширять
схему этой задачей не будем.

**Правку таблицы.** Расхождения инструмент показывает, но кто прав — не
решает. По комнатам правило известно (база эталон), по тарифам такого правила
нет, и выдумывать его здесь неуместно.
