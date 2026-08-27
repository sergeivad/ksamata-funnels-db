#!/usr/bin/env python3
"""Клиент GetCourse для реестра предложений.

Только GET. Единственный источник, который видит предложения БЕЗ заказов —
через выгрузки они невидимы в принципе.

Подтверждённые на живом API факты:
  - пагинация идёт по limit/offset; параметр page молча игнорируется
    и бесконечно отдаёт первую страницу;
  - поле status непригодно как признак актуальности: у всех предложений
    оно равно 'draft';
  - оба эндпоинта клиента уважают limit/offset, и оба обходятся
    постранично через fetch_all(). Замер 2026-08-28 на боевом аккаунте:
    у 'offer/get-offers' страницы offset=0 и offset=1000 не пересекаются
    (id 709868…2943535 и 2943551…3527499, пересечение пустое), полный
    обход даёт 7877 предложений — и 7880 при повторном обходе через
    несколько часов, без единого дубля id: реестр пополняется, поэтому
    точное число сверять бессмысленно, сверять надо отсутствие дублей.

    Асимметрии между двумя эндпоинтами больше нет, но она была, и это
    стоит помнить, если поведение API снова поедет. До 28.08.2026
    'offer/get-offers-tags' limit/offset уважал (offset=7000 отдавал
    хвост 679 записей, offset=9000 — пустую страницу), а
    'offer/get-offers' игнорировал оба параметра и всегда отдавал весь
    реестр целиком (7679 записей на замере 25.07.2026, 7704 —
    30.07.2026). Постраничный обход тогда был невозможен: каждая
    «страница» приходила больше page_size, цикл решал, что данные не
    кончились, и уходил в пагинацию до предохранителя fetch_all
    (MAX_PAGES) — на живом прогоне это не уложилось в 10 минут и
    разорвало соединение. Поэтому load_offers() тянул 'offer/get-offers'
    ОДНИМ запросом через fetch_page() и стерёг ответ проверкой «ровно
    PAGE_SIZE записей — похоже, включилась пагинация». Проверка ровно
    для этого и стояла, и 28.08.2026 сработала: прогон с ключами
    перестал доходить до отчёта. Оба эндпоинта переведены на fetch_all(),
    предохранитель снят за ненадобностью.
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
    # Оба эндпоинта уважают limit/offset (замер 28.08.2026) и обходятся
    # одинаково — постранично. До 28.08 'offer/get-offers' пагинацию
    # игнорировал и тянулся одним запросом; история — в докстринге модуля.
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
    # Как и все остальные загрузчики пакета (load_expectations,
    # load_observations, group_observations, save_snapshot) — сортируем
    # результат сами, а не полагаемся на порядок ответа GetCourse. Классы
    # 10, 12 и 14 идут по offers напрямую; их порядок в отчёте не должен
    # держаться на чужой (недокументированной) гарантии сортировки API.
    return sorted(offers, key=lambda o: o.offer_id)


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
