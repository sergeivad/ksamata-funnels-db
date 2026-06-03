#!/usr/bin/env python3
"""
Добавляет теги АВ-таксономии к воронкам в ksamata_funnels.db.

Формат тега: «АВ <Ось>: <Значение>» — ровно один пробел до и после двоеточия.
Исключение: служебный тег «АВ Автоворонка» (без двоеточия).

Скрипт идемпотентен: повторный запуск не создаёт дублей ни в raw-строках,
ни в funnel_tags (UNIQUE-констрейнт + INSERT OR IGNORE).
"""

import sqlite3
import os

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, 'ksamata_funnels.db')

# ============================================================
# МАППИНГ ВОРОНОК: num -> (Продукт, Канал, Направление, Подрядчик)
# ============================================================

FUNNEL_MAP = {
    1:  ('БОО',     'Ютуб',    'Органика',         'Внутренний'),
    2:  ('СВС',     'Ютуб',    'Органика',         'Внутренний'),
    3:  ('ДБО',     'Ютуб',    'Органика',         'Внутренний'),
    4:  ('ГП',      'Ютуб',    'Органика',         'Внутренний'),
    5:  ('ДБО',     'Ютуб',    'Реклама',          'НИМБ'),
    6:  ('БОО',     'Яндекс',  'РСЯ',              'НИМБ'),
    7:  ('ДБО',     'Яндекс',  'РСЯ',              'НИМБ'),
    8:  ('ЖКТ',     'Яндекс',  'РСЯ',              'НИМБ'),
    9:  ('ЩЖ',      'Яндекс',  'РСЯ',              'НИМБ'),
    10: ('СВС',     'Яндекс',  'РСЯ',              'НИМБ'),
    11: ('ДБО',     'ВК',      'In Stream',        'NR'),
    12: ('ЖКТ',     'ВК',      'Реклама',          'NR'),
    13: ('ЖКТ',     'ВК',      'In Stream',        'NR'),
    14: ('ЖКТ',     'ВК',      'Маркетплатформа',  'NR'),
    15: ('ДБО',     'ВК',      'Маркетплатформа',  'NR'),
    16: ('БОО',     'ВК',      'Реклама',          'ИНХАУЗ'),
    17: ('ДБО',     'МАКС',    'Посевы',           'NR'),
    18: ('ДБО',     'ВК',      'Реклама',          'HT'),
    19: ('БОО',     'ВК',      'Реклама',          'HT'),
    20: ('БОО',     'ВК',      'Реклама',          'ИНХАУЗ'),
    21: ('СВС',     'Яндекс',  'Реклама',          'Алексей'),
    22: ('БОО',     'Яндекс',  'Реклама',          'Алексей'),
    23: ('ДБО',     'Яндекс',  'Реклама',          'Алексей'),
    24: ('БОО',     'Яндекс',  'Ретаргет',         'Алексей'),
    25: ('СВС',     'Яндекс',  'Ретаргет',         'Алексей'),
    26: ('ДБО',     'Яндекс',  'Ретаргет',         'Алексей'),
    27: ('БОО',     'Перелив', 'Перелив с БОО',    'Внутренний'),
    28: ('ДБО',     'Перелив', 'Перелив с ДБО',    'Внутренний'),
    29: ('БОО',     'Яндекс',  'Квиз',             'Алексей'),
    30: ('ДБО',     'Яндекс',  'Квиз',             'Алексей'),
    31: ('СВС',     'Яндекс',  'Квиз',             'Алексей'),
    32: ('ДЫХАНИЕ', 'Яндекс',  'РСЯ',              'НИМБ'),
}

# Соответствие: raw-колонка -> tag_type
SLOT_MAP = {
    'reg_tags_raw': 'reg',
    'tag_15_raw':   'time_15',
    'tag_19_raw':   'time_19',
}


# ============================================================
# ХЕЛПЕРЫ (в стиле add_dih_funnel.py)
# ============================================================

def get_or_create(conn, table, name):
    """Возвращает id существующей записи или создаёт новую."""
    row = conn.execute(f"SELECT id FROM {table} WHERE name = ?", (name,)).fetchone()
    if row:
        return row['id']
    cur = conn.execute(f"INSERT INTO {table}(name) VALUES(?)", (name,))
    return cur.lastrowid


def raw_to_list(raw):
    """Парсит raw-строку тегов в список непустых элементов."""
    if not raw:
        return []
    return [t.strip() for t in raw.split(',') if t.strip()]


def build_av_tags(slot_type, product, channel, direction, contractor):
    """
    Строит упорядоченный список АВ-тегов для заданного слота.

    Порядок:
      1. АВ Автоворонка
      2. АВ Этап: Регистрация  (только reg)  /  АВ Этап: Оплата  (time_15 / time_19)
      3. АВ Продукт: <product>
      4. АВ Канал: <channel>
      5. АВ Направление: <direction>
      6. АВ Подрядчик: <contractor>
      7. АВ Время: 15  /  АВ Время: 19  (только time-слоты)
    """
    tags = [
        'АВ Автоворонка',
        'АВ Этап: Регистрация' if slot_type == 'reg' else 'АВ Этап: Оплата',
        f'АВ Продукт: {product}',
        f'АВ Канал: {channel}',
        f'АВ Направление: {direction}',
        f'АВ Подрядчик: {contractor}',
    ]
    if slot_type == 'time_15':
        tags.append('АВ Время: 15')
    elif slot_type == 'time_19':
        tags.append('АВ Время: 19')
    return tags


def next_position(conn, funnel_id, tag_type):
    """Возвращает следующую свободную позицию для (funnel_id, tag_type)."""
    row = conn.execute(
        "SELECT MAX(position) FROM funnel_tags WHERE funnel_id = ? AND tag_type = ?",
        (funnel_id, tag_type)
    ).fetchone()
    max_pos = row[0]
    return (max_pos + 1) if max_pos is not None else 0


# ============================================================
# ОСНОВНАЯ ЛОГИКА
# ============================================================

def add_av_tags_to_funnel(conn, funnel_row, product, channel, direction, contractor):
    """
    Для одной воронки проходит по всем трём слотам.
    Обрабатывает только те, у которых raw-строка непустая.
    """
    funnel_id = funnel_row['id']
    funnel_num = funnel_row['num']

    for raw_col, slot_type in SLOT_MAP.items():
        raw_value = funnel_row[raw_col]
        if not raw_value or not raw_value.strip():
            # Пустой слот — пропускаем
            continue

        av_tags = build_av_tags(slot_type, product, channel, direction, contractor)
        existing_raw_list = raw_to_list(raw_value)

        # Позиция начинается с текущего максимума
        pos = next_position(conn, funnel_id, slot_type)

        new_raw_tags = []  # только те, что реально добавляются в raw

        for tag_name in av_tags:
            # 1. tags: get_or_create
            tag_id = get_or_create(conn, 'tags', tag_name)

            # 2. funnel_tags: INSERT OR IGNORE (UNIQUE-констрейнт защищает от дублей)
            conn.execute(
                "INSERT OR IGNORE INTO funnel_tags(funnel_id, tag_id, tag_type, position) "
                "VALUES(?, ?, ?, ?)",
                (funnel_id, tag_id, slot_type, pos)
            )
            # Увеличиваем позицию только если вставка прошла (не была проигнорирована)
            # Используем changes() для определения, была ли вставка
            if conn.execute("SELECT changes()").fetchone()[0] > 0:
                pos += 1

            # 3. raw-строка: добавляем только если тега там ещё нет
            if tag_name not in existing_raw_list:
                existing_raw_list.append(tag_name)
                new_raw_tags.append(tag_name)

        # Обновляем raw-строку в БД только если были добавлены новые теги
        if new_raw_tags:
            updated_raw = ', '.join(existing_raw_list)
            conn.execute(
                f"UPDATE funnels SET {raw_col} = ? WHERE id = ?",
                (updated_raw, funnel_id)
            )
            print(f"  #{funnel_num} [{slot_type}]: добавлено {len(new_raw_tags)} АВ-тегов")
        else:
            print(f"  #{funnel_num} [{slot_type}]: АВ-теги уже присутствуют (пропуск)")


def main():
    if not os.path.exists(DB_PATH):
        raise FileNotFoundError(f"База не найдена: {DB_PATH}")

    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    print(f"Подключено: {DB_PATH}\n")

    print("=== Добавление АВ-тегов ===\n")

    for funnel_num, (product, channel, direction, contractor) in FUNNEL_MAP.items():
        funnel_row = conn.execute(
            "SELECT id, num, reg_tags_raw, tag_15_raw, tag_19_raw FROM funnels WHERE num = ?",
            (funnel_num,)
        ).fetchone()

        if funnel_row is None:
            print(f"  ПРЕДУПРЕЖДЕНИЕ: воронка #{funnel_num} не найдена в БД, пропуск.")
            continue

        add_av_tags_to_funnel(conn, funnel_row, product, channel, direction, contractor)

    conn.commit()
    print("\nCommit OK.\n")

    # ============================================================
    # ВЕРИФИКАЦИЯ
    # ============================================================

    print("=" * 60)
    print("ВЕРИФИКАЦИЯ")
    print("=" * 60)

    # 1. Глобальные счётчики
    total_tags = conn.execute("SELECT COUNT(*) FROM tags").fetchone()[0]
    print(f"\nВсего строк в tags: {total_tags}")

    print("\nСтроки в funnel_tags по tag_type:")
    for row in conn.execute(
        "SELECT tag_type, COUNT(*) AS cnt FROM funnel_tags GROUP BY tag_type ORDER BY tag_type"
    ).fetchall():
        print(f"  {row['tag_type']:<10}: {row['cnt']}")

    # 2. Детальный вывод для воронок 1, 16, 17, 20
    print()
    for check_num in [1, 16, 17, 20]:
        funnel_row = conn.execute(
            "SELECT id, num, reg_tags_raw, tag_15_raw, tag_19_raw FROM funnels WHERE num = ?",
            (check_num,)
        ).fetchone()
        if funnel_row is None:
            print(f"  Воронка #{check_num}: НЕ НАЙДЕНА\n")
            continue

        funnel_id = funnel_row['id']
        print(f"--- Воронка #{check_num} (id={funnel_id}) ---")

        # АВ-теги по слотам
        for raw_col, slot_type in SLOT_MAP.items():
            av_tags = conn.execute("""
                SELECT t.name, ft.position
                FROM funnel_tags ft
                JOIN tags t ON ft.tag_id = t.id
                WHERE ft.funnel_id = ?
                  AND ft.tag_type = ?
                  AND t.name LIKE 'АВ %'
                ORDER BY ft.position
            """, (funnel_id, slot_type)).fetchall()

            if av_tags:
                print(f"  [{slot_type}] АВ-теги:")
                for t in av_tags:
                    print(f"    pos={t['position']}  {t['name']}")
            else:
                # Слот может быть пустым (например, у №1 нет time-слотов)
                raw_val = funnel_row[raw_col]
                if raw_val and raw_val.strip():
                    print(f"  [{slot_type}] АВ-тегов нет (raw непустой — проверьте)")
                else:
                    print(f"  [{slot_type}] пустой слот")

        # raw-строки
        print(f"  reg_tags_raw : {funnel_row['reg_tags_raw']}")
        print(f"  tag_15_raw   : {funnel_row['tag_15_raw']}")
        print(f"  tag_19_raw   : {funnel_row['tag_19_raw']}")
        print()

    conn.close()
    print("Done.")


if __name__ == '__main__':
    main()
