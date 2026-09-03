#!/usr/bin/env python3
"""Отчёт обязан отличать «проверено, расхождений нет» от «не проверяли».

Пустой лист класса читается как «всё в порядке» — и это верно ровно тогда,
когда класс считался. Без реестра предложений GetCourse шесть классов не
считаются вовсе, и их пустота не значит ничего.

До этих тестов разницу держала только надпись в README. На надпись в
документации в этом пакете уже полагались однажды: сверка написания тега
этапа месяц отдавала ноль совпадений, и ноль читали как «расхождений нет»
(фаза 15). Ровно тот же симптом — молчание вместо ответа.
"""

import openpyxl
import pytest

from db_source import FunnelRow
from findings import (
    CLASS_TITLES,
    REGISTRY_FILTERED_CLASSES,
    REGISTRY_ONLY_CLASSES,
    Finding,
    degraded_classes,
    unevaluated_classes,
)
from report import DEGRADED_NOTE, NOT_EVALUATED_NOTE, build_summary_rows, write_report

FUNNELS = [
    FunnelRow(funnel_id=11, num=11, front_code='f11', product_name='ДБО NR ВК',
              status='active', has_predspisok=True),
]


def finding(cls, funnel='f11'):
    return Finding(cls=cls, funnel=funnel, tag_type='reg', subject='S', detail='D',
                   evidence='E', first_seen='2026-05-02', last_seen='2026-05-13', deals=3)


def note_of(path, cls):
    """Пометка листа класса. Лежит в A2 — той строке, что и так была пустой:
    заголовки на 3-й, данные с 4-й, и сдвигать их нельзя."""
    return openpyxl.load_workbook(path)[f'Класс {cls}']['A2'].value


# --- какие классы без реестра слепнут -------------------------------------

def test_registry_only_classes_are_exactly_the_finders_whose_whole_input_is_offers():
    assert REGISTRY_ONLY_CLASSES == {9, 10, 11, 12, 14, 17}


def test_registry_filtered_classes_are_the_two_that_only_lose_a_filter():
    # 2 (find_extra_axes ← registry_av_tags) и 7 (find_unresolved ←
    # registry_keys). Класс 5 приходит из той же функции, что и 7, но
    # фильтра не касается — легко ошибиться, поэтому закреплено.
    assert REGISTRY_FILTERED_CLASSES == {2, 7}
    assert 5 not in REGISTRY_FILTERED_CLASSES


def test_the_two_sets_do_not_overlap_and_name_only_real_classes():
    assert not (REGISTRY_ONLY_CLASSES & REGISTRY_FILTERED_CLASSES)
    assert (REGISTRY_ONLY_CLASSES | REGISTRY_FILTERED_CLASSES) <= set(CLASS_TITLES)


# --- признак «реестр не читали» — данные, а не флаг ------------------------

def test_empty_registry_marks_classes_regardless_of_why_it_is_empty():
    """Пустой реестр — и от `--no-api`, и от ответа API, из которого ничего
    не пришло. Класс слеп одинаково, значит и говорить надо одинаково."""
    assert unevaluated_classes([]) == REGISTRY_ONLY_CLASSES
    assert degraded_classes([]) == REGISTRY_FILTERED_CLASSES


def test_non_empty_registry_marks_nothing():
    offers = [object()]
    assert unevaluated_classes(offers) == frozenset()
    assert degraded_classes(offers) == frozenset()


# --- лист класса ----------------------------------------------------------

def test_unevaluated_class_sheet_says_so_in_plain_words(tmp_path):
    out = tmp_path / 'r.xlsx'
    write_report(str(out), [], FUNNELS, [], not_evaluated=REGISTRY_ONLY_CLASSES,
                 degraded=REGISTRY_FILTERED_CLASSES)
    for cls in REGISTRY_ONLY_CLASSES:
        assert note_of(out, cls) == NOT_EVALUATED_NOTE


def test_degraded_class_sheet_warns_about_inflated_counts(tmp_path):
    out = tmp_path / 'r.xlsx'
    write_report(str(out), [finding(2, funnel='—')], FUNNELS, [],
                 not_evaluated=REGISTRY_ONLY_CLASSES, degraded=REGISTRY_FILTERED_CLASSES)
    for cls in REGISTRY_FILTERED_CLASSES:
        assert note_of(out, cls) == DEGRADED_NOTE


def test_evaluated_class_sheet_carries_no_note(tmp_path):
    out = tmp_path / 'r.xlsx'
    write_report(str(out), [], FUNNELS, [], not_evaluated=REGISTRY_ONLY_CLASSES,
                 degraded=REGISTRY_FILTERED_CLASSES)
    for cls in set(CLASS_TITLES) - REGISTRY_ONLY_CLASSES - REGISTRY_FILTERED_CLASSES:
        assert note_of(out, cls) is None


def test_full_run_leaves_every_sheet_unmarked(tmp_path):
    """Прогон с реестром не должен пугать ни одним листом."""
    out = tmp_path / 'r.xlsx'
    write_report(str(out), [finding(1)], FUNNELS, [])
    for cls in CLASS_TITLES:
        assert note_of(out, cls) is None


def test_note_does_not_move_headers_or_data(tmp_path):
    """Пометка занимает уже существующую пустую строку 2. Заголовки обязаны
    остаться на 3-й, данные — с 4-й: на эти номера смотрит и test_report.py,
    и глаз человека, привыкшего к формату."""
    out = tmp_path / 'r.xlsx'
    write_report(str(out), [finding(17, funnel='f11')], FUNNELS, [],
                 not_evaluated=REGISTRY_ONLY_CLASSES)
    ws = openpyxl.load_workbook(out)['Класс 17']
    assert ws['A3'].value == 'Воронка'
    assert ws['A4'].value == 'f11'
    assert ws.freeze_panes == 'A4'


# --- сводка ---------------------------------------------------------------

def test_summary_header_marks_unevaluated_classes():
    rows = build_summary_rows([], FUNNELS, not_evaluated={17})
    header = rows[0]
    assert 'Класс 17 (не проверялся)' in header
    assert 'Класс 17' not in header
    assert 'Класс 16' in header  # остальные не тронуты


def test_summary_header_is_untouched_on_a_full_run():
    header = build_summary_rows([], FUNNELS)[0]
    assert all('не проверялся' not in str(cell) for cell in header)


def test_summary_still_counts_and_sums_when_a_class_is_marked():
    """Пометка — только слово в заголовке: числа и инвариант полноты целы."""
    findings = [finding(1), finding(17), finding(9, funnel='—')]
    rows = build_summary_rows(findings, FUNNELS, not_evaluated={9, 17})
    header = rows[0]
    cols = [i for i, name in enumerate(header) if str(name).startswith('Класс ')]
    assert sum(row[i] for row in rows[1:-1] for i in cols) == len(findings)


@pytest.mark.parametrize('cls', sorted(REGISTRY_ONLY_CLASSES))
def test_every_registry_only_class_is_marked_in_the_summary(cls):
    header = build_summary_rows([], FUNNELS, not_evaluated=REGISTRY_ONLY_CLASSES)[0]
    assert f'Класс {cls} (не проверялся)' in header
