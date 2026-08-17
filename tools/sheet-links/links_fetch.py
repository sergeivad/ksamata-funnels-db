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

from links_settings import (
    GSHEETS_CLIENT_DIR,
    GSHEETS_PROJECT,
    READ_RANGE,
    SPREADSHEET_ID,
)


def _client():
    if GSHEETS_CLIENT_DIR not in sys.path:
        sys.path.insert(0, GSHEETS_CLIENT_DIR)
    import gsheets_client
    return gsheets_client


def visible_titles(meta):
    """Заголовки нескрытых листов в порядке таблицы."""
    out = []
    for sheet in meta.get('sheets') or []:
        props = sheet.get('properties') or {}
        if props.get('hidden'):
            continue
        out.append(props.get('title'))
    return out


def _fetch_from_api():
    g = _client()
    gs = g.Sheets(GSHEETS_PROJECT)
    # Списка листов в клиенте нет — берём метаданные тем же низкоуровневым
    # запросом, что и sheet_title(). Править чужой клиент ради одного поля
    # не станем: он общий с deal_exp_analytic.
    meta = g._req(
        f'{g.API}/{SPREADSHEET_ID}?fields=sheets.properties(sheetId,title,hidden)',
        headers=gs._h())
    return {title: gs.read(SPREADSHEET_ID, title, READ_RANGE)
            for title in visible_titles(meta)}


def load_sheets(cache_path=None):
    """Видимые листы: заголовок → строки. С кешем, чтобы повторные прогоны
    и тесты не ходили в сеть."""
    if cache_path and os.path.exists(cache_path):
        with open(cache_path, encoding='utf-8') as fh:
            return json.load(fh)
    sheets = _fetch_from_api()
    if cache_path:
        with open(cache_path, 'w', encoding='utf-8') as fh:
            json.dump(sheets, fh, ensure_ascii=False)
    return sheets
