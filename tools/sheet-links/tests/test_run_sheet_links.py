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
    """Архив в подробную часть не идёт — охват задачи это активные.

    Название блока листа намеренно НЕ «[БОО архив]», как в исходном черновике
    задачи: подстрока «архив» — один из DEAD_MARKERS в links_sheet.py, и
    блок с ней в заголовке классифицируется мёртвым (проверено —
    test_dead_marker_in_head_row_marks_block в test_links_sheet.py пинит
    это как намеренное поведение), поэтому вообще не доходит до matched, и
    тест перестаёт проверять то, что заявлено в его же докстринге —
    отсеивание по статусу воронки, а не по маркеру «отключена»."""
    sheets = {'БОО': [['', '[БОО старое]'],
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


def test_collect_unslotted_uses_link_row_not_block_header_row(tmp_path):
    """Requirement 3: раздел «слот не определён» должен указывать строку
    самой ссылки, а не строку заголовка блока — иначе владелец идёт не туда
    искать адрес.

    Ссылка на row 2 стоит до первой комнаты блока (якоря ещё нет), а комната,
    по которой блок матчится с воронкой, появляется только на row 3."""
    sheets = {'ДБО': [
        ['', '[ДБО ВК]'],                                                 # row 1: заголовок
        ['', '', '', '', '', 'https://t.ksamata.ru/dbo/tarif-no-anchor'],  # row 2: ссылка без якоря
        ['', '1 день', 'https://gc.ksamata.ru/dbo1-vk', '', '',
         'https://t.ksamata.ru/dbo/tarif-19'],                            # row 3: тут появляется комната
    ]}
    result, reports, unslotted, funnels, active = collect(
        sheets, make_db(tmp_path))
    assert len(result.matched) == 1
    assert len(unslotted) == 1
    item = unslotted[0]
    assert item.row == 2          # строка самой ссылки, а не заголовка (row 1)
    assert item.url == 'https://t.ksamata.ru/dbo/tarif-no-anchor'
    assert item.label == 'f11'


def test_main_refresh_forces_fetch_and_overwrites_stale_cache(tmp_path, monkeypatch):
    """Requirement 1: --refresh не должен читать существующий кеш и обязан
    перезаписать его свежими данными."""
    import links_fetch

    cache = tmp_path / 'cache.json'
    stale = {'СТАРОЕ': [['', '[устарело]']]}
    cache.write_text(json.dumps(stale), encoding='utf-8')

    def fake_fetch():
        return SHEETS

    monkeypatch.setattr(links_fetch, '_fetch_from_api', fake_fetch)

    db = make_db(tmp_path)
    out = tmp_path / 'report.md'
    code = main(['--db', db, '--cache', str(cache), '--out', str(out),
                 '--today', '2026-08-17', '--refresh'])
    assert code == 0

    on_disk = json.loads(cache.read_text(encoding='utf-8'))
    assert on_disk == SHEETS
    assert 'СТАРОЕ' not in on_disk


def test_main_without_refresh_uses_existing_cache(tmp_path, monkeypatch):
    """Без --refresh не ходим в сеть вовсе — если бы пошли, конфтест-заглушка
    сокета уронила бы тест."""
    cache = tmp_path / 'cache.json'
    cache.write_text(json.dumps(SHEETS), encoding='utf-8')
    db = make_db(tmp_path)
    out = tmp_path / 'report.md'
    code = main(['--db', db, '--cache', str(cache), '--out', str(out),
                 '--today', '2026-08-17'])
    assert code == 0


def test_main_prints_cache_age_when_reading_from_cache(tmp_path, capsys):
    """Requirement 2: возраст кеша должен появляться в консоли, когда прогон
    читает его вместо сети."""
    import os
    import time

    cache = tmp_path / 'cache.json'
    cache.write_text(json.dumps(SHEETS), encoding='utf-8')
    old_time = time.time() - 3600 * 5  # пять часов назад
    os.utime(cache, (old_time, old_time))

    db = make_db(tmp_path)
    out = tmp_path / 'report.md'
    main(['--db', db, '--cache', str(cache), '--out', str(out),
          '--today', '2026-08-17'])
    captured = capsys.readouterr()
    assert 'кеш' in captured.out.lower()
    assert 'ч' in captured.out  # часы возраста упомянуты в каком-то виде


def test_collect_sorts_reports_by_front_code_number(tmp_path):
    """Requirement 4: f11 должен идти после f2, а не по алфавиту строки."""
    path = tmp_path / 'live2.db'
    con = sqlite3.connect(path)
    con.executescript(SCHEMA)
    con.execute("INSERT INTO funnels (id,front_code,product_name,status) "
                "VALUES (1,'f11','Одиннадцать','active')")
    con.execute("INSERT INTO funnels (id,front_code,product_name,status) "
                "VALUES (2,'f2','Два','active')")
    con.execute("INSERT INTO funnels (id,front_code,product_name,status) "
                "VALUES (3,'','Без кода','active')")
    con.execute("INSERT INTO funnel_days (funnel_id,time_slot,day_num,gc_room,"
                "web_room) VALUES (1,'19',1,'https://gc.ksamata.ru/room-11','')")
    con.execute("INSERT INTO funnel_days (funnel_id,time_slot,day_num,gc_room,"
                "web_room) VALUES (2,'19',1,'https://gc.ksamata.ru/room-2','')")
    con.execute("INSERT INTO funnel_days (funnel_id,time_slot,day_num,gc_room,"
                "web_room) VALUES (3,'19',1,'https://gc.ksamata.ru/room-3','')")
    con.commit()
    con.close()

    sheets = {'X': [
        ['', '[Блок 11]'],
        ['', '1 день', 'https://gc.ksamata.ru/room-11', '', '',
         'https://t.ksamata.ru/x/11'],
        ['', '[Блок 2]'],
        ['', '1 день', 'https://gc.ksamata.ru/room-2', '', '',
         'https://t.ksamata.ru/x/2'],
        ['', '[Блок 3]'],
        ['', '1 день', 'https://gc.ksamata.ru/room-3', '', '',
         'https://t.ksamata.ru/x/3'],
    ]}
    result, reports, unslotted, funnels, active = collect(sheets, str(path))
    assert [r.label for r in reports] == ['f2', 'f11', '#3']
