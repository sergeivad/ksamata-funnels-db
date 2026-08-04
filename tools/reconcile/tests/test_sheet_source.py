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
