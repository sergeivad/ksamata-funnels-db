#!/usr/bin/env python3
"""Чтение таблицы «Воронки ссылки» через сервисный аккаунт.

Только через API: заполнять и читать гуглтаблицы через браузер не работает
(проверено 16.08.2026, ~/.claude/rules/google-sheets.md). Клиент берём
готовый из соседнего проекта — путь абсолютный, зависимость одна: google-auth.

403 или 404 на существующую таблицу означает, что она не расшарена на
сервисный аккаунт. Правильное действие — попросить владельца дать доступ
leak-281@personal-chief-501813.iam.gserviceaccount.com, а не искать обход.
"""

import json
import os
import sys
import tempfile

from links_settings import (
    GSHEETS_CLIENT_DIR,
    GSHEETS_PROJECT,
    READ_RANGE,
    SPREADSHEET_ID,
)


def _client():
    if not os.path.isdir(GSHEETS_CLIENT_DIR):
        raise RuntimeError(
            f'Клиент Google Sheets не найден: {GSHEETS_CLIENT_DIR}. '
            'gsheets_client — не наш код, он занят из соседнего проекта '
            'deal_exp_analytic (links_settings.GSHEETS_CLIENT_DIR); проверьте, '
            'что проект на месте и путь не переехал.')
    if GSHEETS_CLIENT_DIR not in sys.path:
        # append, не insert(0, ...): каталог чужого проекта не должен
        # оказаться впереди стандартной библиотеки в поиске импортов.
        sys.path.append(GSHEETS_CLIENT_DIR)
    import gsheets_client
    return gsheets_client


def visible_titles(meta):
    """Заголовки нескрытых листов в порядке таблицы. Лист без заголовка
    пропускается: gs.read() уронится на None.replace, а лист без имени
    прочитать всё равно нечем."""
    out = []
    for sheet in meta.get('sheets') or []:
        props = sheet.get('properties') or {}
        if props.get('hidden'):
            continue
        title = props.get('title')
        if not title:
            continue
        out.append(title)
    return out


def _fetch_from_api():
    g = _client()
    gs = g.Sheets(GSHEETS_PROJECT)
    # Списка листов в клиенте нет — берём метаданные тем же низкоуровневым
    # запросом, что и sheet_title(). Править чужой клиент ради одного поля
    # не станем: он общий с deal_exp_analytic. sheetId в ответе не просим —
    # он тут никому не нужен.
    meta = g._req(
        f'{g.API}/{SPREADSHEET_ID}?fields=sheets.properties(title,hidden)',
        headers=gs._h())
    return {title: gs.read(SPREADSHEET_ID, title, READ_RANGE)
            for title in visible_titles(meta)}


def _read_cache(cache_path):
    try:
        with open(cache_path, encoding='utf-8') as fh:
            return json.load(fh)
    except json.JSONDecodeError as exc:
        raise ValueError(
            f'Кеш повреждён: {cache_path} ({exc}). Удалите файл — он будет '
            'перечитан из API при следующем запуске.') from exc


def _write_cache(cache_path, sheets):
    """Пишем во временный файл рядом с целевым и переименовываем атомарно
    (os.replace — атомарна на одной файловой системе). Иначе прерывание на
    середине записи (диск кончился, конкурентный читатель) оставляет
    усечённый файл, который следующий запуск молча примет за валидный кеш."""
    directory = os.path.dirname(cache_path) or '.'
    fd, tmp_path = tempfile.mkstemp(
        prefix=os.path.basename(cache_path) + '.', suffix='.tmp', dir=directory)
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as fh:
            json.dump(sheets, fh, ensure_ascii=False)
        os.replace(tmp_path, cache_path)
    except BaseException:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)
        raise


def load_sheets(cache_path=None):
    """Видимые листы: заголовок → строки. С кешем, чтобы повторные прогоны
    и тесты не ходили в сеть."""
    if cache_path and os.path.exists(cache_path):
        return _read_cache(cache_path)
    sheets = _fetch_from_api()
    if cache_path:
        _write_cache(cache_path, sheets)
    return sheets
