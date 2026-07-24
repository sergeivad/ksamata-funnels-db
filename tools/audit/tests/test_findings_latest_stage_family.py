import datetime

from db_source import Expectation
from export_source import Observation
from findings import (
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
