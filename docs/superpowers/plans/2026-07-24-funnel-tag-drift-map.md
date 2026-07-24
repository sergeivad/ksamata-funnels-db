# Карта расхождений тегов воронок — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Построить скрипт, который сводит реестр предложений GetCourse, историю выгрузок `deal_export` и `ksamata_funnels.db` в один XLSX-отчёт с 16 классами расхождений.

**Architecture:** Три модуля-источника (`api_source`, `export_source`, `db_source`) приводят свои данные к общим типам из `normalize`. Модуль `findings` — чистые функции, каждая принимает готовые коллекции и возвращает `list[Finding]`. `report` пишет XLSX, `run_audit` оркестрирует. Ни один модуль, кроме `run_audit`, не читает окружение и не пишет на диск — это делает их тестируемыми без моков файловой системы и сети.

**Tech Stack:** Python 3.12, стандартная библиотека (`sqlite3`, `urllib.request`, `csv`, `unicodedata`, `dataclasses`), `openpyxl` 3.1.5, `pytest` 9.0.2. Новых зависимостей не добавляется.

**Спек:** [2026-07-24-funnel-tag-drift-map-design.md](../specs/2026-07-24-funnel-tag-drift-map-design.md)

## Global Constraints

- **База только на чтение.** Открывать исключительно как `sqlite3.connect(f"file:{path}?mode=ro", uri=True)`. После любого прогона `git status --porcelain` обязан быть чистым, а `select count(*) from monitor_targets` — возвращать `0`.
- **Ключи GetCourse не попадают в репозиторий.** Читаются из окружения: `GC_DEV_KEY`, `GC_API_KEY`, `GC_DOMAIN`. Не логируются, не пишутся в отчёт, не пишутся в снимок.
- **Ничего не чинится автоматически.** Ни записи в базу, ни вызовов POST/PUT к GetCourse. Только GET и только отчёт.
- **Ключ склейки** — АВ-четвёрка `АВ Продукт` + `АВ Подрядчик` + `АВ Канал` + `АВ Направление`. Коллизии не разрешаются угадыванием.
- **Пагинация API — `limit` / `offset`.** Параметр `page` молча игнорируется и возвращает первую страницу бесконечно.
- **Разделитель тегов в выгрузках — `|`** (в колонке «Теги предложений»).
- **Дрейф меряется по дате файла выгрузки**, не по дате создания заказа.
- **Порог по дате:** выгрузки с `2026-04-01` включительно.
- **Точное написание:** `АВ Этап: Предписок` (всё кириллицей). Легаси-вариант `предсписок` — другой тег, автоматически не сводится.
- Новых зависимостей не добавлять. Всё, кроме `openpyxl`, — стандартная библиотека.

## File Structure

Всё живёт в `tools/audit/`. Плоские импорты (`from normalize import ...`) — это соответствует скриптовому стилю `tools/` и позволяет запускать как `python3 tools/audit/run_audit.py`, так и pytest, без пакетной обвязки в `tools/`.

| Файл | Ответственность |
|---|---|
| `tools/audit/conftest.py` | кладёт каталог в `sys.path` для pytest |
| `tools/audit/paths.py` | резолв путей от корня репозитория, порог даты |
| `tools/audit/normalize.py` | нормализация тегов, разбор АВ-осей, АВ-ключ, вывод `tag_type` |
| `tools/audit/db_source.py` | ожидания из базы, индекс АВ-ключей, словарь тегов |
| `tools/audit/export_source.py` | поиск и разбор выгрузок → наблюдения |
| `tools/audit/api_source.py` | клиент GetCourse, снимок реестра предложений |
| `tools/audit/findings.py` | 16 классов находок |
| `tools/audit/report.py` | запись XLSX |
| `tools/audit/run_audit.py` | CLI и оркестрация |
| `tools/audit/tests/*.py` | pytest |

Запуск тестов из корня репозитория: `python3 -m pytest tools/audit/tests -v`

---

### Task 1: Нормализация и разбор АВ-тегов

Фундамент: чистые функции без ввода-вывода. Всё остальное зависит от них.

**Files:**
- Create: `tools/audit/paths.py`
- Create: `tools/audit/normalize.py`
- Create: `tools/audit/conftest.py`
- Test: `tools/audit/tests/test_normalize.py`

**Interfaces:**
- Consumes: ничего.
- Produces:
  - `normalize_tag(raw: str) -> str`
  - `parse_tagset(raw: str | None) -> frozenset[str]`
  - `fold(tag: str) -> str`
  - `av_value(tags: frozenset[str], axis: str) -> str | None`
  - `av_key(tags: frozenset[str]) -> tuple[str | None, str | None, str | None, str | None]`
  - `is_complete_key(key: tuple) -> bool`
  - `key_label(key: tuple) -> str`
  - `classify(tags: frozenset[str]) -> tuple[str | None, str | None]` — возвращает `(tag_type, reason)`; ровно одно из двух не `None`
  - константы `AXES`, `STAGE_PREFIX`, `TIME_PREFIX`, `AUTOFUNNEL_TAG`, `LEGACY_AUTOFUNNEL_TAG`, `PREDPISOK_STAGE`
  - `paths.ROOT_DIR`, `paths.DB_PATH`, `paths.OUT_DIR`, `paths.DOWNLOADS_DIR`, `paths.SINCE_DATE`

- [ ] **Step 1: Создать `conftest.py` и `paths.py`**

`tools/audit/conftest.py`:

```python
"""Кладёт каталог tools/audit в sys.path, чтобы тесты использовали плоские импорты."""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
```

`tools/audit/paths.py`:

```python
#!/usr/bin/env python3
"""Пути и пороги. Всё резолвится от корня репозитория, а не от рабочего каталога."""

import datetime
import os

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT_DIR = os.path.abspath(os.path.join(BASE_DIR, '..', '..'))

DB_PATH = os.path.join(ROOT_DIR, 'ksamata_funnels.db')
OUT_DIR = os.path.join(ROOT_DIR, 'data', 'generated')

DOWNLOADS_DIR = os.path.expanduser('~/Downloads')

# Спек: выгрузки с апреля 2026 включительно.
SINCE_DATE = datetime.date(2026, 4, 1)
```

- [ ] **Step 2: Написать падающий тест**

`tools/audit/tests/test_normalize.py`:

```python
import pytest

from normalize import (
    AUTOFUNNEL_TAG,
    LEGACY_AUTOFUNNEL_TAG,
    av_key,
    av_value,
    classify,
    fold,
    is_complete_key,
    key_label,
    normalize_tag,
    parse_tagset,
)


def test_normalize_trims_and_collapses_spaces():
    assert normalize_tag('  АВ   Продукт:  ДБО  ') == 'АВ Продукт: ДБО'


def test_normalize_applies_nfc():
    # 'й' как 'и' + U+0306 должен схлопнуться в единый кодпоинт
    decomposed = 'Лине' + 'и\u0306' + 'ка'
    assert decomposed != 'Линейка'
    assert normalize_tag(decomposed) == 'Линейка'


def test_parse_tagset_splits_on_pipe_and_drops_empties():
    assert parse_tagset('ДБО| РСЯ ||АВ Продукт: ДБО|') == frozenset(
        {'ДБО', 'РСЯ', 'АВ Продукт: ДБО'}
    )


def test_parse_tagset_handles_none_and_blank():
    assert parse_tagset(None) == frozenset()
    assert parse_tagset('   ') == frozenset()


def test_fold_is_case_insensitive_but_normalize_keeps_original():
    assert fold('АВ Автоворонка') == fold('ав автоворонка')
    assert normalize_tag('АВ Автоворонка') == 'АВ Автоворонка'


def test_av_value_extracts_axis():
    tags = frozenset({'АВ Продукт: ДБО', 'АВ Канал: ВК'})
    assert av_value(tags, 'АВ Продукт') == 'ДБО'
    assert av_value(tags, 'АВ Подрядчик') is None


def test_av_key_returns_four_axes_in_order():
    tags = parse_tagset(
        'АВ Продукт: ДБО|АВ Подрядчик: NR|АВ Канал: ВК|АВ Направление: In Stream'
    )
    assert av_key(tags) == ('ДБО', 'NR', 'ВК', 'In Stream')
    assert is_complete_key(av_key(tags)) is True


def test_av_key_marks_incomplete():
    tags = parse_tagset('АВ Продукт: ДБО|АВ Канал: ВК')
    key = av_key(tags)
    assert key == ('ДБО', None, 'ВК', None)
    assert is_complete_key(key) is False


def test_key_label_is_readable_and_marks_gaps():
    assert key_label(('ДБО', None, 'ВК', 'РСЯ')) == 'ДБО / — / ВК / РСЯ'


@pytest.mark.parametrize(
    'raw,expected_type',
    [
        ('АВ Этап: Регистрация|АВ Продукт: ДБО', 'reg'),
        ('АВ Этап: Мессенджер|АВ Продукт: ДБО', 'messenger'),
        ('АВ Этап: Оплата|АВ Время: 19', 'time_19'),
        ('АВ Этап: Оплата|АВ Время: 15', 'time_15'),
    ],
)
def test_classify_returns_tag_type(raw, expected_type):
    tag_type, reason = classify(parse_tagset(raw))
    assert tag_type == expected_type
    assert reason is None


@pytest.mark.parametrize(
    'raw,expected_reason',
    [
        ('АВ Этап: Оплата|АВ Продукт: ДБО', 'no_time'),
        ('АВ Этап: Предписок|АВ Продукт: ДБО', 'predspisok'),
        ('АВ Продукт: ДБО|ДБО', 'no_stage'),
    ],
)
def test_classify_returns_reason_when_type_undecidable(raw, expected_reason):
    tag_type, reason = classify(parse_tagset(raw))
    assert tag_type is None
    assert reason == expected_reason


def test_predpisok_spelling_is_exact_and_legacy_variant_is_distinct():
    # Легаси 'предсписок' — ДРУГОЙ тег, автоматически не сводится (спек, «Нормализация»).
    tag_type, reason = classify(parse_tagset('предсписок|АВ Продукт: ДБО'))
    assert reason == 'no_stage'


def test_autofunnel_constants_are_distinct():
    assert AUTOFUNNEL_TAG == 'АВ Автоворонка'
    assert LEGACY_AUTOFUNNEL_TAG == 'автоворонки'
    assert fold(AUTOFUNNEL_TAG) != fold(LEGACY_AUTOFUNNEL_TAG)
```

- [ ] **Step 3: Запустить тест и убедиться, что он падает**

```bash
python3 -m pytest tools/audit/tests/test_normalize.py -v
```

Ожидается: `ModuleNotFoundError: No module named 'normalize'` — все тесты падают на сборе.

- [ ] **Step 4: Реализовать `normalize.py`**

```python
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
    """Значение оси, например av_value(tags, 'АВ Продукт') -> 'ДБО'."""
    prefix = axis + ':'
    for tag in tags:
        if tag.startswith(prefix):
            value = normalize_tag(tag[len(prefix):])
            if value:
                return value
    return None


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
      - (None, 'no_stage' | 'predspisok' | 'no_time') — почему не выведен.
    """
    if STAGE_REG in tags:
        return 'reg', None
    if STAGE_MESSENGER in tags:
        return 'messenger', None
    if PREDPISOK_STAGE in tags:
        return None, 'predspisok'
    if STAGE_PAYMENT in tags:
        if TIME_19 in tags:
            return 'time_19', None
        if TIME_15 in tags:
            return 'time_15', None
        return None, 'no_time'
    return None, 'no_stage'

```

- [ ] **Step 5: Запустить тесты и убедиться, что они проходят**

```bash
python3 -m pytest tools/audit/tests/test_normalize.py -v
```

Ожидается: `18 passed`.

- [ ] **Step 6: Коммит**

```bash
git add tools/audit/paths.py tools/audit/normalize.py tools/audit/conftest.py tools/audit/tests/test_normalize.py
git commit -m "feat(audit): нормализация тегов и разбор АВ-таксономии"
```

---

### Task 2: Ожидания из базы

**Files:**
- Create: `tools/audit/db_source.py`
- Test: `tools/audit/tests/test_db_source.py`

**Interfaces:**
- Consumes: `normalize.av_key`, `normalize.is_complete_key`, `normalize.parse_tagset`.
- Produces:
  - `@dataclass(frozen=True) Expectation(funnel_id: int, num: int, front_code: str, product_name: str, status: str, tag_type: str, tags: frozenset[str])`
  - `@dataclass(frozen=True) FunnelRow(funnel_id: int, num: int, front_code: str, product_name: str, status: str)`
  - `load_expectations(db_path: str) -> list[Expectation]`
  - `load_funnels(db_path: str) -> list[FunnelRow]`
  - `load_tag_vocabulary(db_path: str) -> frozenset[str]`
  - `build_av_index(expectations) -> dict[tuple, set[int]]`
  - `find_key_collisions(index) -> dict[tuple, set[int]]`
  - `label_of(row: FunnelRow) -> str`

- [ ] **Step 1: Написать падающий тест**

`tools/audit/tests/test_db_source.py`:

```python
import sqlite3

import pytest

from db_source import (
    build_av_index,
    find_key_collisions,
    label_of,
    load_expectations,
    load_funnels,
    load_tag_vocabulary,
)

SCHEMA = """
CREATE TABLE sources (id INTEGER PRIMARY KEY, name TEXT);
CREATE TABLE products (id INTEGER PRIMARY KEY, name TEXT);
CREATE TABLE contractors (id INTEGER PRIMARY KEY, name TEXT);
CREATE TABLE funnels (
    id INTEGER PRIMARY KEY, num INTEGER, source_id INTEGER,
    product_id INTEGER, contractor_id INTEGER,
    product_name TEXT DEFAULT '', front_code TEXT DEFAULT '',
    status TEXT DEFAULT 'active'
);
CREATE TABLE tags (id INTEGER PRIMARY KEY, name TEXT);
CREATE TABLE funnel_tags (
    id INTEGER PRIMARY KEY, funnel_id INTEGER, tag_id INTEGER,
    tag_type TEXT, position INTEGER DEFAULT 0
);
"""


def make_db(tmp_path, funnels, tag_links):
    """funnels: [(id, num, front_code, product_name, status)]
    tag_links: [(funnel_id, tag_type, [имена тегов])]"""
    path = tmp_path / 'test.db'
    con = sqlite3.connect(path)
    con.executescript(SCHEMA)
    for fid, num, code, pname, status in funnels:
        con.execute(
            'INSERT INTO funnels (id,num,source_id,product_id,contractor_id,'
            'product_name,front_code,status) VALUES (?,?,1,1,1,?,?,?)',
            (fid, num, pname, code, status),
        )
    tag_ids = {}
    for _, _, names in tag_links:
        for name in names:
            if name not in tag_ids:
                tag_ids[name] = len(tag_ids) + 1
                con.execute('INSERT INTO tags (id,name) VALUES (?,?)',
                            (tag_ids[name], name))
    for fid, tag_type, names in tag_links:
        for pos, name in enumerate(names):
            con.execute(
                'INSERT INTO funnel_tags (funnel_id,tag_id,tag_type,position) '
                'VALUES (?,?,?,?)', (fid, tag_ids[name], tag_type, pos))
    con.commit()
    con.close()
    return str(path)


AV_DBO_NR_VK_IS = [
    'АВ Продукт: ДБО', 'АВ Подрядчик: NR',
    'АВ Канал: ВК', 'АВ Направление: In Stream',
]


def test_load_expectations_groups_tags_by_funnel_and_type(tmp_path):
    db = make_db(
        tmp_path,
        [(11, 11, 'f11', 'ДБО NR ВК', 'active')],
        [(11, 'reg', AV_DBO_NR_VK_IS + ['АВ Этап: Регистрация', 'автоворонки'])],
    )
    exps = load_expectations(db)
    assert len(exps) == 1
    assert exps[0].funnel_id == 11
    assert exps[0].front_code == 'f11'
    assert exps[0].tag_type == 'reg'
    assert 'автоворонки' in exps[0].tags
    assert 'АВ Продукт: ДБО' in exps[0].tags


def test_connect_returns_a_connection_that_rejects_writes(tmp_path):
    """Запись в живую базу запрещена спеком — проверяем, а не декларируем."""
    import db_source as module

    db = make_db(tmp_path, [(1, 1, 'f1', 'X', 'active')],
                 [(1, 'reg', AV_DBO_NR_VK_IS)])
    con = module._connect(db)
    try:
        with pytest.raises(sqlite3.OperationalError):
            con.execute("INSERT INTO tags (id, name) VALUES (999, 'x')")
    finally:
        con.close()


def test_load_expectations_leaves_data_untouched(tmp_path):
    db = make_db(tmp_path, [(1, 1, 'f1', 'X', 'active')],
                 [(1, 'reg', AV_DBO_NR_VK_IS)])
    load_expectations(db)
    con = sqlite3.connect(db)
    remaining = con.execute('SELECT count(*) FROM funnel_tags').fetchone()[0]
    con.close()
    assert remaining == 4


def test_build_av_index_maps_key_to_funnels(tmp_path):
    db = make_db(
        tmp_path,
        [(11, 11, 'f11', 'ДБО NR ВК', 'active')],
        [(11, 'reg', AV_DBO_NR_VK_IS), (11, 'time_19', AV_DBO_NR_VK_IS)],
    )
    index = build_av_index(load_expectations(db))
    assert index[('ДБО', 'NR', 'ВК', 'In Stream')] == {11}


def test_find_key_collisions_detects_two_funnels_on_one_key(tmp_path):
    shared = ['АВ Продукт: ЖИВО', 'АВ Подрядчик: НИМБ',
              'АВ Канал: Яндекс', 'АВ Направление: РСЯ']
    db = make_db(
        tmp_path,
        [(34, 34, 'f33', 'ЖИВО НИМБ РСЯ', 'active'),
         (46, 46, 'f43', 'КВИЗЫ ЖИВО НИМБ', 'active')],
        [(34, 'reg', shared), (46, 'reg', shared)],
    )
    collisions = find_key_collisions(build_av_index(load_expectations(db)))
    assert collisions == {('ЖИВО', 'НИМБ', 'Яндекс', 'РСЯ'): {34, 46}}


def test_incomplete_keys_are_excluded_from_index(tmp_path):
    db = make_db(tmp_path, [(1, 1, 'f1', 'X', 'active')],
                 [(1, 'reg', ['АВ Продукт: ДБО', 'АВ Канал: ВК'])])
    assert build_av_index(load_expectations(db)) == {}


def test_load_tag_vocabulary_returns_all_tag_names(tmp_path):
    db = make_db(tmp_path, [(1, 1, 'f1', 'X', 'active')],
                 [(1, 'reg', AV_DBO_NR_VK_IS + ['автоворонки'])])
    vocab = load_tag_vocabulary(db)
    assert 'автоворонки' in vocab
    assert 'АВ Мессенджер: МАКС' not in vocab


def test_load_funnels_returns_all_including_drafts(tmp_path):
    db = make_db(
        tmp_path,
        [(1, 1, 'f1', 'A', 'active'), (2, 2, '', 'B', 'draft')],
        [(1, 'reg', AV_DBO_NR_VK_IS)],
    )
    rows = load_funnels(db)
    assert {r.status for r in rows} == {'active', 'draft'}
    assert len(rows) == 2


def test_label_of_falls_back_to_num_when_front_code_empty(tmp_path):
    db = make_db(tmp_path, [(2, 27, '', 'БОО Перелив СПБ', 'active')], [])
    row = load_funnels(db)[0]
    assert label_of(row) == '#27'
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

```bash
python3 -m pytest tools/audit/tests/test_db_source.py -v
```

Ожидается: `ModuleNotFoundError: No module named 'db_source'`.

- [ ] **Step 3: Реализовать `db_source.py`**

```python
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
```

- [ ] **Step 4: Запустить тесты и убедиться, что они проходят**

```bash
python3 -m pytest tools/audit/tests/test_db_source.py -v
```

Ожидается: `9 passed`.

- [ ] **Step 5: Проверить на живой базе, что она не изменилась**

```bash
python3 -c "import sys; sys.path.insert(0,'tools/audit'); import db_source, paths; e=db_source.load_expectations(paths.DB_PATH); i=db_source.build_av_index(e); print('пар:',len(e),'ключей:',len(i),'коллизий:',len(db_source.find_key_collisions(i)))" && git status --porcelain
```

Ожидается: `пар: 200 ключей: 49 коллизий: 1`, и `git status --porcelain` не показывает `ksamata_funnels.db`.

- [ ] **Step 6: Коммит**

```bash
git add tools/audit/db_source.py tools/audit/tests/test_db_source.py
git commit -m "feat(audit): читать ожидания по тегам из базы"
```

---

### Task 3: Разбор выгрузок deal_export

**Files:**
- Create: `tools/audit/export_source.py`
- Test: `tools/audit/tests/test_export_source.py`

**Interfaces:**
- Consumes: `normalize.parse_tagset`, `paths.SINCE_DATE`.
- Produces:
  - `@dataclass(frozen=True) Observation(deal_id: str, tags: frozenset[str], file_name: str, file_date: datetime.date, deal_created: str)`
  - `TAGS_COLUMN: str = 'Теги предложений'`
  - `file_date_from_name(name: str) -> datetime.date | None`
  - `has_tags_column(path: str) -> bool`
  - `discover_export_files(directory: str, since: datetime.date) -> list[str]`
  - `read_observations(path: str) -> list[Observation]`
  - `load_observations(files: list[str]) -> list[Observation]`

- [ ] **Step 1: Написать падающий тест**

`tools/audit/tests/test_export_source.py`:

```python
import csv
import datetime

import openpyxl
import pytest

from export_source import (
    TAGS_COLUMN,
    discover_export_files,
    file_date_from_name,
    has_tags_column,
    load_observations,
    read_observations,
)

HEADERS = ['ID заказа', 'Дата создания', 'Состав заказа', TAGS_COLUMN, 'Статус']


def write_csv(path, rows):
    with open(path, 'w', encoding='utf-8-sig', newline='') as fh:
        w = csv.writer(fh, delimiter=';')
        w.writerow(HEADERS)
        w.writerows(rows)


def write_xlsx(path, rows, headers=None):
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.append(headers if headers is not None else HEADERS)
    for r in rows:
        ws.append(list(r))
    wb.save(path)


def test_file_date_from_name_reads_first_iso_date():
    assert file_date_from_name('deal_export_2026-07-19_08-38-45.xlsx') == datetime.date(2026, 7, 19)
    assert file_date_from_name('deal_export_with_utm_2026-04-23.xlsx') == datetime.date(2026, 4, 23)
    assert file_date_from_name('deal_export_2026-05-13_11-43-50 (1).xlsx') == datetime.date(2026, 5, 13)
    assert file_date_from_name('deal_cycles_client_summary.md') is None


def test_has_tags_column_true_for_full_export(tmp_path):
    p = tmp_path / 'deal_export_2026-05-01_00-00-00.csv'
    write_csv(p, [['1', '2026-05-01 00:00:00', 'X', 'ДБО|РСЯ', 'Оплачен']])
    assert has_tags_column(str(p)) is True


def test_has_tags_column_false_for_utm_slice(tmp_path):
    p = tmp_path / 'deal_export_2026-05-01_00-00-00_utm.xlsx'
    write_xlsx(p, [['1', 'X']], headers=['ID заказа', 'Состав заказа'])
    assert has_tags_column(str(p)) is False


def test_discover_skips_files_before_since_and_without_tags(tmp_path):
    old = tmp_path / 'deal_export_2026-03-01_00-00-00.csv'
    write_csv(old, [['1', '2026-03-01 00:00:00', 'X', 'ДБО', 'Оплачен']])

    utm = tmp_path / 'deal_export_2026-05-01_00-00-00_utm.xlsx'
    write_xlsx(utm, [['2', 'X']], headers=['ID заказа', 'Состав заказа'])

    good = tmp_path / 'deal_export_2026-05-02_00-00-00.csv'
    write_csv(good, [['3', '2026-05-02 00:00:00', 'X', 'ДБО', 'Оплачен']])

    noise = tmp_path / 'unrelated_2026-05-03.xlsx'
    write_xlsx(noise, [['4', 'X']])

    found = discover_export_files(str(tmp_path), datetime.date(2026, 4, 1))
    assert [p.rsplit('/', 1)[-1] for p in found] == ['deal_export_2026-05-02_00-00-00.csv']


def test_discover_skips_excel_lock_files(tmp_path):
    lock = tmp_path / '~$deal_export_2026-05-02_00-00-00.xlsx'
    lock.write_bytes(b'not a real workbook')
    good = tmp_path / 'deal_export_2026-05-02_00-00-00.csv'
    write_csv(good, [['3', '2026-05-02 00:00:00', 'X', 'ДБО', 'Оплачен']])

    found = discover_export_files(str(tmp_path), datetime.date(2026, 4, 1))
    assert len(found) == 1
    assert '~$' not in found[0]


def test_read_observations_from_csv(tmp_path):
    p = tmp_path / 'deal_export_2026-05-02_00-00-00.csv'
    write_csv(p, [
        ['861', '2026-05-01 10:00:00', 'Курс', 'ДБО|АВ Продукт: ДБО', 'Оплачен'],
        ['862', '2026-05-01 11:00:00', 'Курс', '', 'Отменен'],
    ])
    obs = read_observations(str(p))
    assert len(obs) == 1  # строка без тегов отбрасывается
    assert obs[0].deal_id == '861'
    assert obs[0].tags == frozenset({'ДБО', 'АВ Продукт: ДБО'})
    assert obs[0].file_date == datetime.date(2026, 5, 2)
    assert obs[0].deal_created == '2026-05-01 10:00:00'


def test_read_observations_from_xlsx(tmp_path):
    p = tmp_path / 'deal_export_2026-05-02_00-00-00.xlsx'
    write_xlsx(p, [['861', '2026-05-01 10:00:00', 'Курс', 'ДБО|РСЯ', 'Оплачен']])
    obs = read_observations(str(p))
    assert obs[0].tags == frozenset({'ДБО', 'РСЯ'})


def test_load_observations_dedups_by_deal_and_file_date_not_deal_alone(tmp_path):
    """Один заказ в двух выгрузках — ДВА наблюдения: это и есть сигнал дрейфа."""
    march = tmp_path / 'deal_export_2026-04-11_00-00-00.csv'
    write_csv(march, [['810', '2026-04-10 10:00:00', 'Курс', 'АВ Продукт: СВС', 'Оплачен']])
    may = tmp_path / 'deal_export_2026-05-13_00-00-00.csv'
    write_csv(may, [['810', '2026-04-10 10:00:00', 'Курс', 'АВ Продукт: СВС|СВС', 'Оплачен']])

    obs = load_observations([str(march), str(may)])
    assert len(obs) == 2
    assert {o.file_date for o in obs} == {datetime.date(2026, 4, 11), datetime.date(2026, 5, 13)}


def test_load_observations_dedups_exact_duplicate_within_same_file_date(tmp_path):
    a = tmp_path / 'deal_export_2026-05-13_00-00-00.csv'
    write_csv(a, [['810', '2026-05-01 10:00:00', 'Курс', 'ДБО', 'Оплачен']])
    b = tmp_path / 'deal_export_2026-05-13_11-11-11 (1).csv'
    write_csv(b, [['810', '2026-05-01 10:00:00', 'Курс', 'ДБО', 'Оплачен']])

    obs = load_observations([str(a), str(b)])
    assert len(obs) == 1
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

```bash
python3 -m pytest tools/audit/tests/test_export_source.py -v
```

Ожидается: `ModuleNotFoundError: No module named 'export_source'`.

- [ ] **Step 3: Реализовать `export_source.py`**

```python
#!/usr/bin/env python3
"""Поиск и разбор выгрузок deal_export.

Ключевое свойство, проверенное на данных: «Теги предложений» вычисляются
в МОМЕНТ ВЫГРУЗКИ, а не хранятся на заказе. Поэтому единица наблюдения —
пара (заказ, дата файла), и дедупликация идёт по ней, а не по одному
id заказа: один заказ в двух выгрузках это два наблюдения, и именно их
расхождение является сигналом дрейфа.
"""

import csv
import datetime
import os
import re
from dataclasses import dataclass

import openpyxl

from normalize import parse_tagset

TAGS_COLUMN = 'Теги предложений'
DEAL_ID_COLUMN = 'ID заказа'
CREATED_COLUMN = 'Дата создания'

FILE_PREFIX = 'deal_export'
DATE_RE = re.compile(r'(\d{4})-(\d{2})-(\d{2})')


@dataclass(frozen=True)
class Observation:
    deal_id: str
    tags: frozenset
    file_name: str
    file_date: datetime.date
    deal_created: str


def file_date_from_name(name):
    match = DATE_RE.search(name)
    if not match:
        return None
    try:
        return datetime.date(int(match.group(1)), int(match.group(2)), int(match.group(3)))
    except ValueError:
        return None


def _read_header(path):
    if path.lower().endswith('.csv'):
        with open(path, encoding='utf-8-sig', newline='') as fh:
            return next(csv.reader(fh, delimiter=';'), [])
    wb = openpyxl.load_workbook(path, read_only=True)
    try:
        ws = wb.active
        row = next(ws.iter_rows(min_row=1, max_row=1, values_only=True), ())
        return [str(c) for c in row if c is not None]
    finally:
        wb.close()


def has_tags_column(path):
    """Отсеивает срезы *_utm с 13 колонками — колонки тегов там нет."""
    try:
        return TAGS_COLUMN in _read_header(path)
    except Exception:
        return False


def discover_export_files(directory, since):
    found = []
    for name in sorted(os.listdir(directory)):
        if name.startswith('~$') or not name.startswith(FILE_PREFIX):
            continue
        if not name.lower().endswith(('.csv', '.xlsx')):
            continue
        file_date = file_date_from_name(name)
        if file_date is None or file_date < since:
            continue
        full = os.path.join(directory, name)
        if has_tags_column(full):
            found.append(full)
    return found


def _rows(path):
    """Отдаёт словари {колонка: значение} независимо от формата файла."""
    if path.lower().endswith('.csv'):
        with open(path, encoding='utf-8-sig', newline='') as fh:
            for row in csv.DictReader(fh, delimiter=';'):
                yield row
        return

    wb = openpyxl.load_workbook(path, read_only=True)
    try:
        ws = wb.active
        stream = ws.iter_rows(values_only=True)
        header = [str(c) if c is not None else '' for c in next(stream, ())]
        for values in stream:
            yield {header[i]: values[i] for i in range(min(len(header), len(values)))}
    finally:
        wb.close()


def read_observations(path):
    name = os.path.basename(path)
    file_date = file_date_from_name(name)
    if file_date is None:
        return []

    result = []
    for row in _rows(path):
        deal_id = row.get(DEAL_ID_COLUMN)
        if deal_id is None or str(deal_id).strip() == '':
            continue
        tags = parse_tagset(row.get(TAGS_COLUMN))
        if not tags:
            continue
        result.append(
            Observation(
                deal_id=str(deal_id).strip(),
                tags=tags,
                file_name=name,
                file_date=file_date,
                deal_created=str(row.get(CREATED_COLUMN) or '').strip(),
            )
        )
    return result


def load_observations(files):
    """Дедуп по (заказ, дата файла) — НЕ по одному заказу.

    Две выгрузки одной даты с одним и тем же заказом дают одно наблюдение;
    выгрузки разных дат — два, даже если наборы тегов совпали.
    """
    seen = {}
    for path in files:
        for obs in read_observations(path):
            seen.setdefault((obs.deal_id, obs.file_date), obs)
    return sorted(seen.values(), key=lambda o: (o.file_date, o.deal_id))
```

- [ ] **Step 4: Запустить тесты и убедиться, что они проходят**

```bash
python3 -m pytest tools/audit/tests/test_export_source.py -v
```

Ожидается: `9 passed`.

- [ ] **Step 5: Проверить на живом каталоге выгрузок**

```bash
python3 -c "import sys; sys.path.insert(0,'tools/audit'); import export_source as e, paths; f=e.discover_export_files(paths.DOWNLOADS_DIR, paths.SINCE_DATE); print('файлов:', len(f)); print('\n'.join(x.rsplit('/',1)[-1] for x in f[:5]))"
```

Ожидается: непустой список файлов с апреля 2026, без `_utm` и без `~$`.

- [ ] **Step 6: Коммит**

```bash
git add tools/audit/export_source.py tools/audit/tests/test_export_source.py
git commit -m "feat(audit): читать наблюдения из выгрузок deal_export"
```

---

### Task 4: Клиент GetCourse

**Files:**
- Create: `tools/audit/api_source.py`
- Test: `tools/audit/tests/test_api_source.py`

**Interfaces:**
- Consumes: `normalize.normalize_tag`.
- Produces:
  - `@dataclass(frozen=True) ApiConfig(dev_key: str, api_key: str, domain: str)`
  - `@dataclass(frozen=True) Offer(offer_id: int, title: str, status: str, tags: frozenset[str])`
  - `config_from_env(env: dict) -> ApiConfig` — бросает `RuntimeError` при нехватке переменных
  - `build_url(cfg, path, params) -> str`
  - `auth_header(cfg) -> str`
  - `fetch_page(cfg, path, params, opener) -> list[dict]`
  - `fetch_all(cfg, path, opener, page_size=1000) -> list[dict]`
  - `load_offers(cfg, opener) -> list[Offer]`
  - `save_snapshot(offers: list[Offer], path: str) -> None`
  - `PAGE_SIZE: int = 1000`

`opener` — вызываемый объект `(url: str, headers: dict) -> str`, возвращающий тело ответа. По умолчанию `urllib_opener`. Инъекция нужна, чтобы тесты не ходили в сеть.

- [ ] **Step 1: Написать падающий тест**

`tools/audit/tests/test_api_source.py`:

```python
import json

import pytest

from api_source import (
    PAGE_SIZE,
    ApiConfig,
    auth_header,
    build_url,
    config_from_env,
    fetch_all,
    load_offers,
    save_snapshot,
)

CFG = ApiConfig(dev_key='DEV', api_key='API', domain='school.getcourse.ru')


def test_config_from_env_reads_three_variables():
    cfg = config_from_env({'GC_DEV_KEY': 'd', 'GC_API_KEY': 'a', 'GC_DOMAIN': 'x.ru'})
    assert cfg == ApiConfig(dev_key='d', api_key='a', domain='x.ru')


def test_config_from_env_raises_when_incomplete():
    with pytest.raises(RuntimeError) as err:
        config_from_env({'GC_DEV_KEY': 'd'})
    assert 'GC_API_KEY' in str(err.value)


def test_config_from_env_error_does_not_leak_key_values():
    with pytest.raises(RuntimeError) as err:
        config_from_env({'GC_DEV_KEY': 'super-secret-value'})
    assert 'super-secret-value' not in str(err.value)


def test_auth_header_uses_underscore_between_keys():
    assert auth_header(CFG) == 'Bearer DEV_API'


def test_build_url_targets_v1_and_encodes_params():
    url = build_url(CFG, 'offer/get-offers-tags', {'limit': 1000, 'offset': 2000})
    assert url.startswith('https://school.getcourse.ru/pl/api/v1/offer/get-offers-tags?')
    assert 'limit=1000' in url
    assert 'offset=2000' in url


def test_fetch_all_uses_limit_offset_not_page():
    """Параметр page молча игнорируется API и отдаёт первую страницу вечно."""
    calls = []

    def opener(url, headers):
        calls.append(url)
        offset = int(url.split('offset=')[1].split('&')[0])
        if offset >= 2 * PAGE_SIZE:
            return json.dumps({'data': []})
        return json.dumps({'data': [{'offerId': offset + i} for i in range(PAGE_SIZE)]})

    rows = fetch_all(CFG, 'offer/get-offers-tags', opener)
    assert len(rows) == 2 * PAGE_SIZE
    assert all('page=' not in url for url in calls)
    assert any('offset=0' in url for url in calls)
    assert any(f'offset={PAGE_SIZE}' in url for url in calls)


def test_fetch_all_stops_on_short_page():
    def opener(url, headers):
        if 'offset=0' in url:
            return json.dumps({'data': [{'offerId': i} for i in range(10)]})
        raise AssertionError('не должен запрашивать вторую страницу после короткой')

    assert len(fetch_all(CFG, 'offer/get-offers', opener)) == 10


def test_fetch_all_accepts_bare_array_envelope():
    def opener(url, headers):
        return json.dumps([{'offerId': 1}]) if 'offset=0' in url else json.dumps([])

    assert fetch_all(CFG, 'offer/get-offers', opener) == [{'offerId': 1}]


def test_load_offers_joins_offers_with_their_tags():
    def opener(url, headers):
        if 'get-offers-tags' in url:
            if 'offset=0' in url:
                return json.dumps({'data': [
                    {'offerId': 1, 'tags': ['АВ Продукт: ДБО', ' РСЯ ']},
                    {'offerId': 2, 'tags': []},
                ]})
            return json.dumps({'data': []})
        if 'offset=0' in url:
            return json.dumps({'data': [
                {'id': 1, 'title': 'Курс А', 'status': 'draft'},
                {'id': 2, 'title': 'Курс Б', 'status': 'draft'},
            ]})
        return json.dumps({'data': []})

    offers = load_offers(CFG, opener)
    by_id = {o.offer_id: o for o in offers}
    assert by_id[1].title == 'Курс А'
    assert by_id[1].tags == frozenset({'АВ Продукт: ДБО', 'РСЯ'})
    assert by_id[2].tags == frozenset()


def test_load_offers_keeps_offers_missing_from_tags_endpoint():
    def opener(url, headers):
        if 'get-offers-tags' in url:
            return json.dumps({'data': []})
        if 'offset=0' in url:
            return json.dumps({'data': [{'id': 7, 'title': 'Без тегов', 'status': 'draft'}]})
        return json.dumps({'data': []})

    offers = load_offers(CFG, opener)
    assert len(offers) == 1
    assert offers[0].tags == frozenset()


def test_save_snapshot_writes_json_without_credentials(tmp_path):
    from api_source import Offer

    out = tmp_path / 'snapshot.json'
    save_snapshot([Offer(offer_id=1, title='Курс', status='draft',
                         tags=frozenset({'ДБО'}))], str(out))
    text = out.read_text(encoding='utf-8')
    assert 'DEV' not in text
    assert 'API' not in text
    payload = json.loads(text)
    assert payload[0]['offer_id'] == 1
    assert payload[0]['tags'] == ['ДБО']
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

```bash
python3 -m pytest tools/audit/tests/test_api_source.py -v
```

Ожидается: `ModuleNotFoundError: No module named 'api_source'`.

- [ ] **Step 3: Реализовать `api_source.py`**

```python
#!/usr/bin/env python3
"""Клиент GetCourse для реестра предложений.

Только GET. Единственный источник, который видит предложения БЕЗ заказов —
через выгрузки они невидимы в принципе.

Два подтверждённых на живом API факта:
  - пагинация идёт по limit/offset; параметр page молча игнорируется
    и бесконечно отдаёт первую страницу;
  - поле status непригодно как признак актуальности: у всех предложений
    оно равно 'draft'.
"""

import json
import urllib.parse
import urllib.request
from dataclasses import dataclass

from normalize import normalize_tag

PAGE_SIZE = 1000
REQUIRED_ENV = ('GC_DEV_KEY', 'GC_API_KEY', 'GC_DOMAIN')
TIMEOUT_SECONDS = 60


@dataclass(frozen=True)
class ApiConfig:
    dev_key: str
    api_key: str
    domain: str


@dataclass(frozen=True)
class Offer:
    offer_id: int
    title: str
    status: str
    tags: frozenset


def config_from_env(env):
    missing = [name for name in REQUIRED_ENV if not env.get(name)]
    if missing:
        # Перечисляем ИМЕНА переменных, никогда не значения.
        raise RuntimeError(
            'Не заданы переменные окружения: ' + ', '.join(missing)
        )
    return ApiConfig(
        dev_key=env['GC_DEV_KEY'],
        api_key=env['GC_API_KEY'],
        domain=env['GC_DOMAIN'],
    )


def auth_header(cfg):
    return f'Bearer {cfg.dev_key}_{cfg.api_key}'


def build_url(cfg, path, params):
    base = f'https://{cfg.domain}/pl/api/v1/{path}'
    return base + '?' + urllib.parse.urlencode(params)


def urllib_opener(url, headers):
    request = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS) as response:
        return response.read().decode('utf-8')


def _unwrap(payload):
    """API отдаёт либо {'data': [...]}, либо голый массив."""
    if isinstance(payload, dict):
        data = payload.get('data')
        return data if isinstance(data, list) else []
    return payload if isinstance(payload, list) else []


def fetch_page(cfg, path, params, opener):
    url = build_url(cfg, path, params)
    body = opener(url, {'Authorization': auth_header(cfg)})
    return _unwrap(json.loads(body))


def fetch_all(cfg, path, opener, page_size=PAGE_SIZE):
    rows = []
    offset = 0
    while True:
        page = fetch_page(cfg, path, {'limit': page_size, 'offset': offset}, opener)
        rows.extend(page)
        if len(page) < page_size:
            return rows
        offset += page_size


def load_offers(cfg, opener=urllib_opener):
    raw_offers = fetch_all(cfg, 'offer/get-offers', opener)
    raw_tags = fetch_all(cfg, 'offer/get-offers-tags', opener)

    tags_by_id = {}
    for row in raw_tags:
        offer_id = row.get('offerId')
        if offer_id is None:
            continue
        names = (normalize_tag(t) for t in (row.get('tags') or []))
        tags_by_id[int(offer_id)] = frozenset(n for n in names if n)

    offers = []
    for row in raw_offers:
        offer_id = row.get('id')
        if offer_id is None:
            continue
        offer_id = int(offer_id)
        offers.append(
            Offer(
                offer_id=offer_id,
                title=normalize_tag(row.get('title') or ''),
                status=str(row.get('status') or ''),
                tags=tags_by_id.get(offer_id, frozenset()),
            )
        )
    return offers


def save_snapshot(offers, path):
    """Сырой снимок для воспроизводимости прогона. Ключи сюда не попадают."""
    payload = [
        {
            'offer_id': o.offer_id,
            'title': o.title,
            'status': o.status,
            'tags': sorted(o.tags),
        }
        for o in offers
    ]
    with open(path, 'w', encoding='utf-8') as fh:
        json.dump(payload, fh, ensure_ascii=False, indent=2)
```

- [ ] **Step 4: Запустить тесты и убедиться, что они проходят**

```bash
python3 -m pytest tools/audit/tests/test_api_source.py -v
```

Ожидается: `11 passed`.

- [ ] **Step 5: Коммит**

```bash
git add tools/audit/api_source.py tools/audit/tests/test_api_source.py
git commit -m "feat(audit): клиент реестра предложений GetCourse"
```

---

### Task 5: Находки групп I и II (классы 1–7)

Расхождения в наборах тегов и сбои опознания. Работают на связке «выгрузки + база».

**Files:**
- Create: `tools/audit/findings.py`
- Test: `tools/audit/tests/test_findings_groups_1_2.py`

**Interfaces:**
- Consumes: `normalize.*`, `db_source.Expectation`, `db_source.label_of`, `export_source.Observation`.
- Produces:
  - `@dataclass(frozen=True) Finding(cls: int, funnel: str, tag_type: str, subject: str, detail: str, evidence: str, first_seen: str, last_seen: str, deals: int)`
  - `@dataclass(frozen=True) Group(key: tuple, tag_type: str | None, reason: str | None, tags: frozenset[str], deals: int, first_seen: date, last_seen: date, files: tuple[str, ...])`
  - `CLASS_TITLES: dict[int, str]` — заголовки всех 16 классов
  - `group_observations(observations) -> list[Group]`
  - `find_missing_in_getcourse(groups, expectations, index) -> list[Finding]` — класс 1
  - `find_extra_axes(groups, vocabulary) -> list[Finding]` — класс 2
  - `find_unsupported_stage(groups) -> list[Finding]` — класс 3
  - `find_contradictory_legacy(groups, expectations, index) -> list[Finding]` — класс 4
  - `find_unresolved(groups, index) -> list[Finding]` — классы 5, 6, 7

- [ ] **Step 1: Написать падающий тест**

`tools/audit/tests/test_findings_groups_1_2.py`:

```python
import datetime

from db_source import Expectation
from export_source import Observation
from findings import (
    CLASS_TITLES,
    find_contradictory_legacy,
    find_extra_axes,
    find_missing_in_getcourse,
    find_unresolved,
    find_unsupported_stage,
    group_observations,
)
from normalize import parse_tagset

KEY = ('ДБО', 'NR', 'ВК', 'In Stream')
AV = 'АВ Продукт: ДБО|АВ Подрядчик: NR|АВ Канал: ВК|АВ Направление: In Stream'
INDEX = {KEY: {11}}


def exp(tag_type, raw):
    return Expectation(funnel_id=11, num=11, front_code='f11',
                       product_name='ДБО NR ВК', status='active',
                       tag_type=tag_type, tags=parse_tagset(raw))


def obs(raw, day, deal_id='1'):
    return Observation(deal_id=deal_id, tags=parse_tagset(raw),
                       file_name=f'deal_export_2026-05-{day:02d}_00-00-00.csv',
                       file_date=datetime.date(2026, 5, day),
                       deal_created='2026-05-01 00:00:00')


def test_class_titles_cover_all_sixteen():
    assert sorted(CLASS_TITLES) == list(range(1, 17))


def test_group_observations_aggregates_by_key_type_and_tagset():
    raw = AV + '|АВ Этап: Регистрация'
    groups = group_observations([obs(raw, 2, '1'), obs(raw, 5, '2')])
    assert len(groups) == 1
    g = groups[0]
    assert g.key == KEY
    assert g.tag_type == 'reg'
    assert g.deals == 2
    assert g.first_seen == datetime.date(2026, 5, 2)
    assert g.last_seen == datetime.date(2026, 5, 5)


def test_group_observations_separates_different_tagsets():
    base = AV + '|АВ Этап: Регистрация'
    groups = group_observations([obs(base, 2), obs(base + '|автоворонки', 5, '2')])
    assert len(groups) == 2


def test_class_1_reports_tag_expected_in_db_but_absent_in_getcourse():
    groups = group_observations([obs(AV + '|АВ Этап: Регистрация', 2)])
    expectations = [exp('reg', AV + '|АВ Этап: Регистрация|автоворонки')]
    found = find_missing_in_getcourse(groups, expectations, INDEX)
    assert len(found) == 1
    assert found[0].cls == 1
    assert found[0].funnel == 'f11'
    assert 'автоворонки' in found[0].subject


def test_class_1_silent_when_sets_match():
    raw = AV + '|АВ Этап: Регистрация'
    assert find_missing_in_getcourse(group_observations([obs(raw, 2)]),
                                     [exp('reg', raw)], INDEX) == []


def test_class_2_reports_axis_present_in_getcourse_but_absent_from_db_vocabulary():
    raw = AV + '|АВ Этап: Мессенджер|АВ Мессенджер: МАКС'
    groups = group_observations([obs(raw, 2)])
    vocabulary = frozenset({'АВ Продукт: ДБО', 'АВ Подрядчик: NR', 'АВ Канал: ВК',
                            'АВ Направление: In Stream', 'АВ Этап: Мессенджер'})
    found = find_extra_axes(groups, vocabulary)
    assert [f.cls for f in found] == [2]
    assert 'АВ Мессенджер: МАКС' in found[0].subject


def test_class_3_reports_predpisok_stage():
    groups = group_observations([obs(AV + '|АВ Этап: Предписок', 2)])
    found = find_unsupported_stage(groups)
    assert [f.cls for f in found] == [3]
    assert 'Предписок' in found[0].subject


def test_class_4_reports_contradictory_legacy_direction_tags():
    raw = AV + '|АВ Этап: Оплата|АВ Время: 19|ВК NR ВК|ВК NR IS'
    groups = group_observations([obs(raw, 2)])
    expectations = [exp('time_19', raw)]
    found = find_contradictory_legacy(groups, expectations, INDEX)
    assert [f.cls for f in found] == [4]
    assert 'ВК NR ВК' in found[0].evidence
    assert 'ВК NR IS' in found[0].evidence


def test_class_5_reports_payment_without_time():
    groups = group_observations([obs(AV + '|АВ Этап: Оплата', 2)])
    found = find_unresolved(groups, INDEX)
    assert [f.cls for f in found] == [5]


def test_class_6_reports_predpisok_as_unresolved():
    groups = group_observations([obs(AV + '|АВ Этап: Предписок', 2)])
    found = find_unresolved(groups, INDEX)
    assert [f.cls for f in found] == [6]


def test_class_7_reports_known_type_but_unknown_funnel():
    other = ('ЩЖ', 'НИМБ', 'Яндекс', 'РСЯ')
    raw = ('АВ Продукт: ЩЖ|АВ Подрядчик: НИМБ|АВ Канал: Яндекс|'
           'АВ Направление: РСЯ|АВ Этап: Регистрация')
    found = find_unresolved(group_observations([obs(raw, 2)]), INDEX)
    assert [f.cls for f in found] == [7]
    assert 'ЩЖ' in found[0].subject


def test_classes_5_6_7_are_mutually_exclusive():
    """Каждая неопознанная группа попадает ровно в один класс."""
    groups = group_observations([
        obs(AV + '|АВ Этап: Оплата', 2, '1'),
        obs(AV + '|АВ Этап: Предписок', 2, '2'),
        obs('АВ Продукт: ЩЖ|АВ Подрядчик: НИМБ|АВ Канал: Яндекс|'
            'АВ Направление: РСЯ|АВ Этап: Регистрация', 2, '3'),
    ])
    found = find_unresolved(groups, INDEX)
    assert sorted(f.cls for f in found) == [5, 6, 7]
    assert len(found) == len(groups)


def test_find_unresolved_silent_for_recognised_group():
    raw = AV + '|АВ Этап: Регистрация'
    assert find_unresolved(group_observations([obs(raw, 2)]), INDEX) == []
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

```bash
python3 -m pytest tools/audit/tests/test_findings_groups_1_2.py -v
```

Ожидается: `ModuleNotFoundError: No module named 'findings'`.

- [ ] **Step 3: Реализовать группы I и II в `findings.py`**

```python
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
```

- [ ] **Step 4: Запустить тесты и убедиться, что они проходят**

```bash
python3 -m pytest tools/audit/tests/test_findings_groups_1_2.py -v
```

Ожидается: `13 passed`.

- [ ] **Step 5: Коммит**

```bash
git add tools/audit/findings.py tools/audit/tests/test_findings_groups_1_2.py
git commit -m "feat(audit): находки классов 1-7 (расхождения и сбои опознания)"
```

---

### Task 6: Находки групп III и IV (классы 8–14)

Полнота базы относительно реестра API и актуальность.

**Files:**
- Modify: `tools/audit/findings.py` (дописать функции в конец)
- Test: `tools/audit/tests/test_findings_groups_3_4.py`

**Interfaces:**
- Consumes: всё из Task 5 плюс `api_source.Offer`, `db_source.FunnelRow`.
- Produces:
  - `find_key_collision_findings(collisions, expectations) -> list[Finding]` — класс 8
  - `find_unknown_av_keys(offers, index) -> list[Finding]` — класс 9
  - `find_incomplete_offer_keys(offers) -> list[Finding]` — класс 10
  - `find_unknown_axes_in_registry(offers, vocabulary) -> list[Finding]` — класс 11
  - `find_offers_without_autofunnel(offers) -> list[Finding]` — класс 12
  - `find_silent_funnels(funnels, groups, index) -> list[Finding]` — класс 13
  - `find_unused_offers(offers, groups) -> list[Finding]` — класс 14

- [ ] **Step 1: Написать падающий тест**

`tools/audit/tests/test_findings_groups_3_4.py`:

```python
import datetime

from api_source import Offer
from db_source import Expectation, FunnelRow
from export_source import Observation
from findings import (
    find_incomplete_offer_keys,
    find_key_collision_findings,
    find_offers_without_autofunnel,
    find_silent_funnels,
    find_unknown_av_keys,
    find_unknown_axes_in_registry,
    find_unused_offers,
    group_observations,
)
from normalize import parse_tagset

KEY = ('ДБО', 'NR', 'ВК', 'In Stream')
AV = 'АВ Продукт: ДБО|АВ Подрядчик: NR|АВ Канал: ВК|АВ Направление: In Stream'
INDEX = {KEY: {11}}


def offer(offer_id, raw, title='Курс'):
    return Offer(offer_id=offer_id, title=title, status='draft', tags=parse_tagset(raw))


def obs(raw, day=2, deal_id='1'):
    return Observation(deal_id=deal_id, tags=parse_tagset(raw),
                       file_name='deal_export_2026-05-02_00-00-00.csv',
                       file_date=datetime.date(2026, 5, day),
                       deal_created='2026-05-01 00:00:00')


def funnel(fid, num, code, status='active'):
    return FunnelRow(funnel_id=fid, num=num, front_code=code,
                     product_name='X', status=status)


def test_class_8_reports_collision_with_both_funnels():
    collisions = {('ЖИВО', 'НИМБ', 'Яндекс', 'РСЯ'): {34, 46}}
    expectations = [
        Expectation(funnel_id=34, num=34, front_code='f33', product_name='ЖИВО НИМБ РСЯ',
                    status='active', tag_type='reg', tags=frozenset()),
        Expectation(funnel_id=46, num=46, front_code='f43', product_name='КВИЗЫ ЖИВО НИМБ',
                    status='active', tag_type='reg', tags=frozenset()),
    ]
    found = find_key_collision_findings(collisions, expectations)
    assert [f.cls for f in found] == [8]
    assert 'f33' in found[0].evidence and 'f43' in found[0].evidence


def test_class_9_reports_av_key_present_in_registry_but_absent_from_db():
    offers = [offer(1, AV + '|АВ Этап: Регистрация'),
              offer(2, 'АВ Продукт: ЩЖ|АВ Подрядчик: НИМБ|АВ Канал: Яндекс|'
                       'АВ Направление: РСЯ|АВ Этап: Регистрация')]
    found = find_unknown_av_keys(offers, INDEX)
    assert [f.cls for f in found] == [9]
    assert 'ЩЖ' in found[0].subject


def test_class_9_counts_offers_per_key():
    raw = ('АВ Продукт: ЩЖ|АВ Подрядчик: НИМБ|АВ Канал: Яндекс|'
           'АВ Направление: РСЯ|АВ Этап: Регистрация')
    found = find_unknown_av_keys([offer(1, raw), offer(2, raw)], INDEX)
    assert len(found) == 1
    assert found[0].deals == 2


def test_class_10_reports_offer_with_incomplete_quadruple():
    offers = [offer(1, 'АВ Продукт: ДБО|АВ Канал: ВК|АВ Этап: Регистрация')]
    found = find_incomplete_offer_keys(offers)
    assert [f.cls for f in found] == [10]
    assert 'АВ Подрядчик' in found[0].detail


def test_class_10_ignores_offers_without_any_av_tags():
    assert find_incomplete_offer_keys([offer(1, 'ДБО|РСЯ')]) == []


def test_class_11_reports_axis_absent_from_db_vocabulary():
    vocabulary = frozenset({'АВ Продукт: ДБО', 'АВ Этап: Регистрация'})
    offers = [offer(1, 'АВ Продукт: ДБО|АВ Этап: Регистрация|АВ Линейка: Базовая')]
    found = find_unknown_axes_in_registry(offers, vocabulary)
    assert [f.cls for f in found] == [11]
    assert 'АВ Линейка' in found[0].subject


def test_class_12_reports_stage_without_autofunnel_tag():
    offers = [offer(1, AV + '|АВ Этап: Регистрация'),
              offer(2, AV + '|АВ Этап: Регистрация|АВ Автоворонка')]
    found = find_offers_without_autofunnel(offers)
    assert [f.cls for f in found] == [12]
    assert '1' in found[0].evidence


def test_class_13_reports_active_funnel_with_no_observations():
    groups = group_observations([obs(AV + '|АВ Этап: Регистрация')])
    funnels = [funnel(11, 11, 'f11'), funnel(99, 99, 'f99')]
    index = {KEY: {11}}
    found = find_silent_funnels(funnels, groups, index)
    assert [f.cls for f in found] == [13]
    assert found[0].funnel == 'f99'


def test_class_13_ignores_drafts_and_archive():
    funnels = [funnel(99, 99, 'f99', status='draft'),
               funnel(98, 98, 'f98', status='archive')]
    assert find_silent_funnels(funnels, [], {}) == []


def test_class_14_reports_av_offer_with_zero_deals():
    groups = group_observations([obs(AV + '|АВ Этап: Регистрация')])
    offers = [offer(1, AV + '|АВ Этап: Регистрация'),
              offer(2, 'АВ Продукт: ЩЖ|АВ Подрядчик: НИМБ|АВ Канал: Яндекс|'
                       'АВ Направление: РСЯ|АВ Этап: Регистрация', title='Старый')]
    found = find_unused_offers(offers, groups)
    assert [f.cls for f in found] == [14]
    assert 'Старый' in found[0].subject


def test_class_14_ignores_offers_without_av_tags():
    assert find_unused_offers([offer(1, 'ДБО|РСЯ')], []) == []
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

```bash
python3 -m pytest tools/audit/tests/test_findings_groups_3_4.py -v
```

Ожидается: `ImportError: cannot import name 'find_key_collision_findings' from 'findings'`.

- [ ] **Step 3: Дописать группы III и IV в конец `findings.py`**

```python
# ─── Группа III. Полнота базы относительно реестра GetCourse ────────────────


def _offers_with_av(offers):
    return [o for o in offers if any(t.startswith('АВ ') for t in o.tags)]


def find_key_collision_findings(collisions, expectations):
    """Класс 8: один АВ-ключ указывает на две воронки. Угадывать нельзя."""
    by_id = _by_funnel_id(expectations)
    result = []
    for key, fids in sorted(collisions.items()):
        labels = sorted(
            label_of(by_id[fid]) for fid in fids if fid in by_id
        )
        result.append(
            Finding(
                cls=8,
                funnel='—',
                tag_type='',
                subject=key_label(key),
                detail='Ключ указывает более чем на одну воронку',
                evidence=', '.join(labels),
                first_seen='',
                last_seen='',
                deals=len(fids),
            )
        )
    return result


def find_unknown_av_keys(offers, index):
    """Класс 9: четвёрка живёт в GetCourse, а воронки под неё в базе нет."""
    counts = defaultdict(list)
    for offer in _offers_with_av(offers):
        key = av_key(offer.tags)
        if is_complete_key(key) and key not in index:
            counts[key].append(offer)

    result = []
    for key, group in sorted(counts.items()):
        titles = sorted({o.title for o in group if o.title})
        result.append(
            Finding(
                cls=9,
                funnel='—',
                tag_type='',
                subject=key_label(key),
                detail=f'Предложений с такой четвёркой: {len(group)}',
                evidence='; '.join(titles[:3]),
                first_seen='',
                last_seen='',
                deals=len(group),
            )
        )
    return result


def find_incomplete_offer_keys(offers):
    """Класс 10: у предложения с АВ-тегами четвёрка неполна."""
    result = []
    for offer in _offers_with_av(offers):
        key = av_key(offer.tags)
        if is_complete_key(key):
            continue
        missing = [AXES[i] for i, part in enumerate(key) if part is None]
        result.append(
            Finding(
                cls=10,
                funnel='—',
                tag_type='',
                subject=f'{offer.title} (id {offer.offer_id})',
                detail='Не хватает осей: ' + ', '.join(missing),
                evidence=key_label(key),
                first_seen='',
                last_seen='',
                deals=0,
            )
        )
    return result


def find_unknown_axes_in_registry(offers, vocabulary):
    """Класс 11: ось есть в реестре, но её нет в словаре базы целиком."""
    counts = defaultdict(set)
    for offer in _offers_with_av(offers):
        for tag in offer.tags:
            if tag.startswith('АВ ') and tag not in vocabulary:
                axis = tag.split(':', 1)[0] if ':' in tag else tag
                counts[axis].add(offer.offer_id)

    result = []
    for axis, offer_ids in sorted(counts.items()):
        result.append(
            Finding(
                cls=11,
                funnel='—',
                tag_type='',
                subject=axis,
                detail=f'Предложений с этой осью: {len(offer_ids)}',
                evidence=', '.join(str(i) for i in sorted(offer_ids)[:5]),
                first_seen='',
                last_seen='',
                deals=len(offer_ids),
            )
        )
    return result


def find_offers_without_autofunnel(offers):
    """Класс 12: есть АВ Этап, но нет служебного АВ Автоворонка."""
    result = []
    for offer in _offers_with_av(offers):
        has_stage = any(t.startswith('АВ Этап') for t in offer.tags)
        if not has_stage or AUTOFUNNEL_TAG in offer.tags:
            continue
        result.append(
            Finding(
                cls=12,
                funnel='—',
                tag_type='',
                subject=offer.title,
                detail=f'Нет тега {AUTOFUNNEL_TAG}',
                evidence=str(offer.offer_id),
                first_seen='',
                last_seen='',
                deals=0,
            )
        )
    return result


# ─── Группа IV. Актуальность ────────────────────────────────────────────────
#
# Классы 13 и 14 намеренно НЕ сводятся: 13 смотрит от базы (воронка заведена,
# следов нет), 14 — от GetCourse (предложение существует, заказов нет).
# Воронка может попасть в 13, а её предложения — в 14; это разные выводы.


def find_silent_funnels(funnels, groups, index):
    """Класс 13: воронка active, но за период ни одного наблюдения."""
    seen_ids = set()
    for group in groups:
        seen_ids.update(index.get(group.key, set()))

    result = []
    for row in funnels:
        if row.status != 'active' or row.funnel_id in seen_ids:
            continue
        result.append(
            Finding(
                cls=13,
                funnel=label_of(row),
                tag_type='',
                subject=row.product_name,
                detail='Статус active, но наблюдений за период нет',
                evidence='',
                first_seen='',
                last_seen='',
                deals=0,
            )
        )
    return result


def find_unused_offers(offers, groups):
    """Класс 14: предложение с АВ-тегами, по которому нет заказов.

    Замена нерабочему полю status — у всех предложений оно равно 'draft'.
    """
    observed_keys = {g.key for g in groups if is_complete_key(g.key)}

    result = []
    for offer in _offers_with_av(offers):
        key = av_key(offer.tags)
        if not is_complete_key(key) or key in observed_keys:
            continue
        result.append(
            Finding(
                cls=14,
                funnel='—',
                tag_type='',
                subject=f'{offer.title} (id {offer.offer_id})',
                detail=f'Заказов за период нет. Ключ: {key_label(key)}',
                evidence=str(offer.offer_id),
                first_seen='',
                last_seen='',
                deals=0,
            )
        )
    return result
```

- [ ] **Step 4: Запустить оба набора тестов и убедиться, что они проходят**

```bash
python3 -m pytest tools/audit/tests/test_findings_groups_3_4.py tools/audit/tests/test_findings_groups_1_2.py -v
```

Ожидается: `24 passed` — новые 11 плюс прежние 13, без регрессий.

- [ ] **Step 5: Коммит**

```bash
git add tools/audit/findings.py tools/audit/tests/test_findings_groups_3_4.py
git commit -m "feat(audit): находки классов 8-14 (полнота реестра и актуальность)"
```

---

### Task 7: Находки группы V (классы 15–16)

Дрейф и покрытие. Без класса 16 отчёт врёт: выгрузки — сегментные срезы с неизвестным охватом.

**Files:**
- Modify: `tools/audit/findings.py` (дописать в конец)
- Test: `tools/audit/tests/test_findings_group_5.py`

**Interfaces:**
- Consumes: всё предыдущее.
- Produces:
  - `find_drift(groups, index, expectations) -> list[Finding]` — класс 15
  - `find_coverage(funnels, groups, index) -> list[Finding]` — класс 16

- [ ] **Step 1: Написать падающий тест**

`tools/audit/tests/test_findings_group_5.py`:

```python
import datetime

from db_source import Expectation, FunnelRow
from export_source import Observation
from findings import find_coverage, find_drift, group_observations
from normalize import parse_tagset

KEY = ('ДБО', 'NR', 'ВК', 'In Stream')
AV = 'АВ Продукт: ДБО|АВ Подрядчик: NR|АВ Канал: ВК|АВ Направление: In Stream'
INDEX = {KEY: {11}}
EXPECTATIONS = [
    Expectation(funnel_id=11, num=11, front_code='f11', product_name='ДБО NR ВК',
                status='active', tag_type='reg', tags=parse_tagset(AV))
]


def obs(raw, day, deal_id='1', file_name=None):
    date = datetime.date(2026, 5, day)
    return Observation(
        deal_id=deal_id, tags=parse_tagset(raw),
        file_name=file_name or f'deal_export_2026-05-{day:02d}_00-00-00.csv',
        file_date=date, deal_created='2026-05-01 00:00:00')


def test_class_15_reports_tag_appearing_between_two_export_dates():
    base = AV + '|АВ Этап: Регистрация'
    groups = group_observations([obs(base, 2, '1'), obs(base + '|СВС', 13, '2')])
    found = find_drift(groups, INDEX, EXPECTATIONS)
    assert [f.cls for f in found] == [15]
    assert 'СВС' in found[0].subject
    assert 'появился' in found[0].detail
    assert found[0].first_seen == '2026-05-02'
    assert found[0].last_seen == '2026-05-13'


def test_class_15_reports_tag_disappearing():
    base = AV + '|АВ Этап: Регистрация'
    groups = group_observations([obs(base + '|СВС', 2, '1'), obs(base, 13, '2')])
    found = find_drift(groups, INDEX, EXPECTATIONS)
    assert 'исчез' in found[0].detail


def test_class_15_silent_when_only_one_tagset_ever_seen():
    base = AV + '|АВ Этап: Регистрация'
    groups = group_observations([obs(base, 2, '1'), obs(base, 13, '2')])
    assert find_drift(groups, INDEX, EXPECTATIONS) == []


def test_class_15_uses_file_date_not_deal_created_date():
    """Мартовский заказ в майской выгрузке несёт МАЙСКИЕ теги."""
    base = AV + '|АВ Этап: Регистрация'
    early = Observation(deal_id='1', tags=parse_tagset(base),
                        file_name='deal_export_2026-05-02_00-00-00.csv',
                        file_date=datetime.date(2026, 5, 2),
                        deal_created='2026-03-10 10:00:00')
    late = Observation(deal_id='1', tags=parse_tagset(base + '|СВС'),
                       file_name='deal_export_2026-05-13_00-00-00.csv',
                       file_date=datetime.date(2026, 5, 13),
                       deal_created='2026-03-10 10:00:00')
    found = find_drift(group_observations([early, late]), INDEX, EXPECTATIONS)
    assert found[0].first_seen == '2026-05-02'
    assert found[0].last_seen == '2026-05-13'


def test_class_16_reports_observation_and_file_counts_per_funnel():
    base = AV + '|АВ Этап: Регистрация'
    groups = group_observations([
        obs(base, 2, '1', 'deal_export_2026-05-02_00-00-00.csv'),
        obs(base, 13, '2', 'deal_export_2026-05-13_00-00-00.csv'),
    ])
    funnels = [FunnelRow(funnel_id=11, num=11, front_code='f11',
                         product_name='ДБО NR ВК', status='active')]
    found = find_coverage(funnels, groups, INDEX)
    assert [f.cls for f in found] == [16]
    assert found[0].funnel == 'f11'
    assert found[0].deals == 2
    assert '2 файл' in found[0].detail
    assert found[0].last_seen == '2026-05-13'


def test_class_16_marks_thin_coverage_explicitly():
    base = AV + '|АВ Этап: Регистрация'
    groups = group_observations([obs(base, 2, '1')])
    funnels = [FunnelRow(funnel_id=11, num=11, front_code='f11',
                         product_name='X', status='active')]
    found = find_coverage(funnels, groups, INDEX)
    assert 'мало данных' in found[0].subject


def test_class_16_includes_funnels_with_zero_observations():
    funnels = [FunnelRow(funnel_id=99, num=99, front_code='f99',
                         product_name='X', status='active')]
    found = find_coverage(funnels, [], {})
    assert found[0].deals == 0
    assert 'нет данных' in found[0].subject
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

```bash
python3 -m pytest tools/audit/tests/test_findings_group_5.py -v
```

Ожидается: `ImportError: cannot import name 'find_drift' from 'findings'`.

- [ ] **Step 3: Дописать группу V в конец `findings.py`**

```python
# ─── Группа V. Динамика и достоверность ─────────────────────────────────────

# Меньше этого числа наблюдений — данных слишком мало, чтобы делать выводы.
THIN_COVERAGE_THRESHOLD = 2


def find_drift(groups, index, expectations):
    """Класс 15: набор тегов у пары (ключ × тип) менялся между выгрузками.

    Дата берётся ПО ФАЙЛУ выгрузки, а не по созданию заказа: «Теги
    предложений» вычисляются в момент выгрузки, поэтому старый заказ
    в свежей выгрузке несёт свежие теги.
    """
    by_id = _by_funnel_id(expectations)

    by_slot = defaultdict(list)
    for group in groups:
        if group.tag_type is None:
            continue
        by_slot[(group.key, group.tag_type)].append(group)

    result = []
    for (key, tag_type), variants in sorted(by_slot.items(), key=lambda kv: key_label(kv[0][0])):
        if len(variants) < 2:
            continue
        ordered = sorted(variants, key=lambda g: g.last_seen)
        for older, newer in zip(ordered, ordered[1:]):
            appeared = sorted(newer.tags - older.tags)
            disappeared = sorted(older.tags - newer.tags)
            if not appeared and not disappeared:
                continue
            parts = []
            if appeared:
                parts.append('появился: ' + ', '.join(appeared))
            if disappeared:
                parts.append('исчез: ' + ', '.join(disappeared))
            result.append(
                Finding(
                    cls=15,
                    funnel=_funnel_label(index, by_id, key),
                    tag_type=tag_type,
                    subject=', '.join(appeared + disappeared),
                    detail='; '.join(parts),
                    evidence=f'{key_label(key)} | между {older.last_seen} и {newer.last_seen}',
                    first_seen=str(older.last_seen),
                    last_seen=str(newer.last_seen),
                    deals=older.deals + newer.deals,
                )
            )
    return result


def find_coverage(funnels, groups, index):
    """Класс 16: сколько данных вообще есть по каждой воронке.

    Выгрузки — сегментные срезы с неизвестным охватом. Без этого листа
    отчёт создаёт ложное впечатление полноты.
    """
    stats = defaultdict(lambda: {'deals': 0, 'files': set(), 'last': None})
    for group in groups:
        for fid in index.get(group.key, set()):
            entry = stats[fid]
            entry['deals'] += group.deals
            entry['files'].update(group.files)
            if entry['last'] is None or group.last_seen > entry['last']:
                entry['last'] = group.last_seen

    result = []
    for row in funnels:
        entry = stats.get(row.funnel_id)
        deals = entry['deals'] if entry else 0
        files = len(entry['files']) if entry else 0
        last = entry['last'] if entry else None

        if deals == 0:
            subject = 'нет данных'
        elif deals < THIN_COVERAGE_THRESHOLD or files < THIN_COVERAGE_THRESHOLD:
            subject = 'мало данных — выводы ненадёжны'
        else:
            subject = 'покрытие достаточное'

        result.append(
            Finding(
                cls=16,
                funnel=label_of(row),
                tag_type='',
                subject=subject,
                detail=f'{deals} наблюдений из {files} файлов',
                evidence=row.status,
                first_seen='',
                last_seen=str(last) if last else '',
                deals=deals,
            )
        )
    return result
```

- [ ] **Step 4: Запустить весь набор тестов**

```bash
python3 -m pytest tools/audit/tests -v
```

Ожидается: `78 passed` — 18 + 9 + 9 + 11 + 13 + 11 + 7 по всем файлам, без регрессий в ранее написанных.

- [ ] **Step 5: Коммит**

```bash
git add tools/audit/findings.py tools/audit/tests/test_findings_group_5.py
git commit -m "feat(audit): находки классов 15-16 (дрейф и покрытие)"
```

---

### Task 8: Отчёт XLSX

**Files:**
- Create: `tools/audit/report.py`
- Test: `tools/audit/tests/test_report.py`

**Interfaces:**
- Consumes: `findings.Finding`, `findings.CLASS_TITLES`.
- Produces:
  - `SUMMARY_SHEET: str`, `SOURCES_SHEET: str`
  - `build_summary_rows(findings, funnels) -> list[list]`
  - `write_report(path, findings, funnels, sources) -> None`, где `sources: list[dict]` с ключами `kind`, `name`, `detail`

- [ ] **Step 1: Написать падающий тест**

`tools/audit/tests/test_report.py`:

```python
import openpyxl

from db_source import FunnelRow
from findings import CLASS_TITLES, Finding
from report import SOURCES_SHEET, SUMMARY_SHEET, build_summary_rows, write_report


def finding(cls, funnel='f11'):
    return Finding(cls=cls, funnel=funnel, tag_type='reg', subject='S',
                   detail='D', evidence='E', first_seen='2026-05-02',
                   last_seen='2026-05-13', deals=3)


FUNNELS = [
    FunnelRow(funnel_id=11, num=11, front_code='f11', product_name='ДБО NR ВК', status='active'),
    FunnelRow(funnel_id=12, num=12, front_code='f12', product_name='ЖКТ NR ВК', status='active'),
]


def test_summary_counts_findings_per_funnel_and_class():
    rows = build_summary_rows([finding(1), finding(1), finding(4)], FUNNELS)
    header, first, second = rows[0], rows[1], rows[2]
    assert header[0] == 'Воронка'
    assert first[0] == 'f11'
    assert first[header.index('Класс 1')] == 2
    assert first[header.index('Класс 4')] == 1
    assert second[0] == 'f12'
    assert second[header.index('Класс 1')] == 0


def test_write_report_creates_summary_sources_and_one_sheet_per_class(tmp_path):
    out = tmp_path / 'report.xlsx'
    sources = [{'kind': 'выгрузка', 'name': 'deal_export_2026-05-02.csv', 'detail': '120 строк'}]
    write_report(str(out), [finding(1), finding(15)], FUNNELS, sources)

    wb = openpyxl.load_workbook(out)
    assert SUMMARY_SHEET in wb.sheetnames
    assert SOURCES_SHEET in wb.sheetnames
    # Лист заводится на каждый класс, даже пустой — чтобы «ноль находок»
    # был виден явно, а не выглядел как забытая проверка.
    for cls in CLASS_TITLES:
        assert f'Класс {cls}' in wb.sheetnames


def test_class_sheet_carries_decision_column_left_empty(tmp_path):
    out = tmp_path / 'report.xlsx'
    write_report(str(out), [finding(1)], FUNNELS, [])
    ws = openpyxl.load_workbook(out)['Класс 1']
    # _write_sheet: строка 1 — название листа, 2 — пустая, 3 — заголовки, 4+ — данные.
    header = [c.value for c in ws[3]]
    assert 'Решение' in header
    assert ws.cell(row=4, column=header.index('Решение') + 1).value is None


def test_class_sheet_title_row_names_the_class(tmp_path):
    out = tmp_path / 'report.xlsx'
    write_report(str(out), [], FUNNELS, [])
    ws = openpyxl.load_workbook(out)['Класс 16']
    assert CLASS_TITLES[16] in str(ws['A1'].value or ws['A2'].value or '')


def test_sources_sheet_lists_inputs(tmp_path):
    out = tmp_path / 'report.xlsx'
    sources = [
        {'kind': 'выгрузка', 'name': 'deal_export_2026-05-02.csv', 'detail': '120 строк'},
        {'kind': 'API', 'name': 'offer/get-offers', 'detail': '7679 предложений'},
    ]
    write_report(str(out), [], FUNNELS, sources)
    ws = openpyxl.load_workbook(out)[SOURCES_SHEET]
    values = [str(row[1].value) for row in ws.iter_rows(min_row=2) if row[1].value]
    assert 'deal_export_2026-05-02.csv' in values
    assert 'offer/get-offers' in values
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

```bash
python3 -m pytest tools/audit/tests/test_report.py -v
```

Ожидается: `ModuleNotFoundError: No module named 'report'`.

- [ ] **Step 3: Реализовать `report.py`**

```python
#!/usr/bin/env python3
"""Запись карты расхождений в XLSX.

Лист на каждый класс заводится всегда, даже пустой: «ноль находок» должен
быть виден явно, иначе отсутствие листа читается как забытая проверка.
"""

from collections import defaultdict

import openpyxl
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter

from db_source import label_of
from findings import CLASS_TITLES

SUMMARY_SHEET = 'Сводка'
SOURCES_SHEET = 'Источники'

CLASS_HEADERS = [
    'Воронка', 'Тип', 'Находка', 'Подробности',
    'Свидетельство', 'Первое наблюдение', 'Последнее наблюдение',
    'Заказов', 'Решение',
]

HEADER_FILL = PatternFill('solid', fgColor='DDDDDD')
HEADER_FONT = Font(bold=True)
TITLE_FONT = Font(bold=True, size=12)


def build_summary_rows(findings, funnels):
    """Строка на воронку, колонка на класс. Первая строка — заголовок."""
    classes = sorted(CLASS_TITLES)
    header = ['Воронка', 'Продукт', 'Статус'] + [f'Класс {c}' for c in classes] + ['Всего']

    counts = defaultdict(lambda: defaultdict(int))
    for item in findings:
        counts[item.funnel][item.cls] += 1

    rows = [header]
    for row in funnels:
        label = label_of(row)
        per_class = [counts[label][c] for c in classes]
        rows.append([label, row.product_name, row.status] + per_class + [sum(per_class)])
    return rows


def _write_sheet(ws, title, headers, rows):
    ws['A1'] = title
    ws['A1'].font = TITLE_FONT
    ws.append([])
    ws.append(headers)
    for cell in ws[3]:
        cell.font = HEADER_FONT
        cell.fill = HEADER_FILL
    for row in rows:
        ws.append(row)
    ws.freeze_panes = 'A4'
    for index, _ in enumerate(headers, start=1):
        ws.column_dimensions[get_column_letter(index)].width = 24


def write_report(path, findings, funnels, sources):
    wb = openpyxl.Workbook()

    summary = wb.active
    summary.title = SUMMARY_SHEET
    rows = build_summary_rows(findings, funnels)
    summary.append(rows[0])
    for cell in summary[1]:
        cell.font = HEADER_FONT
        cell.fill = HEADER_FILL
        cell.alignment = Alignment(wrap_text=True, vertical='top')
    for row in rows[1:]:
        summary.append(row)
    summary.freeze_panes = 'B2'

    by_class = defaultdict(list)
    for item in findings:
        by_class[item.cls].append(item)

    for cls in sorted(CLASS_TITLES):
        ws = wb.create_sheet(f'Класс {cls}')
        body = [
            [
                item.funnel, item.tag_type, item.subject, item.detail,
                item.evidence, item.first_seen, item.last_seen, item.deals, None,
            ]
            for item in by_class.get(cls, [])
        ]
        _write_sheet(ws, f'Класс {cls}. {CLASS_TITLES[cls]}', CLASS_HEADERS, body)

    ws = wb.create_sheet(SOURCES_SHEET)
    body = [[s.get('kind', ''), s.get('name', ''), s.get('detail', '')] for s in sources]
    _write_sheet(ws, 'Источники прогона', ['Тип', 'Имя', 'Подробности'], body)

    wb.save(path)
```

- [ ] **Step 4: Запустить тесты и убедиться, что они проходят**

```bash
python3 -m pytest tools/audit/tests/test_report.py -v
```

Ожидается: `5 passed`.

- [ ] **Step 5: Коммит**

```bash
git add tools/audit/report.py tools/audit/tests/test_report.py
git commit -m "feat(audit): запись карты расхождений в XLSX"
```

---

### Task 9: CLI и сквозной прогон

**Files:**
- Create: `tools/audit/run_audit.py`
- Create: `tools/audit/README.md`
- Test: `tools/audit/tests/test_run_audit.py`
- Modify: `CLAUDE.md` — добавить `tools/audit/` в таблицу «Repository layout» и в раздел «Data tools»

**Interfaces:**
- Consumes: всё предыдущее.
- Produces:
  - `collect_findings(expectations, funnels, vocabulary, index, collisions, groups, offers) -> list[Finding]`
  - `main(argv, env) -> int`

- [ ] **Step 1: Написать падающий тест**

`tools/audit/tests/test_run_audit.py`:

```python
import datetime

from api_source import Offer
from db_source import Expectation, FunnelRow
from export_source import Observation
from findings import CLASS_TITLES, group_observations
from normalize import parse_tagset
from run_audit import collect_findings

KEY = ('ДБО', 'NR', 'ВК', 'In Stream')
AV = 'АВ Продукт: ДБО|АВ Подрядчик: NR|АВ Канал: ВК|АВ Направление: In Stream'


def test_collect_findings_runs_every_class_and_tags_them_correctly():
    expectations = [
        Expectation(funnel_id=11, num=11, front_code='f11', product_name='ДБО NR ВК',
                    status='active', tag_type='reg',
                    tags=parse_tagset(AV + '|АВ Этап: Регистрация|автоворонки'))
    ]
    funnels = [
        FunnelRow(funnel_id=11, num=11, front_code='f11', product_name='ДБО NR ВК',
                  status='active'),
        FunnelRow(funnel_id=99, num=99, front_code='f99', product_name='Тихая',
                  status='active'),
    ]
    vocabulary = parse_tagset(AV + '|АВ Этап: Регистрация|автоворонки')
    index = {KEY: {11}}
    groups = group_observations([
        Observation(deal_id='1', tags=parse_tagset(AV + '|АВ Этап: Регистрация'),
                    file_name='deal_export_2026-05-02_00-00-00.csv',
                    file_date=datetime.date(2026, 5, 2), deal_created='2026-05-01'),
    ])
    offers = [Offer(offer_id=1, title='Курс', status='draft',
                    tags=parse_tagset(AV + '|АВ Этап: Регистрация'))]

    found = collect_findings(expectations, funnels, vocabulary, index, {}, groups, offers)
    classes = {f.cls for f in found}

    assert 1 in classes    # 'автоворонки' ожидается базой, в GetCourse нет
    assert 12 in classes   # у предложения нет АВ Автоворонка
    assert 13 in classes   # f99 без наблюдений
    assert 16 in classes   # покрытие считается всегда
    assert classes <= set(CLASS_TITLES)


def test_collect_findings_returns_empty_classes_when_everything_matches():
    tags = AV + '|АВ Этап: Регистрация|АВ Автоворонка'
    expectations = [
        Expectation(funnel_id=11, num=11, front_code='f11', product_name='X',
                    status='active', tag_type='reg', tags=parse_tagset(tags))
    ]
    funnels = [FunnelRow(funnel_id=11, num=11, front_code='f11',
                         product_name='X', status='active')]
    index = {KEY: {11}}
    groups = group_observations([
        Observation(deal_id='1', tags=parse_tagset(tags),
                    file_name='deal_export_2026-05-02_00-00-00.csv',
                    file_date=datetime.date(2026, 5, 2), deal_created='2026-05-01'),
    ])
    offers = [Offer(offer_id=1, title='Курс', status='draft', tags=parse_tagset(tags))]

    found = collect_findings(expectations, funnels, parse_tagset(tags),
                             index, {}, groups, offers)
    # Остаётся только класс 16 — он описывает покрытие, а не дефект.
    assert {f.cls for f in found} == {16}
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

```bash
python3 -m pytest tools/audit/tests/test_run_audit.py -v
```

Ожидается: `ModuleNotFoundError: No module named 'run_audit'`.

- [ ] **Step 3: Реализовать `run_audit.py`**

```python
#!/usr/bin/env python3
"""Карта расхождений тегов воронок.

Сводит три источника — реестр предложений GetCourse, историю выгрузок
deal_export и ksamata_funnels.db — в один XLSX с 16 классами находок.

Эталона нет: скрипт ничего не чинит, только показывает расхождения.

Запуск из корня репозитория:

    GC_DEV_KEY=... GC_API_KEY=... GC_DOMAIN=... python3 tools/audit/run_audit.py

Без сети (только база и выгрузки, классы 9-12 и 14 будут пусты):

    python3 tools/audit/run_audit.py --no-api
"""

import argparse
import datetime
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import api_source
import db_source
import export_source
import findings as F
import paths
import report


def collect_findings(expectations, funnels, vocabulary, index, collisions, groups, offers):
    """Прогоняет все 16 классов. Порядок листов в отчёте задаёт report."""
    result = []
    result += F.find_missing_in_getcourse(groups, expectations, index)
    result += F.find_extra_axes(groups, vocabulary)
    result += F.find_unsupported_stage(groups)
    result += F.find_contradictory_legacy(groups, expectations, index)
    result += F.find_unresolved(groups, index)
    result += F.find_key_collision_findings(collisions, expectations)
    result += F.find_unknown_av_keys(offers, index)
    result += F.find_incomplete_offer_keys(offers)
    result += F.find_unknown_axes_in_registry(offers, vocabulary)
    result += F.find_offers_without_autofunnel(offers)
    result += F.find_silent_funnels(funnels, groups, index)
    result += F.find_unused_offers(offers, groups)
    result += F.find_drift(groups, index, expectations)
    result += F.find_coverage(funnels, groups, index)
    return result


def main(argv=None, env=None):
    env = os.environ if env is None else env
    parser = argparse.ArgumentParser(description='Карта расхождений тегов воронок')
    parser.add_argument('--no-api', action='store_true',
                        help='не ходить в GetCourse; классы 9-12 и 14 останутся пустыми')
    parser.add_argument('--downloads', default=paths.DOWNLOADS_DIR,
                        help='каталог с выгрузками deal_export')
    parser.add_argument('--since', default=paths.SINCE_DATE.isoformat(),
                        help='нижняя граница по дате файла, ГГГГ-ММ-ДД')
    args = parser.parse_args(argv)

    since = datetime.date.fromisoformat(args.since)
    sources = []

    print('Читаю базу…')
    expectations = db_source.load_expectations(paths.DB_PATH)
    funnels = db_source.load_funnels(paths.DB_PATH)
    vocabulary = db_source.load_tag_vocabulary(paths.DB_PATH)
    index = db_source.build_av_index(expectations)
    collisions = db_source.find_key_collisions(index)
    sources.append({
        'kind': 'база',
        'name': os.path.basename(paths.DB_PATH),
        'detail': f'{len(funnels)} воронок, {len(expectations)} пар, '
                  f'{len(index)} ключей, {len(collisions)} коллизий',
    })
    print(f'  воронок: {len(funnels)}, пар: {len(expectations)}, '
          f'ключей: {len(index)}, коллизий: {len(collisions)}')

    print('Ищу выгрузки…')
    files = export_source.discover_export_files(args.downloads, since)
    observations = export_source.load_observations(files)
    groups = F.group_observations(observations)
    for path in files:
        sources.append({'kind': 'выгрузка', 'name': os.path.basename(path), 'detail': ''})
    print(f'  файлов: {len(files)}, наблюдений: {len(observations)}, групп: {len(groups)}')

    offers = []
    if args.no_api:
        print('API пропущен (--no-api): классы 9-12 и 14 будут пусты.')
        sources.append({'kind': 'API', 'name': '—', 'detail': 'пропущен (--no-api)'})
    else:
        print('Читаю реестр предложений GetCourse…')
        cfg = api_source.config_from_env(env)
        offers = api_source.load_offers(cfg)
        os.makedirs(paths.OUT_DIR, exist_ok=True)
        snapshot = os.path.join(paths.OUT_DIR, 'getcourse_offers_snapshot.json')
        api_source.save_snapshot(offers, snapshot)
        sources.append({
            'kind': 'API',
            'name': 'offer/get-offers + offer/get-offers-tags',
            'detail': f'{len(offers)} предложений, снимок: {os.path.basename(snapshot)}',
        })
        print(f'  предложений: {len(offers)}')

    print('Считаю находки…')
    result = collect_findings(expectations, funnels, vocabulary,
                              index, collisions, groups, offers)

    os.makedirs(paths.OUT_DIR, exist_ok=True)
    out_path = os.path.join(paths.OUT_DIR, 'Карта_расхождений_тегов.xlsx')
    report.write_report(out_path, result, funnels, sources)

    by_class = {}
    for item in result:
        by_class[item.cls] = by_class.get(item.cls, 0) + 1
    print(f'\nНаходок всего: {len(result)}')
    for cls in sorted(F.CLASS_TITLES):
        print(f'  Класс {cls:>2}: {by_class.get(cls, 0):>5}  {F.CLASS_TITLES[cls]}')
    print(f'\nОтчёт: {out_path}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
```

- [ ] **Step 4: Запустить весь набор тестов**

```bash
python3 -m pytest tools/audit/tests -v
```

Ожидается: `85 passed` — 78 + 5 + 2, без регрессий.

- [ ] **Step 5: Сквозной прогон без сети и проверка, что база не тронута**

```bash
python3 tools/audit/run_audit.py --no-api && sqlite3 ksamata_funnels.db "select count(*) from monitor_targets;" && git status --porcelain
```

Ожидается: печать статистики по всем 16 классам, файл `data/generated/Карта_расхождений_тегов.xlsx`, затем `0`, и в `git status` — только новые файлы `tools/audit/`, без `ksamata_funnels.db`.

- [ ] **Step 6: Полный прогон с API**

```bash
set -a && . /Users/sergeielkin/dev/ksamata/getcourse-api/.env && set +a && python3 tools/audit/run_audit.py && git status --porcelain
```

Ожидается: `предложений: 7679`, непустые классы 9 и 11, отчёт записан, `ksamata_funnels.db` в `git status` отсутствует.

- [ ] **Step 7: Написать `tools/audit/README.md`**

```markdown
# Карта расхождений тегов воронок

Сводит три источника в один XLSX-отчёт: реестр предложений GetCourse,
историю выгрузок `deal_export` и `ksamata_funnels.db`.

**Эталона нет.** Скрипт ничего не чинит — ни базу, ни GetCourse. На выходе
карта расхождений; решения принимает человек.

Дизайн: [docs/superpowers/specs/2026-07-24-funnel-tag-drift-map-design.md](../../docs/superpowers/specs/2026-07-24-funnel-tag-drift-map-design.md)

## Запуск

Из корня репозитория:

```sh
GC_DEV_KEY=... GC_API_KEY=... GC_DOMAIN=... python3 tools/audit/run_audit.py
```

Без обращения к GetCourse (классы 9–12 и 14 останутся пустыми):

```sh
python3 tools/audit/run_audit.py --no-api
```

Флаги: `--downloads <каталог>` — где искать выгрузки (по умолчанию `~/Downloads`),
`--since ГГГГ-ММ-ДД` — нижняя граница по дате файла (по умолчанию `2026-04-01`).

## Выход

- `data/generated/Карта_расхождений_тегов.xlsx` — сводка, лист на каждый
  из 16 классов, лист источников.
- `data/generated/getcourse_offers_snapshot.json` — сырой снимок реестра
  для воспроизводимости.

Каталог `data/generated/` в git не коммитится.

## Что важно знать

- **База только на чтение.** После прогона `git status --porcelain` обязан
  быть чистым.
- **Ключи GetCourse** берутся из окружения (`GC_DEV_KEY`, `GC_API_KEY`,
  `GC_DOMAIN`) и в репозиторий не попадают.
- **Ключ склейки** предложения с воронкой — АВ-четвёрка `Продукт + Подрядчик +
  Канал + Направление`, а не название предложения: одно название встречается
  у нескольких воронок.
- **Дрейф меряется по дате файла выгрузки.** «Теги предложений» вычисляются
  в момент выгрузки, поэтому старый заказ в свежей выгрузке несёт свежие теги.
- **Пагинация API — `limit`/`offset`.** Параметр `page` молча игнорируется.
- **Поле `status` у предложений непригодно** — у всех оно `draft`.
  Актуальность оценивается по наличию заказов (класс 14).
- **Лист класса 16 (покрытие) читать обязательно.** Выгрузки — сегментные
  срезы с неравномерным охватом; без него отчёт создаёт ложное впечатление
  полноты.

## Тесты

```sh
python3 -m pytest tools/audit/tests -v
```
```

- [ ] **Step 8: Обновить `CLAUDE.md`**

В таблицу «Repository layout» после строки `tools/data-export/` добавить:

```markdown
| `tools/audit/` | Сверка тегов: реестр GetCourse ↔ выгрузки ↔ БД. Только чтение, выход — XLSX в `data/generated/`. См. [tools/audit/README.md](tools/audit/README.md). |
```

В раздел «Data tools» после абзаца про экспорт добавить:

```markdown
- **Audit** (`tools/audit/`): `run_audit.py` строит карту расхождений тегов
  воронок по трём источникам. База открывается только на чтение; ключи
  GetCourse читаются из окружения (`GC_DEV_KEY`, `GC_API_KEY`, `GC_DOMAIN`)
  и в репозиторий не попадают. Тесты: `python3 -m pytest tools/audit/tests`.
```

- [ ] **Step 9: Коммит**

```bash
git add tools/audit/run_audit.py tools/audit/README.md tools/audit/tests/test_run_audit.py CLAUDE.md
git commit -m "feat(audit): CLI карты расхождений и документация"
```

---

## Проверка после реализации

- [ ] `python3 -m pytest tools/audit/tests -v` — всё зелёное
- [ ] `python3 tools/audit/run_audit.py --no-api` отрабатывает без сети
- [ ] Полный прогон с ключами даёт непустые классы 9 и 11
- [ ] `sqlite3 ksamata_funnels.db "select count(*) from monitor_targets;"` → `0`
- [ ] `git status --porcelain` не показывает `ksamata_funnels.db`
- [ ] В репозиторий не попали ключи, выгрузки, снимок API и отчёт
