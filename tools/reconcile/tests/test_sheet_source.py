import decisions
import openpyxl
import pytest

import sheet_source


@pytest.fixture
def sheet_file(tmp_path):
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = 'Рабочие'
    ws.append([])
    ws.append([])
    ws.append(['КОД F№', 'Порядчик', 'Воронка', 'Статус воронки',
               'ДАТА СТАРТА', 'Посадочная '])
    ws.append([])
    ws.append(['F37', 'Ютуб органика', 'БОО', 'Работает', None,
               'https://t.ksamata.ru/boo/a'])
    ws.append([None, 'ВК NR', 'ЖИВО Суставы 490р', 'Работает', None,
               'https://t.ksamata.ru/jivo/trial/nr/a'])
    ws.append([None, None, None, None, None, None])
    path = tmp_path / 'Ссылки.xlsx'
    wb.save(path)
    return str(path)


def test_load_rows_пропускает_шапку_и_пустые(sheet_file):
    assert len(sheet_source.load_rows(sheet_file)) == 2


def test_load_rows_нормализует_код_в_нижний_регистр(sheet_file):
    """SQLite сравнивает TEXT побайтово: F37 и f37 разошлись бы как разные."""
    assert sheet_source.load_rows(sheet_file)[0].front_code == 'f37'


def test_load_rows_допускает_пустой_код(sheet_file):
    """Половина строк таблицы без кода — это норма, а не брак."""
    assert sheet_source.load_rows(sheet_file)[1].front_code == ''


def test_load_rows_расщепляет_лендинги(sheet_file):
    assert sheet_source.load_rows(sheet_file)[0].landings == (
        't.ksamata.ru/boo/a',)


def test_is_live_различает_работает_и_стоп():
    assert sheet_source.is_live('Работает')
    assert not sheet_source.is_live('Стоп')
    assert not sheet_source.is_live('')


def _landing_rule():
    return decisions.Decision(
        id='sheet-row-adbloggers-landing', match={}, scope='sheet_landing',
        row_contractor='ВК NR', row_funnel='ДБО AdBlogger (посевы)',
        landing='https://t.ksamata.ru/nrab/dbo/a',
        verdict='лендинг из письма владельца', why='в таблице ячейка пуста',
        since='2026-08-04')


def test_решение_дополняет_пустой_лендинг_строки():
    """Владелец прислал лендинг 04.08, а таблицу править не будет. Без
    подстановки строка 47 навсегда осталась бы «живой строкой без воронки»,
    хотя воронка заведена в тот же день."""
    row = sheet_source.SheetRow(47, '', 'ВК NR', 'ДБО AdBlogger (посевы)',
                                'Работает', ())
    out = sheet_source.apply_landing_rules([row], [_landing_rule()])
    assert out[0].landings == ('t.ksamata.ru/nrab/dbo/a',)


def test_решение_не_затирает_лендинг_который_в_таблице_есть():
    """Таблица — источник лендингов. Подстановка закрывает дырку, а не
    спорит с заполненной ячейкой."""
    row = sheet_source.SheetRow(47, '', 'ВК NR', 'ДБО AdBlogger (посевы)',
                                'Работает', ('t.ksamata.ru/old/a',))
    out = sheet_source.apply_landing_rules([row], [_landing_rule()])
    assert out[0].landings == ('t.ksamata.ru/old/a',)


def test_решение_не_трогает_чужие_строки():
    row = sheet_source.SheetRow(12, 'f8', 'НИМБ', 'ЖКТ', 'Стоп', ())
    out = sheet_source.apply_landing_rules([row], [_landing_rule()])
    assert out[0].landings == ()
