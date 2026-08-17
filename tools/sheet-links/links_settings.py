#!/usr/bin/env python3
"""Пути и константы. Всё резолвится от корня репозитория, а не от cwd.

Называется links_settings, а не settings: модуль settings есть в
tools/reconcile, оба каталога лежат в одном sys.path, и при совпадении имён
победил бы импортированный первым.
"""

import os

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT_DIR = os.path.abspath(os.path.join(BASE_DIR, '..', '..'))

DB_PATH = os.path.join(ROOT_DIR, 'ksamata_funnels.db')
OUT_DIR = os.path.join(ROOT_DIR, 'data', 'generated')

# Таблица «Воронки ссылки». Читается ТОЛЬКО через сервисный аккаунт —
# общее правило ~/.claude/rules/google-sheets.md. Через браузер не работает:
# \t уходит символом, а синтетический Cmd+V до Sheets не доходит.
SPREADSHEET_ID = '1TTFjAAwE2g0D0BUNyOcMkuybuhbqUHf3EirM4GU2xYI'

# Клиент и ключ сервисного аккаунта живут в соседнем проекте. Путь
# абсолютный: клиент работает из любого места, зависимость одна — google-auth.
GSHEETS_PROJECT = '/Users/sergeielkin/dev/ksamata/deal_exp_analytic'
GSHEETS_CLIENT_DIR = os.path.join(GSHEETS_PROJECT, 'scripts')

# До R — дальше в листах пусто; 3000 строк с запасом на самый длинный лист
# (ЖКТ, 2081 строка).
READ_RANGE = 'A1:R3000'

# Блок считается мёртвым, если любой из маркеров встретился в первых четырёх
# его строках, колонки A-C. Замер 17.08.2026: таких блоков 42 из 135.
DEAD_MARKERS = ('отключен', 'комнаты удален', 'не использ', 'архив', 'удален')
