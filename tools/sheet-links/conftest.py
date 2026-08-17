"""Кладёт tools/sheet-links в sys.path — импорты плоские.

Имена модулей здесь начинаются с links_ и не должны совпадать с именами в
tools/audit и tools/reconcile: все три каталога лежат в одном sys.path, и при
совпадении победил бы тот, что импортирован первым — молча и по-разному в
разных прогонах.
"""

import os
import socket
import sys

import pytest

BASE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, BASE)


@pytest.fixture(autouse=True)
def _block_network(monkeypatch):
    """Сервисный аккаунт на этой машине держит настоящий ключ — даже без
    подмены `_fetch_from_api` он пойдёт за токеном на реальный эндпоинт, а
    не молча вернёт пустоту. Блокируем создание сокетов на время каждого
    теста, чтобы забытый monkeypatch падал громко, а не делал живой запрос."""

    def _guard(*args, **kwargs):
        raise RuntimeError(
            'Сетевой доступ заблокирован в тестах tools/sheet-links '
            '(conftest.py) — подмените точку входа в сеть через monkeypatch, '
            'не полагайтесь на реальный сокет.')

    monkeypatch.setattr(socket, 'socket', _guard)
