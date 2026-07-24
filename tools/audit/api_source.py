#!/usr/bin/env python3
"""Клиент GetCourse для реестра предложений.

Только GET. Единственный источник, который видит предложения БЕЗ заказов —
через выгрузки они невидимы в принципе.

Два подтверждённых на живом API факта:
  - пагинация идёт по limit/offset; параметр page молча игнорируется
    и бесконечно отдаёт первую страницу;
  - поле status непригодно как признак актуальности: у всех предложений
    оно равно 'draft'.
"""

import json
import urllib.parse
import urllib.request
from dataclasses import dataclass

from normalize import normalize_tag

PAGE_SIZE = 1000
REQUIRED_ENV = ('GC_DEV_KEY', 'GC_API_KEY', 'GC_DOMAIN')
TIMEOUT_SECONDS = 60


@dataclass(frozen=True)
class ApiConfig:
    dev_key: str
    api_key: str
    domain: str


@dataclass(frozen=True)
class Offer:
    offer_id: int
    title: str
    status: str
    tags: frozenset


def config_from_env(env):
    missing = [name for name in REQUIRED_ENV if not env.get(name)]
    if missing:
        # Перечисляем ИМЕНА переменных, никогда не значения.
        raise RuntimeError(
            'Не заданы переменные окружения: ' + ', '.join(missing)
        )
    return ApiConfig(
        dev_key=env['GC_DEV_KEY'],
        api_key=env['GC_API_KEY'],
        domain=env['GC_DOMAIN'],
    )


def auth_header(cfg):
    return f'Bearer {cfg.dev_key}_{cfg.api_key}'


def build_url(cfg, path, params):
    base = f'https://{cfg.domain}/pl/api/v1/{path}'
    return base + '?' + urllib.parse.urlencode(params)


def urllib_opener(url, headers):
    request = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS) as response:
        return response.read().decode('utf-8')


def _unwrap(payload):
    """API отдаёт либо {'data': [...]}, либо голый массив."""
    if isinstance(payload, dict):
        data = payload.get('data')
        return data if isinstance(data, list) else []
    return payload if isinstance(payload, list) else []


def fetch_page(cfg, path, params, opener):
    url = build_url(cfg, path, params)
    body = opener(url, {'Authorization': auth_header(cfg)})
    return _unwrap(json.loads(body))


MAX_PAGES = 1000


def fetch_all(cfg, path, opener, page_size=PAGE_SIZE, max_pages=MAX_PAGES):
    rows = []
    offset = 0
    pages_fetched = 0
    while True:
        page = fetch_page(cfg, path, {'limit': page_size, 'offset': offset}, opener)
        rows.extend(page)
        pages_fetched += 1
        if len(page) < page_size:
            return rows
        if pages_fetched >= max_pages:
            raise RuntimeError(
                f'Пагинация {path} не остановилась после {pages_fetched} страниц '
                f'({len(rows)} записей набрано) — похоже на зацикливание API, прерываю.'
            )
        offset += page_size


def load_offers(cfg, opener=urllib_opener):
    raw_offers = fetch_all(cfg, 'offer/get-offers', opener)
    raw_tags = fetch_all(cfg, 'offer/get-offers-tags', opener)

    tags_by_id = {}
    for row in raw_tags:
        offer_id = row.get('offerId')
        if offer_id is None:
            continue
        names = (normalize_tag(t) for t in (row.get('tags') or []))
        tags_by_id[int(offer_id)] = frozenset(n for n in names if n)

    offers = []
    for row in raw_offers:
        offer_id = row.get('id')
        if offer_id is None:
            continue
        offer_id = int(offer_id)
        offers.append(
            Offer(
                offer_id=offer_id,
                title=normalize_tag(row.get('title') or ''),
                status=str(row.get('status') or ''),
                tags=tags_by_id.get(offer_id, frozenset()),
            )
        )
    return offers


def save_snapshot(offers, path):
    """Сырой снимок для воспроизводимости прогона. Ключи сюда не попадают."""
    payload = [
        {
            'offer_id': o.offer_id,
            'title': o.title,
            'status': o.status,
            'tags': sorted(o.tags),
        }
        for o in sorted(offers, key=lambda o: o.offer_id)
    ]
    with open(path, 'w', encoding='utf-8') as fh:
        json.dump(payload, fh, ensure_ascii=False, indent=2)
