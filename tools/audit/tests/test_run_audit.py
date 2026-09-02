import datetime

from api_source import Offer
from db_source import Expectation, FunnelRow
from export_source import Observation
from findings import CLASS_TITLES, group_observations
from normalize import AUTOFUNNEL_TAG, PREDPISOK_STAGE, parse_tagset
from run_audit import collect_findings

# Без маркера: этот сценарий нарочно воспроизводит предложение без типа
# воронки (класс 12 должен сработать), поэтому KEY несёт явный None пятым —
# он должен совпасть с av_key(...), у которого маркер отсутствует.
KEY = ('ДБО', 'NR', 'ВК', 'In Stream', None)
AV = 'АВ Продукт: ДБО|АВ Подрядчик: NR|АВ Канал: ВК|АВ Направление: In Stream'


def test_collect_findings_runs_every_class_and_tags_them_correctly():
    expectations = [
        Expectation(funnel_id=11, num=11, front_code='f11', product_name='ДБО NR ВК',
                    status='active', tag_type='reg',
                    tags=parse_tagset(AV + '|АВ Этап: Регистрация|автоворонки'))
    ]
    funnels = [
        FunnelRow(funnel_id=11, num=11, front_code='f11', product_name='ДБО NR ВК',
                  status='active', has_predspisok=True),
        FunnelRow(funnel_id=99, num=99, front_code='f99', product_name='Тихая',
                  status='active', has_predspisok=True),
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
    tags = AV + '|АВ Этап: Регистрация|' + AUTOFUNNEL_TAG
    expectations = [
        Expectation(funnel_id=11, num=11, front_code='f11', product_name='X',
                    status='active', tag_type='reg', tags=parse_tagset(tags))
    ]
    funnels = [FunnelRow(funnel_id=11, num=11, front_code='f11',
                         product_name='X', status='active', has_predspisok=True)]
    # Здесь, в отличие от предыдущего теста, маркер ЕСТЬ everywhere (db,
    # выгрузка, реестр) — значит и индекс должен быть по ПОЛНОМУ ключу,
    # иначе class 7/9/13/16 не увидят совпадения и вернут лишние находки.
    key_typed = KEY[:4] + (AUTOFUNNEL_TAG,)
    index = {key_typed: {11}}
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


def test_collect_findings_wires_the_predspisok_flag_class():
    """Класс 17 включён в прогон.

    Тест на проводку, а не на логику класса (она в
    test_findings_predspisok_flag.py): забытая строка `result += ...` в
    collect_findings не роняет ничего и не меняет ни одного другого класса —
    отчёт просто получает вечно пустой лист, неотличимый от «расхождений нет».
    """
    tags = AV + '|АВ Этап: Регистрация|' + AUTOFUNNEL_TAG
    key_typed = KEY[:4] + (AUTOFUNNEL_TAG,)
    expectations = [
        Expectation(funnel_id=11, num=11, front_code='f11', product_name='X',
                    status='active', tag_type='reg', tags=parse_tagset(tags))
    ]
    funnels = [FunnelRow(funnel_id=11, num=11, front_code='f11',
                         product_name='X', status='active', has_predspisok=False)]
    observations = [
        Observation(deal_id='1', tags=parse_tagset(tags),
                    file_name='deal_export_2026-05-02_00-00-00.csv',
                    file_date=datetime.date(2026, 5, 2), deal_created='2026-05-01'),
    ]
    groups = group_observations(observations)
    offers = [
        Offer(offer_id=1, title='Курс', status='draft', tags=parse_tagset(tags)),
        Offer(offer_id=2, title='Предсписок', status='draft',
              tags=parse_tagset(AV + '|' + PREDPISOK_STAGE + '|' + AUTOFUNNEL_TAG)),
    ]

    found = collect_findings(expectations, funnels, parse_tagset(tags),
                             {key_typed: {11}}, {}, groups, observations, offers)
    # 16 — покрытие, оно считается всегда; 17 — сама находка.
    assert {f.cls for f in found} == {16, 17}
    assert [f.funnel for f in found if f.cls == 17] == ['f11']
