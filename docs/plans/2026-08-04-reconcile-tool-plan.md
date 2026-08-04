# Инструмент сверки `tools/reconcile/` — план реализации

> **Для агентов:** ОБЯЗАТЕЛЬНЫЙ СУБ-СКИЛЛ: `superpowers:subagent-driven-development`
> или `superpowers:executing-plans`. Шаги отмечаются чекбоксами.

**Цель:** одна команда собирает четыре источника и выдаёт markdown-отчёт,
разделы которого соответствуют этапам разбора.

**Дизайн:** [2026-08-04-razbor-design.md](2026-08-04-razbor-design.md)

**Архитектура:** плоские модули в `tools/reconcile/`, как в `tools/audit`.
Разбор АВ-таксономии **переиспользуется** из `tools/audit/normalize.py`
(`av_key`, `parse_tagset`, `is_complete_key`, `key_label`, `quad`) — он уже
написан, покрыт тестами и знает про четыре взаимоисключающих маркера типа.
Новое здесь только то, чего в `audit` нет: таблица маркетологов, поиск
ближайшей воронки, файл решений и отчёт по этапам.

**Стек:** Python 3, `openpyxl`, `PyYAML`, `pytest` — всё уже установлено.

## Глобальные ограничения

- **База открывается только на чтение** (`sqlite3.connect(f'file:{p}?mode=ro', uri=True)`).
  Инструмент ничего не чинит — ни базу, ни ГК, ни ЛИК.
- Пути резолвятся от корня репозитория через `paths.py`, а не от `cwd`.
- Плоские импорты; `conftest.py` кладёт каталог в `sys.path` (копия
  `tools/audit/conftest.py`).
- Комментарии и docstring — по-русски, как во всём `tools/`.
- Тесты: `python3 -m pytest tools/reconcile/tests`.
- **Не менять ничего в `tools/audit/`.** Только импортировать.

## Карта файлов

| Файл | Ответственность |
|---|---|
| `paths.py` | пути, пороги (`LIVE_SINCE_DAYS`, `SNAPSHOT_MAX_AGE_HOURS`) |
| `combo.py` | связка: обёртка над `av_key` + детектор конфликтов осей |
| `orders_source.py` | выгрузка заказов → статистика по связкам |
| `urls.py` | порт правил `monitor-urls.ts`: расщепление и нормализация URL |
| `sheet_source.py` | таблица маркетологов → строки |
| `db_source.py` | база → воронки со связками и лендингами |
| `matching.py` | сопоставление: ближайшая воронка, лендинг в две ступени |
| `decisions.py` | `decisions.yaml` — загрузка и применение |
| `sections.py` | сборка разделов отчёта |
| `report_md.py` | рендер markdown |
| `run.py` | CLI |

---

### Task 1: `paths.py` и `combo.py`

**Files:**
- Create: `tools/reconcile/paths.py`, `tools/reconcile/combo.py`,
  `tools/reconcile/conftest.py`
- Test: `tools/reconcile/tests/test_combo.py`

**Interfaces:**
- Consumes: `tools/audit/normalize.py` — `AXES`, `av_key`, `is_complete_key`,
  `key_label`, `normalize_tag`, `parse_tagset`, `MARKER_TAGS`
- Produces: `combo.key_of(tags) -> tuple`, `combo.axis_conflicts(tags) -> dict`,
  `combo.is_complete(key) -> bool`, `combo.label(key) -> str`,
  `paths.DB_PATH`, `paths.LIVE_SINCE_DAYS`, `paths.SNAPSHOT_MAX_AGE_HOURS`

- [ ] **Шаг 1: написать падающий тест**

```python
# tools/reconcile/tests/test_combo.py
import combo


def test_key_of_собирает_пятёрку_в_порядке_осей():
    tags = frozenset({
        'АВ Продукт: ДБО', 'АВ Подрядчик: NR',
        'АВ Канал: ВК', 'АВ Направление: In Stream',
        'АВ Автоворонка', 'АВ Этап: Регистрация',
    })
    assert combo.key_of(tags) == ('ДБО', 'NR', 'ВК', 'In Stream', 'АВ Автоворонка')
    assert combo.is_complete(combo.key_of(tags))


def test_key_of_ставит_none_на_отсутствующую_ось():
    tags = frozenset({'АВ Продукт: БОО', 'АВ Канал: Сайт',
                      'АВ Направление: СЕО', 'АВ Подрядчик: НИМБ'})
    key = combo.key_of(tags)
    assert key[4] is None            # маркер типа не проставлен
    assert not combo.is_complete(key)


def test_axis_conflicts_ловит_задвоенную_ось():
    """f55: у заказа сразу РСЯ и Реклама. av_value молча берёт меньшее,
    поэтому конфликт обязан ловиться отдельно — иначе он невидим."""
    tags = frozenset({
        'АВ Продукт: ЖИВО-суставы-триал', 'АВ Подрядчик: ИНХАУЗ',
        'АВ Канал: Яндекс', 'АВ Направление: РСЯ', 'АВ Направление: Реклама',
        'АВ Прямые',
    })
    assert combo.axis_conflicts(tags) == {'АВ Направление': ['РСЯ', 'Реклама']}


def test_axis_conflicts_пуст_когда_конфликтов_нет():
    tags = frozenset({'АВ Продукт: ДБО', 'АВ Канал: ВК'})
    assert combo.axis_conflicts(tags) == {}


def test_axis_conflicts_ловит_два_маркера_типа():
    tags = frozenset({'АВ Автоворонка', 'АВ Прямые'})
    assert combo.axis_conflicts(tags) == {'тип воронки': ['АВ Автоворонка', 'АВ Прямые']}


def test_label_помечает_пропуски_тире():
    assert combo.label(('ДБО', None, 'ВК', 'In Stream', 'АВ Автоворонка')) == \
        'ДБО / — / ВК / In Stream / АВ Автоворонка'
```

- [ ] **Шаг 2: убедиться, что тест падает**

Run: `python3 -m pytest tools/reconcile/tests/test_combo.py -v`
Ожидается: FAIL — `ModuleNotFoundError: No module named 'combo'`

- [ ] **Шаг 3: реализовать**

```python
# tools/reconcile/conftest.py
"""Кладёт tools/reconcile и tools/audit в sys.path — плоские импорты."""

import os
import sys

BASE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, BASE)
sys.path.insert(0, os.path.abspath(os.path.join(BASE, '..', 'audit')))
```

```python
# tools/reconcile/paths.py
#!/usr/bin/env python3
"""Пути и пороги. Всё резолвится от корня репозитория, а не от cwd."""

import os

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT_DIR = os.path.abspath(os.path.join(BASE_DIR, '..', '..'))
AUDIT_DIR = os.path.join(ROOT_DIR, 'tools', 'audit')

DB_PATH = os.path.join(ROOT_DIR, 'ksamata_funnels.db')
OUT_DIR = os.path.join(ROOT_DIR, 'data', 'generated')
DOWNLOADS_DIR = os.path.expanduser('~/Downloads')

DECISIONS_PATH = os.path.join(BASE_DIR, 'decisions.yaml')

# Связка считается живой, если по ней есть заказ за последние N дней.
# Порог выбран на этапе 1 и здесь его менять — решение, а не настройка.
LIVE_SINCE_DAYS = 30

# Снимок ЛИК старше суток использовать нельзя: правило «копию не кладём»
# соблюдается тем, что устаревший снимок не может быть применён молча.
SNAPSHOT_MAX_AGE_HOURS = 24
```

```python
# tools/reconcile/combo.py
#!/usr/bin/env python3
"""Связка воронки — общий язык всех источников.

Пятёрка (Продукт / Подрядчик / Канал / Направление / маркер типа) лежит
и в «Тегах предложений» заказа, и в funnel_tags базы. Разбор берётся из
tools/audit/normalize.py — он уже покрыт тестами и знает про четыре
взаимоисключающих маркера.

Здесь добавлено ровно одно, чего в audit нет: детектор КОНФЛИКТОВ осей.
normalize.av_value при нескольких значениях одной оси молча берёт
лексикографически меньшее, поэтому задвоенная ось (реальный случай f55:
одновременно «РСЯ» и «Реклама») через него не видна вообще. Для трека
разметки это отдельный класс находок, и терять его нельзя.
"""

import sys
import os

sys.path.insert(0, os.path.abspath(
    os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'audit')))

from normalize import (  # noqa: E402
    AXES, MARKER_TAGS, av_key, is_complete_key, key_label, normalize_tag,
    parse_tagset,
)

__all__ = ['key_of', 'is_complete', 'label', 'axis_conflicts', 'parse_tagset',
           'AXES']


def key_of(tags):
    """Связка из набора тегов. Отсутствующая часть даёт None."""
    return av_key(tags)


def is_complete(key):
    """Все четыре оси И маркер типа на месте."""
    return is_complete_key(key)


def label(key):
    """Читаемая форма; пропуски помечаются тире."""
    return key_label(key)


def axis_conflicts(tags):
    """Оси, у которых в наборе больше одного значения.

    Возвращает {ось: [значения...]} — отсортировано, чтобы результат не
    зависел от порядка обхода frozenset. Пустой словарь означает «конфликтов
    нет», а не «осей нет».
    """
    conflicts = {}
    for axis in AXES:
        prefix = axis + ':'
        values = sorted({
            normalize_tag(tag[len(prefix):])
            for tag in tags
            if tag.startswith(prefix) and normalize_tag(tag[len(prefix):])
        })
        if len(values) > 1:
            conflicts[axis] = values

    markers = sorted(MARKER_TAGS & {normalize_tag(t) for t in tags})
    if len(markers) > 1:
        conflicts['тип воронки'] = markers
    return conflicts
```

- [ ] **Шаг 4: убедиться, что тесты проходят**

Run: `python3 -m pytest tools/reconcile/tests/test_combo.py -v`
Ожидается: 6 passed

- [ ] **Шаг 5: коммит**

```bash
git add tools/reconcile/paths.py tools/reconcile/combo.py tools/reconcile/conftest.py tools/reconcile/tests/test_combo.py
git commit -m "feat(reconcile): связка воронки и детектор конфликтов осей"
```

---

### Task 2: `orders_source.py` — заказы → статистика по связкам

**Files:**
- Create: `tools/reconcile/orders_source.py`
- Test: `tools/reconcile/tests/test_orders_source.py`

**Interfaces:**
- Consumes: `combo.key_of`, `combo.parse_tagset`, `combo.axis_conflicts`
- Produces: `orders_source.ComboStat` (поля `key`, `orders`, `paid`,
  `last_created`, `conflicts`), `orders_source.load_combos(path) -> dict`,
  `orders_source.newest_export(directory) -> str`

Читается **одна свежая выгрузка**, а не история: вопрос этапа 1 — «что живо
сейчас», и для него хватает последнего среза. Это отличает инструмент от
`tools/audit`, которому история нужна по существу (класс 15 — дрейф).

- [ ] **Шаг 1: написать падающий тест**

```python
# tools/reconcile/tests/test_orders_source.py
import openpyxl
import pytest

import orders_source


@pytest.fixture
def export_file(tmp_path):
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.append(['ID заказа', 'Дата создания', 'Оплачен', 'Теги предложений'])
    ws.append(['1', '2026-07-30 10:00:00', 'Да',
               'АВ Автоворонка|АВ Продукт: ДБО|АВ Подрядчик: NR|'
               'АВ Канал: ВК|АВ Направление: In Stream|АВ Этап: Регистрация'])
    ws.append(['2', '2026-07-31 10:00:00', 'Нет',
               'АВ Автоворонка|АВ Продукт: ДБО|АВ Подрядчик: NR|'
               'АВ Канал: ВК|АВ Направление: In Stream'])
    ws.append(['3', '2026-07-15 10:00:00', 'Да', ''])          # без осей вовсе
    ws.append(['4', '2026-07-20 10:00:00', 'Да',
               'АВ Продукт: БОО|АВ Канал: Сайт'])              # дырка
    path = tmp_path / 'deal_export_2026-08-01_00-00-00.xlsx'
    wb.save(path)
    return str(path)


def test_load_combos_сворачивает_заказы_в_связки(export_file):
    combos, blind = orders_source.load_combos(export_file)
    key = ('ДБО', 'NR', 'ВК', 'In Stream', 'АВ Автоворонка')
    assert combos[key].orders == 2
    assert combos[key].paid == 1
    assert combos[key].last_created == '2026-07-31 10:00:00'


def test_load_combos_считает_заказы_без_осей_отдельно(export_file):
    """21% заказов не несут осей вовсе — это слепая зона, а не связка."""
    _, blind = orders_source.load_combos(export_file)
    assert blind == {'orders': 1, 'paid': 1}


def test_load_combos_сохраняет_неполные_связки(export_file):
    """Дырка разметки — находка трека Р, а не мусор: её нельзя отбрасывать."""
    combos, _ = orders_source.load_combos(export_file)
    holes = [k for k in combos if not all(p is not None for p in k)]
    assert ('БОО', None, 'Сайт', None, None) in holes


def test_newest_export_берёт_самый_свежий(tmp_path):
    for name in ('deal_export_2026-07-01_00-00-00.xlsx',
                 'deal_export_2026-08-01_00-00-00.xlsx'):
        (tmp_path / name).write_bytes(b'')
    assert orders_source.newest_export(str(tmp_path)).endswith(
        'deal_export_2026-08-01_00-00-00.xlsx')


def test_newest_export_падает_когда_выгрузок_нет(tmp_path):
    with pytest.raises(FileNotFoundError):
        orders_source.newest_export(str(tmp_path))
```

- [ ] **Шаг 2: убедиться, что тест падает**

Run: `python3 -m pytest tools/reconcile/tests/test_orders_source.py -v`
Ожидается: FAIL — `ModuleNotFoundError: No module named 'orders_source'`

- [ ] **Шаг 3: реализовать**

```python
# tools/reconcile/orders_source.py
#!/usr/bin/env python3
"""Выгрузка заказов GetCourse → статистика по связкам.

Заказы — источник ПОЛНОТЫ: живая связка без воронки в базе означает, что
воронки не хватает (или что предложение размечено неверно — это решает
matching, а не этот модуль).

Читается ОДНА свежая выгрузка. История здесь не нужна: вопрос «что живо
сейчас» отвечается последним срезом, а чтение истории занимает минуты.
"""

import glob
import os
from collections import defaultdict
from dataclasses import dataclass, field

import openpyxl

import combo

TAGS_COLUMN = 'Теги предложений'
CREATED_COLUMN = 'Дата создания'
PAID_COLUMN = 'Оплачен'
PAID_YES = 'Да'


@dataclass
class ComboStat:
    key: tuple
    orders: int = 0
    paid: int = 0
    last_created: str = ''
    conflicts: dict = field(default_factory=dict)


def newest_export(directory):
    """Самая свежая выгрузка deal_export_* по имени файла.

    Имя несёт дату в сортируемом виде (deal_export_ГГГГ-ММ-ДД_ЧЧ-ММ-СС),
    поэтому сортировка строкой корректна и не зависит от mtime, который
    сбивается копированием.
    """
    found = sorted(glob.glob(os.path.join(directory, 'deal_export_*.xlsx')))
    if not found:
        raise FileNotFoundError(
            f'В {directory} нет ни одной выгрузки deal_export_*.xlsx')
    return found[-1]


def load_combos(path):
    """(связка -> ComboStat, слепая зона).

    Слепая зона — заказы, не несущие НИ ОДНОЙ оси. Их нельзя приписать
    никакой воронке, и их размер (21% на замере 04.08) — самостоятельная
    величина отчёта, а не погрешность.
    """
    workbook = openpyxl.load_workbook(path, read_only=True, data_only=True)
    sheet = workbook.worksheets[0]
    rows = sheet.iter_rows(values_only=True)
    header = list(next(rows))

    idx_tags = header.index(TAGS_COLUMN)
    idx_created = header.index(CREATED_COLUMN)
    idx_paid = header.index(PAID_COLUMN)

    stats = {}
    blind = {'orders': 0, 'paid': 0}

    for row in rows:
        tags = combo.parse_tagset(row[idx_tags])
        key = combo.key_of(tags)
        is_paid = str(row[idx_paid] or '').strip() == PAID_YES

        if all(part is None for part in key):
            blind['orders'] += 1
            blind['paid'] += int(is_paid)
            continue

        stat = stats.get(key)
        if stat is None:
            stat = stats[key] = ComboStat(key=key)
        stat.orders += 1
        stat.paid += int(is_paid)
        created = str(row[idx_created] or '').strip()
        if created > stat.last_created:
            stat.last_created = created
        stat.conflicts.update(combo.axis_conflicts(tags))

    workbook.close()
    return stats, blind
```

- [ ] **Шаг 4: убедиться, что тесты проходят**

Run: `python3 -m pytest tools/reconcile/tests/test_orders_source.py -v`
Ожидается: 5 passed

- [ ] **Шаг 5: коммит**

```bash
git add tools/reconcile/orders_source.py tools/reconcile/tests/test_orders_source.py
git commit -m "feat(reconcile): чтение выгрузки заказов в статистику по связкам"
```

---

### Task 3: `urls.py` — расщепление и нормализация адресов

**Files:**
- Create: `tools/reconcile/urls.py`
- Test: `tools/reconcile/tests/test_urls.py`

**Interfaces:**
- Produces: `urls.split_field(cell) -> list[str]`

**Это порт правил из [app/src/lib/monitor-urls.ts](../../app/src/lib/monitor-urls.ts)**
на Python, а не новая логика. Обе стороны сверки кладут по несколько адресов
в одну ячейку; односторонняя нормализация даёт ложные пропажи — проверено
04.08, когда `f56` и `f84` были ошибочно сочтены отсутствующими.

- [ ] **Шаг 1: написать падающий тест**

```python
# tools/reconcile/tests/test_urls.py
import urls


def test_split_field_разбирает_несколько_адресов_в_ячейке():
    cell = ('https://t.zdravo-telo.ru/rsy/jivo/trial/inhouse/a / '
            'https://gc.zdravo-telo.ru/jivo/sust/inhouse/a')
    assert urls.split_field(cell) == [
        't.zdravo-telo.ru/rsy/jivo/trial/inhouse/a',
        'gc.zdravo-telo.ru/jivo/sust/inhouse/a',
    ]


def test_split_field_срезает_схему_и_хвостовой_слеш():
    assert urls.split_field('https://t.ksamata.ru/nr/boo/a/') == [
        't.ksamata.ru/nr/boo/a']


def test_split_field_отбрасывает_пометки_маркетолога():
    """В таблице встречается «…/a (LP518)» — скобка не часть адреса."""
    assert urls.split_field('https://t.ksamata.ru/jivo/nr/a (LP518)') == [
        't.ksamata.ru/jivo/nr/a']


def test_split_field_игнорирует_текст_без_точки():
    """Класс B из url-field.ts: заметки вроде «сайты» адресами не являются."""
    assert urls.split_field('сайты, геткурс') == []


def test_split_field_на_пустой_ячейке_даёт_пустой_список():
    assert urls.split_field(None) == []
    assert urls.split_field('') == []


def test_split_field_приводит_регистр_к_нижнему():
    assert urls.split_field('HTTPS://T.Ksamata.RU/NR/BOO/A') == [
        't.ksamata.ru/nr/boo/a']
```

- [ ] **Шаг 2: убедиться, что тест падает**

Run: `python3 -m pytest tools/reconcile/tests/test_urls.py -v`
Ожидается: FAIL — `ModuleNotFoundError: No module named 'urls'`

- [ ] **Шаг 3: реализовать**

```python
# tools/reconcile/urls.py
#!/usr/bin/env python3
"""Расщепление и нормализация адресов — порт правил monitor-urls.ts.

Оригинал: app/src/lib/monitor-urls.ts (splitUrlField + normalizeUrl).
Правило одно и то же обязано применяться к ОБЕИМ сторонам сверки: и таблица
маркетологов, и база кладут по несколько адресов в одну ячейку, и
односторонняя нормализация даёт ложные пропажи.

Форма нормализованного адреса — «хост/путь» без схемы и хвостового слеша.
Этого достаточно для сопоставления; проверять живость адреса здесь нечем и
не нужно — этим занимается мониторинг приложения.
"""

import re

_SEPARATORS = re.compile(r'[\s,;\n]+')
_SCHEME = re.compile(r'^https?://', re.IGNORECASE)


def split_field(cell):
    """Ячейка с одним или несколькими адресами -> список нормализованных.

    Отбрасывается всё, что адресом не является: пометки маркетолога в
    скобках, отдельные слова без точки в хосте.
    """
    if cell is None:
        return []

    result = []
    for part in _SEPARATORS.split(str(cell)):
        candidate = part.strip().strip('()').lower()
        candidate = _SCHEME.sub('', candidate).rstrip('/')
        if not candidate:
            continue
        host = candidate.split('/', 1)[0]
        if '.' not in host:
            continue
        if candidate not in result:
            result.append(candidate)
    return result
```

- [ ] **Шаг 4: убедиться, что тесты проходят**

Run: `python3 -m pytest tools/reconcile/tests/test_urls.py -v`
Ожидается: 6 passed

- [ ] **Шаг 5: коммит**

```bash
git add tools/reconcile/urls.py tools/reconcile/tests/test_urls.py
git commit -m "feat(reconcile): порт нормализации URL из monitor-urls.ts"
```

---

### Task 4: `sheet_source.py` — таблица маркетологов

**Files:**
- Create: `tools/reconcile/sheet_source.py`
- Test: `tools/reconcile/tests/test_sheet_source.py`

**Interfaces:**
- Consumes: `urls.split_field`
- Produces: `sheet_source.SheetRow` (поля `front_code`, `contractor`,
  `funnel`, `status`, `landings`, `row_num`), `sheet_source.load_rows(path) -> list`,
  `sheet_source.WORKING_SHEET`

Из таблицы берутся **только** живость и лендинги. Комнаты и дашборды не
читаются вовсе: таблица копирует мёртвую колонку `room_id_f1`, и при
расхождении по комнатам правится таблица, а не база (CLAUDE.md).

- [ ] **Шаг 1: написать падающий тест**

```python
# tools/reconcile/tests/test_sheet_source.py
import openpyxl
import pytest

import sheet_source


@pytest.fixture
def sheet_file(tmp_path):
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = 'Рабочие'
    ws.append([]); ws.append([])                       # строки 1-2 пустые
    ws.append(['КОД F№', 'Порядчик', 'Воронка', 'Статус воронки',
               'ДАТА СТАРТА', 'Посадочная '])          # строка 3 — шапка
    ws.append([])                                      # строка 4 — вторая шапка
    ws.append(['F37', 'Ютуб органика', 'БОО', 'Работает', None,
               'https://t.ksamata.ru/boo/a'])
    ws.append([None, 'ВК NR', 'ЖИВО Суставы 490р', 'Работает', None,
               'https://t.ksamata.ru/jivo/trial/nr/a'])
    ws.append([None, None, None, None, None, None])    # пустая строка
    path = tmp_path / 'Ссылки.xlsx'
    wb.save(path)
    return str(path)


def test_load_rows_пропускает_шапку_и_пустые(sheet_file):
    rows = sheet_source.load_rows(sheet_file)
    assert len(rows) == 2


def test_load_rows_нормализует_код_в_нижний_регистр(sheet_file):
    """SQLite сравнивает TEXT побайтово: F37 и f37 разошлись бы как разные."""
    assert sheet_source.load_rows(sheet_file)[0].front_code == 'f37'


def test_load_rows_допускает_пустой_код(sheet_file):
    """Половина строк таблицы без кода — это норма, а не брак."""
    assert sheet_source.load_rows(sheet_file)[1].front_code == ''


def test_load_rows_расщепляет_лендинги(sheet_file):
    assert sheet_source.load_rows(sheet_file)[0].landings == [
        't.ksamata.ru/boo/a']


def test_is_live_различает_работает_и_стоп():
    assert sheet_source.is_live('Работает')
    assert not sheet_source.is_live('Стоп')
    assert not sheet_source.is_live('')
```

- [ ] **Шаг 2: убедиться, что тест падает**

Run: `python3 -m pytest tools/reconcile/tests/test_sheet_source.py -v`
Ожидается: FAIL — `ModuleNotFoundError: No module named 'sheet_source'`

- [ ] **Шаг 3: реализовать**

```python
# tools/reconcile/sheet_source.py
#!/usr/bin/env python3
"""Таблица маркетологов «Ссылки для сбора статы» → строки.

Роль таблицы — ПОДТВЕРЖДЕНИЕ: она отвечает на «какие воронки ещё живы» и
«какие у них лендинги». Больше ничего отсюда не берётся.

Комнаты и дашборды не читаются сознательно: таблица копирует мёртвую
колонку room_id_f1, и при расхождении по комнатам правится таблица, а не
база (CLAUDE.md). Добавлять их сюда — значит заводить сверку, у которой
заведомо неверный эталон.
"""

from dataclasses import dataclass

import openpyxl

import urls

WORKING_SHEET = 'Рабочие'
HEADER_ROW = 3
FIRST_DATA_ROW = 5

COL_CODE = 0
COL_CONTRACTOR = 1
COL_FUNNEL = 2
COL_STATUS = 3
COL_LANDING = 5

LIVE_STATUS = 'Работает'


@dataclass(frozen=True)
class SheetRow:
    row_num: int
    front_code: str
    contractor: str
    funnel: str
    status: str
    landings: tuple


def is_live(status):
    """«Работает» против «Стоп». Пустой статус живым не считается."""
    return str(status or '').strip() == LIVE_STATUS


def _text(value):
    return str(value).strip() if value is not None else ''


def load_rows(path, sheet_name=WORKING_SHEET):
    workbook = openpyxl.load_workbook(path, read_only=True, data_only=True)
    sheet = workbook[sheet_name]

    rows = []
    for number, raw in enumerate(sheet.iter_rows(values_only=True), start=1):
        if number < FIRST_DATA_ROW:
            continue
        if not any(cell not in (None, '') for cell in raw):
            continue
        padded = list(raw) + [None] * (COL_LANDING + 1 - len(raw))
        rows.append(SheetRow(
            row_num=number,
            front_code=_text(padded[COL_CODE]).lower(),
            contractor=_text(padded[COL_CONTRACTOR]),
            funnel=_text(padded[COL_FUNNEL]),
            status=_text(padded[COL_STATUS]),
            landings=tuple(urls.split_field(padded[COL_LANDING])),
        ))
    workbook.close()
    return rows
```

- [ ] **Шаг 4: убедиться, что тесты проходят**

Run: `python3 -m pytest tools/reconcile/tests/test_sheet_source.py -v`
Ожидается: 5 passed

- [ ] **Шаг 5: коммит**

```bash
git add tools/reconcile/sheet_source.py tools/reconcile/tests/test_sheet_source.py
git commit -m "feat(reconcile): чтение таблицы маркетологов"
```

---

### Task 5: `db_source.py` — база → воронки со связками и лендингами

**Files:**
- Create: `tools/reconcile/db_source.py`
- Test: `tools/reconcile/tests/test_db_source.py`

**Interfaces:**
- Consumes: `combo.key_of`, `urls.split_field`
- Produces: `db_source.Funnel` (поля `funnel_id`, `front_code`, `status`,
  `label`, `key`, `landings`, `contractor`, `product`),
  `db_source.load_funnels(db_path) -> list[Funnel]`

Лендинги собираются из **двух** мест: `funnels.landing_url` и блока
`landings` — иначе вторые адреса воронки теряются.

- [ ] **Шаг 1: написать падающий тест**

```python
# tools/reconcile/tests/test_db_source.py
import sqlite3

import pytest

import db_source


@pytest.fixture
def db(tmp_path):
    path = tmp_path / 'test.db'
    con = sqlite3.connect(path)
    con.executescript("""
        CREATE TABLE funnels (id INTEGER PRIMARY KEY, num INTEGER,
            front_code TEXT, status TEXT, landing_url TEXT,
            source_id INT, product_id INT, contractor_id INT);
        CREATE TABLE tags (id INTEGER PRIMARY KEY, name TEXT);
        CREATE TABLE funnel_tags (funnel_id INT, tag_id INT, tag_type TEXT,
            position INT);
        CREATE TABLE funnel_blocks (id INTEGER PRIMARY KEY, funnel_id INT,
            kind TEXT);
        CREATE TABLE funnel_block_items (id INTEGER PRIMARY KEY, block_id INT,
            url TEXT);
        CREATE TABLE sources (id INTEGER PRIMARY KEY, name TEXT);
        CREATE TABLE products (id INTEGER PRIMARY KEY, name TEXT);
        CREATE TABLE contractors (id INTEGER PRIMARY KEY, name TEXT);

        INSERT INTO contractors VALUES (1, 'ИНХАУЗ');
        INSERT INTO products VALUES (1, 'ЖИВО-суставы');
        INSERT INTO sources VALUES (1, 'Яндекс РСЯ');
        INSERT INTO funnels VALUES (1, 56, 'f56', 'active',
            'https://t.zdravo-telo.ru/a / https://gc.zdravo-telo.ru/b',
            1, 1, 1);
        INSERT INTO tags VALUES (1, 'АВ Продукт: ЖИВО-суставы'),
            (2, 'АВ Подрядчик: ИНХАУЗ'), (3, 'АВ Канал: Яндекс'),
            (4, 'АВ Направление: РСЯ'), (5, 'АВ Прямые');
        INSERT INTO funnel_tags VALUES (1,1,'reg',0), (1,2,'reg',1),
            (1,3,'reg',2), (1,4,'reg',3), (1,5,'reg',4);
        INSERT INTO funnel_blocks VALUES (1, 1, 'landings');
        INSERT INTO funnel_block_items VALUES (1, 1, 'https://land.ksamata.ru/c');
    """)
    con.commit()
    con.close()
    return str(path)


def test_load_funnels_собирает_связку_из_funnel_tags(db):
    funnel = db_source.load_funnels(db)[0]
    assert funnel.key == ('ЖИВО-суставы', 'ИНХАУЗ', 'Яндекс', 'РСЯ', 'АВ Прямые')


def test_load_funnels_берёт_лендинги_из_обоих_мест(db):
    """Второй адрес живёт в блоке landings — терять его нельзя."""
    assert set(db_source.load_funnels(db)[0].landings) == {
        't.zdravo-telo.ru/a', 'gc.zdravo-telo.ru/b', 'land.ksamata.ru/c'}


def test_load_funnels_метка_по_коду_а_не_по_num(db):
    """num человеку не показывают никогда (CLAUDE.md)."""
    assert db_source.load_funnels(db)[0].label == 'f56'


def test_load_funnels_метка_падает_на_id_без_кода(tmp_path):
    path = tmp_path / 'x.db'
    con = sqlite3.connect(path)
    con.executescript("""
        CREATE TABLE funnels (id INTEGER PRIMARY KEY, num INTEGER,
            front_code TEXT, status TEXT, landing_url TEXT,
            source_id INT, product_id INT, contractor_id INT);
        CREATE TABLE tags (id INTEGER PRIMARY KEY, name TEXT);
        CREATE TABLE funnel_tags (funnel_id INT, tag_id INT, tag_type TEXT,
            position INT);
        CREATE TABLE funnel_blocks (id INTEGER PRIMARY KEY, funnel_id INT,
            kind TEXT);
        CREATE TABLE funnel_block_items (id INTEGER PRIMARY KEY, block_id INT,
            url TEXT);
        CREATE TABLE sources (id INTEGER PRIMARY KEY, name TEXT);
        CREATE TABLE products (id INTEGER PRIMARY KEY, name TEXT);
        CREATE TABLE contractors (id INTEGER PRIMARY KEY, name TEXT);
        INSERT INTO funnels VALUES (7, 7, '', 'draft', '', NULL, NULL, NULL);
    """)
    con.commit()
    con.close()
    assert db_source.load_funnels(str(path))[0].label == '#7'


def test_load_funnels_открывает_базу_только_на_чтение(db):
    """Инструмент ничего не чинит: запись должна быть невозможна физически."""
    con = db_source.connect(db)
    with pytest.raises(sqlite3.OperationalError):
        con.execute("UPDATE funnels SET status='archive'")
    con.close()
```

- [ ] **Шаг 2: убедиться, что тест падает**

Run: `python3 -m pytest tools/reconcile/tests/test_db_source.py -v`
Ожидается: FAIL — `ModuleNotFoundError: No module named 'db_source'`

Внимание: модуль с таким же именем есть в `tools/audit`, и `conftest.py`
кладёт оба каталога в `sys.path`. Наш каталог вставляется **последним**
(`sys.path.insert(0, BASE)` идёт после вставки audit), поэтому выигрывает
наш. Тест `test_load_funnels_берёт_лендинги_из_обоих_мест` упадёт, если
разрешится чужой модуль — у audit-версии нет поля `landings`.

- [ ] **Шаг 3: реализовать**

```python
# tools/reconcile/db_source.py
#!/usr/bin/env python3
"""База → воронки со связками и лендингами. Только чтение.

Связка берётся из funnel_tags — материализованного результата «шаблон +
оверрайды», а не из raw-строк *_raw: те импортно-экспортные артефакты и
источником истины не являются.

Лендинги собираются из ДВУХ мест: funnels.landing_url и блока landings.
Воронка нередко держит второй адрес только в блоке (f84), и чтение одного
поля даёт ложные пропажи.
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


def connect(db_path):
    """Только чтение. Запись в живую базу запрещена дизайном."""
    return sqlite3.connect(f'file:{db_path}?mode=ro', uri=True)


def load_funnels(db_path):
    con = connect(db_path)
    try:
        base = con.execute("""
            SELECT f.id, COALESCE(f.front_code, ''), COALESCE(f.status, ''),
                   COALESCE(f.landing_url, ''),
                   COALESCE(c.name, ''), COALESCE(p.name, '')
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
    for funnel_id, code, status, landing_url, contractor, product in base:
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
        ))
    return result
```

- [ ] **Шаг 4: убедиться, что тесты проходят**

Run: `python3 -m pytest tools/reconcile/tests/test_db_source.py -v`
Ожидается: 5 passed

- [ ] **Шаг 5: коммит**

```bash
git add tools/reconcile/db_source.py tools/reconcile/tests/test_db_source.py
git commit -m "feat(reconcile): чтение воронок базы со связками и лендингами"
```

---

### Task 6: `matching.py` — ближайшая воронка и лендинг в две ступени

**Files:**
- Create: `tools/reconcile/matching.py`
- Test: `tools/reconcile/tests/test_matching.py`

**Interfaces:**
- Consumes: `db_source.Funnel`, `sheet_source.SheetRow`
- Produces: `matching.nearest(key, funnels) -> Near | None`,
  `matching.Near` (поля `funnel`, `distance`, `diff`),
  `matching.match_sheet_row(row, funnels) -> SheetMatch`,
  `matching.SheetMatch` (поля `funnel`, `tier`) где `tier` ∈
  `'landing' | 'contractor_product' | None`

**Это сердце инструмента.** Без поиска ближайшей воронки семь ошибок
разметки из десяти читаются как недостающие воронки — ровно та ловушка,
в которую легко попасть (замер 04.08).

- [ ] **Шаг 1: написать падающий тест**

```python
# tools/reconcile/tests/test_matching.py
import db_source
import matching
import sheet_source


def make_funnel(label, key, landings=(), contractor='', product='',
                status='active'):
    return db_source.Funnel(
        funnel_id=hash(label) % 1000, front_code=label, status=status,
        label=label, key=key, landings=tuple(landings),
        contractor=contractor, product=product)


F69 = make_funnel('f69', ('БОО', 'НИМБ', 'Сайт', 'СЕО', 'АВ Автоворонка'))
F8 = make_funnel('f8', ('ЖКТ', 'НИМБ', 'Яндекс', 'РСЯ', 'АВ Автоворонка'))
FUNNELS = [F69, F8]


def test_nearest_находит_воронку_без_маркера_типа():
    """454 заказа «Сайт / СЕО / НИМБ / БОО» — это f69 без типа в разметке."""
    near = matching.nearest(('БОО', 'НИМБ', 'Сайт', 'СЕО', None), FUNNELS)
    assert near.funnel is F69
    assert near.distance == 1
    assert near.diff == [('тип воронки', None, 'АВ Автоворонка')]


def test_nearest_находит_воронку_с_чужим_маркером():
    """24 заказа с «АВ Прямые» — это f8, размеченная как автоворонка."""
    near = matching.nearest(('ЖКТ', 'НИМБ', 'Яндекс', 'РСЯ', 'АВ Прямые'),
                            FUNNELS)
    assert near.funnel is F8
    assert near.distance == 1


def test_nearest_молчит_когда_похожего_нет():
    """RedBananas на канале ТГ — действительно новая воронка."""
    key = ('ДБО', 'RedBananas', 'ТГ', 'Реклама', 'АВ Автоворонка')
    assert matching.nearest(key, FUNNELS) is None


def test_nearest_возвращает_точное_совпадение_с_расстоянием_ноль():
    near = matching.nearest(F8.key, FUNNELS)
    assert near.funnel is F8 and near.distance == 0


def test_match_sheet_row_первая_ступень_лендинг():
    funnel = make_funnel('f37', ('БОО', 'НИМБ', 'Ютуб', 'Органика', None),
                         landings=['t.ksamata.ru/boo/a'])
    row = sheet_source.SheetRow(5, '', 'Ютуб органика', 'БОО', 'Работает',
                                ('t.ksamata.ru/boo/a',))
    result = matching.match_sheet_row(row, [funnel])
    assert result.funnel is funnel and result.tier == 'landing'


def test_match_sheet_row_вторая_ступень_подрядчик_и_продукт():
    """Совпадение по второй ступени — САМО ПО СЕБЕ находка: лендинг разошёлся."""
    funnel = make_funnel('f37', ('БОО', 'НИМБ', 'Ютуб', 'Органика', None),
                         landings=['t.ksamata.ru/old'],
                         contractor='Ютуб органика', product='БОО')
    row = sheet_source.SheetRow(5, '', 'Ютуб органика', 'БОО', 'Работает',
                                ('t.ksamata.ru/new',))
    result = matching.match_sheet_row(row, [funnel])
    assert result.funnel is funnel and result.tier == 'contractor_product'


def test_match_sheet_row_не_находит_ничего():
    row = sheet_source.SheetRow(9, '', 'ВК NR', 'ЖИВО Суставы 490р',
                                'Работает', ('t.ksamata.ru/jivo/trial/nr/a',))
    result = matching.match_sheet_row(row, [])
    assert result.funnel is None and result.tier is None
```

- [ ] **Шаг 2: убедиться, что тест падает**

Run: `python3 -m pytest tools/reconcile/tests/test_matching.py -v`
Ожидается: FAIL — `ModuleNotFoundError: No module named 'matching'`

- [ ] **Шаг 3: реализовать**

```python
# tools/reconcile/matching.py
#!/usr/bin/env python3
"""Сопоставление источников. Ключ свой на каждом стыке.

Заказы ↔ база — по связке, ОБЯЗАТЕЛЬНО с поиском ближайшей воронки.
Замер 04.08: из десяти живых связок без воронки семь оказались ошибками
разметки в ГК (нет маркера типа, чужой маркер, задвоенная ось, нет оси
продукта), и только три — действительно новыми воронками. Без расстояния
до ближайшей все десять читаются одинаково, и разбор уходит не туда.

Таблица ↔ база — по лендингу, с падением на «подрядчик + продукт».
Ступень фиксируется в результате: совпадение по второй означает, что
лендинг разошёлся или отсутствует, и это находка, а не деталь реализации.
"""

from dataclasses import dataclass

import combo

# Дальше двух осей «ближайшая» перестаёт быть подсказкой и становится шумом:
# на расстоянии 3+ похожими оказываются воронки, не связанные ничем.
MAX_DISTANCE = 2

AXIS_NAMES = combo.AXES + ('тип воронки',)


@dataclass(frozen=True)
class Near:
    funnel: object
    distance: int
    diff: list


@dataclass(frozen=True)
class SheetMatch:
    funnel: object
    tier: str


def _diff(key, other):
    """Позиции, где связки расходятся: [(ось, было, стало), ...]."""
    return [
        (AXIS_NAMES[i], key[i], other[i])
        for i in range(len(AXIS_NAMES))
        if key[i] != other[i]
    ]


def nearest(key, funnels):
    """Ближайшая воронка к связке или None, если дальше MAX_DISTANCE.

    При равном расстоянии выбирается воронка с меньшей меткой — стабильно
    между прогонами, в отличие от порядка исходного списка.
    """
    best = None
    for funnel in funnels:
        difference = _diff(key, funnel.key)
        distance = len(difference)
        if distance > MAX_DISTANCE:
            continue
        candidate = (distance, funnel.label)
        if best is None or candidate < (best.distance, best.funnel.label):
            best = Near(funnel=funnel, distance=distance, diff=difference)
    return best


def match_sheet_row(row, funnels):
    """Строка таблицы -> воронка базы. Две ступени, ступень фиксируется."""
    if row.landings:
        wanted = set(row.landings)
        for funnel in funnels:
            if wanted & set(funnel.landings):
                return SheetMatch(funnel=funnel, tier='landing')

    contractor = row.contractor.strip().casefold()
    product = row.funnel.strip().casefold()
    if contractor and product:
        for funnel in funnels:
            if (funnel.contractor.strip().casefold() == contractor
                    and funnel.product.strip().casefold() == product):
                return SheetMatch(funnel=funnel, tier='contractor_product')

    return SheetMatch(funnel=None, tier=None)
```

- [ ] **Шаг 4: убедиться, что тесты проходят**

Run: `python3 -m pytest tools/reconcile/tests/test_matching.py -v`
Ожидается: 7 passed

- [ ] **Шаг 5: коммит**

```bash
git add tools/reconcile/matching.py tools/reconcile/tests/test_matching.py
git commit -m "feat(reconcile): поиск ближайшей воронки и сопоставление по лендингу"
```

---

### Task 7: `decisions.py` — файл решений

**Files:**
- Create: `tools/reconcile/decisions.py`, `tools/reconcile/decisions.yaml`
- Test: `tools/reconcile/tests/test_decisions.py`

**Interfaces:**
- Produces: `decisions.load(path) -> list[Decision]`,
  `decisions.Decision` (поля `id`, `match`, `verdict`, `why`, `since`,
  `waiting_for`), `decisions.covering(key, rules) -> Decision | None`

**Это механизм против хождения по кругу.** Решение «квизы не заводим»
сегодня живёт абзацем в CLAUDE.md, поэтому 13 квизовых строк всплывают в
каждой сверке и обсуждаются заново.

- [ ] **Шаг 1: написать падающий тест**

```python
# tools/reconcile/tests/test_decisions.py
import textwrap

import pytest

import decisions


@pytest.fixture
def rules_file(tmp_path):
    path = tmp_path / 'decisions.yaml'
    path.write_text(textwrap.dedent("""
        - id: quiz-not-tracked
          match:
            продукт: [ЖКТ, ЖИВО]
            тип: [АВ Квиз, АВ Квиз-Лайт]
          verdict: не заводим
          why: решение 29.07 — карточки вышли бы пустыми
          since: 2026-07-29

        - id: leak-effective-from
          match:
            подрядчик: [НИМБ]
          verdict: ждёт ответа
          why: что значит effectiveFrom = null у существующего набора
          since: 2026-08-04
          waiting_for: besales
    """), encoding='utf-8')
    return str(path)


def test_load_читает_правила(rules_file):
    rules = decisions.load(rules_file)
    assert [r.id for r in rules] == ['quiz-not-tracked', 'leak-effective-from']


def test_covering_гасит_совпавшую_связку(rules_file):
    rules = decisions.load(rules_file)
    key = ('ЖКТ', 'НИМБ', 'Яндекс', 'РСЯ', 'АВ Квиз')
    assert decisions.covering(key, rules).id == 'quiz-not-tracked'


def test_covering_молчит_на_несовпавшей(rules_file):
    rules = decisions.load(rules_file)
    key = ('ДБО', 'NR', 'ВК', 'In Stream', 'АВ Автоворонка')
    assert decisions.covering(key, rules) is None


def test_covering_требует_совпадения_всех_осей_правила(rules_file):
    """Продукт подходит, тип — нет: правило не применяется."""
    rules = decisions.load(rules_file)
    key = ('ЖКТ', 'НИМБ', 'Яндекс', 'РСЯ', 'АВ Автоворонка')
    assert decisions.covering(key, rules) is None


def test_waiting_for_отделяет_ждущие_от_решённых(rules_file):
    rules = decisions.load(rules_file)
    waiting = [r for r in rules if r.waiting_for]
    assert [r.waiting_for for r in waiting] == ['besales']


def test_load_на_отсутствующем_файле_даёт_пустой_список(tmp_path):
    assert decisions.load(str(tmp_path / 'нет.yaml')) == []
```

- [ ] **Шаг 2: убедиться, что тест падает**

Run: `python3 -m pytest tools/reconcile/tests/test_decisions.py -v`
Ожидается: FAIL — `ModuleNotFoundError: No module named 'decisions'`

- [ ] **Шаг 3: реализовать**

```python
# tools/reconcile/decisions.py
#!/usr/bin/env python3
"""Файл решений — механизм против хождения по кругу.

Принятое решение становится строкой, по которой инструмент МОЛЧИТ:
совпавшие связки уходят в свёрнутый раздел «решено ранее». Пока решение
живёт абзацем в CLAUDE.md, оно не гасит ни одной строки отчёта, и каждая
сверка обсуждает его заново.

Правило совпадает, когда совпали ВСЕ перечисленные в нём оси. Ось, которую
правило не называет, не проверяется — так «квизы по ЖКТ и ЖИВО» пишутся
двумя осями, а не перечислением всех связок.
"""

import os
from dataclasses import dataclass, field

import yaml

# Имена осей в файле решений — короткие и русские: файл ведёт человек.
AXIS_ALIASES = {
    'продукт': 0,
    'подрядчик': 1,
    'канал': 2,
    'направление': 3,
    'тип': 4,
}


@dataclass(frozen=True)
class Decision:
    id: str
    match: dict
    verdict: str
    why: str
    since: str
    waiting_for: str = ''
    _positions: dict = field(default_factory=dict, compare=False)


def load(path):
    """Читает decisions.yaml. Отсутствие файла — норма, а не ошибка."""
    if not os.path.exists(path):
        return []
    with open(path, encoding='utf-8') as handle:
        raw = yaml.safe_load(handle) or []

    rules = []
    for item in raw:
        match = item.get('match') or {}
        positions = {}
        for alias, values in match.items():
            if alias not in AXIS_ALIASES:
                raise ValueError(
                    f'Правило {item.get("id")}: неизвестная ось «{alias}». '
                    f'Допустимы: {", ".join(sorted(AXIS_ALIASES))}')
            positions[AXIS_ALIASES[alias]] = [str(v) for v in values]
        rules.append(Decision(
            id=str(item.get('id', '')),
            match=match,
            verdict=str(item.get('verdict', '')),
            why=str(item.get('why', '')),
            since=str(item.get('since', '')),
            waiting_for=str(item.get('waiting_for', '')),
            _positions=positions,
        ))
    return rules


def covering(key, rules):
    """Первое правило, покрывающее связку, или None."""
    for rule in rules:
        if not rule._positions:
            continue
        if all(key[pos] in values for pos, values in rule._positions.items()):
            return rule
    return None
```

```yaml
# tools/reconcile/decisions.yaml
# Принятые решения. Инструмент по ним МОЛЧИТ: совпавшие связки уходят в
# свёрнутый раздел «решено ранее». Переносится из раздела «Что решено и НЕ
# надо переоткрывать» в docs/OPEN.md.
#
# Оси: продукт, подрядчик, канал, направление, тип.
# Правило срабатывает, когда совпали ВСЕ названные в нём оси.

- id: quiz-not-tracked
  match:
    тип: [АВ Квиз, АВ Квиз-Лайт]
  verdict: не заводим
  why: >
    Решение 29.07, подтверждено 30.07 замером и повторно 04.08 на другом
    наборе: квизы числятся «Стоп», в ЛИК их нет, карточки вышли бы пустыми.
  since: 2026-07-29
```

- [ ] **Шаг 4: убедиться, что тесты проходят**

Run: `python3 -m pytest tools/reconcile/tests/test_decisions.py -v`
Ожидается: 6 passed

- [ ] **Шаг 5: коммит**

```bash
git add tools/reconcile/decisions.py tools/reconcile/decisions.yaml tools/reconcile/tests/test_decisions.py
git commit -m "feat(reconcile): файл решений, гасящий разобранные связки"
```

---

### Task 8: `sections.py` — сборка разделов отчёта

**Files:**
- Create: `tools/reconcile/sections.py`
- Test: `tools/reconcile/tests/test_sections.py`

**Interfaces:**
- Consumes: `matching.nearest`, `matching.match_sheet_row`,
  `decisions.covering`, `orders_source.ComboStat`, `db_source.Funnel`,
  `sheet_source.SheetRow`, `sheet_source.is_live`
- Produces: `sections.build(combos, blind, funnels, sheet_rows, rules,
  today) -> Report`, `sections.Report` (поля `missing`, `mislabelled`,
  `dead`, `sheet_only`, `status_drift`, `settled`, `waiting`, `blind`)

Разделы соответствуют этапам разбора, и порядок в отчёте — это и есть
ответ на «с чего начать».

- [ ] **Шаг 1: написать падающий тест**

```python
# tools/reconcile/tests/test_sections.py
import datetime

import db_source
import decisions
import orders_source
import sections
import sheet_source

TODAY = datetime.date(2026, 8, 1)


def funnel(label, key, status='active', landings=(), contractor='', product=''):
    return db_source.Funnel(
        funnel_id=abs(hash(label)) % 1000, front_code=label, status=status,
        label=label, key=key, landings=tuple(landings),
        contractor=contractor, product=product)


def stat(key, orders=10, paid=1, last='2026-07-31 10:00:00'):
    return orders_source.ComboStat(key=key, orders=orders, paid=paid,
                                   last_created=last)


F8 = funnel('f8', ('ЖКТ', 'НИМБ', 'Яндекс', 'РСЯ', 'АВ Автоворонка'))


def test_связка_без_похожей_воронки_идёт_в_missing():
    key = ('ДБО', 'RedBananas', 'ТГ', 'Реклама', 'АВ Автоворонка')
    report = sections.build({key: stat(key)}, {'orders': 0, 'paid': 0},
                            [F8], [], [], TODAY)
    assert [item.key for item in report.missing] == [key]


def test_связка_с_похожей_воронкой_идёт_в_mislabelled():
    """Ошибка разметки в ГК — трек Р, а не недостающая воронка."""
    key = ('ЖКТ', 'НИМБ', 'Яндекс', 'РСЯ', 'АВ Прямые')
    report = sections.build({key: stat(key)}, {'orders': 0, 'paid': 0},
                            [F8], [], [], TODAY)
    assert report.missing == []
    assert report.mislabelled[0].near.funnel is F8


def test_решённая_связка_уходит_в_settled_и_не_в_missing():
    key = ('ЖКТ', 'НИМБ', 'Яндекс', 'РСЯ', 'АВ Квиз')
    rules = [decisions.Decision(
        id='quiz-not-tracked', match={'тип': ['АВ Квиз']},
        verdict='не заводим', why='решение 29.07', since='2026-07-29',
        _positions={4: ['АВ Квиз']})]
    report = sections.build({key: stat(key)}, {'orders': 0, 'paid': 0},
                            [], [], rules, TODAY)
    assert report.missing == [] and report.mislabelled == []
    assert [item.key for item in report.settled] == [key]


def test_воронка_active_без_свежих_заказов_идёт_в_dead():
    old = funnel('f70', ('ГП', 'НИМБ', 'Сайт', 'СЕО', 'АВ Автоворонка'))
    report = sections.build({}, {'orders': 0, 'paid': 0}, [old], [], [], TODAY)
    assert [item.funnel.label for item in report.dead] == ['f70']


def test_воронка_archive_в_dead_не_попадает():
    old = funnel('f6', ('БОО', 'НИМБ', 'Яндекс', 'РСЯ', 'АВ Автоворонка'),
                 status='archive')
    report = sections.build({}, {'orders': 0, 'paid': 0}, [old], [], [], TODAY)
    assert report.dead == []


def test_живая_строка_таблицы_без_воронки_идёт_в_sheet_only():
    row = sheet_source.SheetRow(9, '', 'ВК NR', 'ЖИВО Суставы 490р',
                                'Работает', ('t.ksamata.ru/jivo/trial/nr/a',))
    report = sections.build({}, {'orders': 0, 'paid': 0}, [], [row], [], TODAY)
    assert [item.row.funnel for item in report.sheet_only] == \
        ['ЖИВО Суставы 490р']


def test_строка_стоп_без_воронки_в_sheet_only_не_идёт():
    """13 несошедшихся строк — «Стоп»; шуметь ими нельзя."""
    row = sheet_source.SheetRow(20, '', 'ВК NR', 'БОО', 'Стоп',
                                ('t.ksamata.ru/nr/boo/a',))
    report = sections.build({}, {'orders': 0, 'paid': 0}, [], [row], [], TODAY)
    assert report.sheet_only == []


def test_расхождение_статуса_попадает_в_status_drift():
    live = funnel('f9', ('БОО', 'НИМБ', 'Яндекс', 'РСЯ', 'АВ Автоворонка'),
                  landings=['t.ksamata.ru/boo/a'])
    row = sheet_source.SheetRow(7, 'f9', 'НИМБ', 'БОО', 'Стоп',
                                ('t.ksamata.ru/boo/a',))
    report = sections.build({}, {'orders': 0, 'paid': 0}, [live], [row], [],
                            TODAY)
    assert [item.funnel.label for item in report.status_drift] == ['f9']
```

- [ ] **Шаг 2: убедиться, что тест падает**

Run: `python3 -m pytest tools/reconcile/tests/test_sections.py -v`
Ожидается: FAIL — `ModuleNotFoundError: No module named 'sections'`

- [ ] **Шаг 3: реализовать**

```python
# tools/reconcile/sections.py
#!/usr/bin/env python3
"""Сборка разделов отчёта. Порядок разделов = порядок этапов разбора.

Ключевое разделение: связка без воронки в базе попадает в РАЗНЫЕ разделы в
зависимости от того, есть ли похожая воронка.

  нет похожей  -> missing     — воронки действительно не хватает (этап 1)
  есть похожая -> mislabelled — ошибка разметки в ГК (трек Р)

Замер 04.08: семь случаев из десяти — второй вид. Свалить их в один список
значит отправить разбор не туда, где проблема.
"""

import datetime
from dataclasses import dataclass, field

import decisions as decisions_module
import matching
import paths
import sheet_source


@dataclass
class MissingCombo:
    key: tuple
    stat: object


@dataclass
class MislabelledCombo:
    key: tuple
    stat: object
    near: object


@dataclass
class DeadFunnel:
    funnel: object
    last_created: str


@dataclass
class SheetOnly:
    row: object


@dataclass
class StatusDrift:
    funnel: object
    row: object


@dataclass
class Settled:
    key: tuple
    stat: object
    rule: object


@dataclass
class Report:
    missing: list = field(default_factory=list)
    mislabelled: list = field(default_factory=list)
    dead: list = field(default_factory=list)
    sheet_only: list = field(default_factory=list)
    status_drift: list = field(default_factory=list)
    settled: list = field(default_factory=list)
    waiting: list = field(default_factory=list)
    blind: dict = field(default_factory=dict)


def _is_live(last_created, today):
    """Связка жива, если последний заказ не старше LIVE_SINCE_DAYS."""
    if not last_created:
        return False
    stamp = datetime.date.fromisoformat(last_created[:10])
    return (today - stamp).days <= paths.LIVE_SINCE_DAYS


def build(combos, blind, funnels, sheet_rows, rules, today):
    report = Report(blind=dict(blind))
    report.waiting = [rule for rule in rules if rule.waiting_for]

    by_key = {funnel.key: funnel for funnel in funnels}

    for key, stat in sorted(combos.items(), key=lambda kv: -kv[1].orders):
        if not _is_live(stat.last_created, today):
            continue
        if key in by_key:
            continue

        rule = decisions_module.covering(key, rules)
        if rule is not None:
            report.settled.append(Settled(key=key, stat=stat, rule=rule))
            continue

        near = matching.nearest(key, funnels)
        if near is None:
            report.missing.append(MissingCombo(key=key, stat=stat))
        else:
            report.mislabelled.append(
                MislabelledCombo(key=key, stat=stat, near=near))

    for funnel in funnels:
        if funnel.status != 'active':
            continue
        stat = combos.get(funnel.key)
        last = stat.last_created if stat else ''
        if not _is_live(last, today):
            report.dead.append(DeadFunnel(funnel=funnel, last_created=last))

    for row in sheet_rows:
        match = matching.match_sheet_row(row, funnels)
        if match.funnel is None:
            if sheet_source.is_live(row.status):
                report.sheet_only.append(SheetOnly(row=row))
            continue
        funnel_is_active = match.funnel.status == 'active'
        if sheet_source.is_live(row.status) != funnel_is_active:
            report.status_drift.append(
                StatusDrift(funnel=match.funnel, row=row))

    return report
```

- [ ] **Шаг 4: убедиться, что тесты проходят**

Run: `python3 -m pytest tools/reconcile/tests/test_sections.py -v`
Ожидается: 8 passed

- [ ] **Шаг 5: коммит**

```bash
git add tools/reconcile/sections.py tools/reconcile/tests/test_sections.py
git commit -m "feat(reconcile): разделы отчёта по этапам разбора"
```

---

### Task 9: `report_md.py`, `run.py` и README

**Files:**
- Create: `tools/reconcile/report_md.py`, `tools/reconcile/run.py`,
  `tools/reconcile/README.md`
- Test: `tools/reconcile/tests/test_report_md.py`
- Modify: `docs/README.md` (строка в указателе), `CLAUDE.md` (строка в
  таблице `tools/`)

**Interfaces:**
- Consumes: `sections.Report`
- Produces: `report_md.render(report, meta) -> str`,
  `run.main(argv) -> int`

- [ ] **Шаг 1: написать падающий тест**

```python
# tools/reconcile/tests/test_report_md.py
import orders_source
import report_md
import sections

META = {'export': 'deal_export_2026-08-01_01-48-36.xlsx',
        'sheet': 'Ссылки для сбора статы.xlsx',
        'today': '2026-08-04', 'funnels': 73, 'combos': 107}


def test_render_ставит_разделы_в_порядке_этапов():
    key = ('ДБО', 'RedBananas', 'ТГ', 'Реклама', 'АВ Автоворонка')
    report = sections.Report(
        missing=[sections.MissingCombo(
            key=key,
            stat=orders_source.ComboStat(key=key, orders=1, paid=1,
                                         last_created='2026-07-13 10:00:00'))],
        blind={'orders': 46557, 'paid': 26133})
    text = report_md.render(report, META)
    assert text.index('Этап 1') < text.index('Трек Р')


def test_render_показывает_связку_читаемо():
    key = ('ДБО', 'RedBananas', 'ТГ', 'Реклама', 'АВ Автоворонка')
    report = sections.Report(missing=[sections.MissingCombo(
        key=key, stat=orders_source.ComboStat(key=key, orders=1, paid=1,
                                              last_created='2026-07-13'))])
    assert 'ДБО / RedBananas / ТГ / Реклама / АВ Автоворонка' in \
        report_md.render(report, META)


def test_render_называет_размер_слепой_зоны():
    report = sections.Report(blind={'orders': 46557, 'paid': 26133})
    text = report_md.render(report, META)
    assert '26 133' in text


def test_render_на_пустом_отчёте_говорит_что_разделы_пусты():
    text = report_md.render(sections.Report(blind={'orders': 0, 'paid': 0}),
                            META)
    assert 'расхождений нет' in text
```

- [ ] **Шаг 2: убедиться, что тест падает**

Run: `python3 -m pytest tools/reconcile/tests/test_report_md.py -v`
Ожидается: FAIL — `ModuleNotFoundError: No module named 'report_md'`

- [ ] **Шаг 3: реализовать**

```python
# tools/reconcile/report_md.py
#!/usr/bin/env python3
"""Рендер отчёта в markdown.

Порядок разделов повторяет порядок этапов разбора и этим отвечает на
вопрос «с чего начать». Пустой раздел печатается явно — «расхождений нет»
читается иначе, чем отсутствие раздела.
"""

import combo

EMPTY = '_расхождений нет_'


def _thousands(number):
    return f'{number:,}'.replace(',', ' ')


def _table(header, rows):
    if not rows:
        return EMPTY
    lines = ['| ' + ' | '.join(header) + ' |',
             '|' + '|'.join('---' for _ in header) + '|']
    lines.extend('| ' + ' | '.join(str(cell) for cell in row) + ' |'
                 for row in rows)
    return '\n'.join(lines)


def render(report, meta):
    parts = [
        '# Сверка источников',
        '',
        f'Выгрузка заказов: `{meta["export"]}` · таблица: `{meta["sheet"]}` · '
        f'дата прогона: {meta["today"]}',
        '',
        '## Этап 1. Полнота — воронок не хватает',
        '',
        _table(['Заказов', 'Оплат', 'Последний', 'Связка'],
               [(_thousands(item.stat.orders), item.stat.paid,
                 item.stat.last_created[:10], combo.label(item.key))
                for item in report.missing]),
        '',
        '## Этап 1. Кандидаты в archive — заказов нет',
        '',
        _table(['Воронка', 'Последний заказ', 'Связка'],
               [(item.funnel.label, item.last_created[:10] or 'никогда',
                 combo.label(item.funnel.key)) for item in report.dead]),
        '',
        '## Этап 2. Живость — таблица расходится с базой',
        '',
        _table(['Воронка', 'В базе', 'В таблице', 'Строка'],
               [(item.funnel.label, item.funnel.status, item.row.status,
                 item.row.row_num) for item in report.status_drift]),
        '',
        '## Этап 2. Живые строки таблицы без воронки',
        '',
        _table(['Строка', 'Подрядчик', 'Воронка', 'Лендинг'],
               [(item.row.row_num, item.row.contractor, item.row.funnel,
                 item.row.landings[0] if item.row.landings else '—')
                for item in report.sheet_only]),
        '',
        '## Трек Р. Разметка в GetCourse',
        '',
        f'Заказов без осей вовсе: **{_thousands(report.blind.get("orders", 0))}**, '
        f'из них оплаченных — **{_thousands(report.blind.get("paid", 0))}**. '
        'Эти заказы нельзя приписать никакой воронке.',
        '',
        _table(['Заказов', 'Связка в заказах', 'Похоже на', 'Разница'],
               [(_thousands(item.stat.orders), combo.label(item.key),
                 item.near.funnel.label,
                 '; '.join(f'{axis}: {was or "—"} → {became or "—"}'
                           for axis, was, became in item.near.diff))
                for item in report.mislabelled]),
        '',
        f'## Ждёт ответа ({len(report.waiting)})',
        '',
        _table(['Кому', 'Вопрос'],
               [(rule.waiting_for, rule.why) for rule in report.waiting]),
        '',
        f'## Решено ранее ({len(report.settled)})',
        '',
        _table(['Заказов', 'Связка', 'Решение', 'Когда'],
               [(_thousands(item.stat.orders), combo.label(item.key),
                 item.rule.verdict, item.rule.since)
                for item in report.settled]),
        '',
    ]
    return '\n'.join(parts)
```

```python
# tools/reconcile/run.py
#!/usr/bin/env python3
"""Сверка четырёх источников в один отчёт по этапам разбора.

Запуск из корня репозитория:

    python3 tools/reconcile/run.py

Дизайн: docs/plans/2026-08-04-razbor-design.md

Инструмент ничего не чинит — ни базу, ни GetCourse, ни ЛИК. На выходе
отчёт; решения принимает человек и записывает их в decisions.yaml.
"""

import argparse
import datetime
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.abspath(os.path.join(
    os.path.dirname(os.path.abspath(__file__)), '..', 'audit')))

import db_source          # noqa: E402
import decisions          # noqa: E402
import orders_source      # noqa: E402
import paths              # noqa: E402
import report_md          # noqa: E402
import sections           # noqa: E402
import sheet_source       # noqa: E402

DEFAULT_SHEET = 'Ссылки для сбора статы-2.xlsx'


def main(argv=None):
    parser = argparse.ArgumentParser(description='Сверка источников по воронкам')
    parser.add_argument('--export', help='выгрузка заказов (по умолчанию — '
                                         'самая свежая в ~/Downloads)')
    parser.add_argument('--sheet', help='таблица маркетологов')
    parser.add_argument('--db', default=paths.DB_PATH)
    parser.add_argument('--out', help='куда положить отчёт '
                                      '(по умолчанию data/generated/)')
    parser.add_argument('--today', help='дата прогона ГГГГ-ММ-ДД, для тестов')
    args = parser.parse_args(argv)

    export_path = args.export or orders_source.newest_export(paths.DOWNLOADS_DIR)
    sheet_path = args.sheet or os.path.join(paths.DOWNLOADS_DIR, DEFAULT_SHEET)
    today = (datetime.date.fromisoformat(args.today) if args.today
             else datetime.date.today())

    print(f'Заказы:  {export_path}')
    combos, blind = orders_source.load_combos(export_path)
    print(f'  связок: {len(combos)}, заказов без осей: {blind["orders"]}')

    print(f'Таблица: {sheet_path}')
    sheet_rows = sheet_source.load_rows(sheet_path)
    print(f'  строк: {len(sheet_rows)}')

    print(f'База:    {args.db}')
    funnels = db_source.load_funnels(args.db)
    print(f'  воронок: {len(funnels)}')

    rules = decisions.load(paths.DECISIONS_PATH)
    report = sections.build(combos, blind, funnels, sheet_rows, rules, today)

    text = report_md.render(report, {
        'export': os.path.basename(export_path),
        'sheet': os.path.basename(sheet_path),
        'today': today.isoformat(),
        'funnels': len(funnels),
        'combos': len(combos),
    })

    out_dir = args.out or paths.OUT_DIR
    os.makedirs(out_dir, exist_ok=True)
    out_path = os.path.join(out_dir, f'reconcile-{today.isoformat()}.md')
    with open(out_path, 'w', encoding='utf-8') as handle:
        handle.write(text)

    print()
    print(f'Отчёт: {out_path}')
    print(f'  не хватает воронок: {len(report.missing)}')
    print(f'  ошибок разметки:    {len(report.mislabelled)}')
    print(f'  кандидатов в archive: {len(report.dead)}')
    print(f'  расхождений статуса:  {len(report.status_drift)}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
```

- [ ] **Шаг 4: убедиться, что тесты проходят**

Run: `python3 -m pytest tools/reconcile/tests -v`
Ожидается: все тесты зелёные (48 passed)

- [ ] **Шаг 5: прогнать на живых данных**

Run:
```bash
python3 tools/reconcile/run.py --today 2026-08-04 \
  --export ~/Downloads/deal_export_2026-08-01_01-48-36.xlsx \
  --sheet "$HOME/Downloads/Ссылки для сбора статы-2.xlsx"
```

Ожидается: отчёт в `data/generated/reconcile-2026-08-04.md`. Сверить с
замерами дизайна: не хватает воронок ~3, ошибок разметки ~7, живых строк
таблицы без воронки — 1.

**Если числа разошлись — это находка, а не повод подгонять код.** Замеры
дизайна сделаны ad-hoc скриптом с точным сравнением множеств; `av_key`
устроен иначе (при конфликте берёт меньшее значение), поэтому расхождение
по `f55` ожидаемо и должно всплыть в конфликтах осей, а не в missing.

- [ ] **Шаг 6: проверить, что база не изменена**

Run: `git status --porcelain ksamata_funnels.db`
Ожидается: пустой вывод

- [ ] **Шаг 7: README и указатели**

Создать `tools/reconcile/README.md` по образцу `tools/audit/README.md`:
назначение, запуск, роли источников, ключи сопоставления, файл решений,
ссылка на дизайн. Добавить строку в таблицу `tools/` в `CLAUDE.md` и в
указатель `docs/README.md`.

- [ ] **Шаг 8: коммит**

```bash
git add tools/reconcile/ CLAUDE.md docs/README.md
git commit -m "feat(reconcile): отчёт по этапам разбора и CLI"
```

---

## Самопроверка плана

**Покрытие дизайна:**

| Требование дизайна | Задача |
|---|---|
| Связка пяти осей как общий язык | 1 |
| Заказы → полнота | 2 |
| Общая нормализация URL для обеих сторон | 3 |
| Таблица: только живость и лендинги | 4 |
| Лендинги из двух мест базы | 5 |
| **Поиск ближайшей воронки** | 6 |
| Лендинг в две ступени с фиксацией ступени | 6 |
| Файл решений | 7 |
| Разделы «решено ранее» и «ждёт ответа» | 7, 8 |
| Разделы в порядке этапов | 8, 9 |
| База только на чтение | 5 (тест) |

**Отложено сознательно (YAGNI):** чтение снимка ЛИК и раздел этапа 3.
Этап 3 заморожен до ответов A–C, а формат снимка неизвестен, пока реестр
не снят. Строить парсер под неизвестный формат — гадание. Отдельная задача
после того, как снимок появится.

**Согласованность типов:** `Funnel` из задачи 5 потребляется задачами 6 и
8; поля `label`, `key`, `landings`, `contractor`, `product`, `status`
используются ровно в объявленном виде. `ComboStat` из задачи 2 —
`orders`, `paid`, `last_created`, `conflicts`. `Near` из задачи 6 —
`funnel`, `distance`, `diff`.
