import json
import sqlite3

from run_sheet_links import (
    _ambiguous_key,
    _orphan_key,
    _unslotted_key,
    collect,
    main,
)

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
    result, reports, unslotted, funnels, active, dead_active = collect(
        SHEETS, make_db(tmp_path))
    assert len(result.matched) == 1
    assert active == 1
    assert reports[0].label == 'f11'
    assert reports[0].kinds['tariffs'].has_block is False
    assert reports[0].kinds['tariffs'].diff.only_sheet == [
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
    result, reports, _, _, _, _ = collect(sheets, make_db(tmp_path))
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
    result, reports, unslotted, funnels, active, dead_active = collect(
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
    # B5: 'ч' в тексте — вакуумная проверка, она истинна для любого прогона
    # (само слово «Отчёт:» содержит «ч»). Пин на конкретную фразу возраста —
    # backdate ровно на 5 часов, значит "5 ч 0 мин".
    assert '5 ч 0 мин' in captured.out


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
    result, reports, unslotted, funnels, active, dead_active = collect(
        sheets, str(path))
    assert [r.label for r in reports] == ['f2', 'f11', '#3']


def test_main_refresh_keeps_old_cache_when_fetch_fails(tmp_path, monkeypatch):
    """B1: неудачный --refresh не должен уничтожать рабочий снимок. Раньше
    файл кеша удалялся ДО похода в сеть, и упавший фетч (таблица не
    расшарена, ноутбук офлайн) оставлял инструмент вовсе без кеша —
    сломанным именно тогда, когда снимок нужнее всего."""
    import links_fetch

    cache = tmp_path / 'cache.json'
    cache.write_text(json.dumps(SHEETS), encoding='utf-8')
    before = cache.read_text(encoding='utf-8')

    def failing_fetch():
        raise RuntimeError('таблица недоступна (офлайн/не расшарена)')

    monkeypatch.setattr(links_fetch, '_fetch_from_api', failing_fetch)

    db = make_db(tmp_path)
    out = tmp_path / 'report.md'
    try:
        main(['--db', db, '--cache', str(cache), '--out', str(out),
              '--today', '2026-08-17', '--refresh'])
    except RuntimeError:
        pass

    assert cache.exists()
    assert cache.read_text(encoding='utf-8') == before


def test_main_out_accepts_bare_filename(tmp_path, monkeypatch):
    """B4: `--out report.md` (без каталога в пути) не должен падать —
    os.makedirs(os.path.dirname(out_path)) получал '' и ронял
    FileNotFoundError."""
    monkeypatch.chdir(tmp_path)
    cache = tmp_path / 'cache.json'
    cache.write_text(json.dumps(SHEETS), encoding='utf-8')
    db = make_db(tmp_path)
    code = main(['--db', db, '--cache', str(cache), '--out', 'report.md',
                 '--today', '2026-08-17'])
    assert code == 0
    assert (tmp_path / 'report.md').exists()


def test_orphan_key_sorts_by_sheet_then_row():
    """B6: не было теста на ключ сортировки сирот."""
    from links_sheet import SheetBlock

    a = SheetBlock(sheet='Я', name='a', row=5)
    b = SheetBlock(sheet='А', name='b', row=9)
    c = SheetBlock(sheet='А', name='c', row=2)
    assert sorted([a, b, c], key=_orphan_key) == [c, b, a]


def test_ambiguous_key_sorts_by_sheet_then_row():
    """B6/ревью: исходная версия варьировала лист и строку ОДНОВРЕМЕННО и в
    одном направлении (больший лист → и строка больше), так что тест прошёл
    бы и для ключа, сортирующего только по строке — лист как будто бы не
    проверялся вовсе. Здесь два независимых случая: лист решает вопреки
    строке, и строка решает при одинаковом листе."""
    from links_match import Ambiguous
    from links_sheet import SheetBlock

    # Лист важнее строки: у "раннего" листа строка БОЛЬШЕ — ключ, глядящий
    # только на строку, отсортировал бы эту пару наоборот.
    early_sheet_late_row = Ambiguous(SheetBlock(sheet='А', name='x', row=9),
                                     [(1, 1)])
    late_sheet_early_row = Ambiguous(SheetBlock(sheet='Я', name='y', row=1),
                                     [(2, 1)])
    assert sorted([late_sheet_early_row, early_sheet_late_row],
                 key=_ambiguous_key) == [early_sheet_late_row, late_sheet_early_row]

    # Одинаковый лист — решает строка.
    same_sheet_late_row = Ambiguous(SheetBlock(sheet='А', name='x', row=9),
                                    [(1, 1)])
    same_sheet_early_row = Ambiguous(SheetBlock(sheet='А', name='y', row=2),
                                     [(2, 1)])
    assert sorted([same_sheet_late_row, same_sheet_early_row],
                 key=_ambiguous_key) == [same_sheet_early_row, same_sheet_late_row]


def test_unslotted_key_orders_by_kind_then_row():
    """B6: не было теста на порядок вида блока/строки внутри «слот не
    определён» — только на F-код (test_collect_sorts_reports_by_front_code_
    number). Тарифы должны идти раньше заявок раньше допродаж, как и в
    остальных секциях (links_report.KIND_ORDER), а внутри одного вида —
    по возрастанию строки."""
    from links_report import Unslotted

    upsell_first_row = Unslotted(label='f1', block_name='x', sheet='Л',
                                 kind='upsell', url='u', row=1)
    tariffs_late_row = Unslotted(label='f1', block_name='x', sheet='Л',
                                 kind='tariffs', row=5, url='u')
    tariffs_early_row = Unslotted(label='f1', block_name='x', sheet='Л',
                                  kind='tariffs', row=2, url='u')
    applications = Unslotted(label='f1', block_name='x', sheet='Л',
                             kind='applications', row=3, url='u')
    ordered = sorted(
        [upsell_first_row, tariffs_late_row, applications, tariffs_early_row],
        key=_unslotted_key)
    assert ordered == [tariffs_early_row, tariffs_late_row, applications,
                       upsell_first_row]


# Комната та же, что в make_db() (funnel_id=1, f11) — иначе блок не
# опознаётся вовсе и падает в сироты вместо matched.
UPSELL_SHEETS = {'ДБО': [
    ['', '[ДБО ВК]'],
    ['', '1 день', 'https://gc.ksamata.ru/dbo1-vk', '', '',
     'https://gc.ksamata.ru/dbo/meditation-vk'],
]}


def test_collect_splits_column_f_by_host_into_tariffs_and_upsell(tmp_path):
    """Task 8: колонка F с хостом gc.ksamata.ru должна уйти в блок
    «Допродажи / дожим» (`upsell`), а не в «Тарифы» — без этой развязки
    отчёт предлагал бы владельцу вставить дожимные ссылки в тарифы."""
    result, reports, unslotted, funnels, active, dead_active = collect(
        UPSELL_SHEETS, make_db(tmp_path))
    assert len(result.matched) == 1
    rep = reports[0]
    assert rep.kinds['tariffs'].diff.only_sheet == []
    assert rep.kinds['upsell'].diff.only_sheet == [
        ('19', 'https://gc.ksamata.ru/dbo/meditation-vk')]


def test_collect_reports_upsell_only_fillable_funnel(tmp_path):
    """Task 8: воронка, у которой тарифов и заявок в таблице нет вовсе, а
    допродажи есть и заливаемы, обязана всё равно попасть в отчёт и в
    counters «можно заполнить»."""
    from links_report import build_report
    import datetime

    result, reports, unslotted, funnels, active, dead_active = collect(
        UPSELL_SHEETS, make_db(tmp_path))
    text = build_report(datetime.date(2026, 8, 18), 1, result, reports,
                        unslotted, funnels, active)
    assert 'из них можно заполнить: 1' in text
    assert 'Допродажи / дожим' in text
    assert 'https://gc.ksamata.ru/dbo/meditation-vk' in text


def test_kind_registries_agree():
    """Ревью: три реестра видов блока обязаны перечислять одни и те же виды.
    Вид, забытый в links_compare.KIND_FIELD, падает громко (KeyError при
    первом же sheet_items) — а забытый в links_db.BLOCK_KINDS падает МОЛЧА:
    load_blocks его просто не найдёт, has_block станет False, и отчёт
    честно соврёт владельцу, что заливать нечего залитого, хотя блок такого
    вида в базе уже есть. Тихая неверная строка в документе, который читают
    как факт, хуже падения."""
    from links_compare import KIND_FIELD
    from links_db import BLOCK_KINDS
    from links_report import KIND_ORDER

    assert set(BLOCK_KINDS) == set(KIND_ORDER) == set(KIND_FIELD)


def test_collect_flags_disabled_block_matching_an_active_funnel(tmp_path):
    """Task 8 review, пункт D: таблица помечает блок отключённым, а его
    вебинарная комната всё равно совпадает с активной воронкой в базе —
    источники расходятся, и `collect` обязан вынести это отдельно, а не
    оставить блок молча тонуть среди «отключённых»."""
    sheets = {'БОО': [
        ['', '[БОО Адарат отключена]'],
        ['', '1 день', 'https://gc.ksamata.ru/dbo1-vk', '', '',
         'https://t.ksamata.ru/boo/tarif'],
    ]}
    result, reports, unslotted, funnels, active, dead_active = collect(
        sheets, make_db(tmp_path))
    assert len(result.dead) == 1
    assert len(dead_active) == 1
    assert dead_active[0].label == 'f11'
    assert dead_active[0].block_name == 'БОО Адарат отключена'
    assert dead_active[0].sheet == 'БОО'


def test_collect_does_not_flag_disabled_block_matching_an_archived_funnel(
        tmp_path):
    """Симметричный случай: отключённый блок, чья комната совпадает с
    АРХИВНОЙ (не активной) воронкой, не расхождение источников — таблица и
    база согласны, что это не действующий блок."""
    sheets = {'БОО': [
        ['', '[БОО архив отключена]'],
        ['', '1 день', 'https://gc.ksamata.ru/boo-arch', '', '',
         'https://t.ksamata.ru/boo/tarif'],
    ]}
    result, reports, unslotted, funnels, active, dead_active = collect(
        sheets, make_db(tmp_path))
    assert len(result.dead) == 1
    assert dead_active == []
