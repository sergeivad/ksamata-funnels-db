"""Отставленные четвёрки: гасят шум, но не слепоту.

Отставка действует, пока после ДАТЫ РЕШЕНИЯ по связке не было заказов. Продала
снова — находка обязана вернуться, иначе список превращается из «решено»
в «не смотрим». Прошлые заказы отставку не отменяют: почти все записи списка
как раз продавали когда-то.
"""
import datetime

from api_source import Offer
from export_source import Observation
from findings import (
    find_drift,
    find_extra_axes,
    find_unknown_av_keys,
    find_unknown_axes_in_registry,
    find_unresolved,
    find_unused_offers,
    group_observations,
    last_order_dates,
    registry_keys_of,
)
from normalize import parse_tagset
from retired import RETIRED_KEYS, is_retired

RETIRED_KEY = ('БОО', 'Рома', 'Яндекс', 'Реклама')
RETIRED_AV = ('АВ Продукт: БОО|АВ Подрядчик: Рома|АВ Канал: Яндекс|'
              'АВ Направление: Реклама')
LIVE_AV = ('АВ Продукт: ЩЖ|АВ Подрядчик: Незнакомец|АВ Канал: Яндекс|'
           'АВ Направление: РСЯ')
LIVE_KEY = ('ЩЖ', 'Незнакомец', 'Яндекс', 'РСЯ')

RETIRED_ON = RETIRED_KEYS[RETIRED_KEY][0]          # '2026-07-27'
BEFORE, AFTER = '2026-05-01', '2026-09-01'


def offer(offer_id, raw, title='Курс'):
    return Offer(offer_id=offer_id, title=title, status='draft', tags=parse_tagset(raw))


def obs(raw, created, deal_id='1'):
    return Observation(deal_id=deal_id, tags=parse_tagset(raw),
                       file_name='deal_export_2026-05-02_00-00-00.csv',
                       file_date=datetime.date(2026, 5, 2),
                       deal_created=f'{created} 10:00:00')


# ─── реестр решений ──────────────────────────────────────────────────────────

def test_every_entry_carries_a_valid_date_and_a_reason():
    for key, (date, reason) in RETIRED_KEYS.items():
        assert datetime.date.fromisoformat(date), key
        assert reason.strip(), key


def test_registry_has_no_incomplete_keys():
    for key in RETIRED_KEYS:
        assert len(key) == 4 and all(part.strip() for part in key), key


# ─── само правило ────────────────────────────────────────────────────────────

def test_retired_when_there_were_never_any_orders():
    assert is_retired(RETIRED_KEY, None)


def test_retired_when_the_last_order_predates_the_decision():
    """Прошлые заказы отставку НЕ отменяют — иначе список бесполезен."""
    assert is_retired(RETIRED_KEY, BEFORE)


def test_not_retired_when_an_order_arrives_after_the_decision():
    assert not is_retired(RETIRED_KEY, AFTER)


def test_an_order_on_the_decision_day_itself_does_not_revive():
    """Граница включительно: решение принято по данным этого дня."""
    assert is_retired(RETIRED_KEY, RETIRED_ON)


def test_unparseable_date_fails_open():
    """Непонятная дата = «мог быть заказ позже». Лучше лишняя находка."""
    assert not is_retired(RETIRED_KEY, '01.05.2026')
    assert not is_retired(RETIRED_KEY, '')


def test_key_outside_the_registry_is_never_retired():
    assert not is_retired(LIVE_KEY, None)


def test_date_with_a_time_tail_is_accepted():
    assert is_retired(RETIRED_KEY, f'{BEFORE} 23:59:59')


# ─── сбор дат заказов ────────────────────────────────────────────────────────

def test_last_order_dates_takes_the_latest_per_key():
    dates = last_order_dates([
        obs(RETIRED_AV + '|АВ Этап: Регистрация', '2026-03-01', '1'),
        obs(RETIRED_AV + '|АВ Этап: Регистрация', '2026-06-15', '2'),
        obs(RETIRED_AV + '|АВ Этап: Регистрация', '2026-01-09', '3'),
    ])
    assert dates[RETIRED_KEY].startswith('2026-06-15')


def test_last_order_dates_ignores_incomplete_keys():
    assert last_order_dates([obs('АВ Продукт: БОО|АВ Этап: Оплата', '2026-06-01')]) == {}


# ─── класс 9 ─────────────────────────────────────────────────────────────────

def test_class_9_skips_a_retired_key_that_only_sold_before_the_decision():
    offers = [offer(1, RETIRED_AV + '|АВ Этап: Регистрация')]
    assert find_unknown_av_keys(offers, {}, {RETIRED_KEY: BEFORE}) == []


def test_class_9_reports_a_retired_key_that_sold_again_afterwards():
    offers = [offer(1, RETIRED_AV + '|АВ Этап: Регистрация')]
    found = find_unknown_av_keys(offers, {}, {RETIRED_KEY: AFTER})
    assert [f.cls for f in found] == [9]
    assert 'Рома' in found[0].subject


def test_class_9_still_reports_keys_outside_the_registry():
    offers = [offer(1, LIVE_AV + '|АВ Этап: Регистрация')]
    found = find_unknown_av_keys(offers, {}, {})
    assert [f.cls for f in found] == [9]
    assert 'Незнакомец' in found[0].subject


def test_class_9_stays_silent_when_the_funnel_exists_in_the_db():
    offers = [offer(1, LIVE_AV + '|АВ Этап: Регистрация')]
    assert find_unknown_av_keys(offers, {LIVE_KEY: {11}}, {}) == []


# ─── класс 14 ────────────────────────────────────────────────────────────────

def test_class_14_skips_a_retired_key():
    offers = [offer(1, RETIRED_AV + '|АВ Этап: Регистрация', title='Старый')]
    assert find_unused_offers(offers, []) == []


def test_class_14_still_reports_offers_outside_the_registry():
    offers = [offer(1, LIVE_AV + '|АВ Этап: Регистрация', title='Старый')]
    found = find_unused_offers(offers, [])
    assert [f.cls for f in found] == [14]
    assert 'Старый' in found[0].subject


def test_class_14_stays_silent_for_a_retired_key_that_started_selling():
    """Класс 14 — про НУЛЬ заказов, поэтому продающая связка ему не находка.

    Возвращать её обязан класс 9 (см. тест выше), и оба пути не должны
    сработать одновременно.
    """
    groups = group_observations([obs(RETIRED_AV + '|АВ Этап: Регистрация', '2026-09-01')])
    offers = [offer(1, RETIRED_AV + '|АВ Этап: Регистрация')]
    assert find_unused_offers(offers, groups) == []


# ─── класс 7 подчиняется тому же правилу отставки, что и класс 9 ─────────────

def test_class_7_skips_a_retired_key_that_only_sold_before_the_decision():
    """Иначе отставленная связка просто переезжает из класса 9 в класс 7.

    На живых данных 28 из 32 находок класса 7 были ровно теми связками,
    что уже отставлены.
    """
    groups = group_observations([obs(RETIRED_AV + '|АВ Этап: Регистрация', BEFORE)])
    assert find_unresolved(groups, {}, {RETIRED_KEY}, {RETIRED_KEY: BEFORE}) == []


def test_class_7_reports_a_retired_key_that_sold_again_afterwards():
    groups = group_observations([obs(RETIRED_AV + '|АВ Этап: Регистрация', AFTER)])
    found = find_unresolved(groups, {}, {RETIRED_KEY}, {RETIRED_KEY: AFTER})
    assert [f.cls for f in found] == [7]
    assert 'Рома' in found[0].subject


# ─── класс 15 подчиняется тому же правилу отставки ───────────────────────────

def _drift_obs(raw, day, created, deal_id='1'):
    """Наблюдение с управляемой ДАТОЙ ФАЙЛА: класс 15 меряет дрейф по ней."""
    return Observation(deal_id=deal_id, tags=parse_tagset(raw),
                       file_name=f'deal_export_2026-05-{day:02d}_00-00-00.csv',
                       file_date=datetime.date(2026, 5, day),
                       deal_created=f'{created} 10:00:00')


def _drift_pair(av, created):
    """Единогласная пропажа маркера между двумя выгрузками — заведомая находка."""
    base = av + '|АВ Этап: Регистрация'
    return [_drift_obs(base + '|АВ Квиз', 2, created, '1'),
            _drift_obs(base, 13, created, '2')]


def test_class_15_skips_a_retired_key_that_only_sold_before_the_decision():
    """Разметку мая у связки, объявленной отработавшей, чинить уже незачем.

    Без этого фильтра отставка «переезжает» из класса в класс: на прогоне
    2026-07-27 последней находкой класса 15 осталась ровно отставленная
    `ЗП / НИМБ / Яндекс / РСЯ`.
    """
    found = find_drift(_drift_pair(RETIRED_AV, BEFORE), {}, [],
                       {RETIRED_KEY: BEFORE})
    assert found == []


def test_class_15_reports_a_retired_key_that_sold_again_afterwards():
    found = find_drift(_drift_pair(RETIRED_AV, AFTER), {}, [],
                       {RETIRED_KEY: AFTER})
    assert [f.cls for f in found] == [15]


def test_class_15_still_reports_a_live_key():
    """Парный: фильтр отставки не должен гасить класс целиком."""
    found = find_drift(_drift_pair(LIVE_AV, BEFORE), {}, [], {LIVE_KEY: BEFORE})
    assert [f.cls for f in found] == [15]


# ─── классы 2 и 11 подчиняются тому же правилу отставки ─────────────────────

# Словарь знает обе четвёрки и этап целиком, поэтому единственный неизвестный
# базе тег в тестах ниже — «АВ Время: 20». Иначе находка возникала бы и без
# него, и тест проходил бы по случайной причине.
VOCAB = (parse_tagset(RETIRED_AV) | parse_tagset(LIVE_AV)
         | {'АВ Этап: Регистрация'})
UNKNOWN = '|АВ Этап: Регистрация|АВ Время: 20'


def test_class_2_skips_a_retired_key_that_only_sold_before_the_decision():
    """Иначе отставка переезжает из класса 7 в класс 2 и шум не убывает.

    На прогоне 2026-07-27 так выглядели 30 находок класса 2 из 46: словарь
    базы не знает `АВ Подрядчик: Илья` именно потому, что воронки под эту
    связку нет — она отработала.
    """
    groups = group_observations([obs(RETIRED_AV + UNKNOWN, BEFORE)])
    assert find_extra_axes(groups, VOCAB, {RETIRED_KEY: BEFORE}) == []


def test_class_2_reports_a_retired_key_that_sold_again_afterwards():
    groups = group_observations([obs(RETIRED_AV + UNKNOWN, AFTER)])
    found = find_extra_axes(groups, VOCAB, {RETIRED_KEY: AFTER})
    assert [f.cls for f in found] == [2]
    assert 'АВ Время: 20' in found[0].subject


def test_class_2_still_reports_a_live_key():
    """Парный: фильтр отставки не должен гасить класс целиком."""
    groups = group_observations([obs(LIVE_AV + UNKNOWN, BEFORE)])
    found = find_extra_axes(groups, VOCAB, {LIVE_KEY: BEFORE})
    assert [f.cls for f in found] == [2]


def test_class_11_skips_a_retired_key_that_only_sold_before_the_decision():
    """Замер 2026-07-27: 20 из 24 неизвестных базе значений — только отставка."""
    offers = [offer(1, RETIRED_AV + UNKNOWN)]
    assert find_unknown_axes_in_registry(offers, VOCAB,
                                         {RETIRED_KEY: BEFORE}) == []


def test_class_11_reports_a_retired_key_that_sold_again_afterwards():
    offers = [offer(1, RETIRED_AV + UNKNOWN)]
    found = find_unknown_axes_in_registry(offers, VOCAB, {RETIRED_KEY: AFTER})
    assert [f.cls for f in found] == [11]
    assert found[0].subject == 'АВ Время'


def test_class_11_still_reports_a_live_key():
    offers = [offer(1, LIVE_AV + UNKNOWN)]
    found = find_unknown_axes_in_registry(offers, VOCAB, {LIVE_KEY: BEFORE})
    assert [f.cls for f in found] == [11]


def test_registry_keys_of_collects_only_complete_quadruples():
    keys = registry_keys_of([
        offer(1, RETIRED_AV + '|АВ Этап: Регистрация'),
        offer(2, 'АВ Продукт: БОО|АВ Этап: Оплата'),
    ])
    assert keys == {RETIRED_KEY}
