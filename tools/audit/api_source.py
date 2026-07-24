#!/usr/bin/env python3
"""Клиент GetCourse для реестра предложений.

Только GET. Единственный источник, который видит предложения БЕЗ заказов —
через выгрузки они невидимы в принципе.

Подтверждённые на живом API факты:
  - пагинация идёт по limit/offset; параметр page молча игнорируется
    и бесконечно отдаёт первую страницу;
  - поле status непригодно как признак актуальности: у всех предложений
    оно равно 'draft';
  - ⚠️ АСИММЕТРИЯ ПАГИНАЦИИ МЕЖДУ ДВУМЯ ЭНДПОИНТАМИ ЭТОГО КЛИЕНТА:
    'offer/get-offers-tags' честно уважает limit/offset (offset=7000 на
    боевых данных отдаёт хвост 679 записей, offset=9000 — пустую страницу),
    а 'offer/get-offers' **игнорирует оба параметра** и всегда отдаёт
    целиком весь реестр (все 7679 записей) вне зависимости от offset.
    Прогонять 'offer/get-offers' через постраничный fetch_all() нельзя:
    каждая «страница» оказывается больше page_size, цикл решает, что
    данные не кончились, и уходит в бесконечную пагинацию вплоть до
    срабатывания предохранителя fetch_all (MAX_PAGES) — на живом прогоне
    это не уложилось в 10 минут и разорвало соединение. Поэтому
    load_offers() тянет 'offer/get-offers' ОДНИМ запросом через
    fetch_page(), а 'offer/get-offers-tags' — через fetch_all(), где
    постраничный обход действительно нужен и работает.
"""

import json
import ssl
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
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS) as response:
            return response.read().decode('utf-8')
    except ssl.SSLCertVerificationError as exc:
        # НЕ отключать проверку сертификата и не глушить исключение —
        # только объяснить пользователю, что чинить и где. Частый случай:
        # python.org-сборка Python на macOS не тянет за собой набор
        # корневых сертификатов (нет cert.pem), и это ломает вообще любой
        # HTTPS-запрос, никак не связано с сервером GetCourse.
        raise RuntimeError(
            'Не удалось проверить TLS-сертификат сервера '
            f'({exc}). Это почти наверняка проблема установки Python на '
            'этой машине, а не сервера: у python.org-сборки Python не '
            'подключён набор корневых сертификатов. Почините одним из '
            'способов: запустите "Install Certificates.command" из '
            'каталога установки Python (Applications/Python 3.x/), либо '
            'укажите переменную окружения SSL_CERT_FILE с путём к файлу '
            'корневых сертификатов (например, из пакета certifi).'
        ) from exc


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
    # 'offer/get-offers' игнорирует limit/offset и всегда отдаёт весь
    # реестр одним ответом — см. асимметрию пагинации в докстринге модуля.
    # Постраничный fetch_all() здесь зациклился бы до предохранителя.
    raw_offers = fetch_page(cfg, 'offer/get-offers', {'limit': PAGE_SIZE, 'offset': 0}, opener)
    if len(raw_offers) == PAGE_SIZE:
        # Сегодня 'offer/get-offers' лимит игнорирует и отдаёт весь реестр
        # (7679 записей), поэтому один запрос с limit=PAGE_SIZE безопасен.
        # Но если GetCourse однажды начнёт лимит уважать, этот же запрос
        # молча вернёт ровно PAGE_SIZE предложений вместо всех — и карта
        # расхождений станет неверной без единого предупреждения. Число,
        # совпавшее с PAGE_SIZE день в день, тоже возможно, но отличить
        # его от включившейся пагинации отсюда нельзя, поэтому осторожность
        # важнее удобства: останавливаемся и просим перейти на fetch_all().
        raise RuntimeError(
            f"'offer/get-offers' вернул ровно PAGE_SIZE ({PAGE_SIZE}) записей "
            'за один запрос. Похоже, что API начал уважать limit/offset '
            '(включилась пагинация) — раньше он игнорировал оба параметра '
            'и отдавал весь реестр целиком. load_offers() тянет этот '
            'эндпоинт одним запросом и в этом случае молча получит только '
            'первую страницу вместо полного реестра. Переведите load_offers() '
            "на постраничный обход fetch_all() для 'offer/get-offers', как это "
            "уже сделано для 'offer/get-offers-tags'."
        )
    # А вот 'offer/get-offers-tags' пагинацию уважает по-честному.
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
