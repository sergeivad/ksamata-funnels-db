"""Раскладка листа: заголовок блока и колонки.

Оба дефекта, которые закрывают эти тесты, найдены владельцем 18.08.2026 на
живой таблице, а не выдуманы: инструмент не видел 50 блоков из 185 и читал
семь листов из 26 не с тех колонок.
"""

from links_sheet import STANDARD, parse_blocks, resolve_columns

HEAD_STD = ['теги в тарифах', '', 'ссылка на вебинар', 'запись на Ютуб',
            'Ссылка на повтор', 'ссылка на продажную страницу',
            'ссылка на посадочную страницу', 'страницы в ГК для тарифов',
            'ОТО', 'Бонусы']

# Лист ТКМ: перед продажной вклинена «Ссылка на предсписок» — всё сдвинуто.
HEAD_TKM = ['теги в тарифах', '', 'ссылка на вебинар', 'запись на Ютуб',
            'Ссылка на повтор', 'Ссылка на предсписок',
            'ссылка на продажную страницу', 'ссылка на посадочную страницу',
            'страницы в ГК для тарифов', 'ОТО']

# Лист ЗВ/ДББ/РД: повтор уехал в G, колонки «ГК для тарифов» нет вовсе.
HEAD_ZV = ['', '', 'ссылка на вебинар', 'запись на Ютуб',
           'Cсылка на запись', '', 'Ссылка на повтор',
           'ссылка на продажную страницу', 'ссылка на посадочную страницу',
           'ОТО', 'Бонусы']

# Лист ЧО: «ГК для тарифов» нет, сразу после посадочной идёт ОТО.
HEAD_CHO = ['теги в тарифах', '', 'ссылка на вебинар', 'Ссылка на запись',
            'Ссылка на повтор', 'ссылка на продажную страницу',
            'ссылка на посадочную страницу', 'ОТО', 'Бонусы']


# --- заголовок блока -------------------------------------------------------

def block_names(rows):
    return [b.name for b in parse_blocks('Л', rows)]


def test_plain_bracket_header():
    assert block_names([HEAD_STD, ['', '[ДБО ВК]']]) == ['ДБО ВК']


def test_header_with_trailing_text_is_still_a_header():
    """«НОВАЯ ЦЕНА» после скобки — 23 таких блока на одном листе БОО."""
    assert block_names([HEAD_STD, ['', '[БОО сайт] НОВАЯ ЦЕНА']]) \
        == ['БОО сайт НОВАЯ ЦЕНА']


def test_trailing_text_stays_in_the_name():
    """«БОО сайт» и «БОО сайт НОВАЯ ЦЕНА» — РАЗНЫЕ блоки листа, и в отчёте
    они не должны читаться одинаково."""
    names = block_names([HEAD_STD, ['', '[БОО сайт]'],
                         ['', '[БОО сайт] НОВАЯ ЦЕНА']])
    assert names == ['БОО сайт', 'БОО сайт НОВАЯ ЦЕНА']
    assert len(set(names)) == 2


def test_paren_instead_of_bracket_is_a_typo_not_a_new_syntax():
    assert block_names([HEAD_STD, ['', '[БОО Ютуб органика)']]) \
        == ['БОО Ютуб органика']


def test_two_names_in_one_header_keep_both():
    rows = [HEAD_STD, ['', '[БОО перелив с Short ZM] + [БОО перелив с СВС]']]
    assert block_names(rows) == ['БОО перелив с Short ZM + [БОО перелив с СВС]']


def test_url_with_template_braces_is_not_a_header():
    """Строки ЧО вида .../cho-tw1?[%web%] содержат скобки, но заголовком не
    являются — они не НАЧИНАЮТСЯ со скобки."""
    rows = [HEAD_STD, ['', '[ЧО ВК]'],
            ['https://online.ksamata.ru/room/cho-tw1?[%web%]', '1 день']]
    assert block_names(rows) == ['ЧО ВК']


def test_bare_brackets_are_not_a_header():
    assert block_names([HEAD_STD, ['', '[]'], ['', '[ДБО ВК]']]) == ['ДБО ВК']


# --- колонки ---------------------------------------------------------------

def test_standard_layout_resolves():
    lay = resolve_columns([HEAD_STD])
    assert (lay.webinar, lay.replay, lay.tariff, lay.note, lay.app) \
        == (2, 4, 5, 6, 7)
    assert lay == STANDARD


def test_tkm_layout_is_shifted_by_one():
    lay = resolve_columns([HEAD_TKM])
    assert (lay.tariff, lay.note, lay.app) == (6, 7, 8)
    assert lay.replay == 4


def test_zv_layout_has_replay_in_g_and_no_gk_column():
    lay = resolve_columns([HEAD_ZV])
    assert (lay.replay, lay.tariff, lay.note) == (6, 7, 8)
    assert lay.app is None


def test_cho_layout_has_no_gk_column():
    """Раньше сюда попадала колонка ОТО и уезжала в «Оформление заявки»."""
    lay = resolve_columns([HEAD_CHO])
    assert lay.app is None


def test_header_row_is_found_below_the_top():
    assert resolve_columns([[''], ['мусор'], HEAD_STD]) == STANDARD


def test_sheet_without_a_header_row_is_unresolved():
    """Молчаливое чтение по номерам — ровно тот дефект, что чинится здесь."""
    assert resolve_columns([['', '1 день', 'https://gc.ksamata.ru/a']]) is None


# --- колонки влияют на разбор ---------------------------------------------

def test_tkm_tariffs_and_apps_come_from_g_and_i():
    rows = [
        HEAD_TKM,
        ['', '[ТКМ НИМБ РСЯ]'],
        ['', '1 день', 'https://gc.ksamata.ru/tkm1-19-rsya', '', '',
         'https://gc.ksamata.ru/tkm/pre-yan',
         'https://t.ksamata.ru/tkm/tarif-rsya', '',
         'https://gc.ksamata.ru/tkm/curator_rsya'],
    ]
    b = parse_blocks('ТКМ', rows, resolve_columns(rows))[0]
    assert [l.url for l in b.tariffs] == ['https://t.ksamata.ru/tkm/tarif-rsya']
    assert [l.url for l in b.apps] == ['https://gc.ksamata.ru/tkm/curator_rsya']
    # предсписок из колонки F не должен попасть НИКУДА
    assert b.upsell == []


def test_sheet_without_gk_column_yields_no_applications():
    rows = [
        HEAD_CHO,
        ['', '[ЧО ВК]'],
        ['', '1 день', 'https://gc.ksamata.ru/cho1-vk', '', '',
         'https://t.ksamata.ru/cho/tarif-vk', '', 'https://gc.ksamata.ru/oto'],
    ]
    b = parse_blocks('ЧО', rows, resolve_columns(rows))[0]
    assert [l.url for l in b.tariffs] == ['https://t.ksamata.ru/cho/tarif-vk']
    assert b.apps == []
