#!/usr/bin/env python3
"""
Добавляет таблицу product_durations и заполняет её данными о длительности вебинаров.
"""

import sqlite3
import os

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT_DIR = os.path.abspath(os.path.join(BASE_DIR, '..', '..'))
DB_PATH = os.path.join(ROOT_DIR, 'ksamata_funnels.db')


def fmt(minutes):
    h = minutes // 60
    m = minutes % 60
    return f"{h}ч {m}м"


def main():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row

    # 1. Create table
    conn.execute("""
        CREATE TABLE IF NOT EXISTS product_durations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            product_id INTEGER NOT NULL REFERENCES products(id),
            day_num INTEGER NOT NULL CHECK(day_num BETWEEN 1 AND 5),
            duration_minutes INTEGER NOT NULL,
            UNIQUE(product_id, day_num)
        )
    """)
    conn.commit()
    print("Table product_durations created (or already exists).")

    # 2. Verify product IDs
    rows = conn.execute("SELECT id, name FROM products ORDER BY id").fetchall()
    print("\nProducts in DB:")
    product_by_name = {}
    for r in rows:
        print(f"  id={r['id']}  name={r['name']}")
        product_by_name[r['name']] = r['id']

    # Expected mapping
    expected = {
        'БОО': 1,
        'ГП':  2,
        'ДБО': 3,
        'ЖКТ': 4,
        'СВС': 5,
        'ЩЖ':  6,
        'ДЫХАНИЕ': 7,
    }
    print()
    for code, expected_id in expected.items():
        actual_id = product_by_name.get(code)
        status = 'OK' if actual_id == expected_id else f'MISMATCH (expected {expected_id}, got {actual_id})'
        print(f"  {code}: id={actual_id}  {status}")

    # 3. Duration data keyed by product code
    durations = {
        'БОО': {1: 107, 2: 183, 3: 177, 4: 181, 5: 172},
        'ГП':  {1: 103, 2: 185, 3:  72, 4: 190, 5: 182},
        'ДБО': {1: 103, 2: 151, 3: 146, 4: 155, 5: 174},
        'ЖКТ': {1: 107, 2: 198, 3: 144},
        'СВС': {1:  90, 2: 146, 3: 155, 4: 153, 5: 180},
        'ЩЖ':  {1:  87, 2: 176, 3: 178},
        'ДЫХАНИЕ': {1: 100, 2: 137, 3: 143, 4: 150, 5: 173},
    }

    # 4. Insert data
    inserted = 0
    for code, days in durations.items():
        product_id = product_by_name.get(code)
        if product_id is None:
            print(f"WARNING: product '{code}' not found in DB, skipping.")
            continue
        for day_num, minutes in days.items():
            conn.execute("""
                INSERT OR REPLACE INTO product_durations (product_id, day_num, duration_minutes)
                VALUES (?, ?, ?)
            """, (product_id, day_num, minutes))
            inserted += 1

    conn.commit()
    print(f"\nInserted/replaced {inserted} duration records.")

    # 5. Verification table
    print("\nVerification:")
    print(f"{'Продукт':<6}  {'День':>4}  {'Минуты':>7}  {'Длительность':>12}")
    print("-" * 38)
    result = conn.execute("""
        SELECT p.name, pd.day_num, pd.duration_minutes
        FROM product_durations pd
        JOIN products p ON pd.product_id = p.id
        ORDER BY pd.product_id, pd.day_num
    """).fetchall()
    for r in result:
        print(f"{r['name']:<6}  {r['day_num']:>4}  {r['duration_minutes']:>7}  {fmt(r['duration_minutes']):>12}")

    conn.close()


if __name__ == '__main__':
    main()
