import json
import ssl

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
    urllib_opener,
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

    Заглушка сама себя ограничивает: если предохранитель в fetch_all когда-нибудь
    уберут, этот тест не должен зависнуть навсегда — opener считает свои вызовы
    и после заведомо большего числа, чем max_pages, поднимает собственное
    (отличимое от RuntimeError предохранителя) исключение с характерным текстом.
    Так зависание становится невозможным в принципе, а не просто маловероятным.
    """
    page_size = 5
    max_pages = 3
    call_budget = 10  # заведомо больше max_pages — предохранитель обязан сработать раньше
    calls = {'count': 0}

    def opener(url, headers):
        calls['count'] += 1
        if calls['count'] > call_budget:
            raise AssertionError(
                'СТАБ-ЗАГЛУШКА: предохранитель fetch_all не сработал — opener '
                f'вызван {calls["count"]} раз (бюджет {call_budget}); ожидался '
                f'RuntimeError после {max_pages} страниц.'
            )
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


def _paginating_opener(total, calls=None, tags_total=None):
    """Заглушка обоих эндпоинтов, честно уважающих limit/offset.

    Ровно так живой API вёл себя на замере 28.08.2026: страницы по offset
    не пересекаются, хвост короче PAGE_SIZE, следующий за ним offset пуст.
    """
    if tags_total is None:
        tags_total = total
    offers = [{'id': i, 'title': f'Курс {i}', 'status': 'draft'} for i in range(total)]
    tags = [{'offerId': i, 'tags': []} for i in range(tags_total)]

    def opener(url, headers):
        offset = int(url.split('offset=')[1].split('&')[0])
        limit = int(url.split('limit=')[1].split('&')[0])
        rows = tags if 'get-offers-tags' in url else offers
        if calls is not None:
            calls.setdefault(url.split('/v1/')[1].split('?')[0], []).append(offset)
        return json.dumps({'data': rows[offset:offset + limit]})

    return opener


def test_load_offers_paginates_get_offers():
    """С 28.08.2026 'offer/get-offers' уважает limit/offset — реестр больше

    не приходит одним ответом, и load_offers обязан обойти его постранично,
    иначе карта расхождений строится по первой тысяче предложений вместо
    всех (боевой замер: 7877).

    Заглушка отдаёт непересекающиеся страницы, как живой API: ключевая
    проверка — что затребованы все offset'ы и собраны все записи, а не
    только первая страница.
    """
    total = 2 * PAGE_SIZE + 137
    calls = {}

    offers = load_offers(CFG, _paginating_opener(total, calls))

    assert len(offers) == total
    assert calls['offer/get-offers'] == [0, PAGE_SIZE, 2 * PAGE_SIZE]
    assert [o.offer_id for o in offers] == list(range(total))


def test_load_offers_does_not_stop_at_exactly_page_size():
    """Пограничный случай: реестр ровно в PAGE_SIZE записей.

    Раньше здесь стоял предохранитель — ровно PAGE_SIZE записей за один
    запрос считались признаком включившейся пагинации и роняли прогон
    (см. историю в докстринге модуля). Пагинация включилась, предохранитель
    снят, и это число больше ничего не значит: просто полная страница, за
    которой идёт пустая.
    """
    calls = {}

    offers = load_offers(CFG, _paginating_opener(PAGE_SIZE, calls))

    assert len(offers) == PAGE_SIZE
    assert calls['offer/get-offers'] == [0, PAGE_SIZE]


def test_load_offers_collects_whole_registry_regardless_of_its_size():
    """Контроль на живых величинах: 7877 предложений (замер 28.08.2026) и

    небольшие 42 — обход обязан собрать всё до последней записи.
    """
    for total in (7877, 42):
        offers = load_offers(CFG, _paginating_opener(total))
        assert len(offers) == total


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


def test_load_offers_returns_offers_sorted_by_offer_id_regardless_of_api_order():
    """Все остальные загрузчики пакета сортируют результат (load_expectations,
    load_observations, group_observations, save_snapshot) — load_offers должен
    делать то же самое, а не отдавать предложения в порядке ответа GetCourse.
    Классы 10, 12 и 14 идут по offers напрямую."""

    def opener(url, headers):
        if 'get-offers-tags' in url:
            return json.dumps({'data': []})
        if 'offset=0' in url:
            return json.dumps({'data': [
                {'id': 30, 'title': 'В', 'status': 'draft'},
                {'id': 10, 'title': 'А', 'status': 'draft'},
                {'id': 20, 'title': 'Б', 'status': 'draft'},
            ]})
        return json.dumps({'data': []})

    offers = load_offers(CFG, opener)
    assert [o.offer_id for o in offers] == [10, 20, 30]


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


def test_urllib_opener_turns_cert_verify_failure_into_a_clear_russian_message(monkeypatch):
    """python.org-сборка Python на macOS без установленного набора корневых

    сертификатов (нет cert.pem) роняет ЛЮБОЙ HTTPS-запрос с
    ssl.SSLCertVerificationError, и раньше пользователь видел 20-строчный
    traceback без единой подсказки. urllib_opener обязан сам чинить эту
    ошибку, а не отключать проверку сертификата — заглушка-opener здесь не
    подходит, потому что чинится сам urllib_opener, поэтому подменяем
    urllib.request.urlopen напрямую.
    """
    import urllib.request

    def fake_urlopen(request, timeout=None):
        raise ssl.SSLCertVerificationError(
            '[SSL: CERTIFICATE_VERIFY_FAILED] certificate verify failed: '
            'unable to get local issuer certificate'
        )

    monkeypatch.setattr(urllib.request, 'urlopen', fake_urlopen)

    with pytest.raises(RuntimeError) as err:
        urllib_opener('https://school.getcourse.ru/pl/api/v1/offer/get-offers', {})

    message = str(err.value)
    assert 'сертификат' in message.lower()
    assert 'Install Certificates.command' in message
    assert 'SSL_CERT_FILE' in message
    # Категорически нельзя намекать на отключение проверки как на решение.
    assert 'verify=False' not in message
    assert '_create_unverified_context' not in message
