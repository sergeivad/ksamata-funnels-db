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


def test_load_expectations_keeps_tag_types_of_one_funnel_separate(tmp_path):
    """Одна воронка, два tag_type с разными наборами тегов.

    Должны получиться две отдельные записи Expectation (по одной на
    tag_type), а не одна со слитыми тегами: если бы группировка шла только
    по funnel_id, вышла бы одна запись с объединённым множеством тегов и
    len(exps) == 1 здесь уже упал бы.
    """
    reg_tags = AV_DBO_NR_VK_IS + ['АВ Этап: Регистрация', 'только_reg_тег']
    time19_tags = [
        'АВ Продукт: ДБО', 'АВ Подрядчик: NR', 'АВ Канал: ВК',
        'АВ Направление: In Stream', 'АВ Этап: Оплата', 'АВ Время: 19',
        'только_time19_тег',
    ]
    db = make_db(
        tmp_path,
        [(11, 11, 'f11', 'ДБО NR ВК', 'active')],
        [(11, 'reg', reg_tags), (11, 'time_19', time19_tags)],
    )
    exps = load_expectations(db)
    assert len(exps) == 2
    by_type = {e.tag_type: e for e in exps}
    assert set(by_type) == {'reg', 'time_19'}
    assert by_type['reg'].tags != by_type['time_19'].tags
    assert 'только_reg_тег' in by_type['reg'].tags
    assert 'только_reg_тег' not in by_type['time_19'].tags
    assert 'только_time19_тег' in by_type['time_19'].tags
    assert 'только_time19_тег' not in by_type['reg'].tags


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


def test_find_key_collisions_ignores_single_funnel_keys(tmp_path):
    """Один ключ уникален (одна воронка), другой — коллизия (две воронки).

    Должна вернуться только коллизия: если бы реализация возвращала любой
    ключ с fids >= 1 (а не строго > 1), уникальный ключ 34 тоже попал бы
    в результат.
    """
    unique = ['АВ Продукт: ЖИВО', 'АВ Подрядчик: НИМБ',
              'АВ Канал: Яндекс', 'АВ Направление: РСЯ']
    shared = ['АВ Продукт: КВИЗ', 'АВ Подрядчик: НИМБ',
              'АВ Канал: ВК', 'АВ Направление: In Stream']
    db = make_db(
        tmp_path,
        [(34, 34, 'f33', 'ЖИВО НИМБ РСЯ', 'active'),
         (46, 46, 'f43', 'КВИЗ НИМБ ВК', 'active'),
         (47, 47, 'f47', 'КВИЗ НИМБ ВК 2', 'active')],
        [(34, 'reg', unique), (46, 'reg', shared), (47, 'reg', shared)],
    )
    collisions = find_key_collisions(build_av_index(load_expectations(db)))
    assert collisions == {('КВИЗ', 'НИМБ', 'ВК', 'In Stream'): {46, 47}}


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
