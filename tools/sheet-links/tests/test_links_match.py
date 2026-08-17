from links_match import match_blocks
from links_sheet import SheetBlock, Link


def block(name, rooms=(), tariffs=(), dead=False):
    return SheetBlock(sheet='ДБО', name=name, row=1, dead=dead,
                      rooms=set(rooms),
                      tariffs=[Link(2, u, None, '') for u in tariffs],
                      apps=[])


def test_matches_by_room_slug():
    result = match_blocks([block('ДБО ВК', rooms=['dbo1-vk'])],
                          {7: {'dbo1-vk', '1dbo-vk'}}, {})
    assert len(result.matched) == 1
    assert result.matched[0].funnel_id == 7
    assert result.matched[0].key == 'rooms'
    assert result.matched[0].weight == 1


def test_strongest_room_overlap_wins():
    result = match_blocks(
        [block('ДБО ВК', rooms=['a', 'b', 'c'])],
        {7: {'a'}, 8: {'a', 'b', 'c'}}, {})
    assert result.matched[0].funnel_id == 8
    assert result.matched[0].weight == 3


def test_equal_weight_is_ambiguous_not_a_guess():
    result = match_blocks([block('БОО Ютуб мир', rooms=['a'])],
                          {7: {'a'}, 8: {'a'}}, {})
    assert result.matched == []
    assert len(result.ambiguous) == 1
    assert sorted(f for f, _ in result.ambiguous[0].candidates) == [7, 8]


def test_secondary_key_used_only_when_rooms_find_nothing():
    result = match_blocks(
        [block('ДБО ВК', rooms=['unknown'],
               tariffs=['https://t.ksamata.ru/a'])],
        {}, {'https://t.ksamata.ru/a': {5}})
    assert result.matched[0].funnel_id == 5
    assert result.matched[0].key == 'urls'


def test_rooms_beat_urls_when_both_available():
    result = match_blocks(
        [block('ДБО ВК', rooms=['dbo1-vk'],
               tariffs=['https://t.ksamata.ru/a'])],
        {7: {'dbo1-vk'}}, {'https://t.ksamata.ru/a': {5}})
    assert result.matched[0].funnel_id == 7
    assert result.matched[0].key == 'rooms'


def test_secondary_key_normalizes_url():
    result = match_blocks(
        [block('ДБО ВК', tariffs=['https://T.Ksamata.ru/a/'])],
        {}, {'https://t.ksamata.ru/a': {5}})
    assert result.matched[0].funnel_id == 5


def test_block_with_nothing_matching_is_orphan():
    result = match_blocks([block('ЗП Яндекс РСЯ', rooms=['zp1-15-rsya'])],
                          {7: {'dbo1-vk'}}, {})
    assert result.orphans and result.orphans[0].name == 'ЗП Яндекс РСЯ'
    assert result.matched == []


def test_dead_block_is_set_aside_without_matching():
    result = match_blocks([block('ДБО ВК', rooms=['dbo1-vk'], dead=True)],
                          {7: {'dbo1-vk'}}, {})
    assert result.dead and result.dead[0].name == 'ДБО ВК'
    assert result.matched == [] and result.orphans == []
