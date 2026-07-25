import csv
import datetime

import openpyxl
import pytest

from export_source import (
    TAGS_COLUMN,
    discover_export_files,
    discover_export_files_with_stats,
    file_date_from_name,
    has_tags_column,
    load_observations,
    read_observations,
)

HEADERS = ['ID заказа', 'Дата создания', 'Состав заказа', TAGS_COLUMN, 'Статус']


def write_csv(path, rows):
    with open(path, 'w', encoding='utf-8-sig', newline='') as fh:
        w = csv.writer(fh, delimiter=';')
        w.writerow(HEADERS)
        w.writerows(rows)


def write_xlsx(path, rows, headers=None):
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.append(headers if headers is not None else HEADERS)
    for r in rows:
        ws.append(list(r))
    wb.save(path)


def test_file_date_from_name_reads_first_iso_date():
    assert file_date_from_name('deal_export_2026-07-19_08-38-45.xlsx') == datetime.date(2026, 7, 19)
    assert file_date_from_name('deal_export_with_utm_2026-04-23.xlsx') == datetime.date(2026, 4, 23)
    assert file_date_from_name('deal_export_2026-05-13_11-43-50 (1).xlsx') == datetime.date(2026, 5, 13)
    assert file_date_from_name('deal_cycles_client_summary.md') is None


def test_has_tags_column_true_for_full_export(tmp_path):
    p = tmp_path / 'deal_export_2026-05-01_00-00-00.csv'
    write_csv(p, [['1', '2026-05-01 00:00:00', 'X', 'ДБО|РСЯ', 'Оплачен']])
    assert has_tags_column(str(p)) is True


def test_has_tags_column_false_for_utm_slice(tmp_path):
    p = tmp_path / 'deal_export_2026-05-01_00-00-00_utm.xlsx'
    write_xlsx(p, [['1', 'X']], headers=['ID заказа', 'Состав заказа'])
    assert has_tags_column(str(p)) is False


def test_discover_skips_files_before_since_and_without_tags(tmp_path):
    old = tmp_path / 'deal_export_2026-03-01_00-00-00.csv'
    write_csv(old, [['1', '2026-03-01 00:00:00', 'X', 'ДБО', 'Оплачен']])

    utm = tmp_path / 'deal_export_2026-05-01_00-00-00_utm.xlsx'
    write_xlsx(utm, [['2', 'X']], headers=['ID заказа', 'Состав заказа'])

    good = tmp_path / 'deal_export_2026-05-02_00-00-00.csv'
    write_csv(good, [['3', '2026-05-02 00:00:00', 'X', 'ДБО', 'Оплачен']])

    noise = tmp_path / 'unrelated_2026-05-03.xlsx'
    write_xlsx(noise, [['4', 'X']])

    found = discover_export_files(str(tmp_path), datetime.date(2026, 4, 1))
    assert [p.rsplit('/', 1)[-1] for p in found] == ['deal_export_2026-05-02_00-00-00.csv']


def test_discover_with_stats_reports_selection_and_exclusion_counts(tmp_path):
    """Лист «Источники» должен уметь показать не только отобранные файлы,
    но и сколько отброшено и почему — discover_export_files_with_stats
    считает это, не ломая сигнатуру discover_export_files (ей пользуются
    другие тесты)."""
    old = tmp_path / 'deal_export_2026-03-01_00-00-00.csv'
    write_csv(old, [['1', '2026-03-01 00:00:00', 'X', 'ДБО', 'Оплачен']])

    utm = tmp_path / 'deal_export_2026-05-01_00-00-00_utm.xlsx'
    write_xlsx(utm, [['2', 'X']], headers=['ID заказа', 'Состав заказа'])

    good_a = tmp_path / 'deal_export_2026-05-02_00-00-00.csv'
    write_csv(good_a, [['3', '2026-05-02 00:00:00', 'X', 'ДБО', 'Оплачен']])
    good_b = tmp_path / 'deal_export_2026-05-03_00-00-00.csv'
    write_csv(good_b, [['4', '2026-05-03 00:00:00', 'X', 'ДБО', 'Оплачен']])

    files, stats = discover_export_files_with_stats(str(tmp_path), datetime.date(2026, 4, 1))

    assert sorted(p.rsplit('/', 1)[-1] for p in files) == [
        'deal_export_2026-05-02_00-00-00.csv',
        'deal_export_2026-05-03_00-00-00.csv',
    ]
    assert stats['selected'] == 2
    assert stats['excluded_too_old'] == 1
    assert stats['excluded_no_tags_column'] == 1
    assert stats['total_candidates'] == 4

    # Тот же список файлов, что и у discover_export_files для того же входа.
    assert files == discover_export_files(str(tmp_path), datetime.date(2026, 4, 1))


def test_discover_skips_excel_lock_files(tmp_path):
    # Файл-блокировка — ВАЛИДНЫЙ xlsx с настоящей колонкой тегов, чтобы
    # единственной причиной его исключения была проверка префикса '~$', а не
    # перехват исключения на битом архиве (has_tags_column вернула бы False
    # и без этой проверки — тест был бы ненагруженным).
    lock = tmp_path / '~$deal_export_2026-05-02_00-00-00.xlsx'
    write_xlsx(lock, [['3', '2026-05-02 00:00:00', 'X', 'ДБО', 'Оплачен']])
    good = tmp_path / 'deal_export_2026-05-02_00-00-00.csv'
    write_csv(good, [['3', '2026-05-02 00:00:00', 'X', 'ДБО', 'Оплачен']])

    found = discover_export_files(str(tmp_path), datetime.date(2026, 4, 1))
    assert len(found) == 1
    assert '~$' not in found[0]


def test_has_tags_column_warns_and_rejects_unreadable_file(tmp_path):
    """Битый файл выпадает из охвата, но об этом не молчат.

    В отличие от штатного «колонки нет» (например, срез *_utm), файл, который
    не удалось прочитать вовсе, — аномалия для карты расхождений: его данные
    просто отсутствуют, и это должно быть видно, а не тонуть молча.
    """
    p = tmp_path / 'deal_export_2026-05-01_00-00-00.xlsx'
    p.write_bytes(b'not a real workbook')

    with pytest.warns(UserWarning) as record:
        result = has_tags_column(str(p))

    assert result is False
    assert any(p.name in str(w.message) for w in record)


def test_read_observations_from_csv(tmp_path):
    p = tmp_path / 'deal_export_2026-05-02_00-00-00.csv'
    write_csv(p, [
        ['861', '2026-05-01 10:00:00', 'Курс', 'ДБО|АВ Продукт: ДБО', 'Оплачен'],
        ['862', '2026-05-01 11:00:00', 'Курс', '', 'Отменен'],
    ])
    obs = read_observations(str(p))
    assert len(obs) == 1  # строка без тегов отбрасывается
    assert obs[0].deal_id == '861'
    assert obs[0].tags == frozenset({'ДБО', 'АВ Продукт: ДБО'})
    assert obs[0].file_date == datetime.date(2026, 5, 2)
    assert obs[0].deal_created == '2026-05-01 10:00:00'


def test_read_observations_from_xlsx(tmp_path):
    p = tmp_path / 'deal_export_2026-05-02_00-00-00.xlsx'
    write_xlsx(p, [['861', '2026-05-01 10:00:00', 'Курс', 'ДБО|РСЯ', 'Оплачен']])
    obs = read_observations(str(p))
    assert obs[0].tags == frozenset({'ДБО', 'РСЯ'})


def test_load_observations_dedups_by_deal_and_file_date_not_deal_alone(tmp_path):
    """Один заказ в двух выгрузках — ДВА наблюдения: это и есть сигнал дрейфа."""
    march = tmp_path / 'deal_export_2026-04-11_00-00-00.csv'
    write_csv(march, [['810', '2026-04-10 10:00:00', 'Курс', 'АВ Продукт: СВС', 'Оплачен']])
    may = tmp_path / 'deal_export_2026-05-13_00-00-00.csv'
    write_csv(may, [['810', '2026-04-10 10:00:00', 'Курс', 'АВ Продукт: СВС|СВС', 'Оплачен']])

    obs = load_observations([str(march), str(may)])
    assert len(obs) == 2
    assert {o.file_date for o in obs} == {datetime.date(2026, 4, 11), datetime.date(2026, 5, 13)}


def test_load_observations_dedups_exact_duplicate_within_same_file_date(tmp_path):
    a = tmp_path / 'deal_export_2026-05-13_00-00-00.csv'
    write_csv(a, [['810', '2026-05-01 10:00:00', 'Курс', 'ДБО', 'Оплачен']])
    b = tmp_path / 'deal_export_2026-05-13_11-11-11 (1).csv'
    write_csv(b, [['810', '2026-05-01 10:00:00', 'Курс', 'ДБО', 'Оплачен']])

    obs = load_observations([str(a), str(b)])
    assert len(obs) == 1
