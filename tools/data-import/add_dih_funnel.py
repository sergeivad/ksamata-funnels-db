#!/usr/bin/env python3
"""
Adds a new funnel to ksamata_funnels.db:
  #32 — ДЫХАНИЕ НИМБ РСЯ

Two time slots (19:00, 15:00) × 5 days = 10 funnel_days rows.
Product 'ДЫХАНИЕ' is created in `products` if missing.
BotHelp is no longer used (run via GetCourse) — stored in bothelp_condition.

Idempotent: skip insert if funnel with num=32 already exists.
"""

import sqlite3
import re
import os

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT_DIR = os.path.abspath(os.path.join(BASE_DIR, '..', '..'))
DB_PATH = os.path.join(ROOT_DIR, 'ksamata_funnels.db')


def get_or_create(conn, table, name):
    row = conn.execute(f"SELECT id FROM {table} WHERE name = ?", (name,)).fetchone()
    if row:
        return row[0]
    cur = conn.execute(f"INSERT INTO {table}(name) VALUES(?)", (name,))
    return cur.lastrowid


def parse_tag_string(raw):
    if not raw:
        return []
    parts = [t.strip() for t in raw.split(',')]
    return [p for p in parts if p and not re.match(r'^t=\d+$', p)]


def ensure_tags(conn, tag_names):
    return {name: get_or_create(conn, 'tags', name) for name in tag_names}


def insert_funnel_tags(conn, funnel_id, tag_map, tag_type, raw):
    for pos, tname in enumerate(parse_tag_string(raw)):
        if tname in tag_map:
            conn.execute(
                "INSERT OR IGNORE INTO funnel_tags(funnel_id, tag_id, tag_type, position) VALUES(?,?,?,?)",
                (funnel_id, tag_map[tname], tag_type, pos)
            )


# ============================================================
# FUNNEL DATA
# ============================================================

ROOM_IDS_JSON = (
    '{'
    '"d1_19":"dih1-19-rsya","d2_19":"dih2-19-rsya","d3_19":"dih3-19-rsya",'
    '"d4_19":"dih4-19-rsya","d5_19":"dih5-19-rsya",'
    '"d1_15":"dih1-15-rsya","d2_15":"dih2-15-rsya","d3_15":"dih3-15-rsya",'
    '"d4_15":"dih4-15-rsya","d5_15":"dih5-15-rsya"'
    '}'
)

REGI_TOTAL_URL = 'https://gc.ksamata.ru/pl/user/user/index?uc%5Bsegment_id%5D=0&uc%5Brule_string%5D=%7B%22type%22%3A%22user_hasdealrule%22%2C%22inverted%22%3A0%2C%22className%22%3A%22app%3A%3Amodules%3A%3Auser%3A%3Amodels%3A%3Arule%3A%3AHasDealRule%22%2C%22params%22%3A%7B%22linkedRule%22%3A%7B%22type%22%3A%22andrule%22%2C%22inverted%22%3A0%2C%22className%22%3A%22app%3A%3Acomponents%3A%3Alogic%3A%3Arule%3A%3AAndRule%22%2C%22params%22%3A%7B%22children%22%3A%5B%7B%22type%22%3A%22deal_created_at%22%2C%22inverted%22%3A0%2C%22className%22%3A%22app%3A%3Amodules%3A%3Asales%3A%3Arules%3A%3ADealCreatedAtRule%22%2C%22params%22%3A%7B%22value%22%3A%7B%22from%22%3A%2220.05.2022%22%2C%22to%22%3A%2224.05.2022%22%2C%22toNDays%22%3Anull%2C%22fromNDays%22%3Anull%2C%22dateType%22%3A%22prev_day%22%2C%22withTime%22%3Afalse%7D%2C%22valueMode%22%3Anull%7D%7D%2C%7B%22type%22%3A%22deal_offer_id%22%2C%22inverted%22%3A0%2C%22className%22%3A%22app%3A%3Acomponents%3A%3Alogic%3A%3Arule%3A%3Asales%3A%3AOfferIdDealContextRule%22%2C%22params%22%3A%7B%22value%22%3A%7B%22selected_id%22%3A%5B8347430%5D%2C%22selected_tags%22%3A%5B%22%D0%B4%D1%8B%D1%85%D0%B0%D0%BD%D0%B8%D0%B5%22%5D%2C%22all_object_with_tags%22%3Afalse%7D%2C%22valueMode%22%3Anull%7D%7D%5D%2C%22mode%22%3A%22and%22%7D%7D%2C%22countCondition%22%3Anull%7D%7D&formParams%5Bclarity_uid%5D=wIMVGIqMM-l54Ric6Z1s6gW9Zhwq0Vn1'

REGI_15_URL = 'https://gc.ksamata.ru/pl/user/user/index?uc%5Bsegment_id%5D=0&uc%5Brule_string%5D=%7B%22type%22%3A%22andrule%22%2C%22inverted%22%3A0%2C%22className%22%3A%22app%3A%3Acomponents%3A%3Alogic%3A%3Arule%3A%3AAndRule%22%2C%22params%22%3A%7B%22children%22%3A%5B%7B%22type%22%3A%22UserContext_formfieldvalue%22%2C%22inverted%22%3A0%2C%22className%22%3A%22app%3A%3Acomponents%3A%3Alogic%3A%3Arule%3A%3AFormFieldValueRule%22%2C%22params%22%3A%7B%22valueMode%22%3A2%2C%22fieldId%22%3A5002734%2C%22fieldValue%22%3A%7B%22selected_id%22%3A%5B%22%D0%A3%D0%B4%D0%BE%D0%B1%D0%BD%D0%BE+%D1%81%D0%BC%D0%BE%D1%82%D1%80%D0%B5%D1%82%D1%8C+%D0%B2+15%3A00%22%5D%7D%2C%22caseSensitive%22%3Afalse%7D%7D%2C%7B%22type%22%3A%22user_hasdealrule%22%2C%22inverted%22%3A0%2C%22className%22%3A%22app%3A%3Amodules%3A%3Auser%3A%3Amodels%3A%3Arule%3A%3AHasDealRule%22%2C%22params%22%3A%7B%22linkedRule%22%3A%7B%22type%22%3A%22andrule%22%2C%22inverted%22%3A0%2C%22className%22%3A%22app%3A%3Acomponents%3A%3Alogic%3A%3Arule%3A%3AAndRule%22%2C%22params%22%3A%7B%22children%22%3A%5B%7B%22type%22%3A%22deal_created_at%22%2C%22inverted%22%3A0%2C%22className%22%3A%22app%3A%3Amodules%3A%3Asales%3A%3Arules%3A%3ADealCreatedAtRule%22%2C%22params%22%3A%7B%22value%22%3A%7B%22from%22%3A%2215.07.2024%22%2C%22to%22%3A%2215.07.2024%22%2C%22toNDays%22%3Anull%2C%22fromNDays%22%3Anull%2C%22dateType%22%3A%22prev_day%22%2C%22withTime%22%3Afalse%7D%2C%22valueMode%22%3Anull%7D%7D%2C%7B%22type%22%3A%22deal_offer_id%22%2C%22inverted%22%3A0%2C%22className%22%3A%22app%3A%3Acomponents%3A%3Alogic%3A%3Arule%3A%3Asales%3A%3AOfferIdDealContextRule%22%2C%22params%22%3A%7B%22value%22%3A%7B%22selected_id%22%3A%5B8347430%5D%2C%22selected_tags%22%3A%5B%5D%2C%22all_object_with_tags%22%3Afalse%7D%2C%22valueMode%22%3Anull%7D%7D%5D%2C%22mode%22%3A%22and%22%7D%7D%2C%22countCondition%22%3Anull%7D%7D%5D%2C%22mode%22%3A%22and%22%7D%7D&formParams%5Bclarity_uid%5D=wIMVGIqMM-l54Ric6Z1s6gW9Zhwq0Vn1'

REGI_19_URL = 'https://gc.ksamata.ru/pl/user/user/index?uc%5Bsegment_id%5D=0&uc%5Brule_string%5D=%7B%22type%22%3A%22andrule%22%2C%22inverted%22%3A0%2C%22className%22%3A%22app%3A%3Acomponents%3A%3Alogic%3A%3Arule%3A%3AAndRule%22%2C%22params%22%3A%7B%22children%22%3A%5B%7B%22type%22%3A%22UserContext_formfieldvalue%22%2C%22inverted%22%3A0%2C%22className%22%3A%22app%3A%3Acomponents%3A%3Alogic%3A%3Arule%3A%3AFormFieldValueRule%22%2C%22params%22%3A%7B%22valueMode%22%3A2%2C%22fieldId%22%3A5002734%2C%22fieldValue%22%3A%7B%22selected_id%22%3A%5B%22%D0%A3%D0%B4%D0%BE%D0%B1%D0%BD%D0%BE+%D1%81%D0%BC%D0%BE%D1%82%D1%80%D0%B5%D1%82%D1%8C+%D0%B2+19%3A00%22%5D%7D%2C%22caseSensitive%22%3Afalse%7D%7D%2C%7B%22type%22%3A%22user_hasdealrule%22%2C%22inverted%22%3A0%2C%22className%22%3A%22app%3A%3Amodules%3A%3Auser%3A%3Amodels%3A%3Arule%3A%3AHasDealRule%22%2C%22params%22%3A%7B%22linkedRule%22%3A%7B%22type%22%3A%22andrule%22%2C%22inverted%22%3A0%2C%22className%22%3A%22app%3A%3Acomponents%3A%3Alogic%3A%3Arule%3A%3AAndRule%22%2C%22params%22%3A%7B%22children%22%3A%5B%7B%22type%22%3A%22deal_created_at%22%2C%22inverted%22%3A0%2C%22className%22%3A%22app%3A%3Amodules%3A%3Asales%3A%3Arules%3A%3ADealCreatedAtRule%22%2C%22params%22%3A%7B%22value%22%3A%7B%22from%22%3A%2215.07.2024%22%2C%22to%22%3A%2215.07.2024%22%2C%22toNDays%22%3Anull%2C%22fromNDays%22%3Anull%2C%22dateType%22%3A%22prev_day%22%2C%22withTime%22%3Afalse%7D%2C%22valueMode%22%3Anull%7D%7D%2C%7B%22type%22%3A%22deal_offer_id%22%2C%22inverted%22%3A0%2C%22className%22%3A%22app%3A%3Acomponents%3A%3Alogic%3A%3Arule%3A%3Asales%3A%3AOfferIdDealContextRule%22%2C%22params%22%3A%7B%22value%22%3A%7B%22selected_id%22%3A%5B8347430%5D%2C%22selected_tags%22%3A%5B%5D%2C%22all_object_with_tags%22%3Afalse%7D%2C%22valueMode%22%3Anull%7D%7D%5D%2C%22mode%22%3A%22and%22%7D%7D%2C%22countCondition%22%3Anull%7D%7D%5D%2C%22mode%22%3A%22and%22%7D%7D&formParams%5Bclarity_uid%5D=wIMVGIqMM-l54Ric6Z1s6gW9Zhwq0Vn1'


FUNNEL_32 = {
    'num': 32,
    'source': 'Яндекс РСЯ',
    'product': 'ДЫХАНИЕ',
    'contractor': 'НИМБ',
    'variant': 'РСЯ',
    'product_name': 'ДЫХАНИЕ НИМБ РСЯ',
    'landing_url': 'https://t.ksamata.ru/dih/rsya/a',
    'start_date': '2026-05-05',
    'block_name': '[ДЫХАНИЕ НИМБ РСЯ]',
    'sheet_name': 'ДЫХАНИЕ',
    'tag_19_raw': 'дыхание, РСЯ, t=19',
    'tag_15_raw': 'дыхание, РСЯ, t=15',
    'reg_tags_raw': 'Регистрация, Яндекс Реклама новый ленд, РСЯ, НИМБ, ДЫХАНИЕ',
    'dash_sales_url': 'https://gc.ksamata.ru/pl/logic/funnel/update?id=1680871',
    'dash_pereliv_url': '',
    'regi_total_url': REGI_TOTAL_URL,
    'regi_15_url': REGI_15_URL,
    'regi_19_url': REGI_19_URL,
    'regi_notime_url': '',
    'predspisok_url': '',
    'bothelp_condition': 'воронка геткурс',
    'room_ids_json': ROOM_IDS_JSON,
    'days': {
        '19': {
            1: {
                'gc_room':    'https://gc.ksamata.ru/dih1-19-rsya',
                'web_room':   'https://web.ksamatacenter.com/room/dih1-19-rsya',
                'sales_page': 'https://t.ksamata.ru/dih/tarif-19-rsya',
                'tariffs':    'https://gc.ksamata.ru/dih/tarif/curator-19-rsya',
                'oto':        'https://gc.ksamata.ru/dih/oto-19-rsya',
                'bonuses':    'https://gc.ksamata.ru/av/dih/bonus-1',
                'mission':    'https://gc.ksamata.ru/pl/tasks/mission/update?id=2451609',
                'mission_type': 'update',
            },
            2: {
                'gc_room':    'https://gc.ksamata.ru/dih2-19-rsya',
                'web_room':   'https://web.ksamatacenter.com/room/dih2-19-rsya',
                'sales_page': 'https://t.ksamata.ru/dih/tarifz-19-rsya',
                'sales_note': 'тарифы с записью 2,3 дня',
                'bonuses':    'https://gc.ksamata.ru/av/dih/bonus-2',
                'meditation': 'https://gc.ksamata.ru/meditation-rsya',
                'dojim_note': 'дожим в ГК по куп больш курс',
            },
            3: {
                'gc_room':    'https://gc.ksamata.ru/dih3-19-rsya',
                'web_room':   'https://web.ksamatacenter.com/room/dih3-19-rsya',
                'sales_page': 'https://t.ksamata.ru/dih/tarifz-19-rsya',
                'sales_note': 'тарифы с записью 2,3 дня',
            },
            4: {
                'gc_room':    'https://gc.ksamata.ru/dih4-19-rsya',
                'web_room':   'https://web.ksamatacenter.com/room/dih4-19-rsya',
            },
            5: {
                'gc_room':    'https://gc.ksamata.ru/dih5-19-rsya',
                'web_room':   'https://web.ksamatacenter.com/room/dih5-19-rsya',
                'bonuses':    'геткурс',
                'mission':    'https://gc.ksamata.ru/pl/tasks/mission/process?id=2456727',
                'mission_type': 'process',
            },
        },
        '15': {
            1: {
                'gc_room':    'https://gc.ksamata.ru/dih1-15-rsya',
                'web_room':   'https://web.ksamatacenter.com/room/dih1-15-rsya',
                'sales_page': 'https://t.ksamata.ru/dih/tarif-15-rsya',
                'tariffs':    'https://gc.ksamata.ru/dih/tarif/curator-15-rsya',
                'oto':        'https://gc.ksamata.ru/dih/oto-15-rsya',
            },
            2: {
                'gc_room':    'https://gc.ksamata.ru/dih2-15-rsya',
                'web_room':   'https://web.ksamatacenter.com/room/dih2-15-rsya',
                'sales_page': 'https://t.ksamata.ru/dih/tarifz-15-rsya',
                'sales_note': 'тарифы с записью 2,3 дня',
            },
            3: {
                'gc_room':    'https://gc.ksamata.ru/dih3-15-rsya',
                'web_room':   'https://web.ksamatacenter.com/room/dih3-15-rsya',
                'sales_page': 'https://t.ksamata.ru/dih/tarifz-15-rsya',
                'sales_note': 'тарифы с записью 2,3 дня',
            },
            4: {
                'gc_room':    'https://gc.ksamata.ru/dih4-15-rsya',
                'web_room':   'https://web.ksamatacenter.com/room/dih4-15-rsya',
            },
            5: {
                'gc_room':    'https://gc.ksamata.ru/dih5-15-rsya',
                'web_room':   'https://web.ksamatacenter.com/room/dih5-15-rsya',
            },
        },
    },
}


# ============================================================
# INSERT LOGIC
# ============================================================

def insert_funnel(conn, fdata):
    num = fdata['num']

    existing = conn.execute("SELECT id FROM funnels WHERE num = ?", (num,)).fetchone()
    if existing:
        print(f"  Funnel #{num} already exists (id={existing[0]}), skipping.")
        return None

    source_id = get_or_create(conn, 'sources', fdata['source'])
    product_id = get_or_create(conn, 'products', fdata['product'])
    contractor_id = get_or_create(conn, 'contractors', fdata['contractor'])

    all_tag_names = set()
    for raw in (fdata['tag_19_raw'], fdata['tag_15_raw'], fdata['reg_tags_raw']):
        all_tag_names.update(parse_tag_string(raw))
    tag_map = ensure_tags(conn, all_tag_names)

    cur = conn.execute("""
        INSERT INTO funnels(
            num, source_id, product_id, contractor_id, variant,
            product_name, landing_url, start_date,
            block_name, sheet_name, tag_19_raw, tag_15_raw, reg_tags_raw,
            dash_sales_url, dash_pereliv_url,
            regi_total_url, regi_15_url, regi_19_url, regi_notime_url,
            predspisok_url, room_ids_json, bothelp_condition
        ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    """, (
        num, source_id, product_id, contractor_id, fdata['variant'],
        fdata['product_name'], fdata['landing_url'], fdata['start_date'],
        fdata['block_name'], fdata['sheet_name'],
        fdata['tag_19_raw'], fdata['tag_15_raw'], fdata['reg_tags_raw'],
        fdata['dash_sales_url'], fdata['dash_pereliv_url'],
        fdata['regi_total_url'], fdata['regi_15_url'],
        fdata['regi_19_url'], fdata['regi_notime_url'],
        fdata['predspisok_url'], fdata['room_ids_json'],
        fdata['bothelp_condition'],
    ))
    funnel_id = cur.lastrowid
    print(f"  Inserted funnel #{num} -> id={funnel_id}")

    insert_funnel_tags(conn, funnel_id, tag_map, 'time_19', fdata['tag_19_raw'])
    insert_funnel_tags(conn, funnel_id, tag_map, 'time_15', fdata['tag_15_raw'])
    insert_funnel_tags(conn, funnel_id, tag_map, 'reg',     fdata['reg_tags_raw'])

    for slot, days in fdata['days'].items():
        for day_num, day in days.items():
            conn.execute("""
                INSERT INTO funnel_days(
                    funnel_id, time_slot, day_num, room_id_f1,
                    gc_room, web_room, replay_url, web_replay,
                    sales_page, sales_note, tariffs, oto, bonuses,
                    mission, mission_type, meditation, dojim_note
                ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            """, (
                funnel_id, slot, day_num, '',
                day.get('gc_room', ''),    day.get('web_room', ''),
                day.get('replay_url', ''), day.get('web_replay', ''),
                day.get('sales_page', ''), day.get('sales_note', ''),
                day.get('tariffs', ''),    day.get('oto', ''),
                day.get('bonuses', ''),    day.get('mission', ''),
                day.get('mission_type', ''),
                day.get('meditation', ''), day.get('dojim_note', ''),
            ))

    return funnel_id


def verify_funnel(conn, num):
    print(f"\n{'='*60}\n  Funnel #{num}\n{'='*60}")
    row = conn.execute("""
        SELECT f.id, f.num, s.name, p.name, c.name, f.variant, f.product_name,
               f.landing_url, f.start_date, f.block_name, f.sheet_name,
               f.tag_19_raw, f.tag_15_raw, f.reg_tags_raw,
               f.dash_sales_url, f.dash_pereliv_url,
               f.regi_total_url, f.regi_15_url, f.regi_19_url, f.regi_notime_url,
               f.predspisok_url, f.room_ids_json, f.bothelp_condition
        FROM funnels f
        JOIN sources s ON f.source_id = s.id
        JOIN products p ON f.product_id = p.id
        JOIN contractors c ON f.contractor_id = c.id
        WHERE f.num = ?
    """, (num,)).fetchone()
    if not row:
        print("  [NOT FOUND]")
        return
    labels = ['id', 'num', 'source', 'product', 'contractor', 'variant',
              'product_name', 'landing_url', 'start_date', 'block_name',
              'sheet_name', 'tag_19_raw', 'tag_15_raw', 'reg_tags_raw',
              'dash_sales_url', 'dash_pereliv_url',
              'regi_total_url', 'regi_15_url', 'regi_19_url', 'regi_notime_url',
              'predspisok_url', 'room_ids_json', 'bothelp_condition']
    for label, val in zip(labels, row):
        v = val if val is None or len(str(val)) < 120 else str(val)[:117] + '...'
        print(f"  {label:<18}: {v}")

    funnel_id = row[0]
    tags = conn.execute("""
        SELECT ft.tag_type, ft.position, t.name
        FROM funnel_tags ft JOIN tags t ON ft.tag_id = t.id
        WHERE ft.funnel_id = ? ORDER BY ft.tag_type, ft.position
    """, (funnel_id,)).fetchall()
    if tags:
        print(f"\n  Tags ({len(tags)}):")
        for tt, pos, name in tags:
            print(f"    [{tt}] pos={pos}  {name}")

    days = conn.execute("""
        SELECT time_slot, day_num, gc_room, web_room, sales_page, sales_note,
               tariffs, oto, bonuses, mission, mission_type, meditation, dojim_note
        FROM funnel_days WHERE funnel_id = ?
        ORDER BY time_slot, day_num
    """, (funnel_id,)).fetchall()
    cols = ['time_slot', 'day_num', 'gc_room', 'web_room', 'sales_page', 'sales_note',
            'tariffs', 'oto', 'bonuses', 'mission', 'mission_type', 'meditation', 'dojim_note']
    print(f"\n  Funnel days ({len(days)}):")
    for d in days:
        filled = {c: v for c, v in zip(cols, d) if v}
        print(f"    slot={filled.get('time_slot')} day={filled.get('day_num')}:")
        for k, v in filled.items():
            if k not in ('time_slot', 'day_num'):
                print(f"      {k:<14}: {v}")


def add_dih_funnel(db_path=DB_PATH):
    if not os.path.exists(db_path):
        raise FileNotFoundError(f"Database not found: {db_path}")
    conn = sqlite3.connect(db_path)
    conn.execute("PRAGMA foreign_keys = ON")
    print(f"Connected to: {db_path}")
    print("\n--- Inserting funnel #32 (ДЫХАНИЕ НИМБ РСЯ) ---")
    insert_funnel(conn, FUNNEL_32)
    conn.commit()
    print("\nCommit OK.")
    return conn


if __name__ == '__main__':
    conn = add_dih_funnel()
    print("\n--- Verification ---")
    verify_funnel(conn, 32)
    conn.close()
    print("\nDone.")
