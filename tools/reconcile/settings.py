#!/usr/bin/env python3
"""Пути и пороги. Всё резолвится от корня репозитория, а не от cwd.

Называется settings, а не paths: модуль с именем paths есть в tools/audit,
оба каталога лежат в одном sys.path, и при совпадении имён победил бы тот,
что импортирован первым. Это уже случалось — `pytest tools/` одним прогоном
валился с «module 'paths' has no attribute LIVE_SINCE_DAYS», хотя каждый
набор по отдельности проходил.
"""

import os

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT_DIR = os.path.abspath(os.path.join(BASE_DIR, '..', '..'))
AUDIT_DIR = os.path.join(ROOT_DIR, 'tools', 'audit')

DB_PATH = os.path.join(ROOT_DIR, 'ksamata_funnels.db')
OUT_DIR = os.path.join(ROOT_DIR, 'data', 'generated')
DOWNLOADS_DIR = os.path.expanduser('~/Downloads')

DECISIONS_PATH = os.path.join(BASE_DIR, 'decisions.yaml')

# Связка считается живой, если по ней есть заказ за последние N дней.
# Это решение, а не настройка: порог отделяет «воронка работает» от
# «воронку пора в archive», и менять его надо осознанно.
LIVE_SINCE_DAYS = 30

# Снимок ЛИК старше суток использовать нельзя: правило «копию не кладём»
# соблюдается тем, что устаревший снимок не может быть применён молча.
SNAPSHOT_MAX_AGE_HOURS = 24
