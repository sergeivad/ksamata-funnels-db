import datetime

from links_compare import Diff
from links_plan import (PlanBlock, PlanSkip, block_plan, build_plan,
                        plan_json)
from links_report import FunnelReport, KindReport

TODAY = datetime.date(2026, 8, 18)
EMPTY = Diff([], [], [], 0)


def only_sheet(pairs):
    return Diff(list(pairs), [], [], 0)


def report(label='f29', tariffs=EMPTY, apps=EMPTY, upsell=EMPTY,
           has_tariffs=False, has_apps=False, has_upsell=False):
    return FunnelReport(
        label=label, product_name='СВС НИМБ ВК', block_name='СВС ВК НИМБ',
        sheet='СВС (нов)', row=194, key='rooms',
        kinds={
            'tariffs': KindReport(has_tariffs, tariffs),
            'applications': KindReport(has_apps, apps),
            'upsell': KindReport(has_upsell, upsell),
        })


# --- режим и слот по видам -------------------------------------------------

def test_tariffs_keep_slots_and_go_by_time():
    block, skip = block_plan('f29', 'tariffs',
                             [('19', 'https://t/19'), ('15', 'https://t/15')])
    assert skip is None
    assert block == PlanBlock('f29', 'tariffs', 'by_time',
                              [('19', 'https://t/19'), ('15', 'https://t/15')])


def test_single_slot_tariff_is_not_mirrored_into_the_other():
    """Замер: 146 из 146 адресов под одним слотом лежат в базе под тем же
    одним. Дублирование в оба слота было бы выдумкой."""
    block, _ = block_plan('f32', 'tariffs', [('19', 'https://t/rsya')])
    assert block.items == [('19', 'https://t/rsya')]


def test_applications_go_by_time_too():
    block, _ = block_plan('f29', 'applications', [('15', 'https://gc/c15')])
    assert block.mode == 'by_time'


def test_upsell_drops_the_slot_and_goes_common():
    """В таблице дожим стоит в 19-й половине, но все 20 таких блоков базы
    лежат как «Общее» без слота."""
    block, skip = block_plan('f29', 'upsell', [('19', 'https://gc/med')])
    assert skip is None
    assert block == PlanBlock('f29', 'upsell', 'common',
                              [(None, 'https://gc/med')])


def test_fully_unslotted_by_time_kind_falls_back_to_common():
    block, _ = block_plan('f29', 'tariffs', [(None, 'https://t/a')])
    assert block.mode == 'common'


def test_mixed_slots_are_skipped_with_a_reason():
    block, skip = block_plan('f29', 'tariffs',
                             [('19', 'https://t/a'), (None, 'https://t/b')])
    assert block is None
    assert isinstance(skip, PlanSkip)
    assert '19' in skip.reason


def test_empty_kind_is_neither_block_nor_skip():
    assert block_plan('f29', 'tariffs', []) == (None, None)


# --- сборка по отчёту ------------------------------------------------------

def test_existing_block_is_never_touched():
    """Расхождения чинит человек: вид, который в базе есть, в план не едет."""
    rep = report(has_tariffs=True,
                 tariffs=only_sheet([('19', 'https://t/a')]))
    blocks, skips = build_plan([rep])
    assert blocks == [] and skips == []


def test_plan_covers_every_absent_kind_of_a_funnel():
    rep = report(tariffs=only_sheet([('19', 'https://t/a')]),
                 apps=only_sheet([('19', 'https://gc/b')]),
                 upsell=only_sheet([('19', 'https://gc/c')]))
    blocks, _ = build_plan([rep])
    assert [(b.kind, b.mode) for b in blocks] == [
        ('tariffs', 'by_time'), ('applications', 'by_time'),
        ('upsell', 'common')]


def test_report_order_is_preserved():
    a = report(label='f25', upsell=only_sheet([('19', 'https://gc/a')]))
    b = report(label='f86', upsell=only_sheet([('19', 'https://gc/b')]))
    blocks, _ = build_plan([a, b])
    assert [x.label for x in blocks] == ['f25', 'f86']


# --- JSON ------------------------------------------------------------------

def test_json_names_the_funnel_by_front_code_and_enables_the_block():
    blocks, _ = build_plan([report(upsell=only_sheet([('19', 'https://gc/m')]))])
    data = plan_json(TODAY, blocks)
    assert data['generated'] == '2026-08-18'
    assert data['blocks'] == [{
        'funnel': 'f29', 'kind': 'upsell', 'mode': 'common', 'enabled': True,
        'items': [{'slot': None, 'label': '', 'url': 'https://gc/m'}],
    }]
