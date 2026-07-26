"""Экспорт только читает базу — и не должен подменять её пустышкой, если файла нет."""

import sqlite3

import pytest

from ksamata_funnels_export import load_all


def test_missing_db_is_not_silently_created(tmp_path):
    """Отсутствующий файл — это ошибка, а не повод создать пустую базу.

    sqlite3.connect без mode=ro создаёт файл молча: на месте настоящей базы
    (свежий клон, переименование) остаётся пустышка, а скрипт падает на первом
    SELECT с невнятным «no such table».
    """
    missing = tmp_path / "ksamata_funnels.db"

    with pytest.raises(sqlite3.OperationalError):
        load_all(str(missing))

    assert not missing.exists(), "скрипт создал пустую БД вместо внятного отказа"


def test_reads_a_real_db(tmp_path):
    """Read-only не должен ломать само чтение."""
    db = tmp_path / "ksamata_funnels.db"
    conn = sqlite3.connect(str(db))
    conn.executescript(
        """
        CREATE TABLE sources (id INTEGER PRIMARY KEY, name TEXT);
        CREATE TABLE products (id INTEGER PRIMARY KEY, name TEXT);
        CREATE TABLE contractors (id INTEGER PRIMARY KEY, name TEXT);
        CREATE TABLE funnels (id INTEGER PRIMARY KEY, num INTEGER,
            source_id INTEGER, product_id INTEGER, contractor_id INTEGER);
        CREATE TABLE funnel_days (id INTEGER PRIMARY KEY, funnel_id INTEGER);
        CREATE TABLE funnel_tags (id INTEGER PRIMARY KEY, funnel_id INTEGER);
        CREATE TABLE tags (id INTEGER PRIMARY KEY, name TEXT);
        CREATE TABLE salebot_configs (id INTEGER PRIMARY KEY, funnel_id INTEGER);
        CREATE TABLE product_durations (id INTEGER PRIMARY KEY);
        INSERT INTO funnels (num) VALUES (1);
        """
    )
    conn.commit()
    conn.close()

    data = load_all(str(db))
    assert data is not None
