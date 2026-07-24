import datetime

from api_source import Offer
from db_source import Expectation, FunnelRow
from export_source import Observation
from findings import (
    find_incomplete_offer_keys,
    find_key_collision_findings,
    find_offers_without_autofunnel,
    find_silent_funnels,
    find_unknown_av_keys,
    find_unknown_axes_in_registry,
    find_unused_offers,
    group_observations,
)
from normalize import parse_tagset

KEY = ('ДБО', 'NR', 'ВК', 'In Stream')
AV = 'АВ Продукт: ДБО|АВ Подрядчик: NR|АВ Канал: ВК|АВ Направление: In Stream'
INDEX = {KEY: {11}}


def offer(offer_id, raw, title='Курс'):
    return Offer(offer_id=offer_id, title=title, status='draft', tags=parse_tagset(raw))


def obs(raw, day=2, deal_id='1'):
    return Observation(deal_id=deal_id, tags=parse_tagset(raw),
                       file_name='deal_export_2026-05-02_00-00-00.csv',
                       file_date=datetime.date(2026, 5, day),
                       deal_created='2026-05-01 00:00:00')


def funnel(fid, num, code, status='active'):
    return FunnelRow(funnel_id=fid, num=num, front_code=code,
                     product_name='X', status=status)


def test_class_8_reports_collision_with_both_funnels():
    collisions = {('ЖИВО', 'НИМБ', 'Яндекс', 'РСЯ'): {34, 46}}
    expectations = [
        Expectation(funnel_id=34, num=34, front_code='f33', product_name='ЖИВО НИМБ РСЯ',
                    status='active', tag_type='reg', tags=frozenset()),
        Expectation(funnel_id=46, num=46, front_code='f43', product_name='КВИЗЫ ЖИВО НИМБ',
                    status='active', tag_type='reg', tags=frozenset()),
    ]
    found = find_key_collision_findings(collisions, expectations)
    assert [f.cls for f in found] == [8]
    assert 'f33' in found[0].evidence and 'f43' in found[0].evidence


def test_class_9_reports_av_key_present_in_registry_but_absent_from_db():
    offers = [offer(1, AV + '|АВ Этап: Регистрация'),
              offer(2, 'АВ Продукт: ЩЖ|АВ Подрядчик: НИМБ|АВ Канал: Яндекс|'
                       'АВ Направление: РСЯ|АВ Этап: Регистрация')]
    found = find_unknown_av_keys(offers, INDEX)
    assert [f.cls for f in found] == [9]
    assert 'ЩЖ' in found[0].subject


def test_class_9_counts_offers_per_key():
    raw = ('АВ Продукт: ЩЖ|АВ Подрядчик: НИМБ|АВ Канал: Яндекс|'
           'АВ Направление: РСЯ|АВ Этап: Регистрация')
    found = find_unknown_av_keys([offer(1, raw), offer(2, raw)], INDEX)
    assert len(found) == 1
    assert found[0].deals == 2


def test_class_10_reports_offer_with_incomplete_quadruple():
    offers = [offer(1, 'АВ Продукт: ДБО|АВ Канал: ВК|АВ Этап: Регистрация')]
    found = find_incomplete_offer_keys(offers)
    assert [f.cls for f in found] == [10]
    assert 'АВ Подрядчик' in found[0].detail


def test_class_10_ignores_offers_without_any_av_tags():
    assert find_incomplete_offer_keys([offer(1, 'ДБО|РСЯ')]) == []


def test_class_11_reports_axis_absent_from_db_vocabulary():
    vocabulary = frozenset({'АВ Продукт: ДБО', 'АВ Этап: Регистрация'})
    offers = [offer(1, 'АВ Продукт: ДБО|АВ Этап: Регистрация|АВ Линейка: Базовая')]
    found = find_unknown_axes_in_registry(offers, vocabulary)
    assert [f.cls for f in found] == [11]
    assert 'АВ Линейка' in found[0].subject


def test_class_12_reports_stage_without_autofunnel_tag():
    offers = [offer(1, AV + '|АВ Этап: Регистрация'),
              offer(2, AV + '|АВ Этап: Регистрация|АВ Автоворонка')]
    found = find_offers_without_autofunnel(offers)
    assert [f.cls for f in found] == [12]
    assert '1' in found[0].evidence


def test_class_13_reports_active_funnel_with_no_observations():
    groups = group_observations([obs(AV + '|АВ Этап: Регистрация')])
    funnels = [funnel(11, 11, 'f11'), funnel(99, 99, 'f99')]
    index = {KEY: {11}}
    found = find_silent_funnels(funnels, groups, index)
    assert [f.cls for f in found] == [13]
    assert found[0].funnel == 'f99'


def test_class_13_ignores_drafts_and_archive():
    funnels = [funnel(99, 99, 'f99', status='draft'),
               funnel(98, 98, 'f98', status='archive')]
    assert find_silent_funnels(funnels, [], {}) == []


def test_class_14_reports_av_offer_with_zero_deals():
    groups = group_observations([obs(AV + '|АВ Этап: Регистрация')])
    offers = [offer(1, AV + '|АВ Этап: Регистрация'),
              offer(2, 'АВ Продукт: ЩЖ|АВ Подрядчик: НИМБ|АВ Канал: Яндекс|'
                       'АВ Направление: РСЯ|АВ Этап: Регистрация', title='Старый')]
    found = find_unused_offers(offers, groups)
    assert [f.cls for f in found] == [14]
    assert 'Старый' in found[0].subject


def test_class_14_ignores_offers_without_av_tags():
    assert find_unused_offers([offer(1, 'ДБО|РСЯ')], []) == []
