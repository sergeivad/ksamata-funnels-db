import sqlite3

import pytest

import funnels_source

SCHEMA = """
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
"""


@pytest.fixture
def db(tmp_path):
    path = tmp_path / 'test.db'
    con = sqlite3.connect(path)
    con.executescript(SCHEMA + """
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
    funnel = funnels_source.load_funnels(db)[0]
    assert funnel.key == ('ЖИВО-суставы', 'ИНХАУЗ', 'Яндекс', 'РСЯ', 'АВ Прямые')


def test_load_funnels_берёт_лендинги_из_обоих_мест(db):
    """Второй адрес живёт в блоке landings — терять его нельзя."""
    assert set(funnels_source.load_funnels(db)[0].landings) == {
        't.zdravo-telo.ru/a', 'gc.zdravo-telo.ru/b', 'land.ksamata.ru/c'}


def test_load_funnels_метка_по_коду_а_не_по_num(db):
    """num человеку не показывают никогда (CLAUDE.md)."""
    assert funnels_source.load_funnels(db)[0].label == 'f56'


def test_load_funnels_метка_падает_на_id_без_кода(tmp_path):
    path = tmp_path / 'x.db'
    con = sqlite3.connect(path)
    con.executescript(SCHEMA + """
        INSERT INTO funnels VALUES (7, 7, '', 'draft', '', NULL, NULL, NULL);
    """)
    con.commit()
    con.close()
    assert funnels_source.load_funnels(str(path))[0].label == '#7'


def test_load_funnels_открывает_базу_только_на_чтение(db):
    """Инструмент ничего не чинит: запись должна быть невозможна физически."""
    con = funnels_source.connect(db)
    with pytest.raises(sqlite3.OperationalError):
        con.execute("UPDATE funnels SET status='archive'")
    con.close()
