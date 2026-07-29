import datetime

from db_source import Expectation, FunnelRow
from export_source import Observation
from findings import find_coverage, find_drift, group_observations
from normalize import parse_tagset

# Пятый элемент — маркер типа воронки (см. normalize.av_key). AV сознательно
# БЕЗ маркера, и тесты класса 15 ниже нарочно переключают именно
# «АВ Время: 20», а не маркер типа воронки («АВ Автоворонка» / «АВ Квиз» и
# т.п.): маркер теперь ЧАСТЬ av_key, и find_drift группирует наблюдения по
# слоту (av_key(tags), tag_type) — появление/исчезновение маркера меняло бы
# сам слот, а не тег внутри него, и пара наблюдений разъезжалась бы по двум
# разным слотам вместо одного дрейфующего. «АВ Время: 20» в av_key не
# участвует (это не ось и не маркер), поэтому безопасно им и подменяем.
KEY = ('ДБО', 'NR', 'ВК', 'In Stream', None)
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
    observations = [obs(base, 2, '1'), obs(base + '|АВ Время: 20', 13, '2')]
    found = find_drift(observations, INDEX, EXPECTATIONS)
    assert [f.cls for f in found] == [15]
    assert 'АВ Время: 20' in found[0].subject
    assert 'появился' in found[0].detail
    assert found[0].first_seen == '2026-05-02'
    assert found[0].last_seen == '2026-05-13'


def test_class_15_reports_tag_disappearing():
    base = AV + '|АВ Этап: Регистрация'
    observations = [obs(base + '|АВ Время: 20', 2, '1'), obs(base, 13, '2')]
    found = find_drift(observations, INDEX, EXPECTATIONS)
    assert 'исчез' in found[0].detail


def test_class_15_silent_when_only_one_tagset_ever_seen():
    base = AV + '|АВ Этап: Регистрация'
    observations = [obs(base, 2, '1'), obs(base, 13, '2')]
    assert find_drift(observations, INDEX, EXPECTATIONS) == []


def test_class_15_uses_file_date_not_deal_created_date():
    """Мартовский заказ в майской выгрузке несёт МАЙСКИЕ теги."""
    base = AV + '|АВ Этап: Регистрация'
    early = Observation(deal_id='1', tags=parse_tagset(base),
                        file_name='deal_export_2026-05-02_00-00-00.csv',
                        file_date=datetime.date(2026, 5, 2),
                        deal_created='2026-03-10 10:00:00')
    late = Observation(deal_id='1', tags=parse_tagset(base + '|АВ Время: 20'),
                       file_name='deal_export_2026-05-13_00-00-00.csv',
                       file_date=datetime.date(2026, 5, 13),
                       deal_created='2026-03-10 10:00:00')
    found = find_drift([early, late], INDEX, EXPECTATIONS)
    assert found[0].first_seen == '2026-05-02'
    assert found[0].last_seen == '2026-05-13'


def test_class_15_reports_both_transitions_when_tagset_returns_to_original():
    """A → B → A: переход «появился» не должен теряться при возврате к A.

    Раньше group_observations сворачивал оба наблюдения набора A
    (05-02 и 05-13) в одну Group с last_seen=05-13, из-за чего
    find_drift видел только вариант A (05-13) и вариант B (05-08) и
    сообщал единственный переход «исчез» между ними — переход
    «появился» между 05-02 и 05-08 пропадал молча.
    """
    base = AV + '|АВ Этап: Регистрация'
    observations = [
        obs(base, 2, '1'),
        obs(base + '|АВ Время: 20', 8, '2'),
        obs(base, 13, '3'),
    ]
    found = find_drift(observations, INDEX, EXPECTATIONS)
    assert [f.cls for f in found] == [15, 15]

    appear, disappear = found
    assert 'появился' in appear.detail
    assert 'АВ Время: 20' in appear.subject
    assert appear.first_seen == '2026-05-02'
    assert appear.last_seen == '2026-05-08'

    assert 'исчез' in disappear.detail
    assert 'АВ Время: 20' in disappear.subject
    assert disappear.first_seen == '2026-05-08'
    assert disappear.last_seen == '2026-05-13'


def test_class_15_single_date_in_slot_has_no_findings():
    base = AV + '|АВ Этап: Регистрация'
    observations = [obs(base, 2, '1'), obs(base, 2, '2')]
    assert find_drift(observations, INDEX, EXPECTATIONS) == []


def test_class_15_orders_multiple_simultaneous_tag_changes_deterministically():
    """Пять тегов меняется разом — и с двух сторон (appeared И
    disappeared), не только с одной.

    Прогоняет замену sorted(...) на list(...) в find_drift: если find_drift
    начнёт полагаться на порядок обхода set-разности, порядок тегов в
    subject/detail станет недетерминированным между процессами
    (PYTHONHASHSEED). С парой изменившихся тегов на сторону случайный
    порядок из frozenset совпадает со отсортированным примерно в
    половине запусков — недостаточно надёжно. Здесь по 5 тегов меняются
    на каждой стороне (appeared и disappeared независимо), так что
    list(frozenset) должен угадать оба 5-элементных порядка одновременно,
    чтобы случайно пройти тест — вероятность этого 1/120 на сторону.

    Теги вставляются в наборы в порядке, обратном алфавитному, а
    ожидаются в утверждении — в алфавитном: так тест ловит именно
    отсутствие сортировки, а не случайное совпадение порядка вставки.

    Меняются лишние значения оси «АВ Направление», а не произвольные слова:
    после фильтра `is_av_tag` класс 15 видит только словарь АВ-таксономии.
    Ключ слота при этом не съезжает — av_value берёт минимальное значение
    оси, а латинское «In Stream» меньше любого кириллического.
    """
    d = '|АВ Направление: '
    older = AV + '|АВ Этап: Регистрация' + d + ('КОРЬ' + d + 'ИЖИЦА' + d
                                                + 'ЗЕВС' + d + 'ЖЕСТ' + d + 'ЕЖИК')
    newer = AV + '|АВ Этап: Регистрация' + d + ('ДЕЛЬТА' + d + 'ГАММА' + d
                                                + 'ВЕГА' + d + 'БЕТА' + d + 'АЛЬФА')
    observations = [obs(older, 2, '1'), obs(newer, 13, '2')]
    found = find_drift(observations, INDEX, EXPECTATIONS)
    assert [f.cls for f in found] == [15]
    expected = ', '.join('АВ Направление: ' + v for v in (
        'АЛЬФА', 'БЕТА', 'ВЕГА', 'ГАММА', 'ДЕЛЬТА',
        'ЕЖИК', 'ЖЕСТ', 'ЗЕВС', 'ИЖИЦА', 'КОРЬ'))
    assert found[0].subject == expected
    # startswith, а не ==: к detail добавляется вывод «нетто/переключение»,
    # а этот тест — про детерминированный ПОРЯДОК перечисления тегов.
    assert found[0].detail.startswith(
        'появился: ' + ', '.join('АВ Направление: ' + v for v in (
            'АЛЬФА', 'БЕТА', 'ВЕГА', 'ГАММА', 'ДЕЛЬТА'))
        + '; исчез: ' + ', '.join('АВ Направление: ' + v for v in (
            'ЕЖИК', 'ЖЕСТ', 'ЗЕВС', 'ИЖИЦА', 'КОРЬ'))
    )


def test_class_15_ignores_a_tag_that_only_part_of_the_slot_carries():
    """Смешанный слот — не дрейф. Регрессия по `ЖКТ / NR / ВК / Реклама`.

    На этой воронке ПОСТОЯННО, на каждой дате, живут две популяции заказов:
    ~6633 обычных и ~126 квизовых (замер по выгрузкам 03.06 / 08.07 / 26.07).
    Перетегирования не было ни разу. Но выгрузка 08.07 оказалась узким
    сегментом, где квизовые составили большинство (126 против 22), и прежнее
    правило «самый частый набор за день» отчиталось о смене типа воронки.

    Здесь тот же расклад в миниатюре: на обеих датах «АВ Время: 20» есть у части
    наблюдений, и меняется только чьё большинство. Находок быть не должно.
    """
    base = AV + '|АВ Этап: Регистрация'
    observations = [
        # 02.05: большинство БЕЗ тега
        obs(base, 2, '1'), obs(base, 2, '2'), obs(base + '|АВ Время: 20', 2, '3'),
        # 13.05: большинство С тегом — но обе популяции на месте
        obs(base + '|АВ Время: 20', 13, '4'), obs(base + '|АВ Время: 20', 13, '5'),
        obs(base, 13, '6'),
    ]
    assert find_drift(observations, INDEX, EXPECTATIONS) == []


def test_class_15_ignores_a_tag_that_was_only_partial_before_vanishing():
    """Тег был у ЧАСТИ слота и пропал совсем — всё равно не дрейф.

    Пропажу видно, но неизвестно, что произошло: разметку сняли или в срез
    просто не попали те заказы, что её несли. Ровно так ведут себя узкие
    сегментные выгрузки, из-за которых класс и врал. Отличать этот случай
    от единогласного обязан именно счётчик «у всех»: если считать тег
    присутствующим на дате по одному наблюдению, находка появится.
    """
    base = AV + '|АВ Этап: Регистрация'
    observations = [
        obs(base, 2, '1'), obs(base, 2, '2'), obs(base + '|АВ Время: 20', 2, '3'),
        obs(base, 13, '4'), obs(base, 13, '5'),
    ]
    assert find_drift(observations, INDEX, EXPECTATIONS) == []


def test_class_15_ignores_a_tag_that_was_partial_before_becoming_unanimous():
    """Зеркальный случай: тег был у части слота и стал у всех — тоже не дрейф.

    Появлением это считать нельзя: на старой дате разметка уже была, просто
    не у всех. Сравнивать единогласное «сейчас» надо с «было хоть у кого-то»,
    а не с «было у всех» — иначе каждый смешанный слот, чей срез сузился до
    одной популяции, отчитается о появлении тега, которого не появлялось.
    """
    base = AV + '|АВ Этап: Регистрация'
    observations = [
        obs(base, 2, '1'), obs(base, 2, '2'), obs(base + '|АВ Время: 20', 2, '3'),
        obs(base + '|АВ Время: 20', 13, '4'), obs(base + '|АВ Время: 20', 13, '5'),
    ]
    assert find_drift(observations, INDEX, EXPECTATIONS) == []


def test_class_15_requires_the_change_to_be_unanimous_on_both_dates():
    """Тег был у ВСЕХ наблюдений и не остался НИ У ОДНОГО — вот это дрейф.

    Парный к тесту выше: расклад отличается только тем, что на второй дате
    тега нет ни у кого. Без него фильтр смешанных слотов нельзя отличить
    от «класс 15 вообще молчит».
    """
    base = AV + '|АВ Этап: Регистрация'
    observations = [
        obs(base + '|АВ Время: 20', 2, '1'), obs(base + '|АВ Время: 20', 2, '2'),
        obs(base, 13, '3'), obs(base, 13, '4'),
    ]
    found = find_drift(observations, INDEX, EXPECTATIONS)
    assert [f.cls for f in found] == [15]
    assert found[0].subject == 'АВ Время: 20'
    assert found[0].detail.startswith('исчез: АВ Время: 20')


def test_class_15_ignores_tags_the_funnels_db_does_not_store():
    """Маркетинговая разметка GetCourse — не расхождение.

    `ОТО` / `big-course` / `допродажи` говорят, какой апсел крутится в
    воронке на этой неделе. База воронок их не хранит, расходиться нечему,
    а на прогоне 2026-07-27 они давали 68 находок из 103.
    """
    base = AV + '|АВ Этап: Регистрация'
    observations = [
        obs(base + '|big-course|допродажи', 2, '1'),
        obs(base + '|ОТО|Яндекс Реклама новый ленд', 13, '2'),
    ]
    assert find_drift(observations, INDEX, EXPECTATIONS) == []


def test_class_15_ignores_the_legacy_messenger_tag():
    """«АВ / Мессенджер» — легаси, вычищенный из GetCourse в июле 2026.

    Начинается с «АВ », но осью и этапом не является: этап живёт в
    «АВ Этап: Мессенджер», который чистку пережил. В реестре (7682
    предложения на 27.07) легаси-тега нет ни у одного предложения, а
    июльские выгрузки помнят его навсегда — и класс показывал его пропажу
    24 раза, по разу на воронку.
    """
    base = AV + '|АВ Этап: Мессенджер'
    observations = [
        obs(base + '|АВ / Мессенджер', 2, '1'),
        obs(base, 13, '2'),
    ]
    assert find_drift(observations, INDEX, EXPECTATIONS) == []


def test_class_15_ignores_per_order_messenger_tags():
    """«АВ Мессенджер: ВК/МАКС/ТГ» — свойство ЗАКАЗА, а не воронки.

    Классы 11 и 2 пропускают их через EXTERNAL_TAG_PREFIXES; класс 15
    обязан быть с ними согласован, иначе одна и та же разметка объявляется
    внешней в одном месте отчёта и дрейфом в другом.
    """
    base = AV + '|АВ Этап: Мессенджер'
    observations = [
        obs(base + '|АВ Мессенджер: ВК', 2, '1'),
        obs(base + '|АВ Мессенджер: МАКС', 13, '2'),
    ]
    assert find_drift(observations, INDEX, EXPECTATIONS) == []


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


def test_class_15_marks_a_returned_change_as_switching_not_loss():
    """A → B → A: разметка вернулась, значит это переключение, а не пропажа.

    Подавать возврат как «тег исчез» значит топить настоящие пропажи в шуме.
    """
    base = AV + '|АВ Этап: Регистрация'
    observations = [
        obs(base, 2, '1'), obs(base + '|АВ Время: 20', 8, '2'), obs(base, 13, '3'),
    ]
    found = find_drift(observations, INDEX, EXPECTATIONS)

    assert len(found) == 2, 'оба перехода по-прежнему видны'
    for item in found:
        assert 'переключение' in item.detail, item.detail


def test_class_15_marks_a_one_way_disappearance_as_net_loss():
    """A → B без возврата: тег действительно потерян, это и есть находка."""
    base = AV + '|АВ Этап: Регистрация'
    observations = [obs(base + '|АВ Время: 20', 2, '1'), obs(base, 13, '2')]
    found = find_drift(observations, INDEX, EXPECTATIONS)

    assert len(found) == 1
    assert 'переключение' not in found[0].detail
    assert 'нетто' in found[0].detail, found[0].detail
