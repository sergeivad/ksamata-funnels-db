import pytest

from links_sheet import cell, parse_blocks, room_slug


def test_room_slug_takes_one_segment_hosts():
    assert room_slug('https://gc.ksamata.ru/svs1-vk') == 'svs1-vk'
    assert room_slug('https://web.ksamatacenter.com/room/svs1-vk') == 'svs1-vk'
    assert room_slug('https://gc.ksamata.ru/svs1-vk/') == 'svs1-vk'


def test_room_slug_rejects_tariff_pages():
    """Адрес заявки — три сегмента, и комнатой он не является."""
    assert room_slug('https://gc.ksamata.ru/dbo/tarif/curator-y') is None
    assert room_slug('https://t.ksamata.ru/svs/tarif-1vk') is None
    assert room_slug('') is None
    assert room_slug(None) is None


def test_room_slug_lowercases():
    assert room_slug('https://gc.ksamata.ru/SVS1-VK') == 'svs1-vk'


def test_cell_beyond_row_end_is_empty():
    assert cell(['a', 'b'], 5) == ''
    assert cell(['  x  '], 0) == 'x'


def test_block_starts_from_marker_in_a_or_b():
    rows = [
        ['теги в тарифах', '', 'ссылка на вебинар'],
        ['', '[ДБО ВК]'],
        ['', '1 день', 'https://gc.ksamata.ru/dbo1-vk'],
        ['[ДБО ТГ]'],
        ['', '1 день', 'https://gc.ksamata.ru/dbo1-tg'],
    ]
    blocks = parse_blocks('ДБО', rows)
    assert [b.name for b in blocks] == ['ДБО ВК', 'ДБО ТГ']
    assert blocks[0].sheet == 'ДБО'
    assert blocks[0].row == 2
    assert blocks[0].rooms == {'dbo1-vk'}
    assert blocks[1].rooms == {'dbo1-tg'}


def test_rows_before_first_marker_are_ignored():
    rows = [
        ['', '', 'https://gc.ksamata.ru/sirota'],
        ['', '[ДБО ВК]'],
        ['', '1 день', 'https://gc.ksamata.ru/dbo1-vk'],
    ]
    blocks = parse_blocks('ДБО', rows)
    assert len(blocks) == 1
    assert blocks[0].rooms == {'dbo1-vk'}


def test_tariff_goes_to_f_application_to_h():
    rows = [
        ['', '[ДБО ВК]'],
        ['', '1 день', 'https://gc.ksamata.ru/dbo1-vk', '', '',
         'https://t.ksamata.ru/dbo/tarif-1vk', '',
         'https://gc.ksamata.ru/dbo/tarif/curator-vk'],
    ]
    block = parse_blocks('ДБО', rows)[0]
    assert [l.url for l in block.tariffs] == ['https://t.ksamata.ru/dbo/tarif-1vk']
    assert [l.url for l in block.apps] == [
        'https://gc.ksamata.ru/dbo/tarif/curator-vk']


def test_link_anchors_to_room_of_its_own_row():
    rows = [
        ['', '[ДБО ВК]'],
        ['', '1 день', 'https://gc.ksamata.ru/dbo1-vk', '', '',
         'https://t.ksamata.ru/dbo/tarif-1vk'],
        ['', '2 день', 'https://gc.ksamata.ru/dbo2-vk', '', '',
         'https://t.ksamata.ru/dbo/tarif-2vk'],
    ]
    block = parse_blocks('ДБО', rows)[0]
    assert [l.anchor for l in block.tariffs] == ['dbo1-vk', 'dbo2-vk']


def test_link_without_room_falls_back_to_nearest_room_above():
    rows = [
        ['', '[ДБО ВК]'],
        ['', '1 день', 'https://gc.ksamata.ru/dbo1-vk'],
        ['', '', '', '', '', 'https://t.ksamata.ru/dbo/tarif-1vk'],
    ]
    block = parse_blocks('ДБО', rows)[0]
    assert block.tariffs[0].anchor == 'dbo1-vk'


def test_link_before_any_room_has_no_anchor():
    rows = [
        ['', '[ДБО ВК]'],
        ['', '', '', '', '', 'https://t.ksamata.ru/dbo/tarif-1vk'],
    ]
    block = parse_blocks('ДБО', rows)[0]
    assert block.tariffs[0].anchor is None


def test_anchor_does_not_leak_across_blocks():
    rows = [
        ['', '[ДБО ВК]'],
        ['', '1 день', 'https://gc.ksamata.ru/dbo1-vk'],
        ['', '[ДБО ТГ]'],
        ['', '', '', '', '', 'https://t.ksamata.ru/dbo/tarif-tg'],
    ]
    blocks = parse_blocks('ДБО', rows)
    assert blocks[1].tariffs[0].anchor is None


def test_note_from_column_g_is_kept():
    rows = [
        ['', '[ДБО ВК]'],
        ['', '2 день', 'https://gc.ksamata.ru/dbo2-vk', '', '',
         'https://t.ksamata.ru/dbo/tarif-z', 'тарифы с записью ГЛАВНОГО занятия'],
    ]
    block = parse_blocks('ДБО', rows)[0]
    assert block.tariffs[0].note == 'тарифы с записью ГЛАВНОГО занятия'


def test_non_url_cells_are_not_links():
    rows = [
        ['', '[ДБО ВК]'],
        ['', '1 день', 'https://gc.ksamata.ru/dbo1-vk', '', '', 'сайты', '',
         'геткурс'],
    ]
    block = parse_blocks('ДБО', rows)[0]
    assert block.tariffs == []
    assert block.apps == []


def test_replay_room_in_column_e_counts():
    rows = [
        ['', '[ДБО ВК]'],
        ['', '4 день', 'https://gc.ksamata.ru/dbo4-vk', '',
         'https://gc.ksamata.ru/dbo4r-vk'],
    ]
    block = parse_blocks('ДБО', rows)[0]
    assert block.rooms == {'dbo4-vk', 'dbo4r-vk'}


def test_dead_marker_in_head_row_marks_block():
    rows = [
        ['отключена', '[ДБО ВК]'],
        ['', '1 день', 'https://gc.ksamata.ru/dbo1-vk'],
    ]
    assert parse_blocks('ДБО', rows)[0].dead is True


def test_dead_marker_within_first_four_rows():
    rows = [
        ['', '[ДБО ВК]'],
        ['', '', 'Комнаты удалены'],
        ['', '1 день', 'https://gc.ksamata.ru/dbo1-vk'],
    ]
    assert parse_blocks('ДБО', rows)[0].dead is True


@pytest.mark.parametrize('marker', [
    'отключена', 'Комнаты удалены', 'не используется', 'архив', 'удалено'])
def test_every_dead_marker_is_recognised(marker):
    rows = [
        [marker, '[ДБО ВК]'],
        ['', '1 день', 'https://gc.ksamata.ru/dbo1-vk'],
    ]
    assert parse_blocks('ДБО', rows)[0].dead is True


def test_live_block_is_not_dead():
    rows = [
        ['', '[ДБО ВК]'],
        ['', '1 день', 'https://gc.ksamata.ru/dbo1-vk'],
    ]
    assert parse_blocks('ДБО', rows)[0].dead is False


def test_dead_marker_below_the_first_four_rows_does_not_count():
    """Иначе пометка следующего блока красила бы предыдущий."""
    rows = [
        ['', '[ДБО ВК]'],
        ['', '1 день', 'https://gc.ksamata.ru/dbo1-vk'],
        ['', '2 день', 'https://gc.ksamata.ru/dbo2-vk'],
        ['', '3 день', 'https://gc.ksamata.ru/dbo3-vk'],
        ['отключена', '4 день', 'https://gc.ksamata.ru/dbo4-vk'],
    ]
    assert parse_blocks('ДБО', rows)[0].dead is False
