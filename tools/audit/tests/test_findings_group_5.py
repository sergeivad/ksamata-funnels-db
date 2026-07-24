import datetime

from db_source import Expectation, FunnelRow
from export_source import Observation
from findings import find_coverage, find_drift, group_observations
from normalize import parse_tagset

KEY = ('ДБО', 'NR', 'ВК', 'In Stream')
AV = 'АВ Продукт: ДБО|АВ Подрядчик: NR|АВ Канал: ВК|АВ Направление: In Stream'
INDEX = {KEY: {11}}
EXPECTATIONS = [
    Expectation(funnel_id=11, num=11, front_code='f11', product_name='ДБО NR ВК',
                status='active', tag_type='reg', tags=parse_tagset(AV))
]


def obs(raw, day, deal_id='1', file_name=None):
    date = datetime.date(2026, 5, day)
    return Observation(
        deal_id=deal_id, tags=parse_tagset(raw),
        file_name=file_name or f'deal_export_2026-05-{day:02d}_00-00-00.csv',
        file_date=date, deal_created='2026-05-01 00:00:00')


def test_class_15_reports_tag_appearing_between_two_export_dates():
    base = AV + '|АВ Этап: Регистрация'
    groups = group_observations([obs(base, 2, '1'), obs(base + '|СВС', 13, '2')])
    found = find_drift(groups, INDEX, EXPECTATIONS)
    assert [f.cls for f in found] == [15]
    assert 'СВС' in found[0].subject
    assert 'появился' in found[0].detail
    assert found[0].first_seen == '2026-05-02'
    assert found[0].last_seen == '2026-05-13'


def test_class_15_reports_tag_disappearing():
    base = AV + '|АВ Этап: Регистрация'
    groups = group_observations([obs(base + '|СВС', 2, '1'), obs(base, 13, '2')])
    found = find_drift(groups, INDEX, EXPECTATIONS)
    assert 'исчез' in found[0].detail


def test_class_15_silent_when_only_one_tagset_ever_seen():
    base = AV + '|АВ Этап: Регистрация'
    groups = group_observations([obs(base, 2, '1'), obs(base, 13, '2')])
    assert find_drift(groups, INDEX, EXPECTATIONS) == []


def test_class_15_uses_file_date_not_deal_created_date():
    """Мартовский заказ в майской выгрузке несёт МАЙСКИЕ теги."""
    base = AV + '|АВ Этап: Регистрация'
    early = Observation(deal_id='1', tags=parse_tagset(base),
                        file_name='deal_export_2026-05-02_00-00-00.csv',
                        file_date=datetime.date(2026, 5, 2),
                        deal_created='2026-03-10 10:00:00')
    late = Observation(deal_id='1', tags=parse_tagset(base + '|СВС'),
                       file_name='deal_export_2026-05-13_00-00-00.csv',
                       file_date=datetime.date(2026, 5, 13),
                       deal_created='2026-03-10 10:00:00')
    found = find_drift(group_observations([early, late]), INDEX, EXPECTATIONS)
    assert found[0].first_seen == '2026-05-02'
    assert found[0].last_seen == '2026-05-13'


def test_class_16_reports_observation_and_file_counts_per_funnel():
    base = AV + '|АВ Этап: Регистрация'
    groups = group_observations([
        obs(base, 2, '1', 'deal_export_2026-05-02_00-00-00.csv'),
        obs(base, 13, '2', 'deal_export_2026-05-13_00-00-00.csv'),
    ])
    funnels = [FunnelRow(funnel_id=11, num=11, front_code='f11',
                         product_name='ДБО NR ВК', status='active')]
    found = find_coverage(funnels, groups, INDEX)
    assert [f.cls for f in found] == [16]
    assert found[0].funnel == 'f11'
    assert found[0].deals == 2
    assert '2 файл' in found[0].detail
    assert found[0].last_seen == '2026-05-13'


def test_class_16_marks_thin_coverage_explicitly():
    base = AV + '|АВ Этап: Регистрация'
    groups = group_observations([obs(base, 2, '1')])
    funnels = [FunnelRow(funnel_id=11, num=11, front_code='f11',
                         product_name='X', status='active')]
    found = find_coverage(funnels, groups, INDEX)
    assert 'мало данных' in found[0].subject


def test_class_16_includes_funnels_with_zero_observations():
    funnels = [FunnelRow(funnel_id=99, num=99, front_code='f99',
                         product_name='X', status='active')]
    found = find_coverage(funnels, [], {})
    assert found[0].deals == 0
    assert 'нет данных' in found[0].subject
