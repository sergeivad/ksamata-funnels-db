"""Класс 17: предложение предсписка в GetCourse есть, а признак у воронки снят.

Класс заведён 2026-09-02 под расхождение, которое до него не ловил НИКТО, и
молчали все тихо: не падали, а честно отдавали ноль. Поэтому здесь важнее
обычного не только «находка есть», но и каждое «находки нет» — у каждого
такого теста своя причина, и все они разные.
"""

from api_source import Offer
from db_source import FunnelRow
from findings import (find_predspisok_without_flag, find_unused_offers,
                      offers_by_scenario)
from normalize import AUTOFUNNEL_TAG, PREDPISOK_STAGE, av_key, parse_tagset

AV = ('АВ Продукт: ДБО|АВ Подрядчик: NR|АВ Канал: ВК|'
      'АВ Направление: In Stream|' + AUTOFUNNEL_TAG)
KEY = ('ДБО', 'NR', 'ВК', 'In Stream', AUTOFUNNEL_TAG)
INDEX = {KEY: {11}}


def offer(raw, offer_id=1, title='Предсписок ДБО'):
    return Offer(offer_id=offer_id, title=title, status='draft',
                 tags=parse_tagset(raw))


def funnel(has_predspisok, fid=11, num=11, code='f11', status='active'):
    return FunnelRow(funnel_id=fid, num=num, front_code=code,
                     product_name='ДБО NR ВК', status=status,
                     has_predspisok=has_predspisok)


PREDSPISOK_OFFER = AV + '|' + PREDPISOK_STAGE


def test_key_literal_matches_av_key_of_the_fixture():
    """Страховка от молчаливого нуля в самих тестах.

    Разъехавшийся с AV литерал KEY означал бы, что INDEX не совпадает ни с
    чем, и ВСЕ тесты файла проходили бы «ноль находок» — включая те, что
    обязаны находку давать.
    """
    assert av_key(parse_tagset(PREDSPISOK_OFFER)) == KEY


def test_reports_a_funnel_whose_flag_is_down():
    found = find_predspisok_without_flag(
        [offer(PREDSPISOK_OFFER)], INDEX, [funnel(has_predspisok=False)])
    assert len(found) == 1
    item = found[0]
    assert item.cls == 17
    assert item.funnel == 'f11'
    assert item.tag_type == 'predspisok'
    assert 'has_predspisok = 0' in item.detail
    assert 'ДБО / NR / ВК / In Stream' in item.detail
    assert 'Предсписок ДБО' in item.evidence


def test_says_nothing_when_the_flag_is_up():
    """Штатное состояние: предложение есть, признак поднят."""
    found = find_predspisok_without_flag(
        [offer(PREDSPISOK_OFFER)], INDEX, [funnel(has_predspisok=True)])
    assert found == []


def test_counts_every_offer_of_the_funnel_but_reports_one_finding():
    offers = [offer(PREDSPISOK_OFFER, 1, 'Предсписок 1'),
              offer(PREDSPISOK_OFFER, 2, 'Предсписок 2')]
    found = find_predspisok_without_flag(
        offers, INDEX, [funnel(has_predspisok=False)])
    assert len(found) == 1
    assert 'Предложений предсписка в GetCourse: 2' in found[0].subject
    assert 'Предсписок 1' in found[0].evidence
    assert 'Предсписок 2' in found[0].evidence


def test_ignores_offers_of_other_scenarios():
    """Регистрация и оплата про признак предсписка не говорят ничего."""
    offers = [offer(AV + '|АВ Этап: Регистрация'),
              offer(AV + '|АВ Этап: Оплата|АВ Время: 19', 2)]
    found = find_predspisok_without_flag(
        offers, INDEX, [funnel(has_predspisok=False)])
    assert found == []


def test_reports_a_draft_or_archived_funnel_and_names_its_status():
    """Статус не фильтр, а часть находки: решение принимает человек."""
    found = find_predspisok_without_flag(
        [offer(PREDSPISOK_OFFER)], INDEX,
        [funnel(has_predspisok=False, status='archive')])
    assert len(found) == 1
    assert 'статус воронки archive' in found[0].detail


def test_orders_findings_by_funnel_not_by_dict_iteration():
    # Второй продукт — ЩЖ, а не первый попавшийся: связка `ЖКТ / NR / ВК /
    # In Stream` отставлена (retired.py), и тест проверял бы фильтр отставки
    # вместо порядка.
    offers = [offer(PREDSPISOK_OFFER, 1),
              offer(AV.replace('ДБО', 'ЩЖ') + '|' + PREDPISOK_STAGE, 2)]
    index = dict(INDEX)
    index[('ЩЖ', 'NR', 'ВК', 'In Stream', AUTOFUNNEL_TAG)] = {12}
    funnels = [funnel(False, fid=11, num=11, code='f11'),
               funnel(False, fid=12, num=12, code='f12')]
    found = find_predspisok_without_flag(offers, index, funnels)
    assert [f.funnel for f in found] == ['f11', 'f12']


# ─── Чужие классы: один факт не должен приезжать в отчёт дважды ─────────────


def test_says_nothing_when_no_funnel_holds_the_key():
    """Это класс 9 («ключ есть в GetCourse, воронки нет»), не 17."""
    found = find_predspisok_without_flag(
        [offer(PREDSPISOK_OFFER)], {}, [funnel(has_predspisok=False)])
    assert found == []


def test_says_nothing_when_the_key_points_at_two_funnels():
    """Это класс 8. Угадывать, какой из двух воронок адресовано предложение,
    нельзя, а «поднимите галку у обеих» — совет наугад."""
    found = find_predspisok_without_flag(
        [offer(PREDSPISOK_OFFER)], {KEY: {11, 12}},
        [funnel(False, fid=11), funnel(False, fid=12, num=12, code='f12')])
    assert found == []


def test_says_nothing_when_the_offer_key_is_incomplete():
    """Нет маркера типа — это класс 12, нет оси — класс 10."""
    without_marker = AV.replace('|' + AUTOFUNNEL_TAG, '') + '|' + PREDPISOK_STAGE
    found = find_predspisok_without_flag(
        [offer(without_marker)], INDEX, [funnel(has_predspisok=False)])
    assert found == []


# ─── Отставка ──────────────────────────────────────────────────────────────
#
# RETIRED_KEYS хранит СВЯЗКИ (четвёрки), а полный ключ пятиэлементный, так что
# вызывающий обязан срезать его через quad. Забытый quad не падает — он делает
# фильтр несовпадающим никогда, то есть молча пропускает всё. Ровно поэтому
# место проверяется тестом, а не только глазами (см. retired.py).

RETIRED_QUAD = ('ГП', 'НИМБ', 'Яндекс', 'РСЯ')     # решение 2026-07-27
RETIRED_AV = ('АВ Продукт: ГП|АВ Подрядчик: НИМБ|АВ Канал: Яндекс|'
              'АВ Направление: РСЯ|' + AUTOFUNNEL_TAG)
RETIRED_KEY = RETIRED_QUAD + (AUTOFUNNEL_TAG,)


def test_skips_a_retired_bundle():
    found = find_predspisok_without_flag(
        [offer(RETIRED_AV + '|' + PREDPISOK_STAGE)],
        {RETIRED_KEY: {11}},
        [funnel(has_predspisok=False)],
    )
    assert found == []


def test_a_retired_bundle_that_sold_again_comes_back():
    """Отставка условна: заказ после даты решения снимает её (retired.py)."""
    found = find_predspisok_without_flag(
        [offer(RETIRED_AV + '|' + PREDPISOK_STAGE)],
        {RETIRED_KEY: {11}},
        [funnel(has_predspisok=False)],
        order_dates={RETIRED_QUAD: '2026-08-15 10:00:00'},
    )
    assert len(found) == 1


# ─── offers_by_scenario ────────────────────────────────────────────────────


def test_offers_by_scenario_splits_the_registry_by_tag_type():
    offers = [
        offer(AV + '|АВ Этап: Регистрация', 1),
        offer(PREDSPISOK_OFFER, 2),
        offer(AV + '|АВ Этап: Оплата|АВ Время: 15', 3),
        offer(AV + '|АВ Этап: Оплата|АВ Время: 19', 4),
        offer(AV + '|АВ Этап: Мессенджер', 5),
    ]
    by_scenario = offers_by_scenario(offers)
    assert {k: [o.offer_id for o in v] for k, v in by_scenario.items()} == {
        'reg': [1], 'predspisok': [2], 'time_15': [3], 'time_19': [4],
        'messenger': [5],
    }


def test_offers_by_scenario_drops_offers_whose_scenario_is_not_derivable():
    """Причины неопознания — предмет класса 5, а не этой функции."""
    offers = [
        offer(AV, 1),                                  # нет этапа вовсе
        offer(AV + '|АВ Этап: Оплата', 2),             # оплата без времени
    ]
    assert offers_by_scenario(offers) == {}


def test_overlaps_with_class_14_on_purpose():
    """Свежее предложение попадает и в класс 14, и в класс 17 — так и надо.

    Сценарий раскатки, а не гипотетика: предложение этапа завели, заказов по
    нему ещё нет, галку у воронки не подняли. Класс 14 говорит «заказов нет,
    кандидат в архив», класс 17 — «признак не поднят». Утверждения РАЗНЫЕ, и
    оба верны; человеку нужны оба, потому что действия по ним противоположны
    (одно ведёт к архиву, другое — к галке).

    Тест стоит здесь, чтобы пересечение не «починили» как дубль: заглушить
    класс 14 на предложениях предсписка значило бы спрятать настоящий архивный
    кандидат в тот день, когда галку поднимут, а предложение так и не выстрелит.

    Проверено на живых данных 02.09.2026: обе находки воспроизводятся.
    """
    single = [offer(PREDSPISOK_OFFER)]
    c17 = find_predspisok_without_flag(single, INDEX, [funnel(has_predspisok=False)])
    # groups пуст = по ключу нет ни одного заказа за период
    c14 = find_unused_offers(single, [])

    assert len(c17) == 1 and c17[0].cls == 17
    assert len(c14) == 1 and c14[0].cls == 14
    # И это разные утверждения об одном предложении, а не одно и то же дважды.
    assert c17[0].detail != c14[0].detail
