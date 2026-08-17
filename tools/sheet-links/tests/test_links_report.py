import datetime

from links_compare import Diff
from links_db import FunnelRow
from links_match import MatchResult
from links_report import FunnelReport, Unslotted, build_report
from links_sheet import SheetBlock

TODAY = datetime.date(2026, 8, 17)
EMPTY = Diff([], [], [], 0)


def empty_result():
    return MatchResult(matched=[], ambiguous=[], orphans=[], dead=[])


def report(label='f11', has_tariffs=False, has_apps=False,
           tariffs=EMPTY, apps=EMPTY):
    return FunnelReport(label=label, product_name='ДБО NR ВК',
                        block_name='ДБО ВК', sheet='ДБО', row=51, key='rooms',
                        has_tariffs=has_tariffs, has_apps=has_apps,
                        tariffs=tariffs, apps=apps)


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
    assert 'https://t.ksamata.ru/a' in text
    assert 'https://t.ksamata.ru/b' in text
    assert '19' in text and '15' in text


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
    assert 'https://t.ksamata.ru/a' in text
    assert '19' in text and '15' in text


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
    un = [Unslotted(label='f11', block_name='ДБО ВК', kind='tariffs',
                    url='https://t.ksamata.ru/x', row=60)]
    text = build_report(TODAY, 26, empty_result(), [], un, {}, 54)
    assert 'Слот не определён' in text
    assert 'https://t.ksamata.ru/x' in text


def test_empty_run_still_produces_all_sections():
    """Пустой прогон не должен выглядеть как обрезанный отчёт."""
    text = build_report(TODAY, 26, empty_result(), [], [], {}, 54)
    for title in ('Сводка', 'Можно залить', 'Расхождения',
                  'Неоднозначные блоки', 'Слот не определён',
                  'Живые блоки без воронки', 'Отключённые блоки'):
        assert f'## {title}' in text


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
