import datetime

from db_source import Expectation
from export_source import Observation
from findings import (
    CLASS_TITLES,
    find_contradictory_legacy,
    find_extra_axes,
    find_missing_in_getcourse,
    find_unresolved,
    group_observations,
)
from normalize import AUTOFUNNEL_TAG, parse_tagset

# Пятый элемент — маркер типа воронки (см. normalize.av_key). AV — намеренно
# БЕЗ маркера здесь (большинство тестов этого файла не о нём), поэтому у KEY
# явный None пятым: иначе g.key (5 элементов) никогда не совпал бы с
# буквальным 4-элементным литералом ни при каких условиях.
KEY = ('ДБО', 'NR', 'ВК', 'In Stream', None)
AV = 'АВ Продукт: ДБО|АВ Подрядчик: NR|АВ Канал: ВК|АВ Направление: In Stream'
INDEX = {KEY: {11}}


def exp(tag_type, raw):
    return Expectation(funnel_id=11, num=11, front_code='f11',
                       product_name='ДБО NR ВК', status='active',
                       tag_type=tag_type, tags=parse_tagset(raw))


def obs(raw, day, deal_id='1'):
    return Observation(deal_id=deal_id, tags=parse_tagset(raw),
                       file_name=f'deal_export_2026-05-{day:02d}_00-00-00.csv',
                       file_date=datetime.date(2026, 5, day),
                       deal_created='2026-05-01 00:00:00')


def test_class_titles_are_stable_numbers_without_gaps_reused():
    """Номера классов — адрес в отчёте, их не переиспользуют.

    3 и 6 сняты 2026-08-25 вместе с этапом «Предсписок», ставшим сценарием
    базы (фаза 14). Дыра на их месте намеренная: по номерам ищут в отчётах
    прошлых прогонов, и «класс 6» не должен однажды начать значить другое.
    """
    assert sorted(CLASS_TITLES) == [1, 2, 4, 5, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]


def test_group_observations_aggregates_by_key_type_and_tagset():
    raw = AV + '|АВ Этап: Регистрация'
    groups = group_observations([obs(raw, 2, '1'), obs(raw, 5, '2')])
    assert len(groups) == 1
    g = groups[0]
    assert g.key == KEY
    assert g.tag_type == 'reg'
    assert g.deals == 2
    assert g.first_seen == datetime.date(2026, 5, 2)
    assert g.last_seen == datetime.date(2026, 5, 5)


def test_group_observations_separates_different_tagsets():
    base = AV + '|АВ Этап: Регистрация'
    groups = group_observations([obs(base, 2), obs(base + '|автоворонки', 5, '2')])
    assert len(groups) == 2


def test_class_1_reports_tag_expected_in_db_but_absent_in_getcourse():
    groups = group_observations([obs(AV + '|АВ Этап: Регистрация', 2)])
    expectations = [exp('reg', AV + '|АВ Этап: Регистрация|автоворонки')]
    found = find_missing_in_getcourse(groups, expectations, INDEX)
    assert len(found) == 1
    assert found[0].cls == 1
    assert found[0].funnel == 'f11'
    assert 'автоворонки' in found[0].subject


def test_class_1_collapses_mass_missing_tag_but_lists_rare_ones_individually():
    """Владелец решил: тег, отсутствующий более чем у пяти пар (ключ ×
    tag_type), сворачивается в одну сводную находку — иначе один шумный тег
    ('автоворонки') делает «Класс 1» равным единице почти у каждой воронки
    и топит редкие расхождения, которые и есть полезный сигнал.

    Здесь тег 'массовый' отсутствует у шести пар (> порога 5) — должен дать
    ровно одну сводную находку. Тег 'редкий' отсутствует только у одной из
    них — должен остаться в перечислении поштучно."""
    groups = []
    expectations = []
    index = {}
    for i in range(6):
        key = (f'П{i}', 'NR', 'ВК', 'In Stream', None)
        present = (
            f'АВ Продукт: П{i}|АВ Подрядчик: NR|АВ Канал: ВК|'
            'АВ Направление: In Stream|АВ Этап: Регистрация'
        )
        expected_raw = present + '|массовый'
        if i == 0:
            expected_raw += '|редкий'
        funnel_id = 100 + i
        groups.extend(group_observations([obs(present, 2, deal_id=f'd{i}')]))
        expectations.append(
            Expectation(funnel_id=funnel_id, num=funnel_id, front_code=f'f{funnel_id}',
                       product_name=f'П{i} NR ВК', status='active',
                       tag_type='reg', tags=parse_tagset(expected_raw))
        )
        index[key] = {funnel_id}

    found = find_missing_in_getcourse(groups, expectations, index)

    mass = [f for f in found if f.subject == 'массовый']
    assert len(mass) == 1
    assert mass[0].funnel == '—'
    assert '6' in mass[0].detail

    rare = [f for f in found if 'редкий' in f.subject]
    assert len(rare) == 1
    assert rare[0].funnel != '—'
    assert 'массовый' not in rare[0].subject


def test_class_1_silent_when_sets_match():
    raw = AV + '|АВ Этап: Регистрация'
    assert find_missing_in_getcourse(group_observations([obs(raw, 2)]),
                                     [exp('reg', raw)], INDEX) == []


VOCABULARY_2 = frozenset({'АВ Продукт: ДБО', 'АВ Подрядчик: NR', 'АВ Канал: ВК',
                          'АВ Направление: In Stream', 'АВ Этап: Мессенджер'})


def test_class_2_reports_axis_present_in_getcourse_but_absent_from_db_vocabulary():
    raw = AV + '|АВ Этап: Мессенджер|АВ Время: 20'
    groups = group_observations([obs(raw, 2)])
    found = find_extra_axes(groups, VOCABULARY_2)
    assert [f.cls for f in found] == [2]
    assert 'АВ Время: 20' in found[0].subject


def test_class_2_ignores_tags_that_live_only_in_getcourse():
    """Мессенджер и линейка базе не нужны — «база их не знает» это норма.

    Мессенджер различает заказы ВНУТРИ воронки (36 четвёрок из 37 несут все
    три значения сразу), а линейка выводится из продукта `ЖИВО*`.
    """
    raw = AV + '|АВ Этап: Мессенджер|АВ Мессенджер: МАКС|АВ Линейка: ЖИВО'
    groups = group_observations([obs(raw, 2)])
    assert find_extra_axes(groups, VOCABULARY_2) == []


def test_class_2_still_reports_funnel_type_markers():
    """Маркеры, в отличие от внешних тегов, — настоящий пробел модели базы."""
    raw = AV + '|АВ Этап: Мессенджер|АВ Квиз'
    groups = group_observations([obs(raw, 2)])
    found = find_extra_axes(groups, VOCABULARY_2)
    assert [f.cls for f in found] == [2]
    assert 'АВ Квиз' in found[0].subject


def test_class_2_leaves_stages_to_classes_3_and_6():
    """`АВ Этап: Предсписок` уже занимает два листа отчёта — третий лишний.

    Класс 3 даёт по нему сводку, класс 6 — список по связкам. На прогоне
    2026-07-27 те же девять связок висели в классе 2 под третьим заголовком.
    """
    groups = group_observations([obs(AV + '|АВ Этап: Предсписок', 2)])
    assert find_extra_axes(groups, VOCABULARY_2) == []


def test_class_2_ignores_a_tag_the_registry_no_longer_carries():
    """Выгрузка вечно хранит разметку своего дня; исправленное чинить нечего.

    Живой случай: в GetCourse писали `АВ продукт: ЖКТ-4вр` со строчной «п»,
    к 2026-07-27 исправили на `АВ Продукт:`, а файлы мая всё ещё несут старое.
    """
    raw = AV + '|АВ Этап: Мессенджер|АВ продукт: ЖКТ-4вр'
    groups = group_observations([obs(raw, 2)])
    assert find_extra_axes(groups, VOCABULARY_2, {},
                           {'АВ Продукт: ЖКТ-4вр'}) == []


def test_class_2_reports_a_tag_the_registry_still_carries():
    """Парный к предыдущему: фильтр реестра не должен гасить класс целиком."""
    raw = AV + '|АВ Этап: Мессенджер|АВ Время: 20'
    groups = group_observations([obs(raw, 2)])
    found = find_extra_axes(groups, VOCABULARY_2, {}, {'АВ Время: 20'})
    assert [f.cls for f in found] == [2]
    assert 'АВ Время: 20' in found[0].subject


def test_class_2_registry_filter_is_off_when_the_registry_is_empty():
    """Прогон с --no-api не должен молча прятать половину класса."""
    raw = AV + '|АВ Этап: Мессенджер|АВ Время: 20'
    groups = group_observations([obs(raw, 2)])
    found = find_extra_axes(groups, VOCABULARY_2, {}, frozenset())
    assert [f.cls for f in found] == [2]


def test_predpisok_stage_is_a_scenario_not_a_finding():
    """Этап «Предсписок» — пятый сценарий базы, а не находка.

    До 2026-08-25 те же группы разбирали классы 3 (сводка) и 6 (список по
    связкам): в модели базы этап выразить было нечем. Фаза 14 завела сценарий
    `predspisok`, и наблюдения теперь получают тип, как все остальные, —
    расхождения по ним разбирает класс 1.
    """
    groups = group_observations([obs(AV + '|АВ Этап: Предсписок', 2)])
    assert [g.tag_type for g in groups] == ['predspisok']
    assert [g.reason for g in groups] == [None]

    # Воронка под эту связку в базе есть — сообщать не о чем.
    assert find_unresolved(groups, INDEX, set(), {}) == []


def test_class_4_reports_contradictory_legacy_direction_tags():
    # Пара уточнений намеренно `IS` + `МП`, а не `ВК NR ВК` + `IS`, как было до
    # 2026-07-31: `ВК NR ВК` признана меткой-корзиной (BUCKET_LEGACY_TAGS) и
    # противоречия больше не образует. Смысл теста прежний — два РАЗНЫХ
    # уточнения размещения сразу.
    raw = AV + '|АВ Этап: Оплата|АВ Время: 19|ВК NR МП|ВК NR IS'
    groups = group_observations([obs(raw, 2)])
    expectations = [exp('time_19', raw)]
    found = find_contradictory_legacy(groups, expectations, INDEX)
    assert [f.cls for f in found] == [4]
    assert 'ВК NR МП' in found[0].evidence
    assert 'ВК NR IS' in found[0].evidence


def test_class_5_reports_payment_without_time():
    groups = group_observations([obs(AV + '|АВ Этап: Оплата', 2)])
    found = find_unresolved(groups, INDEX)
    assert [f.cls for f in found] == [5]


def test_predpisok_group_is_no_longer_unresolved():
    """Обратная сторона снятия класса 6: группа предсписка молчит.

    Раньше она давала находку «типа в модели базы нет». Теперь у неё есть тип,
    воронка под связку в индексе есть — сообщать не о чем.
    """
    groups = group_observations([obs(AV + '|АВ Этап: Предсписок', 2)])
    assert find_unresolved(groups, INDEX) == []


def test_class_7_reports_known_type_but_unknown_funnel():
    # Класс 7 сравнивает по ПОЛНОМУ ключу (findings.is_complete_key — там
    # речь о конкретной воронке, а не о связке), поэтому маркер обязателен:
    # без него запись отсеялась бы как неполная ДО проверки индекса, и тест
    # был бы зелёным по случайной причине.
    raw = ('АВ Продукт: ЩЖ|АВ Подрядчик: НИМБ|АВ Канал: Яндекс|'
           'АВ Направление: РСЯ|АВ Этап: Регистрация|' + AUTOFUNNEL_TAG)
    found = find_unresolved(group_observations([obs(raw, 2)]), INDEX)
    assert [f.cls for f in found] == [7]
    assert 'ЩЖ' in found[0].subject


def test_classes_5_and_7_are_mutually_exclusive():
    """Каждая неопознанная группа попадает ровно в один класс.

    Третьей в наборе была группа предсписка (класс 6) — с фазой 14 она
    опознаётся и в find_unresolved не доходит вовсе, поэтому здесь её нет.
    """
    groups = group_observations([
        obs(AV + '|АВ Этап: Оплата', 2, '1'),
        # class 7 требует полный ключ — см. комментарий в тесте выше.
        obs('АВ Продукт: ЩЖ|АВ Подрядчик: НИМБ|АВ Канал: Яндекс|'
            'АВ Направление: РСЯ|АВ Этап: Регистрация|' + AUTOFUNNEL_TAG, 2, '3'),
    ])
    found = find_unresolved(groups, INDEX)
    assert sorted(f.cls for f in found) == [5, 7]
    assert len(found) == len(groups)


def test_find_unresolved_silent_for_recognised_group():
    raw = AV + '|АВ Этап: Регистрация'
    assert find_unresolved(group_observations([obs(raw, 2)]), INDEX) == []


def test_class_4_does_not_report_a_general_tag_next_to_its_own_refinement():
    """`ВК NR` + `ВК NR IS` — это общий тег и его уточнение, а не противоречие.

    В июльском отчёте так выглядит 21 находка класса 4 из 27: правило ловит
    любые два тега с одним префиксом, а общий тег сам начинается с этого
    префикса. Противоречие — это два РАЗНЫХ уточнения одновременно.
    """
    raw = AV + '|АВ Этап: Оплата|АВ Время: 19|ВК NR|ВК NR IS'
    groups = group_observations([obs(raw, 2)])
    expectations = [exp('time_19', raw)]
    assert find_contradictory_legacy(groups, expectations, INDEX) == []


def test_class_4_still_reports_two_different_refinements_under_one_general_tag():
    # Третьим уточнением с 2026-07-31 стоит `МП`, а не `ВК NR ВК` — см. коммент
    # у test_class_4_reports_contradictory_legacy_direction_tags.
    raw = AV + '|АВ Этап: Оплата|АВ Время: 19|ВК NR|ВК NR IS|ВК NR МП'
    groups = group_observations([obs(raw, 2)])
    expectations = [exp('time_19', raw)]
    found = find_contradictory_legacy(groups, expectations, INDEX)
    assert [f.cls for f in found] == [4]


# ─── класс 7: два фильтра ────────────────────────────────────────────────────
#
# С маркером: class7 (ветка `elif is_complete_key(group.key) and ... not in
# index`) требует полный ключ, иначе запись отсеялась бы неполной ещё до
# сравнения с реестром, и тесты про фильтр реестра проверяли бы не его.
OTHER_AV = ('АВ Продукт: ЩЖ|АВ Подрядчик: НИМБ|АВ Канал: Яндекс|'
            'АВ Направление: РСЯ|АВ Этап: Регистрация|' + AUTOFUNNEL_TAG)
OTHER_KEY = ('ЩЖ', 'НИМБ', 'Яндекс', 'РСЯ', AUTOFUNNEL_TAG)


def test_class_7_hides_a_key_that_is_no_longer_in_the_registry():
    """Разметка одного дня, давно исправленная, — не воронка без записи.

    «Теги предложений» вычисляются в момент выгрузки, поэтому старый файл
    хранит исчезнувшую четвёрку вечно. На живых данных так выглядели
    `БОО / НИМБ / Яндекс / Реклама` и `ДБО / НИМБ / Яндекс / Реклама`:
    один файл от 2026-05-20 и больше нигде.
    """
    groups = group_observations([obs(OTHER_AV, 2)])
    assert find_unresolved(groups, INDEX, registry_keys={('иная', 'ось', 'тут', 'есть')}) == []


def test_class_7_reports_a_key_that_is_still_in_the_registry():
    groups = group_observations([obs(OTHER_AV, 2)])
    found = find_unresolved(groups, INDEX, registry_keys={OTHER_KEY})
    assert [f.cls for f in found] == [7]
    assert 'ЩЖ' in found[0].subject


def test_class_7_registry_filter_is_off_when_the_registry_is_empty():
    """Прогон с --no-api не должен молча прятать половину класса 7."""
    groups = group_observations([obs(OTHER_AV, 2)])
    found = find_unresolved(groups, INDEX, registry_keys=frozenset())
    assert [f.cls for f in found] == [7]


def test_class_7_registry_filter_does_not_touch_class_5():
    """Фильтр реестра — только про класс 7. Причина 5 от него не зависит."""
    groups = group_observations([
        obs(AV + '|АВ Этап: Оплата', 2, '1'),
    ])
    found = find_unresolved(groups, INDEX, registry_keys={OTHER_KEY})
    assert sorted(f.cls for f in found) == [5]


# ─── класс 5: «нет АВ Этап» отделяет воронки от запусков и клуба ──────────────
#
# Раньше ветка `no_stage` давала ОДНУ находку с ключом `— / — / — / — / —` на
# всё, у чего нет АВ-этапа: разбор `deal_export_2026-07-18` (99 928 наблюдений)
# показал внутри 11 172 наблюдения запусков и клуба (`запуск07_26`, `клуб2.0`,
# `Баллы`), 1618 наблюдений воронок на легаси-разметке (12 наборов) и 665
# неясного (в основном `Яндекс Ретаргет`). Владелец 2026-07-30: запуски и клуб
# в этом отчёте не нужны, нужны автоворонки, прямые, квизы и ЖИВО.
#
# Правило: находка есть только там, где этап размечен ЛЕГАСИ-тегом, а АВ-этапа
# нет. Нет ни того, ни другого — это вообще не шаг воронки.
LEGACY_PERELIV = 'ДБО|Регистрация|перелив'
LEGACY_SITE = 'Регистрация|Сайт'
LAUNCH = 'Тарифы|запуск07_26|психосоматика|статистика'


def test_class_5_ignores_a_set_without_any_stage_marker():
    """Запуск: ни АВ-этапа, ни легаси-этапа — не шаг воронки."""
    groups = group_observations([obs(LAUNCH, 2)])
    assert find_unresolved(groups, INDEX) == []


def test_class_5_reports_a_step_marked_only_with_a_legacy_stage():
    groups = group_observations([obs(LEGACY_PERELIV, 2)])
    found = find_unresolved(groups, INDEX)
    assert [f.cls for f in found] == [5]
    assert 'Регистрация' in found[0].subject
    # Ключ у такой группы пустой целиком, поэтому адресует находку сам набор.
    assert 'перелив' in found[0].detail


def test_class_5_reports_each_legacy_set_separately():
    """Двенадцать легаси-наборов — двенадцать адресных находок, не одна.

    Свёртка `_latest_by_stage_family` собирала их все в один слот
    (пустой ключ × семейство 'none'), и отчёт показывал одну бесполезную
    строку на 20 150 заказов.
    """
    groups = group_observations([obs(LEGACY_PERELIV, 2, '1'), obs(LEGACY_SITE, 2, '2')])
    found = find_unresolved(groups, INDEX)
    assert [f.cls for f in found] == [5, 5]
    assert {f.detail for f in found} == {
        'Легаси-набор: ДБО|Регистрация|перелив',
        'Легаси-набор: Регистрация|Сайт',
    }


def test_class_5_counts_a_legacy_payment_stage_too():
    """`Оплата` в выгрузках пока не встречается (замер 2026-07-30: 0 против
    1618 у `Регистрация`), но правило — про словарь легаси-этапов целиком."""
    groups = group_observations([obs('ДБО|Оплата|перелив', 2)])
    found = find_unresolved(groups, INDEX)
    assert [f.cls for f in found] == [5]
    assert 'Оплата' in found[0].subject


def test_class_5_ignores_av_axes_without_any_stage():
    """Полная четвёрка, но этапа нет ни АВ, ни легаси — тоже не шаг воронки.

    Такая группа по-прежнему видна классу 2 (неизвестные базе оси), см.
    test_class_2_reports_unknown_axis_even_when_tag_type_is_undecidable.
    """
    groups = group_observations([obs(AV + '|АВ Время: 20', 2)])
    assert find_unresolved(groups, INDEX) == []


# ─── класс 4: `ВК NR ВК` — общая метка, а не третье уточнение ────────────────
#
# Владелец 2026-07-31: метка старая, смысла больше не несёт, но чистить её в
# GetCourse не надо — все 70 несущих её предложений в статусе draft. Значит
# молчать должен инструмент.
#
# Что показал замер (реестр 7704 предложения + выгрузка 26.07, 334 211
# наблюдений): у 30 предложений направления «Реклама» `ВК NR ВК` — ЕДИНСТВЕННАЯ
# метка размещения, а у 23 In Stream и 17 Маркетплатформы она стоит рядом с их
# собственной (`ВК NR IS` / `ВК NR МП`), то есть осталась от копирования. По
# наблюдениям она встречается на всех трёх направлениях сразу (26 008 / 6 907 /
# 216) — уточнением размещения быть не может.
#
# Прежнее правило её не гасило: исключение работает только когда общий тег —
# СТРОКОВЫЙ префикс уточнения (`ВК NR` ⊂ `ВК NR IS`), а `ВК NR ВК` им не является.


def test_class_4_treats_the_vk_feed_tag_as_a_bucket_not_a_refinement():
    """`ВК NR ВК` рядом с `ВК NR IS` — не противоречие."""
    raw = AV + '|АВ Этап: Оплата|АВ Время: 19|ВК NR IS|ВК NR ВК'
    groups = group_observations([obs(raw, 2)])
    expectations = [exp('time_19', raw)]
    assert find_contradictory_legacy(groups, expectations, INDEX) == []


def test_class_4_still_reports_two_real_refinements_next_to_the_bucket():
    """Гашение метки не должно глушить настоящее противоречие рядом с ней."""
    raw = AV + '|АВ Этап: Оплата|АВ Время: 19|ВК NR IS|ВК NR МП|ВК NR ВК'
    groups = group_observations([obs(raw, 2)])
    expectations = [exp('time_19', raw)]
    found = find_contradictory_legacy(groups, expectations, INDEX)
    assert [f.cls for f in found] == [4]
    assert 'ВК NR IS' in found[0].evidence and 'ВК NR МП' in found[0].evidence
    assert 'ВК NR ВК' not in found[0].evidence
