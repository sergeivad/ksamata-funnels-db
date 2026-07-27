import datetime

from db_source import Expectation
from export_source import Observation
from findings import (
    Group,
    find_contradictory_legacy,
    find_extra_axes,
    find_missing_in_getcourse,
    find_unresolved,
    group_observations,
)
from normalize import parse_tagset

KEY = ('ДБО', 'NR', 'ВК', 'In Stream')
AV = 'АВ Продукт: ДБО|АВ Подрядчик: NR|АВ Канал: ВК|АВ Направление: In Stream'
INDEX = {KEY: {11}}

ORPHAN_AV = ('АВ Продукт: ЩЖ|АВ Подрядчик: НИМБ|АВ Канал: Яндекс|'
             'АВ Направление: РСЯ')
ORPHAN_INDEX = {}


def exp(tag_type, raw):
    return Expectation(funnel_id=11, num=11, front_code='f11',
                       product_name='ДБО NR ВК', status='active',
                       tag_type=tag_type, tags=parse_tagset(raw))


def obs(raw, day, deal_id='1'):
    return Observation(deal_id=deal_id, tags=parse_tagset(raw),
                        file_name=f'deal_export_2026-05-{day:02d}_00-00-00.csv',
                        file_date=datetime.date(2026, 5, day),
                        deal_created='2026-05-01 00:00:00')


# --- Дефект 1/2: find_unresolved должен сводить группы по (ключ, семейство этапа) ---

def test_stale_broken_payment_is_superseded_by_fresh_resolved_one():
    """Майская сломанная 'Оплата без времени' + свежая исправная 'Время: 19'
    на том же ключе — find_unresolved не должен видеть прошлую проблему."""
    groups = group_observations([
        obs(AV + '|АВ Этап: Оплата', 2),
        obs(AV + '|АВ Этап: Оплата|АВ Время: 19', 20),
    ])
    assert find_unresolved(groups, INDEX) == []


def test_reverse_dates_still_reports_the_currently_broken_state():
    """Если свежее наблюдение — сломанное, а старое было исправным, находка
    класса 5 обязана остаться: свёртка не должна прятать проблему ни в одну
    сторону."""
    groups = group_observations([
        obs(AV + '|АВ Этап: Оплата|АВ Время: 19', 2),
        obs(AV + '|АВ Этап: Оплата', 20),
    ])
    found = find_unresolved(groups, INDEX)
    assert [f.cls for f in found] == [5]


def test_orphaned_key_seen_twice_with_different_tagsets_yields_one_finding():
    """Один и тот же осиротевший АВ-ключ, увиденный дважды с разными
    дополнительными тегами, не должен давать две находки класса 7 про один
    и тот же факт «воронки нет»."""
    raw_reg = ORPHAN_AV + '|АВ Этап: Регистрация'
    groups = group_observations([
        obs(raw_reg, 2),
        obs(raw_reg + '|автоворонки', 20, deal_id='2'),
    ])
    found = find_unresolved(groups, ORPHAN_INDEX)
    assert [f.cls for f in found] == [7]


def test_reg_and_messenger_families_on_same_key_do_not_collapse_each_other():
    """reg и messenger сосуществуют законно на одной воронке — они разные
    семейства и не должны схлопываться в одну находку."""
    reg = ORPHAN_AV + '|АВ Этап: Регистрация'
    messenger = ORPHAN_AV + '|АВ Этап: Мессенджер'
    groups = group_observations([obs(reg, 2), obs(messenger, 2, deal_id='2')])
    found = find_unresolved(groups, ORPHAN_INDEX)
    assert sorted(f.cls for f in found) == [7, 7]
    assert {f.tag_type for f in found} == {'reg', 'messenger'}


# --- Дефект 3: правило «только свежайшее» для остальных трёх функций ---

def test_class_1_ignores_stale_group_fixed_by_fresh_observation():
    stale = AV + '|АВ Этап: Регистрация'
    fresh = stale + '|автоворонки'
    groups = group_observations([obs(stale, 2), obs(fresh, 20, deal_id='2')])
    expectations = [exp('reg', fresh)]
    assert find_missing_in_getcourse(groups, expectations, INDEX) == []


def test_class_2_ignores_stale_unknown_axis_fixed_by_fresh_observation():
    stale = AV + '|АВ Этап: Мессенджер|АВ Мессенджер: МАКС'
    fresh = AV + '|АВ Этап: Мессенджер'
    groups = group_observations([obs(stale, 2), obs(fresh, 20, deal_id='2')])
    vocabulary = frozenset({
        'АВ Продукт: ДБО', 'АВ Подрядчик: NR', 'АВ Канал: ВК',
        'АВ Направление: In Stream', 'АВ Этап: Мессенджер',
    })
    assert find_extra_axes(groups, vocabulary) == []


def test_class_4_ignores_stale_contradictory_legacy_fixed_by_fresh_observation():
    stale = AV + '|АВ Этап: Оплата|АВ Время: 19|ВК NR ВК|ВК NR IS'
    fresh = AV + '|АВ Этап: Оплата|АВ Время: 19'
    groups = group_observations([obs(stale, 2), obs(fresh, 20, deal_id='2')])
    expectations = [exp('time_19', fresh)]
    assert find_contradictory_legacy(groups, expectations, INDEX) == []


# --- Правка 1: победитель при ничьей по last_seen не должен зависеть от
# порядка групп во входном списке (см. docstring _freshness_key в findings.py) ---


def test_latest_groups_tiebreak_is_order_independent_not_input_order():
    """На живых данных ничья по last_seen встречается в 61 слоте из 187, и
    раньше побеждала группа, которая раньше встретилась во входном списке
    groups — то есть решала оформительская сортировка group_observations
    (`-deals, key_label`), а не содержание самих групп. Правильный
    tie-break — по числу наблюдений (затем по тегам), и результат обязан
    быть одинаков независимо от порядка элементов в списке groups."""
    day = datetime.date(2026, 5, 10)
    tags_more_deals = parse_tagset(AV + '|АВ Этап: Регистрация|автоворонки')
    tags_fewer_deals = parse_tagset(AV + '|АВ Этап: Регистрация')

    group_more = Group(key=KEY, tag_type='reg', reason=None, tags=tags_more_deals,
                       deals=5, first_seen=day, last_seen=day, files=('a.csv',))
    group_fewer = Group(key=KEY, tag_type='reg', reason=None, tags=tags_fewer_deals,
                        deals=2, first_seen=day, last_seen=day, files=('b.csv',))

    expectations = [exp('reg', AV + '|АВ Этап: Регистрация|автоворонки')]

    forward = find_missing_in_getcourse([group_fewer, group_more], expectations, INDEX)
    backward = find_missing_in_getcourse([group_more, group_fewer], expectations, INDEX)

    assert forward == backward
    # Побеждает группа с бо́льшим числом наблюдений (5 > 2) — она полностью
    # покрывает ожидание базы, поэтому находок быть не должно.
    assert forward == []


def test_latest_by_stage_family_tiebreak_is_order_independent_not_input_order():
    """Тот же дефект, что и выше, но для _latest_by_stage_family, которую
    использует find_unresolved (классы 5/6/7)."""
    day = datetime.date(2026, 5, 10)
    broken = Group(key=KEY, tag_type=None, reason='no_time',
                   tags=parse_tagset(AV + '|АВ Этап: Оплата'),
                   deals=2, first_seen=day, last_seen=day, files=('a.csv',))
    resolved = Group(key=KEY, tag_type='time_19', reason=None,
                     tags=parse_tagset(AV + '|АВ Этап: Оплата|АВ Время: 19'),
                     deals=5, first_seen=day, last_seen=day, files=('b.csv',))

    forward = find_unresolved([broken, resolved], INDEX)
    backward = find_unresolved([resolved, broken], INDEX)

    assert forward == backward
    # Побеждает 'resolved' (5 наблюдений > 2) — тип выводится, находок нет.
    assert forward == []


# --- Правка 2: find_extra_axes не должен требовать выводимый tag_type ---


def test_class_2_reports_unknown_axis_even_when_tag_type_is_undecidable():
    """find_extra_axes ходил по _latest_groups, которая выбрасывает группы
    без выводимого tag_type (нужного классам 1 и 4, но не классу 2 — он
    ищет неизвестные базе АВ-теги независимо от этапа). Из-за этого
    неизвестные оси на группах без 'АВ Этап' (например 'АВ Время: 20')
    молча не попадали в отчёт ни разу."""
    raw = AV + '|АВ Время: 20'  # нет АВ Этап -> tag_type не выводится (no_stage)
    groups = group_observations([obs(raw, 2)])
    vocabulary = frozenset({
        'АВ Продукт: ДБО', 'АВ Подрядчик: NR', 'АВ Канал: ВК',
        'АВ Направление: In Stream',
    })
    found = find_extra_axes(groups, vocabulary)
    assert any('АВ Время: 20' in f.subject for f in found)
