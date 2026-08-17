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


def test_load_blocks_includes_upsell_kind(tmp_path):
    """Task 8: третий вид блока сверки — `upsell` («Допродажи / дожим»)."""
    path = make_db(
        tmp_path,
        funnels=[(1, 'f1', 'ДБО ВК', 'active')],
        blocks=[(10, 1, 'upsell')],
        items=[(10, '19', '', 'https://gc.ksamata.ru/dbo/meditation-vk', 0)])
    con = connect_ro(path)
    blocks = load_blocks(con)
    con.close()
    assert [i.url for i in blocks[(1, 'upsell')]] == [
        'https://gc.ksamata.ru/dbo/meditation-vk']


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
