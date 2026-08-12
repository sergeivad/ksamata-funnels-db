"""Дашборды и подсчёты регистраций экспорт берёт из блока «Ссылки», а не из колонок.

Колонки funnels.dash_*_url / regi_*_url / predspisok_url выведены из обращения
фазой 11 и стоят пустыми: читай отчёт их — все семь полей были бы пустыми по
всем воронкам.
"""

import os
import re
import sqlite3

from ksamata_funnels_export import LINK_LABELS, load_all

# Путь резолвится от расположения этого файла, как и в остальных
# инструментах репозитория (см. ksamata_funnels_export.py: BASE_DIR/ROOT_DIR).
# tools/data-export/tests/test_export_links.py -> repo root: три уровня вверх.
_TESTS_DIR = os.path.dirname(os.path.abspath(__file__))
_ROOT_DIR = os.path.abspath(os.path.join(_TESTS_DIR, '..', '..', '..'))
_PHASE11_PATH = os.path.join(_ROOT_DIR, 'app', 'scripts', 'migrate-phase11.ts')


def make_db(path, items):
    """Минимальная база с одной воронкой и блоком «Ссылки» из `items`."""
    conn = sqlite3.connect(str(path))
    conn.executescript(
        """
        CREATE TABLE sources (id INTEGER PRIMARY KEY, name TEXT);
        CREATE TABLE products (id INTEGER PRIMARY KEY, name TEXT);
        CREATE TABLE contractors (id INTEGER PRIMARY KEY, name TEXT);
        CREATE TABLE funnels (id INTEGER PRIMARY KEY, num INTEGER,
            source_id INTEGER, product_id INTEGER, contractor_id INTEGER,
            product_name TEXT DEFAULT '', variant TEXT DEFAULT '',
            start_date TEXT DEFAULT '', block_name TEXT DEFAULT '',
            sheet_name TEXT DEFAULT '', tag_19_raw TEXT DEFAULT '',
            tag_15_raw TEXT DEFAULT '', reg_tags_raw TEXT DEFAULT '',
            bothelp_condition TEXT DEFAULT '', room_ids_json TEXT DEFAULT '{}');
        CREATE TABLE funnel_days (id INTEGER PRIMARY KEY, funnel_id INTEGER,
            time_slot TEXT, day_num INTEGER);
        CREATE TABLE funnel_tags (id INTEGER PRIMARY KEY, funnel_id INTEGER,
            tag_id INTEGER, tag_type TEXT, position INTEGER);
        CREATE TABLE tags (id INTEGER PRIMARY KEY, name TEXT);
        CREATE TABLE salebot_configs (id INTEGER PRIMARY KEY, funnel_id INTEGER,
            time_slot TEXT);
        CREATE TABLE product_durations (id INTEGER PRIMARY KEY, product_id INTEGER,
            day_num INTEGER, duration_minutes INTEGER);
        CREATE TABLE funnel_blocks (id INTEGER PRIMARY KEY, funnel_id INTEGER,
            kind TEXT, enabled INTEGER, mode TEXT);
        CREATE TABLE funnel_block_items (id INTEGER PRIMARY KEY, block_id INTEGER,
            slot TEXT, label TEXT, url TEXT, position INTEGER);
        INSERT INTO sources (id, name) VALUES (1, 'источник');
        INSERT INTO products (id, name) VALUES (1, 'ДБО');
        INSERT INTO contractors (id, name) VALUES (1, 'подрядчик');
        INSERT INTO funnels (id, num, source_id, product_id, contractor_id)
             VALUES (1, 1, 1, 1, 1);
        INSERT INTO funnel_blocks (id, funnel_id, kind, enabled, mode)
             VALUES (1, 1, 'links', 1, 'common');
        """
    )
    for pos, (label, url) in enumerate(items):
        conn.execute(
            "INSERT INTO funnel_block_items (block_id, slot, label, url, position)"
            " VALUES (1, NULL, ?, ?, ?)",
            (label, url, pos),
        )
    conn.commit()
    conn.close()


def test_standard_labels_land_in_their_fields(tmp_path):
    db = tmp_path / "ksamata_funnels.db"
    make_db(
        db,
        [
            ("Дашборд продаж", "https://gc.example.ru/sales"),
            ("Дашборд перелива", "https://gc.example.ru/pereliv"),
            ("Регистрации всего", "https://gc.example.ru/total"),
            ("Регистрации 15:00", "https://gc.example.ru/15"),
            ("Регистрации 19:00", "https://gc.example.ru/19"),
            ("Регистрации без времени", "https://gc.example.ru/notime"),
            ("Предсписок", "https://gc.example.ru/pre"),
        ],
    )

    f = load_all(str(db))[0]

    assert f["dash_sales"] == "https://gc.example.ru/sales"
    assert f["dash_pereliv"] == "https://gc.example.ru/pereliv"
    assert f["regi_total"] == "https://gc.example.ru/total"
    assert f["regi_15"] == "https://gc.example.ru/15"
    assert f["regi_19"] == "https://gc.example.ru/19"
    assert f["regi_notime"] == "https://gc.example.ru/notime"
    assert f["predspisok"] == "https://gc.example.ru/pre"
    assert f["extra_links"] == ""


def test_label_matching_ignores_case_and_spaces(tmp_path):
    db = tmp_path / "ksamata_funnels.db"
    make_db(db, [("  дашборд ПРОДАЖ  ", "https://gc.example.ru/sales")])

    f = load_all(str(db))[0]

    assert f["dash_sales"] == "https://gc.example.ru/sales"


def test_two_items_with_one_label_are_joined(tmp_path):
    """Случай f9/f16 после фазы 11: под одной подписью два адреса — оба в отчёт."""
    db = tmp_path / "ksamata_funnels.db"
    make_db(
        db,
        [
            ("Дашборд продаж", "https://gc.example.ru/a"),
            ("Дашборд продаж", "https://gc.example.ru/b"),
        ],
    )

    f = load_all(str(db))[0]

    assert f["dash_sales"] == "https://gc.example.ru/a / https://gc.example.ru/b"


def test_unknown_label_goes_to_extra_links(tmp_path):
    db = tmp_path / "ksamata_funnels.db"
    make_db(db, [("Сводка по рекламе", "https://gc.example.ru/ads")])

    f = load_all(str(db))[0]

    assert f["dash_sales"] == ""
    assert f["extra_links"] == "Сводка по рекламе — https://gc.example.ru/ads"


def test_empty_urls_are_skipped(tmp_path):
    db = tmp_path / "ksamata_funnels.db"
    make_db(db, [("Дашборд продаж", ""), ("Дашборд перелива", "   ")])

    f = load_all(str(db))[0]

    assert f["dash_sales"] == ""
    assert f["dash_pereliv"] == ""
    assert f["extra_links"] == ""


def test_funnel_without_links_block_does_not_crash(tmp_path):
    db = tmp_path / "ksamata_funnels.db"
    make_db(db, [])

    f = load_all(str(db))[0]

    assert f["dash_sales"] == ""
    assert f["predspisok"] == ""
    assert f["extra_links"] == ""


def test_two_or_more_unmatched_labels_are_joined_in_extra_links(tmp_path):
    """`extra_links` — не одно поле, а склейка ' / ' по всем незнакомым пунктам."""
    db = tmp_path / "ksamata_funnels.db"
    make_db(
        db,
        [
            ("Сводка по рекламе", "https://gc.example.ru/ads"),
            ("Черновик дашборда", "https://gc.example.ru/draft"),
        ],
    )

    f = load_all(str(db))[0]

    assert f["dash_sales"] == ""
    assert f["extra_links"] == (
        "Сводка по рекламе — https://gc.example.ru/ads / "
        "Черновик дашборда — https://gc.example.ru/draft"
    )


def test_blank_label_with_url_goes_to_extra_links_as_bare_address(tmp_path):
    """Пункт без подписи — законное состояние блока, а не мусор: адрес идёт в
    «Прочие ссылки» голым, без тире, потому что подписывать его нечем."""
    db = tmp_path / "ksamata_funnels.db"
    make_db(db, [("", "https://gc.example.ru/nolabel")])

    f = load_all(str(db))[0]

    assert f["dash_sales"] == ""
    assert f["extra_links"] == "https://gc.example.ru/nolabel"


def test_link_labels_match_migrate_phase11_source():
    """LINK_LABELS (здесь) и LINK_COLUMNS (app/scripts/migrate-phase11.ts) —
    одна и та же таблица «колонка → подпись», переписанная руками в двух
    языках. Расхождение молчит: подпись, которую фаза 11 больше не пишет (или
    пишет по-другому), в этом отчёте попадает в «Прочие ссылки» вместо своей
    графы — и никто не увидит ошибку, пока не сверит отчёт с базой вручную.

    Читаем исходник TypeScript-файла как текст: у pytest нет рантайма, чтобы
    импортировать и выполнить .ts. Если путь резолвится неверно — тест падает
    с FileNotFoundError, а не молча пропускается.
    """
    with open(_PHASE11_PATH, encoding="utf-8") as fh:
        source = fh.read()

    labels = re.findall(r"label:\s*'([^']+)'", source)
    assert labels, f"не нашли ни одной подписи в {_PHASE11_PATH} — разбор сломался"

    from_source = {label.lower() for label in labels}
    from_export = set(LINK_LABELS.keys())
    assert from_source == from_export
