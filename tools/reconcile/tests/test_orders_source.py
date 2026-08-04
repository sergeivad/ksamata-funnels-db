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
    ws.append(['3', '2026-07-15 10:00:00', 'Да', ''])
    ws.append(['4', '2026-07-20 10:00:00', 'Да',
               'АВ Продукт: БОО|АВ Канал: Сайт'])
    path = tmp_path / 'deal_export_2026-08-01_00-00-00.xlsx'
    wb.save(path)
    return str(path)


def test_load_combos_сворачивает_заказы_в_связки(export_file):
    combos, _ = orders_source.load_combos(export_file)
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
    assert ('БОО', None, 'Сайт', None, None) in combos


def test_newest_export_берёт_самый_свежий(tmp_path):
    for name in ('deal_export_2026-07-01_00-00-00.xlsx',
                 'deal_export_2026-08-01_00-00-00.xlsx'):
        (tmp_path / name).write_bytes(b'')
    assert orders_source.newest_export(str(tmp_path)).endswith(
        'deal_export_2026-08-01_00-00-00.xlsx')


def test_newest_export_падает_когда_выгрузок_нет(tmp_path):
    with pytest.raises(FileNotFoundError):
        orders_source.newest_export(str(tmp_path))
