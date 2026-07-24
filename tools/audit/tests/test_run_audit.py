import datetime

from api_source import Offer
from db_source import Expectation, FunnelRow
from export_source import Observation
from findings import CLASS_TITLES, group_observations
from normalize import parse_tagset
from run_audit import collect_findings

KEY = ('ДБО', 'NR', 'ВК', 'In Stream')
AV = 'АВ Продукт: ДБО|АВ Подрядчик: NR|АВ Канал: ВК|АВ Направление: In Stream'


def test_collect_findings_runs_every_class_and_tags_them_correctly():
    expectations = [
        Expectation(funnel_id=11, num=11, front_code='f11', product_name='ДБО NR ВК',
                    status='active', tag_type='reg',
                    tags=parse_tagset(AV + '|АВ Этап: Регистрация|автоворонки'))
    ]
    funnels = [
        FunnelRow(funnel_id=11, num=11, front_code='f11', product_name='ДБО NR ВК',
                  status='active'),
        FunnelRow(funnel_id=99, num=99, front_code='f99', product_name='Тихая',
                  status='active'),
    ]
    vocabulary = parse_tagset(AV + '|АВ Этап: Регистрация|автоворонки')
    index = {KEY: {11}}
    observations = [
        Observation(deal_id='1', tags=parse_tagset(AV + '|АВ Этап: Регистрация'),
                    file_name='deal_export_2026-05-02_00-00-00.csv',
                    file_date=datetime.date(2026, 5, 2), deal_created='2026-05-01'),
    ]
    groups = group_observations(observations)
    offers = [Offer(offer_id=1, title='Курс', status='draft',
                    tags=parse_tagset(AV + '|АВ Этап: Регистрация'))]

    found = collect_findings(expectations, funnels, vocabulary, index, {},
                             groups, observations, offers)
    classes = {f.cls for f in found}

    assert 1 in classes    # 'автоворонки' ожидается базой, в GetCourse нет
    assert 12 in classes   # у предложения нет АВ Автоворонка
    assert 13 in classes   # f99 без наблюдений
    assert 16 in classes   # покрытие считается всегда
    assert classes <= set(CLASS_TITLES)


def test_collect_findings_returns_empty_classes_when_everything_matches():
    tags = AV + '|АВ Этап: Регистрация|АВ Автоворонка'
    expectations = [
        Expectation(funnel_id=11, num=11, front_code='f11', product_name='X',
                    status='active', tag_type='reg', tags=parse_tagset(tags))
    ]
    funnels = [FunnelRow(funnel_id=11, num=11, front_code='f11',
                         product_name='X', status='active')]
    index = {KEY: {11}}
    observations = [
        Observation(deal_id='1', tags=parse_tagset(tags),
                    file_name='deal_export_2026-05-02_00-00-00.csv',
                    file_date=datetime.date(2026, 5, 2), deal_created='2026-05-01'),
    ]
    groups = group_observations(observations)
    offers = [Offer(offer_id=1, title='Курс', status='draft', tags=parse_tagset(tags))]

    found = collect_findings(expectations, funnels, parse_tagset(tags),
                             index, {}, groups, observations, offers)
    # Остаётся только класс 16 — он описывает покрытие, а не дефект.
    assert {f.cls for f in found} == {16}
