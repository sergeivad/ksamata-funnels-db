import datetime

from db_source import Expectation
from export_source import Observation
from findings import (
    CLASS_TITLES,
    find_contradictory_legacy,
    find_extra_axes,
    find_missing_in_getcourse,
    find_unresolved,
    find_unsupported_stage,
    group_observations,
)
from normalize import parse_tagset

KEY = ('ДБО', 'NR', 'ВК', 'In Stream')
AV = 'АВ Продукт: ДБО|АВ Подрядчик: NR|АВ Канал: ВК|АВ Направление: In Stream'
INDEX = {KEY: {11}}


def exp(tag_type, raw):
    return Expectation(funnel_id=11, num=11, front_code='f11',
                       product_name='ДБО NR ВК', status='active',
                       tag_type=tag_type, tags=parse_tagset(raw))


def obs(raw, day, deal_id='1'):
    return Observation(deal_id=deal_id, tags=parse_tagset(raw),
                       file_name=f'deal_export_2026-05-{day:02d}_00-00-00.csv',
                       file_date=datetime.date(2026, 5, day),
                       deal_created='2026-05-01 00:00:00')


def test_class_titles_cover_all_sixteen():
    assert sorted(CLASS_TITLES) == list(range(1, 17))


def test_group_observations_aggregates_by_key_type_and_tagset():
    raw = AV + '|АВ Этап: Регистрация'
    groups = group_observations([obs(raw, 2, '1'), obs(raw, 5, '2')])
    assert len(groups) == 1
    g = groups[0]
    assert g.key == KEY
    assert g.tag_type == 'reg'
    assert g.deals == 2
    assert g.first_seen == datetime.date(2026, 5, 2)
    assert g.last_seen == datetime.date(2026, 5, 5)


def test_group_observations_separates_different_tagsets():
    base = AV + '|АВ Этап: Регистрация'
    groups = group_observations([obs(base, 2), obs(base + '|автоворонки', 5, '2')])
    assert len(groups) == 2


def test_class_1_reports_tag_expected_in_db_but_absent_in_getcourse():
    groups = group_observations([obs(AV + '|АВ Этап: Регистрация', 2)])
    expectations = [exp('reg', AV + '|АВ Этап: Регистрация|автоворонки')]
    found = find_missing_in_getcourse(groups, expectations, INDEX)
    assert len(found) == 1
    assert found[0].cls == 1
    assert found[0].funnel == 'f11'
    assert 'автоворонки' in found[0].subject


def test_class_1_silent_when_sets_match():
    raw = AV + '|АВ Этап: Регистрация'
    assert find_missing_in_getcourse(group_observations([obs(raw, 2)]),
                                     [exp('reg', raw)], INDEX) == []


def test_class_2_reports_axis_present_in_getcourse_but_absent_from_db_vocabulary():
    raw = AV + '|АВ Этап: Мессенджер|АВ Мессенджер: МАКС'
    groups = group_observations([obs(raw, 2)])
    vocabulary = frozenset({'АВ Продукт: ДБО', 'АВ Подрядчик: NR', 'АВ Канал: ВК',
                            'АВ Направление: In Stream', 'АВ Этап: Мессенджер'})
    found = find_extra_axes(groups, vocabulary)
    assert [f.cls for f in found] == [2]
    assert 'АВ Мессенджер: МАКС' in found[0].subject


def test_class_3_reports_predpisok_stage():
    groups = group_observations([obs(AV + '|АВ Этап: Предписок', 2)])
    found = find_unsupported_stage(groups)
    assert [f.cls for f in found] == [3]
    assert 'Предписок' in found[0].subject


def test_class_4_reports_contradictory_legacy_direction_tags():
    raw = AV + '|АВ Этап: Оплата|АВ Время: 19|ВК NR ВК|ВК NR IS'
    groups = group_observations([obs(raw, 2)])
    expectations = [exp('time_19', raw)]
    found = find_contradictory_legacy(groups, expectations, INDEX)
    assert [f.cls for f in found] == [4]
    assert 'ВК NR ВК' in found[0].evidence
    assert 'ВК NR IS' in found[0].evidence


def test_class_5_reports_payment_without_time():
    groups = group_observations([obs(AV + '|АВ Этап: Оплата', 2)])
    found = find_unresolved(groups, INDEX)
    assert [f.cls for f in found] == [5]


def test_class_6_reports_predpisok_as_unresolved():
    groups = group_observations([obs(AV + '|АВ Этап: Предписок', 2)])
    found = find_unresolved(groups, INDEX)
    assert [f.cls for f in found] == [6]


def test_class_7_reports_known_type_but_unknown_funnel():
    other = ('ЩЖ', 'НИМБ', 'Яндекс', 'РСЯ')
    raw = ('АВ Продукт: ЩЖ|АВ Подрядчик: НИМБ|АВ Канал: Яндекс|'
           'АВ Направление: РСЯ|АВ Этап: Регистрация')
    found = find_unresolved(group_observations([obs(raw, 2)]), INDEX)
    assert [f.cls for f in found] == [7]
    assert 'ЩЖ' in found[0].subject


def test_classes_5_6_7_are_mutually_exclusive():
    """Каждая неопознанная группа попадает ровно в один класс."""
    groups = group_observations([
        obs(AV + '|АВ Этап: Оплата', 2, '1'),
        obs(AV + '|АВ Этап: Предписок', 2, '2'),
        obs('АВ Продукт: ЩЖ|АВ Подрядчик: НИМБ|АВ Канал: Яндекс|'
            'АВ Направление: РСЯ|АВ Этап: Регистрация', 2, '3'),
    ])
    found = find_unresolved(groups, INDEX)
    assert sorted(f.cls for f in found) == [5, 6, 7]
    assert len(found) == len(groups)


def test_find_unresolved_silent_for_recognised_group():
    raw = AV + '|АВ Этап: Регистрация'
    assert find_unresolved(group_observations([obs(raw, 2)]), INDEX) == []
