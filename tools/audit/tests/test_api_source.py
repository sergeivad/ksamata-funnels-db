import json

import pytest

from api_source import (
    PAGE_SIZE,
    ApiConfig,
    auth_header,
    build_url,
    config_from_env,
    fetch_all,
    load_offers,
    save_snapshot,
)

CFG = ApiConfig(dev_key='DEV', api_key='API', domain='school.getcourse.ru')


def test_config_from_env_reads_three_variables():
    cfg = config_from_env({'GC_DEV_KEY': 'd', 'GC_API_KEY': 'a', 'GC_DOMAIN': 'x.ru'})
    assert cfg == ApiConfig(dev_key='d', api_key='a', domain='x.ru')


def test_config_from_env_raises_when_incomplete():
    with pytest.raises(RuntimeError) as err:
        config_from_env({'GC_DEV_KEY': 'd'})
    assert 'GC_API_KEY' in str(err.value)


def test_config_from_env_error_does_not_leak_key_values():
    with pytest.raises(RuntimeError) as err:
        config_from_env({'GC_DEV_KEY': 'super-secret-value'})
    assert 'super-secret-value' not in str(err.value)


def test_auth_header_uses_underscore_between_keys():
    assert auth_header(CFG) == 'Bearer DEV_API'


def test_build_url_targets_v1_and_encodes_params():
    url = build_url(CFG, 'offer/get-offers-tags', {'limit': 1000, 'offset': 2000})
    assert url.startswith('https://school.getcourse.ru/pl/api/v1/offer/get-offers-tags?')
    assert 'limit=1000' in url
    assert 'offset=2000' in url


def test_fetch_all_uses_limit_offset_not_page():
    """Параметр page молча игнорируется API и отдаёт первую страницу вечно."""
    calls = []

    def opener(url, headers):
        calls.append(url)
        offset = int(url.split('offset=')[1].split('&')[0])
        if offset >= 2 * PAGE_SIZE:
            return json.dumps({'data': []})
        return json.dumps({'data': [{'offerId': offset + i} for i in range(PAGE_SIZE)]})

    rows = fetch_all(CFG, 'offer/get-offers-tags', opener)
    assert len(rows) == 2 * PAGE_SIZE
    assert all('page=' not in url for url in calls)
    assert any('offset=0' in url for url in calls)
    assert any(f'offset={PAGE_SIZE}' in url for url in calls)


def test_fetch_all_stops_on_short_page():
    def opener(url, headers):
        if 'offset=0' in url:
            return json.dumps({'data': [{'offerId': i} for i in range(10)]})
        raise AssertionError('не должен запрашивать вторую страницу после короткой')

    assert len(fetch_all(CFG, 'offer/get-offers', opener)) == 10


def test_fetch_all_accepts_bare_array_envelope():
    def opener(url, headers):
        return json.dumps([{'offerId': 1}]) if 'offset=0' in url else json.dumps([])

    assert fetch_all(CFG, 'offer/get-offers', opener) == [{'offerId': 1}]


def test_fetch_all_raises_instead_of_looping_forever_on_stuck_offset():
    """Баг бэкенда: API стабильно отдаёт полную страницу вне зависимости от offset.

    Без верхнего предела на число страниц это привело бы к бесконечному циклу.
    """
    page_size = 5
    max_pages = 3

    def opener(url, headers):
        # Всегда возвращает полную страницу — offset никогда не даёт короткий хвост.
        return json.dumps({'data': [{'offerId': i} for i in range(page_size)]})

    with pytest.raises(RuntimeError) as err:
        fetch_all(CFG, 'offer/get-offers', opener, page_size=page_size, max_pages=max_pages)

    message = str(err.value)
    assert str(max_pages) in message
    # Сообщение об ошибке не должно содержать ключи/заголовки авторизации.
    assert auth_header(CFG) not in message
    assert CFG.dev_key not in message
    assert 'Authorization' not in message


def test_load_offers_joins_offers_with_their_tags():
    def opener(url, headers):
        if 'get-offers-tags' in url:
            if 'offset=0' in url:
                return json.dumps({'data': [
                    {'offerId': 1, 'tags': ['АВ Продукт: ДБО', ' РСЯ ']},
                    {'offerId': 2, 'tags': []},
                ]})
            return json.dumps({'data': []})
        if 'offset=0' in url:
            return json.dumps({'data': [
                {'id': 1, 'title': 'Курс А', 'status': 'draft'},
                {'id': 2, 'title': 'Курс Б', 'status': 'draft'},
            ]})
        return json.dumps({'data': []})

    offers = load_offers(CFG, opener)
    by_id = {o.offer_id: o for o in offers}
    assert by_id[1].title == 'Курс А'
    assert by_id[1].tags == frozenset({'АВ Продукт: ДБО', 'РСЯ'})
    assert by_id[2].tags == frozenset()


def test_load_offers_keeps_offers_missing_from_tags_endpoint():
    def opener(url, headers):
        if 'get-offers-tags' in url:
            return json.dumps({'data': []})
        if 'offset=0' in url:
            return json.dumps({'data': [{'id': 7, 'title': 'Без тегов', 'status': 'draft'}]})
        return json.dumps({'data': []})

    offers = load_offers(CFG, opener)
    assert len(offers) == 1
    assert offers[0].tags == frozenset()


def test_save_snapshot_writes_json_without_credentials(tmp_path):
    from api_source import Offer

    out = tmp_path / 'snapshot.json'
    save_snapshot([Offer(offer_id=1, title='Курс', status='draft',
                         tags=frozenset({'ДБО'}))], str(out))
    text = out.read_text(encoding='utf-8')
    assert 'DEV' not in text
    assert 'API' not in text
    payload = json.loads(text)
    assert payload[0]['offer_id'] == 1
    assert payload[0]['tags'] == ['ДБО']


def test_save_snapshot_orders_offers_by_offer_id_for_stable_diffs(tmp_path):
    """Снимок используется для сравнения прогонов во времени — порядок должен

    быть детерминированным (по offer_id), а не зависеть от того, в каком
    порядке пагинация API вернула записи.
    """
    from api_source import Offer

    out = tmp_path / 'snapshot.json'
    shuffled = [
        Offer(offer_id=30, title='В', status='draft', tags=frozenset()),
        Offer(offer_id=10, title='А', status='draft', tags=frozenset()),
        Offer(offer_id=20, title='Б', status='draft', tags=frozenset()),
    ]
    save_snapshot(shuffled, str(out))
    payload = json.loads(out.read_text(encoding='utf-8'))
    assert [row['offer_id'] for row in payload] == [10, 20, 30]
