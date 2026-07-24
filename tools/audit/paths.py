#!/usr/bin/env python3
"""Пути и пороги. Всё резолвится от корня репозитория, а не от рабочего каталога."""

import datetime
import os

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT_DIR = os.path.abspath(os.path.join(BASE_DIR, '..', '..'))

DB_PATH = os.path.join(ROOT_DIR, 'ksamata_funnels.db')
OUT_DIR = os.path.join(ROOT_DIR, 'data', 'generated')

DOWNLOADS_DIR = os.path.expanduser('~/Downloads')

# Спек: выгрузки с апреля 2026 включительно.
SINCE_DATE = datetime.date(2026, 4, 1)
