"""Отставленные четвёрки: гасят шум, но не слепоту.

Отставка действует, только пока по связке нет заказов. Появился заказ — находка
обязана вернуться, иначе список превращается из «решено» в «не смотрим».
"""
import datetime

from export_source import Observation
from findings import find_unknown_av_keys, find_unused_offers, group_observations
from api_source import Offer
from normalize import parse_tagset
from retired import RETIRED_KEYS, is_retired

# Первая четвёрка списка — берём из самого списка, чтобы тест не разошёлся с ним.
RETIRED_KEY = ('БОО', 'Рома', 'Яндекс', 'Реклама')
RETIRED_AV = ('АВ Продукт: БОО|АВ Подрядчик: Рома|АВ Канал: Яндекс|'
              'АВ Направление: Реклама')
LIVE_AV = ('АВ Продукт: ЩЖ|АВ Подрядчик: НИМБ|АВ Канал: Яндекс|'
           'АВ Направление: РСЯ')
LIVE_KEY = ('ЩЖ', 'НИМБ', 'Яндекс', 'РСЯ')


def offer(offer_id, raw, title='Курс'):
    return Offer(offer_id=offer_id, title=title, status='draft', tags=parse_tagset(raw))


def obs(raw, deal_id='1'):
    return Observation(deal_id=deal_id, tags=parse_tagset(raw),
                       file_name='deal_export_2026-05-02_00-00-00.csv',
                       file_date=datetime.date(2026, 5, 2),
                       deal_created='2026-05-01 00:00:00')


def test_retired_key_is_in_the_registry():
    assert RETIRED_KEY in RETIRED_KEYS


def test_every_entry_carries_a_date_and_a_reason():
    for key, value in RETIRED_KEYS.items():
        date, reason = value
        assert datetime.date.fromisoformat(date)
        assert reason.strip(), key


def test_is_retired_true_while_there_are_no_deals():
    assert is_retired(RETIRED_KEY, frozenset())


def test_is_retired_false_once_a_deal_appears():
    """Заказ по отставленной связке отменяет отставку."""
    assert not is_retired(RETIRED_KEY, {RETIRED_KEY})


def test_class_9_skips_a_retired_key():
    offers = [offer(1, RETIRED_AV + '|АВ Этап: Регистрация')]
    assert find_unknown_av_keys(offers, {}, frozenset()) == []


def test_class_9_reports_a_retired_key_again_when_it_starts_selling():
    offers = [offer(1, RETIRED_AV + '|АВ Этап: Регистрация')]
    found = find_unknown_av_keys(offers, {}, {RETIRED_KEY})
    assert [f.cls for f in found] == [9]
    assert 'Рома' in found[0].subject


def test_class_9_still_reports_keys_outside_the_list():
    offers = [offer(1, LIVE_AV + '|АВ Этап: Регистрация')]
    found = find_unknown_av_keys(offers, {}, frozenset())
    assert [f.cls for f in found] == [9]
    assert 'ЩЖ' in found[0].subject


def test_class_14_skips_a_retired_key():
    offers = [offer(1, RETIRED_AV + '|АВ Этап: Регистрация', title='Старый')]
    assert find_unused_offers(offers, []) == []


def test_class_14_still_reports_offers_outside_the_list():
    offers = [offer(1, LIVE_AV + '|АВ Этап: Регистрация', title='Старый')]
    found = find_unused_offers(offers, [])
    assert [f.cls for f in found] == [14]
    assert 'Старый' in found[0].subject


def test_class_14_stays_silent_for_a_retired_key_that_started_selling():
    """Класс 14 — про НУЛЬ заказов, поэтому продающая связка ему не находка.

    Возвращать её обязан класс 9 (см. тест выше), и оба пути не должны
    сработать одновременно.
    """
    groups = group_observations([obs(RETIRED_AV + '|АВ Этап: Регистрация')])
    offers = [offer(1, RETIRED_AV + '|АВ Этап: Регистрация')]
    assert find_unused_offers(offers, groups) == []
