import datetime

from links_compare import Diff
from links_db import FunnelRow
from links_match import MatchResult
from links_report import FunnelReport, KindReport, Unslotted, build_report
from links_sheet import SheetBlock

TODAY = datetime.date(2026, 8, 17)
EMPTY = Diff([], [], [], 0)


def empty_result():
    return MatchResult(matched=[], ambiguous=[], orphans=[], dead=[])


def report(label='f11', has_tariffs=False, has_apps=False, has_upsell=False,
           tariffs=EMPTY, apps=EMPTY, upsell=EMPTY, key='rooms',
           product_name='ДБО NR ВК', block_name='ДБО ВК'):
    kinds = {
        'tariffs': KindReport(has_tariffs, tariffs),
        'applications': KindReport(has_apps, apps),
        'upsell': KindReport(has_upsell, upsell),
    }
    return FunnelReport(label=label, product_name=product_name,
                        block_name=block_name, sheet='ДБО', row=51, key=key,
                        kinds=kinds)


def _section(text, title):
    """Текст одной секции ## title, до следующего заголовка ## ."""
    start = text.index(f'## {title}')
    rest = text[start:]
    end = rest.find('\n## ', 1)
    return rest if end == -1 else rest[:end]


def test_header_carries_date_and_counts():
    text = build_report(TODAY, 26, empty_result(), [], [], {}, active_total=54)
    assert '2026-08-17' in text
    assert 'листов: 26' in text
    assert 'активных воронок: 54' in text


def test_fillable_section_lists_urls_by_slot():
    rep = report(tariffs=Diff([('19', 'https://t.ksamata.ru/a'),
                               ('15', 'https://t.ksamata.ru/b')], [], [], 0))
    text = build_report(TODAY, 26, empty_result(), [rep], [], {}, 54)
    assert 'Можно залить' in text
    # Пины ориентации: слот привязан именно к своему адресу, а не просто
    # присутствует где-то в тексте — перестановка `slot`/`url` в f-строке
    # эти строки бы не прошла.
    assert '  - `19` https://t.ksamata.ru/a' in text
    assert '  - `15` https://t.ksamata.ru/b' in text


def test_funnel_with_matching_block_is_silent():
    rep = report(has_tariffs=True, has_apps=True,
                 tariffs=Diff([], [], [], 3), apps=Diff([], [], [], 2))
    text = build_report(TODAY, 26, empty_result(), [rep], [], {}, 54)
    assert 'f11' not in text


def test_divergence_shows_both_sides():
    rep = report(has_tariffs=True,
                 tariffs=Diff([('19', 'https://t.ksamata.ru/new')],
                              [('19', 'https://t.ksamata.ru/old')], [], 1))
    text = build_report(TODAY, 26, empty_result(), [rep], [], {}, 54)
    assert 'Расхождения' in text
    assert 'https://t.ksamata.ru/new' in text
    assert 'https://t.ksamata.ru/old' in text


def test_slot_disagreement_is_shown():
    rep = report(has_tariffs=True,
                 tariffs=Diff([], [], [('https://t.ksamata.ru/a', '19', '15')], 0))
    text = build_report(TODAY, 26, empty_result(), [rep], [], {}, 54)
    # Пин ориентации: таблица говорит 19, база говорит 15 — не наоборот.
    # Слово 'a' и обе цифры "где-то в тексте" эту перестановку бы не поймали.
    assert ('  - https://t.ksamata.ru/a: в таблице `19`, в базе `15`') in text


def test_ambiguous_section_names_candidates():
    block = SheetBlock(sheet='БОО', name='БОО Ютуб мир', row=477)
    from links_match import Ambiguous
    result = MatchResult(matched=[], ambiguous=[Ambiguous(block, [(1, 10), (2, 10)])],
                         orphans=[], dead=[])
    funnels = {1: FunnelRow(1, 'f70', 'БОО Ютуб', 'active'),
               2: FunnelRow(2, 'f69', 'БОО Ютуб мир', 'active')}
    text = build_report(TODAY, 26, result, [], [], funnels, 54)
    assert 'БОО Ютуб мир' in text
    assert 'f70' in text and 'f69' in text


def test_orphans_section_lists_block_and_sheet():
    block = SheetBlock(sheet='ЗП', name='ЗП Яндекс РСЯ', row=2)
    result = MatchResult(matched=[], ambiguous=[], orphans=[block], dead=[])
    text = build_report(TODAY, 26, result, [], [], {}, 54)
    assert 'ЗП Яндекс РСЯ' in text
    assert 'ЗП' in text


def test_dead_blocks_are_only_a_number():
    block = SheetBlock(sheet='ДБО', name='ДБО старая', row=2, dead=True)
    result = MatchResult(matched=[], ambiguous=[], orphans=[], dead=[block])
    text = build_report(TODAY, 26, result, [], [], {}, 54)
    assert 'ДБО старая' not in text
    assert 'отключ' in text.lower()


def test_unslotted_section():
    un = [Unslotted(label='f11', block_name='ДБО ВК', sheet='ДБО',
                    kind='tariffs', url='https://t.ksamata.ru/x', row=60)]
    text = build_report(TODAY, 26, empty_result(), [], un, {}, 54)
    assert 'Слот не определён' in text
    assert 'https://t.ksamata.ru/x' in text


def test_unslotted_section_names_the_sheet():
    """B8: раздел «Слот не определён» печатал блок и строку, но не лист —
    хотя остальные секции лист называют. Без него владелец не может отличить
    две воронки, у которых обеих строка 3, но в разных листах."""
    un = [Unslotted(label='f8', block_name='ЖКТ Ютуб мир', sheet='ЖКТ',
                    kind='tariffs', url='https://t.ksamata.ru/a', row=3)]
    text = build_report(TODAY, 26, empty_result(), [], un, {}, 54)
    line = next(l for l in text.splitlines() if 'ЖКТ Ютуб мир' in l)
    assert 'ЖКТ' in line


def test_empty_run_still_produces_all_sections():
    """Пустой прогон не должен выглядеть как обрезанный отчёт."""
    text = build_report(TODAY, 26, empty_result(), [], [], {}, 54)
    for title in ('Сводка', 'Можно залить', 'Расхождения',
                  'Неоднозначные блоки', 'Слот не определён',
                  'Живые блоки без воронки', 'Отключённые блоки'):
        assert f'## {title}' in text


def test_funnel_fillable_in_one_kind_diverges_in_other():
    """Классификация идёт по виду блока, а не по воронке целиком: тарифов
    нет вовсе (таблица предлагает адрес — заливаемо), а заявки в базе есть
    и несут лишний адрес (расхождение). Воронка обязана появиться в обеих
    секциях, и адрес расхождения обязан реально быть напечатан — раньше
    он терялся вовсе, потому что «заливаемо» и «расходится» были
    взаимоисключающими ярлыками на всю воронку."""
    rep = report(
        has_tariffs=False, has_apps=True,
        tariffs=Diff([('19', 'https://t.ksamata.ru/fill-me')], [], [], 0),
        apps=Diff([], [('19', 'https://t.ksamata.ru/db-only')], [], 2),
    )
    text = build_report(TODAY, 26, empty_result(), [rep], [], {}, 54)

    fillable_text = _section(text, 'Можно залить')
    diverging_text = _section(text, 'Расхождения')

    assert 'f11' in fillable_text
    assert 'https://t.ksamata.ru/fill-me' in fillable_text
    # Тарифы (заливаемо) не должны тянуть за собой заявки в этой секции.
    assert 'https://t.ksamata.ru/db-only' not in fillable_text

    assert 'f11' in diverging_text
    assert 'https://t.ksamata.ru/db-only' in diverging_text
    assert 'Только в базе' in diverging_text


def test_room_key_wording_is_plain():
    rep = report(key='rooms',
                 tariffs=Diff([('19', 'https://t.ksamata.ru/a')], [], [], 0))
    text = build_report(TODAY, 26, empty_result(), [rep], [], {}, 54)
    assert 'по вебинарной комнате' in text


def test_address_key_wording_flags_weaker_match():
    rep = report(key='urls',
                 tariffs=Diff([('19', 'https://t.ksamata.ru/a')], [], [], 0))
    text = build_report(TODAY, 26, empty_result(), [rep], [], {}, 54)
    assert 'более слабая примета' in text
    assert 'проверить' in text


def test_applications_heading_is_covered():
    """KIND_TITLE['applications'] должен где-то реально печататься — до
    этого теста все проверки шли через tariffs."""
    rep = report(has_apps=False,
                 apps=Diff([('19', 'https://t.ksamata.ru/app')], [], [], 0))
    text = build_report(TODAY, 26, empty_result(), [rep], [], {}, 54)
    assert 'Оформление заявки' in text
    assert 'https://t.ksamata.ru/app' in text


def test_ambiguous_candidates_without_known_funnel_are_named():
    """Если ни один id кандидата не нашёлся в funnels (funnels пуст),
    строка не должна заканчиваться голой стрелкой без текста — вместо
    этого она обязана назвать id кандидатов и сказать, что они не найдены."""
    block = SheetBlock(sheet='БОО', name='БОО Ютуб мир', row=477)
    from links_match import Ambiguous
    result = MatchResult(matched=[], ambiguous=[Ambiguous(block, [(1, 10), (2, 10)])],
                         orphans=[], dead=[])
    text = build_report(TODAY, 26, result, [], [], {}, 54)
    line = next(l for l in text.splitlines() if 'БОО Ютуб мир' in l)
    assert not line.rstrip().endswith('→')
    assert '1' in line and '2' in line
    assert 'не найдены' in line


def test_ambiguous_candidate_weight_is_labelled():
    block = SheetBlock(sheet='БОО', name='БОО Ютуб мир', row=477)
    from links_match import Ambiguous
    result = MatchResult(matched=[], ambiguous=[Ambiguous(block, [(1, 10), (2, 10)])],
                         orphans=[], dead=[])
    funnels = {1: FunnelRow(1, 'f70', 'БОО Ютуб', 'active'),
               2: FunnelRow(2, 'f69', 'БОО Ютуб мир', 'active')}
    text = build_report(TODAY, 26, result, [], [], funnels, 54)
    assert 'f70 (совпадений: 10)' in text
    assert 'f69 (совпадений: 10)' in text


def test_dead_blocks_numeral_agreement():
    block = SheetBlock(sheet='ДБО', name='ДБО старая', row=2, dead=True)
    result = MatchResult(matched=[], ambiguous=[], orphans=[], dead=[block])
    text = build_report(TODAY, 26, result, [], [], {}, 54)
    assert '1 блок ' in text
    assert '1 блоков' not in text

    blocks5 = [SheetBlock(sheet='ДБО', name=f'ДБО старая {i}', row=i, dead=True)
              for i in range(5)]
    result5 = MatchResult(matched=[], ambiguous=[], orphans=[], dead=blocks5)
    text5 = build_report(TODAY, 26, result5, [], [], {}, 54)
    assert '5 блоков' in text5


def test_slot_differs_section_is_deterministically_ordered():
    """diff_items группирует slot_differs через пересечение множеств —
    порядок между разными адресами от прогона к прогону не гарантирован.
    Отчёт обязан сортировать при печати, иначе владелец не сможет сверять
    вывод на глаз между запусками."""
    diff = Diff([], [], [
        ('https://t.ksamata.ru/c', '19', '15'),
        ('https://t.ksamata.ru/a', '19', '15'),
        ('https://t.ksamata.ru/b', '19', '15'),
    ], 0)
    rep = report(has_tariffs=True, tariffs=diff)
    text = build_report(TODAY, 26, empty_result(), [rep], [], {}, 54)
    pos_a = text.index('t.ksamata.ru/a')
    pos_b = text.index('t.ksamata.ru/b')
    pos_c = text.index('t.ksamata.ru/c')
    assert pos_a < pos_b < pos_c


def test_upsell_heading_is_covered():
    """Task 8: KIND_TITLE['upsell'] должен где-то реально печататься."""
    rep = report(has_upsell=False,
                 upsell=Diff([('19', 'https://gc.ksamata.ru/dbo/meditation-vk')],
                             [], [], 0))
    text = build_report(TODAY, 26, empty_result(), [rep], [], {}, 54)
    assert 'Допродажи / дожим' in text
    assert 'https://gc.ksamata.ru/dbo/meditation-vk' in text


def test_funnel_fillable_in_tariffs_diverges_in_upsell():
    """Task 8, тот же тест-принцип, что закрывал Task 6, но на третьем виде
    блока: тарифов в базе нет вовсе (заливаемо), а допродажи есть и несут
    лишний адрес (расхождение) — воронка обязана появиться в обеих секциях."""
    rep = report(
        has_tariffs=False, has_upsell=True,
        tariffs=Diff([('19', 'https://t.ksamata.ru/fill-me')], [], [], 0),
        upsell=Diff([], [('19', 'https://gc.ksamata.ru/db-only')], [], 2),
    )
    text = build_report(TODAY, 26, empty_result(), [rep], [], {}, 54)

    fillable_text = _section(text, 'Можно залить')
    diverging_text = _section(text, 'Расхождения')

    assert 'https://t.ksamata.ru/fill-me' in fillable_text
    assert 'https://gc.ksamata.ru/db-only' not in fillable_text

    assert 'https://gc.ksamata.ru/db-only' in diverging_text
    assert 'Только в базе' in diverging_text


def test_heading_always_shows_block_name():
    """B2: две записи одной воронки от разных блоков листа должны быть
    различимы по заголовку — имя блока в него теперь входит всегда, а не
    только в тексте абзаца под заголовком."""
    rep = report(block_name='ДБО ВК Особый', product_name='ДБО NR ВК',
                 has_tariffs=False,
                 tariffs=Diff([('19', 'https://t.ksamata.ru/x')], [], [], 0))
    text = build_report(TODAY, 26, empty_result(), [rep], [], {}, 54)
    assert '### f11 — ДБО NR ВК · ДБО ВК Особый' in text


def test_heading_falls_back_to_block_name_when_product_name_is_empty():
    """B7: пустое имя товара раньше рисовало висящее тире («### f84 — »).
    Имя блока листа — осмысленный заменитель, а не пустая строка."""
    rep = report(block_name='ДБО ВК Особый', product_name='',
                 has_tariffs=False,
                 tariffs=Diff([('19', 'https://t.ksamata.ru/x')], [], [], 0))
    text = build_report(TODAY, 26, empty_result(), [rep], [], {}, 54)
    assert '### f11 — ДБО ВК Особый' in text
    assert '### f11 —  ' not in text
    assert '### f11 — \n' not in text


def test_heading_warns_when_funnel_is_claimed_by_more_than_one_block():
    """B2: когда два блока листа матчатся на одну воронку, каждая её запись
    должна явно сказать, что верным может быть только одна из них — иначе
    владелец видит два одноимённых ### и не понимает, что они спорят
    за одну и ту же воронку."""
    rep_a = report(label='f11', block_name='ДБО ВК',
                   tariffs=Diff([('19', 'https://t.ksamata.ru/a')], [], [], 0))
    rep_b = report(label='f11', block_name='ДБО ТГ',
                   tariffs=Diff([('19', 'https://t.ksamata.ru/b')], [], [], 0))
    text = build_report(TODAY, 26, empty_result(), [rep_a, rep_b], [], {}, 54)
    assert text.count('### f11') == 2
    # Обе записи этой воронки обязаны нести предупреждение.
    assert text.count('верным может быть только один') == 2


def test_heading_is_silent_about_claims_when_funnel_has_a_single_block():
    rep = report(
        tariffs=Diff([('19', 'https://t.ksamata.ru/a')], [], [], 0))
    text = build_report(TODAY, 26, empty_result(), [rep], [], {}, 54)
    assert 'верным может быть только один' not in text
