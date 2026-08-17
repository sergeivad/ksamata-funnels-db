from dataclasses import dataclass

from links_compare import diff_items, normalize_url, sheet_items, sheet_notes
from links_sheet import parse_blocks


@dataclass(frozen=True)
class FakeItem:
    slot: str
    url: str


def test_normalize_url_lowercases_and_drops_trailing_slash():
    assert normalize_url('HTTPS://T.Ksamata.RU/dbo/Tarif-1/') == \
        'https://t.ksamata.ru/dbo/tarif-1'


def test_normalize_url_keeps_query():
    """В адресах ГК встречаются осмысленные ?id= — их терять нельзя."""
    assert normalize_url('https://gc.ksamata.ru/pl/tasks/mission/process?id=1607990') \
        == 'https://gc.ksamata.ru/pl/tasks/mission/process?id=1607990'


def test_normalize_url_on_empty():
    assert normalize_url('') == ''
    assert normalize_url(None) == ''


ROWS = [
    ['', '[ДБО ВК]'],
    ['', '1 день', 'https://gc.ksamata.ru/dbo1-vk', '', '',
     'https://t.ksamata.ru/dbo/tarif-19', '',
     'https://gc.ksamata.ru/dbo/tarif/curator-19'],
    ['', '1 день', 'https://gc.ksamata.ru/1dbo-vk', '', '',
     'https://t.ksamata.ru/dbo/tarif-15'],
]
SLOTS = {'dbo1-vk': '19', '1dbo-vk': '15'}


def test_sheet_items_take_slot_from_room_of_the_row():
    block = parse_blocks('ДБО', ROWS)[0]
    assert sheet_items(block, 'tariffs', SLOTS) == [
        ('19', 'https://t.ksamata.ru/dbo/tarif-19'),
        ('15', 'https://t.ksamata.ru/dbo/tarif-15'),
    ]


def test_sheet_items_reads_applications_kind():
    block = parse_blocks('ДБО', ROWS)[0]
    assert sheet_items(block, 'applications', SLOTS) == [
        ('19', 'https://gc.ksamata.ru/dbo/tarif/curator-19'),
    ]


def test_sheet_items_slot_is_none_when_room_unknown_to_db():
    block = parse_blocks('ДБО', ROWS)[0]
    assert sheet_items(block, 'tariffs', {}) == [
        (None, 'https://t.ksamata.ru/dbo/tarif-19'),
        (None, 'https://t.ksamata.ru/dbo/tarif-15'),
    ]


def test_sheet_items_dedupe_same_url_same_slot():
    rows = [
        ['', '[ДБО ВК]'],
        ['', '1 день', 'https://gc.ksamata.ru/dbo1-vk', '', '',
         'https://t.ksamata.ru/dbo/tarif-19'],
        ['', '2 день', 'https://gc.ksamata.ru/dbo1-vk', '', '',
         'https://T.ksamata.ru/dbo/tarif-19/'],
    ]
    block = parse_blocks('ДБО', rows)[0]
    assert sheet_items(block, 'tariffs', SLOTS) == [
        ('19', 'https://t.ksamata.ru/dbo/tarif-19')]


def test_sheet_notes_collects_column_g_by_slot_and_address():
    """F: Link.note (колонка G) собиралась и никогда не читалась — спека
    обещает, что подпись попадает в отчёт справочно (см. README)."""
    rows = [
        ['', '[ДБО ВК]'],
        ['', '1 день', 'https://gc.ksamata.ru/dbo1-vk', '', '',
         'https://t.ksamata.ru/dbo/tarif-19',
         'тарифы с записью ГЛАВНОГО занятия'],
    ]
    block = parse_blocks('ДБО', rows)[0]
    assert sheet_notes(block, 'tariffs', SLOTS) == {
        ('19', 'https://t.ksamata.ru/dbo/tarif-19'):
            'тарифы с записью ГЛАВНОГО занятия'}


def test_sheet_notes_skips_empty_notes():
    block = parse_blocks('ДБО', ROWS)[0]
    assert sheet_notes(block, 'tariffs', SLOTS) == {}


def test_diff_all_new_when_db_empty():
    d = diff_items([('19', 'https://t.ksamata.ru/a')], [])
    assert d.only_sheet == [('19', 'https://t.ksamata.ru/a')]
    assert d.only_db == []
    assert d.slot_differs == []
    assert d.same == 0


def test_diff_identical_is_silent():
    d = diff_items([('19', 'https://t.ksamata.ru/a')],
                   [FakeItem('19', 'https://t.ksamata.ru/A/')])
    assert d.only_sheet == [] and d.only_db == []
    assert d.same == 1


def test_diff_reports_both_sides():
    d = diff_items([('19', 'https://t.ksamata.ru/a')],
                   [FakeItem('19', 'https://t.ksamata.ru/b')])
    assert d.only_sheet == [('19', 'https://t.ksamata.ru/a')]
    assert d.only_db == [('19', 'https://t.ksamata.ru/b')]
    assert d.same == 0


def test_diff_same_url_different_slot_is_its_own_bucket():
    d = diff_items([('19', 'https://t.ksamata.ru/a')],
                   [FakeItem('15', 'https://t.ksamata.ru/a')])
    assert d.only_sheet == [] and d.only_db == []
    assert d.slot_differs == [('https://t.ksamata.ru/a', '19', '15')]
    assert d.same == 0


def test_diff_unknown_sheet_slot_does_not_count_as_disagreement():
    """Слот не определён — это незнание, а не расхождение."""
    d = diff_items([(None, 'https://t.ksamata.ru/a')],
                   [FakeItem('15', 'https://t.ksamata.ru/a')])
    assert d.slot_differs == []
    assert d.same == 1


def test_diff_unknown_db_slot_does_not_count_as_disagreement():
    """Симметрично предыдущему: неизвестный слот бывает и в базе (4 такие
    записи на живой базе, обычно из блоков в режиме common)."""
    d = diff_items([('15', 'https://t.ksamata.ru/a')],
                   [FakeItem(None, 'https://t.ksamata.ru/a')])
    assert d.slot_differs == []
    assert d.same == 1


def test_diff_same_url_two_known_slots_on_both_sides_is_not_a_phantom_disagreement():
    """f83/f92: один тарифный адрес законно обслуживает оба слота разом.
    Обе стороны несут пару (19, u) и (15, u) — это два совпадения, а не
    расхождение по тому, какой слот "выжил" при сравнении по адресу."""
    d = diff_items(
        [('19', 'https://t.ksamata.ru/a'), ('15', 'https://t.ksamata.ru/a')],
        [FakeItem('19', 'https://t.ksamata.ru/a'),
         FakeItem('15', 'https://t.ksamata.ru/a')])
    assert d.same == 2
    assert d.only_sheet == []
    assert d.only_db == []
    assert d.slot_differs == []


def test_diff_single_slot_each_side_still_reports_slot_differs():
    d = diff_items([('19', 'https://t.ksamata.ru/a')],
                   [FakeItem('15', 'https://t.ksamata.ru/a')])
    assert d.slot_differs == [('https://t.ksamata.ru/a', '19', '15')]
    assert d.only_sheet == []
    assert d.only_db == []


def test_diff_sheet_has_extra_slot_db_lacks_is_a_real_only_sheet_finding():
    """Лист несёт адрес в обоих слотах, база — только в одном: это не
    расхождение слота, а честная нехватка строки в базе."""
    d = diff_items(
        [('19', 'https://t.ksamata.ru/a'), ('15', 'https://t.ksamata.ru/a')],
        [FakeItem('19', 'https://t.ksamata.ru/a')])
    assert d.same == 1
    assert d.only_sheet == [('15', 'https://t.ksamata.ru/a')]
    assert d.only_db == []
    assert d.slot_differs == []
