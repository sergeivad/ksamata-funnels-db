#!/usr/bin/env python3
"""
Adds 2 new "перелив" funnels to the existing ksamata_funnels.db:
  #27 — БОО перелив с СПБ
  #28 — ДБО перелив с БОО

All data is hardcoded; the Excel source file is NOT parsed.
Script is idempotent: skips a funnel if it already exists (by num).
"""

import sqlite3
import re
import os

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, 'ksamata_funnels.db')


# ============================================================
# HELPER FUNCTIONS
# ============================================================

def get_or_create(conn, table, name):
    """Return the id of an existing row (by name) or insert a new one."""
    row = conn.execute(f"SELECT id FROM {table} WHERE name = ?", (name,)).fetchone()
    if row:
        return row[0]
    cur = conn.execute(f"INSERT INTO {table}(name) VALUES(?)", (name,))
    return cur.lastrowid


def ensure_tags(conn, tag_names):
    """Ensure all tags exist in the tags table. Return {name: id} mapping."""
    result = {}
    for name in tag_names:
        result[name] = get_or_create(conn, 'tags', name)
    return result


def parse_tag_string(raw):
    """Split comma-separated tag string, filter out t=NN tokens."""
    if not raw:
        return []
    parts = [t.strip() for t in raw.split(',')]
    return [p for p in parts if p and not re.match(r'^t=\d+$', p)]


def insert_funnel_tags(conn, funnel_id, tag_map, tag_type, raw):
    """
    Parse raw comma-separated tag string, skip t=NN tokens,
    insert into funnel_tags using the provided tag_map {name: id}.
    """
    tag_names = parse_tag_string(raw)
    for pos, tname in enumerate(tag_names):
        if tname in tag_map:
            conn.execute(
                "INSERT OR IGNORE INTO funnel_tags(funnel_id, tag_id, tag_type, position) VALUES(?,?,?,?)",
                (funnel_id, tag_map[tname], tag_type, pos)
            )


def verify_funnel(conn, num):
    """Print all inserted data for a funnel identified by num."""
    print(f"\n{'='*60}")
    print(f"  Funnel #{num}")
    print(f"{'='*60}")

    row = conn.execute("""
        SELECT f.id, f.num, s.name AS source, p.name AS product,
               c.name AS contractor, f.variant, f.product_name,
               f.landing_url, f.start_date, f.block_name, f.sheet_name,
               f.tag_19_raw, f.tag_15_raw, f.reg_tags_raw, f.room_ids_json
        FROM funnels f
        JOIN sources s ON f.source_id = s.id
        JOIN products p ON f.product_id = p.id
        JOIN contractors c ON f.contractor_id = c.id
        WHERE f.num = ?
    """, (num,)).fetchone()

    if not row:
        print(f"  [NOT FOUND]")
        return

    funnel_id = row[0]
    labels = ['id', 'num', 'source', 'product', 'contractor', 'variant',
              'product_name', 'landing_url', 'start_date', 'block_name',
              'sheet_name', 'tag_19_raw', 'tag_15_raw', 'reg_tags_raw', 'room_ids_json']
    for label, val in zip(labels, row):
        print(f"  {label:<18}: {val}")

    # Tags
    tags = conn.execute("""
        SELECT ft.tag_type, ft.position, t.name
        FROM funnel_tags ft
        JOIN tags t ON ft.tag_id = t.id
        WHERE ft.funnel_id = ?
        ORDER BY ft.tag_type, ft.position
    """, (funnel_id,)).fetchall()
    if tags:
        print(f"\n  Tags ({len(tags)}):")
        for tag_type, pos, name in tags:
            print(f"    [{tag_type}] pos={pos}  {name}")

    # Salebot configs
    sbots = conn.execute("""
        SELECT time_slot, condition, calculator
        FROM salebot_configs
        WHERE funnel_id = ?
        ORDER BY time_slot
    """, (funnel_id,)).fetchall()
    if sbots:
        print(f"\n  Salebot configs ({len(sbots)}):")
        for slot, cond, calc in sbots:
            print(f"    slot={slot}  condition={cond!r}  calculator={calc!r}")

    # Funnel days
    days = conn.execute("""
        SELECT time_slot, day_num, gc_room, web_room, replay_url, web_replay,
               sales_page, sales_note, tariffs, oto, bonuses, mission,
               meditation, dojim_note
        FROM funnel_days
        WHERE funnel_id = ?
        ORDER BY time_slot, day_num
    """, (funnel_id,)).fetchall()
    if days:
        print(f"\n  Funnel days ({len(days)}):")
        cols = ['time_slot', 'day_num', 'gc_room', 'web_room', 'replay_url',
                'web_replay', 'sales_page', 'sales_note', 'tariffs', 'oto',
                'bonuses', 'mission', 'meditation', 'dojim_note']
        for d in days:
            filled = {c: v for c, v in zip(cols, d) if v}
            print(f"    slot={filled.get('time_slot')} day={filled.get('day_num')}:")
            for k, v in filled.items():
                if k not in ('time_slot', 'day_num'):
                    print(f"      {k:<14}: {v}")


# ============================================================
# FUNNEL DATA
# ============================================================

FUNNEL_27 = {
    'num': 27,
    'source': 'Перелив',
    'product': 'БОО',
    'contractor': 'Перелив',
    'variant': '',
    'product_name': 'БОО Перелив СПБ',
    'landing_url': '',
    'start_date': '2024-07-01',
    'block_name': '[БОО перелив с СПБ] НОВАЯ ЦЕНА',
    'sheet_name': 'БОО',
    'tag_19_raw': 'БОО, перелив с СПБ',
    'tag_15_raw': 'БОО, перелив с СПБ',
    'reg_tags_raw': 'Регистрация, Детокс, перелив',
    'dash_sales_url': 'https://gc.ksamata.ru/pl/sales/deal/index?DealContext%5Bsegment_id%5D=&DealContext%5Brule_string%5D=%7B%22type%22%3A%22andrule%22%2C%22inverted%22%3A0%2C%22params%22%3A%7B%22mode%22%3A%22and%22%2C%22children%22%3A%5B%7B%22type%22%3A%22deal_created_at%22%2C%22inverted%22%3A0%2C%22params%22%3A%7B%22value%22%3A%7B%22from%22%3Anull%2C%22to%22%3Anull%2C%22toNDays%22%3Anull%2C%22fromNDays%22%3Anull%2C%22dateType%22%3A%22prev_day%22%2C%22withTime%22%3Afalse%7D%2C%22valueMode%22%3Anull%7D%7D%2C%7B%22type%22%3A%22deal_offer_id%22%2C%22inverted%22%3A0%2C%22params%22%3A%7B%22value%22%3A%7B%22selected_id%22%3A%5B%5D%2C%22selected_tags%22%3A%5B%22%D0%B0%D0%B2%D1%82%D0%BE%D0%B2%D0%BE%D1%80%D0%BE%D0%BD%D0%BA%D0%B8%22%2C%22%D0%BF%D0%B5%D1%80%D0%B5%D0%BB%D0%B8%D0%B2%22%2C%22%D0%91%D0%9E%D0%9E%22%5D%2C%22all_object_with_tags%22%3Atrue%7D%2C%22valueMode%22%3Anull%7D%7D%5D%7D%2C%22maxSize%22%3A%22%22%7D&formParams%5Bclarity_uid%5D=wIMVGIqMM-l54Ric6Z1s6gW9Zhwq0Vn1',
    'dash_pereliv_url': '',
    'regi_total_url': 'https://gc.ksamata.ru/pl/user/user/index?uc%5Bsegment_id%5D=&uc%5Brule_string%5D=%7B%22type%22%3A%22user_hasdealrule%22%2C%22inverted%22%3A0%2C%22params%22%3A%7B%22linkedRule%22%3A%7B%22type%22%3A%22andrule%22%2C%22inverted%22%3A0%2C%22params%22%3A%7B%22mode%22%3A%22and%22%2C%22children%22%3A%5B%7B%22type%22%3A%22deal_created_at%22%2C%22inverted%22%3A0%2C%22params%22%3A%7B%22value%22%3A%7B%22from%22%3A%2220.05.2022%22%2C%22to%22%3A%2224.05.2022%22%2C%22toNDays%22%3Anull%2C%22fromNDays%22%3Anull%2C%22dateType%22%3A%22prev_day%22%2C%22withTime%22%3Afalse%7D%2C%22valueMode%22%3Anull%7D%7D%2C%7B%22type%22%3A%22deal_offer_id%22%2C%22inverted%22%3A0%2C%22params%22%3A%7B%22value%22%3A%7B%22selected_id%22%3A%5B2548929%5D%2C%22selected_tags%22%3A%5B%5D%2C%22all_object_with_tags%22%3Afalse%7D%2C%22valueMode%22%3Anull%7D%7D%5D%7D%7D%2C%22countCondition%22%3A%7B%22checker%22%3A%22nlt%22%2C%22numval%22%3A%22%22%7D%7D%2C%22maxSize%22%3A%22%22%7D&formParams%5Bclarity_uid%5D=wIMVGIqMM-l54Ric6Z1s6gW9Zhwq0Vn1',
    'regi_15_url': 'https://gc.ksamata.ru/pl/user/user/index?uc%5Bsegment_id%5D=&uc%5Brule_string%5D=%7B%22type%22%3A%22andrule%22%2C%22inverted%22%3A0%2C%22params%22%3A%7B%22mode%22%3A%22and%22%2C%22children%22%3A%5B%7B%22type%22%3A%22UserContext_formfieldvalue%22%2C%22inverted%22%3A0%2C%22params%22%3A%7B%22fieldId%22%3A5002734%2C%22fieldValue%22%3A%7B%22selected_id%22%3A%5B%22%D0%A3%D0%B4%D0%BE%D0%B1%D0%BD%D0%BE+%D1%81%D0%BC%D0%BE%D1%82%D1%80%D0%B5%D1%82%D1%8C+%D0%B2+15%3A00%22%5D%7D%2C%22valueMode%22%3Anull%7D%7D%2C%7B%22type%22%3A%22user_hasdealrule%22%2C%22inverted%22%3A0%2C%22params%22%3A%7B%22linkedRule%22%3A%7B%22type%22%3A%22andrule%22%2C%22inverted%22%3A0%2C%22params%22%3A%7B%22mode%22%3A%22and%22%2C%22children%22%3A%5B%7B%22type%22%3A%22deal_created_at%22%2C%22inverted%22%3A0%2C%22params%22%3A%7B%22value%22%3A%7B%22from%22%3A%2220.05.2022%22%2C%22to%22%3A%2224.05.2022%22%2C%22toNDays%22%3Anull%2C%22fromNDays%22%3Anull%2C%22dateType%22%3A%22prev_day%22%2C%22withTime%22%3Afalse%7D%2C%22valueMode%22%3Anull%7D%7D%2C%7B%22type%22%3A%22deal_offer_id%22%2C%22inverted%22%3A0%2C%22params%22%3A%7B%22value%22%3A%7B%22selected_id%22%3A%5B2548929%5D%2C%22selected_tags%22%3A%5B%5D%2C%22all_object_with_tags%22%3Afalse%7D%2C%22valueMode%22%3Anull%7D%7D%5D%7D%7D%2C%22countCondition%22%3A%7B%22checker%22%3A%22nlt%22%2C%22numval%22%3A%22%22%7D%7D%7D%5D%7D%2C%22maxSize%22%3A%22%22%7D&formParams%5Bclarity_uid%5D=wIMVGIqMM-l54Ric6Z1s6gW9Zhwq0Vn1',
    'regi_19_url': 'https://gc.ksamata.ru/pl/user/user/index?uc%5Bsegment_id%5D=&uc%5Brule_string%5D=%7B%22type%22%3A%22andrule%22%2C%22inverted%22%3A0%2C%22params%22%3A%7B%22mode%22%3A%22and%22%2C%22children%22%3A%5B%7B%22type%22%3A%22UserContext_formfieldvalue%22%2C%22inverted%22%3A0%2C%22params%22%3A%7B%22fieldId%22%3A5002734%2C%22fieldValue%22%3A%7B%22selected_id%22%3A%5B%22%D0%A3%D0%B4%D0%BE%D0%B1%D0%BD%D0%BE+%D1%81%D0%BC%D0%BE%D1%82%D1%80%D0%B5%D1%82%D1%8C+%D0%B2+19%3A00%22%5D%7D%2C%22valueMode%22%3A2%7D%7D%2C%7B%22type%22%3A%22user_hasdealrule%22%2C%22inverted%22%3A0%2C%22params%22%3A%7B%22linkedRule%22%3A%7B%22type%22%3A%22andrule%22%2C%22inverted%22%3A0%2C%22params%22%3A%7B%22mode%22%3A%22and%22%2C%22children%22%3A%5B%7B%22type%22%3A%22deal_created_at%22%2C%22inverted%22%3A0%2C%22params%22%3A%7B%22value%22%3A%7B%22from%22%3A%2220.05.2022%22%2C%22to%22%3A%2224.05.2022%22%2C%22toNDays%22%3Anull%2C%22fromNDays%22%3Anull%2C%22dateType%22%3A%22prev_day%22%2C%22withTime%22%3Afalse%7D%2C%22valueMode%22%3Anull%7D%7D%2C%7B%22type%22%3A%22deal_offer_id%22%2C%22inverted%22%3A0%2C%22params%22%3A%7B%22value%22%3A%7B%22selected_id%22%3A%5B2548929%5D%2C%22selected_tags%22%3A%5B%5D%2C%22all_object_with_tags%22%3Afalse%7D%2C%22valueMode%22%3Anull%7D%7D%5D%7D%7D%2C%22countCondition%22%3A%7B%22checker%22%3A%22nlt%22%2C%22numval%22%3A%22%22%7D%7D%7D%5D%7D%2C%22maxSize%22%3A%22%22%7D&formParams%5Bclarity_uid%5D=wIMVGIqMM-l54Ric6Z1s6gW9Zhwq0Vn1',
    'regi_notime_url': 'https://gc.ksamata.ru/pl/user/user/index?uc%5Bsegment_id%5D=&uc%5Brule_string%5D=%7B%22type%22%3A%22andrule%22%2C%22inverted%22%3A0%2C%22params%22%3A%7B%22mode%22%3A%22and%22%2C%22children%22%3A%5B%7B%22type%22%3A%22UserContext_formfieldvalue%22%2C%22inverted%22%3A0%2C%22params%22%3A%7B%22fieldId%22%3A5002734%2C%22fieldValue%22%3A%7B%22selected_id%22%3A%5B%22%D0%A3%D0%B4%D0%BE%D0%B1%D0%BD%D0%BE+%D1%81%D0%BC%D0%BE%D1%82%D1%80%D0%B5%D1%82%D1%8C+%D0%B2+19%3A00%22%5D%7D%2C%22valueMode%22%3A-1%7D%7D%2C%7B%22type%22%3A%22user_hasdealrule%22%2C%22inverted%22%3A0%2C%22params%22%3A%7B%22linkedRule%22%3A%7B%22type%22%3A%22andrule%22%2C%22inverted%22%3A0%2C%22params%22%3A%7B%22mode%22%3A%22and%22%2C%22children%22%3A%5B%7B%22type%22%3A%22deal_created_at%22%2C%22inverted%22%3A0%2C%22params%22%3A%7B%22value%22%3A%7B%22from%22%3A%2220.05.2022%22%2C%22to%22%3A%2224.05.2022%22%2C%22toNDays%22%3Anull%2C%22fromNDays%22%3Anull%2C%22dateType%22%3A%22prev_day%22%2C%22withTime%22%3Afalse%7D%2C%22valueMode%22%3Anull%7D%7D%2C%7B%22type%22%3A%22deal_offer_id%22%2C%22inverted%22%3A0%2C%22params%22%3A%7B%22value%22%3A%7B%22selected_id%22%3A%5B2548929%5D%2C%22selected_tags%22%3A%5B%5D%2C%22all_object_with_tags%22%3Afalse%7D%2C%22valueMode%22%3Anull%7D%7D%5D%7D%7D%2C%22countCondition%22%3A%7B%22checker%22%3A%22nlt%22%2C%22numval%22%3A%22%22%7D%7D%7D%5D%7D%2C%22maxSize%22%3A%22%22%7D&formParams%5Bclarity_uid%5D=wIMVGIqMM-l54Ric6Z1s6gW9Zhwq0Vn1',
    'room_ids_json': '{}',
    'salebot': {
        '19': {'condition': 'boo-spbns19', 'calculator': 'boo-spbns_date = #{current_date}'},
        '15': {'condition': 'boo-spbns15', 'calculator': 'boo-spbns_date = #{current_date}'},
    },
    'days': {
        '19': {
            1: {
                'gc_room': 'https://gc.ksamata.ru/boo1-spb',
                'web_room': 'https://web.ksamatacenter.com/room/boo1-spb',
                'sales_page': 'https://t.ksamata.ru/dtx/tarif-1spb',
                'oto': 'https://gc.ksamata.ru/dtx/qh_imm_spb',
                'bonuses': 'https://gc.ksamata.ru/boo/bonus_1',
                'mission': 'https://gc.ksamata.ru/pl/tasks/mission/process?id=1744669',
            },
            2: {
                'gc_room': 'https://gc.ksamata.ru/boo2-spb',
                'web_room': 'https://web.ksamatacenter.com/room/boo2-spb',
                'sales_page': 'https://t.ksamata.ru/dtx/tarif-2spb',
                'bonuses': 'https://gc.ksamata.ru/boo/bonus_2',
                'mission': 'https://salebot.pro/projects/98250/messages?sheet_id=202093',
                'meditation': 'https://gc.ksamata.ru/meditation-boospb',
                'dojim_note': 'дожим в ГК по куп больш курс',
            },
            3: {
                'gc_room': 'https://gc.ksamata.ru/boo3-spb',
                'web_room': 'https://web.ksamatacenter.com/room/boo3-spb',
                'sales_page': 'https://t.ksamata.ru/dtx/tarif-2spbz',
                'sales_note': 'тарифы с записью',
                'meditation': 'https://gc.ksamata.ru/abl-boospb',
                'dojim_note': 'дожим в ГК по куп мал курс',
            },
            4: {
                'gc_room': 'https://gc.ksamata.ru/boo4-spb',
                'web_room': 'https://web.ksamatacenter.com/room/boo4-spb',
                'replay_url': 'https://gc.ksamata.ru/boo4r-spb',
                'web_replay': 'https://web.ksamatacenter.com/room/boo4r-spb',
            },
            5: {
                'gc_room': 'https://gc.ksamata.ru/boo5-spb',
                'web_room': 'https://web.ksamatacenter.com/room/boo5-spb',
                'replay_url': 'https://gc.ksamata.ru/boo5r-spb',
                'web_replay': 'https://web.ksamatacenter.com/room/boo5r-spb',
            },
        },
        '15': {
            1: {
                'gc_room': 'https://gc.ksamata.ru/1boo-spb',
                'web_room': 'https://web.ksamatacenter.com/room/1boo-spb',
                'sales_page': 'https://t.ksamata.ru/dtx/tarif-1spb',
                'oto': 'https://gc.ksamata.ru/dtx/qh_imm_spb',
                'mission': 'https://gc.ksamata.ru/pl/tasks/mission/process?id=1744671',
            },
            2: {
                'gc_room': 'https://gc.ksamata.ru/2boo-spb',
                'web_room': 'https://web.ksamatacenter.com/room/2boo-spb',
                'sales_page': 'https://t.ksamata.ru/dtx/tarif-2spb',
                'mission': 'https://salebot.pro/projects/98250/messages?sheet_id=202094',
            },
            3: {
                'gc_room': 'https://gc.ksamata.ru/3boo-spb',
                'web_room': 'https://web.ksamatacenter.com/room/3boo-spb',
                'sales_page': 'https://t.ksamata.ru/dtx/tarif-2spbz',
                'sales_note': 'тарифы с записью',
            },
            4: {
                'gc_room': 'https://gc.ksamata.ru/4boo-spb',
                'web_room': 'https://web.ksamatacenter.com/room/4boo-spb',
                'replay_url': 'https://gc.ksamata.ru/4rboo-spb',
                'web_replay': 'https://web.ksamatacenter.com/room/4rboo-spb',
            },
            5: {
                'gc_room': 'https://gc.ksamata.ru/5boo-spb',
                'web_room': 'https://web.ksamatacenter.com/room/5boo-spb',
                'replay_url': 'https://gc.ksamata.ru/5rboo-spb',
                'web_replay': 'https://web.ksamatacenter.com/room/5rboo-spb',
            },
        },
    },
}

FUNNEL_28 = {
    'num': 28,
    'source': 'Перелив',
    'product': 'ДБО',
    'contractor': 'Перелив',
    'variant': '',
    'product_name': 'ДБО Перелив БОО',
    'landing_url': 'https://lp.ksamata.ru/dbb-dtx',
    'start_date': '2024-01-01',
    'block_name': '[ДБО перелив с БОО]',
    'sheet_name': 'ДБО',
    'tag_19_raw': 'СПБ, Перелив с БОО',
    'tag_15_raw': 'СПБ, Перелив с БОО',
    'reg_tags_raw': 'Регистрация, ДБО, перелив',
    'dash_sales_url': 'https://gc.ksamata.ru/pl/sales/deal/index?DealContext%5Bsegment_id%5D=&DealContext%5Brule_string%5D=%7B%22type%22%3A%22andrule%22%2C%22inverted%22%3A0%2C%22params%22%3A%7B%22mode%22%3A%22and%22%2C%22children%22%3A%5B%7B%22type%22%3A%22deal_created_at%22%2C%22inverted%22%3A0%2C%22params%22%3A%7B%22value%22%3A%7B%22from%22%3Anull%2C%22to%22%3Anull%2C%22toNDays%22%3Anull%2C%22fromNDays%22%3Anull%2C%22dateType%22%3A%22prev_day%22%2C%22withTime%22%3Afalse%7D%2C%22valueMode%22%3Anull%7D%7D%2C%7B%22type%22%3A%22deal_offer_id%22%2C%22inverted%22%3A0%2C%22params%22%3A%7B%22value%22%3A%7B%22selected_id%22%3A%5B%5D%2C%22selected_tags%22%3A%5B%22%D0%B0%D0%B2%D1%82%D0%BE%D0%B2%D0%BE%D1%80%D0%BE%D0%BD%D0%BA%D0%B8%22%2C%22%D0%A1%D0%9F%D0%91%22%2C%22%D0%BF%D0%B5%D1%80%D0%B5%D0%BB%D0%B8%D0%B2%22%5D%2C%22all_object_with_tags%22%3Atrue%7D%2C%22valueMode%22%3Anull%7D%7D%5D%7D%2C%22maxSize%22%3A%22%22%7D&formParams%5Bclarity_uid%5D=wIMVGIqMM-l54Ric6Z1s6gW9Zhwq0Vn1',
    'dash_pereliv_url': '',
    'regi_total_url': 'https://gc.ksamata.ru/pl/user/user/index?uc%5Bsegment_id%5D=&uc%5Brule_string%5D=%7B%22type%22%3A%22user_hasdealrule%22%2C%22inverted%22%3A0%2C%22params%22%3A%7B%22linkedRule%22%3A%7B%22type%22%3A%22andrule%22%2C%22inverted%22%3A0%2C%22params%22%3A%7B%22mode%22%3A%22and%22%2C%22children%22%3A%5B%7B%22type%22%3A%22deal_created_at%22%2C%22inverted%22%3A0%2C%22params%22%3A%7B%22value%22%3A%7B%22from%22%3A%2220.05.2022%22%2C%22to%22%3A%2224.05.2022%22%2C%22toNDays%22%3Anull%2C%22fromNDays%22%3Anull%2C%22dateType%22%3A%22prev_day%22%2C%22withTime%22%3Afalse%7D%2C%22valueMode%22%3Anull%7D%7D%2C%7B%22type%22%3A%22deal_offer_id%22%2C%22inverted%22%3A0%2C%22params%22%3A%7B%22value%22%3A%7B%22selected_id%22%3A%5B2573453%5D%2C%22selected_tags%22%3A%5B%5D%2C%22all_object_with_tags%22%3Afalse%7D%2C%22valueMode%22%3Anull%7D%7D%5D%7D%7D%2C%22countCondition%22%3A%7B%22checker%22%3A%22nlt%22%2C%22numval%22%3A%22%22%7D%7D%2C%22maxSize%22%3A%22%22%7D&formParams%5Bclarity_uid%5D=wIMVGIqMM-l54Ric6Z1s6gW9Zhwq0Vn1',
    'regi_15_url': 'https://gc.ksamata.ru/pl/user/user/index?uc%5Bsegment_id%5D=&uc%5Brule_string%5D=%7B%22type%22%3A%22andrule%22%2C%22inverted%22%3A0%2C%22params%22%3A%7B%22mode%22%3A%22and%22%2C%22children%22%3A%5B%7B%22type%22%3A%22UserContext_formfieldvalue%22%2C%22inverted%22%3A0%2C%22params%22%3A%7B%22fieldId%22%3A5002734%2C%22fieldValue%22%3A%7B%22selected_id%22%3A%5B%22%D0%A3%D0%B4%D0%BE%D0%B1%D0%BD%D0%BE+%D1%81%D0%BC%D0%BE%D1%82%D1%80%D0%B5%D1%82%D1%8C+%D0%B2+15%3A00%22%5D%7D%2C%22valueMode%22%3Anull%7D%7D%2C%7B%22type%22%3A%22user_hasdealrule%22%2C%22inverted%22%3A0%2C%22params%22%3A%7B%22linkedRule%22%3A%7B%22type%22%3A%22andrule%22%2C%22inverted%22%3A0%2C%22params%22%3A%7B%22mode%22%3A%22and%22%2C%22children%22%3A%5B%7B%22type%22%3A%22deal_created_at%22%2C%22inverted%22%3A0%2C%22params%22%3A%7B%22value%22%3A%7B%22from%22%3A%2220.05.2022%22%2C%22to%22%3A%2224.05.2022%22%2C%22toNDays%22%3Anull%2C%22fromNDays%22%3Anull%2C%22dateType%22%3A%22prev_day%22%2C%22withTime%22%3Afalse%7D%2C%22valueMode%22%3Anull%7D%7D%2C%7B%22type%22%3A%22deal_offer_id%22%2C%22inverted%22%3A0%2C%22params%22%3A%7B%22value%22%3A%7B%22selected_id%22%3A%5B2573453%5D%2C%22selected_tags%22%3A%5B%5D%2C%22all_object_with_tags%22%3Afalse%7D%2C%22valueMode%22%3Anull%7D%7D%5D%7D%7D%2C%22countCondition%22%3A%7B%22checker%22%3A%22nlt%22%2C%22numval%22%3A%22%22%7D%7D%7D%5D%7D%2C%22maxSize%22%3A%22%22%7D&formParams%5Bclarity_uid%5D=wIMVGIqMM-l54Ric6Z1s6gW9Zhwq0Vn1',
    'regi_19_url': 'https://gc.ksamata.ru/pl/user/user/index?uc%5Bsegment_id%5D=&uc%5Brule_string%5D=%7B%22type%22%3A%22andrule%22%2C%22inverted%22%3A0%2C%22params%22%3A%7B%22mode%22%3A%22and%22%2C%22children%22%3A%5B%7B%22type%22%3A%22UserContext_formfieldvalue%22%2C%22inverted%22%3A0%2C%22params%22%3A%7B%22fieldId%22%3A5002734%2C%22fieldValue%22%3A%7B%22selected_id%22%3A%5B%22%D0%A3%D0%B4%D0%BE%D0%B1%D0%BD%D0%BE+%D1%81%D0%BC%D0%BE%D1%82%D1%80%D0%B5%D1%82%D1%8C+%D0%B2+19%3A00%22%5D%7D%2C%22valueMode%22%3A2%7D%7D%2C%7B%22type%22%3A%22user_hasdealrule%22%2C%22inverted%22%3A0%2C%22params%22%3A%7B%22linkedRule%22%3A%7B%22type%22%3A%22andrule%22%2C%22inverted%22%3A0%2C%22params%22%3A%7B%22mode%22%3A%22and%22%2C%22children%22%3A%5B%7B%22type%22%3A%22deal_created_at%22%2C%22inverted%22%3A0%2C%22params%22%3A%7B%22value%22%3A%7B%22from%22%3A%2220.05.2022%22%2C%22to%22%3A%2224.05.2022%22%2C%22toNDays%22%3Anull%2C%22fromNDays%22%3Anull%2C%22dateType%22%3A%22prev_day%22%2C%22withTime%22%3Afalse%7D%2C%22valueMode%22%3Anull%7D%7D%2C%7B%22type%22%3A%22deal_offer_id%22%2C%22inverted%22%3A0%2C%22params%22%3A%7B%22value%22%3A%7B%22selected_id%22%3A%5B2573453%5D%2C%22selected_tags%22%3A%5B%5D%2C%22all_object_with_tags%22%3Afalse%7D%2C%22valueMode%22%3Anull%7D%7D%5D%7D%7D%2C%22countCondition%22%3A%7B%22checker%22%3A%22nlt%22%2C%22numval%22%3A%22%22%7D%7D%7D%5D%7D%2C%22maxSize%22%3A%22%22%7D&formParams%5Bclarity_uid%5D=wIMVGIqMM-l54Ric6Z1s6gW9Zhwq0Vn1',
    'regi_notime_url': 'https://gc.ksamata.ru/pl/user/user/index?uc%5Bsegment_id%5D=&uc%5Brule_string%5D=%7B%22type%22%3A%22andrule%22%2C%22inverted%22%3A0%2C%22params%22%3A%7B%22mode%22%3A%22and%22%2C%22children%22%3A%5B%7B%22type%22%3A%22UserContext_formfieldvalue%22%2C%22inverted%22%3A0%2C%22params%22%3A%7B%22fieldId%22%3A5002734%2C%22fieldValue%22%3A%7B%22selected_id%22%3A%5B%22%D0%A3%D0%B4%D0%BE%D0%B1%D0%BD%D0%BE+%D1%81%D0%BC%D0%BE%D1%82%D1%80%D0%B5%D1%82%D1%8C+%D0%B2+19%3A00%22%5D%7D%2C%22valueMode%22%3A-1%7D%7D%2C%7B%22type%22%3A%22user_hasdealrule%22%2C%22inverted%22%3A0%2C%22params%22%3A%7B%22linkedRule%22%3A%7B%22type%22%3A%22andrule%22%2C%22inverted%22%3A0%2C%22params%22%3A%7B%22mode%22%3A%22and%22%2C%22children%22%3A%5B%7B%22type%22%3A%22deal_created_at%22%2C%22inverted%22%3A0%2C%22params%22%3A%7B%22value%22%3A%7B%22from%22%3A%2220.05.2022%22%2C%22to%22%3A%2224.05.2022%22%2C%22toNDays%22%3Anull%2C%22fromNDays%22%3Anull%2C%22dateType%22%3A%22prev_day%22%2C%22withTime%22%3Afalse%7D%2C%22valueMode%22%3Anull%7D%7D%2C%7B%22type%22%3A%22deal_offer_id%22%2C%22inverted%22%3A0%2C%22params%22%3A%7B%22value%22%3A%7B%22selected_id%22%3A%5B2573453%5D%2C%22selected_tags%22%3A%5B%5D%2C%22all_object_with_tags%22%3Afalse%7D%2C%22valueMode%22%3Anull%7D%7D%5D%7D%7D%2C%22countCondition%22%3A%7B%22checker%22%3A%22nlt%22%2C%22numval%22%3A%22%22%7D%7D%7D%5D%7D%2C%22maxSize%22%3A%22%22%7D&formParams%5Bclarity_uid%5D=wIMVGIqMM-l54Ric6Z1s6gW9Zhwq0Vn1',
    'room_ids_json': '{}',
    'salebot': {
        '19': {'condition': 'dbo-boo19', 'calculator': 'dbo-boo_date = #{current_date}'},
        '15': {'condition': 'dbo-boo15', 'calculator': 'dbo-boo_date = #{current_date}'},
    },
    'days': {
        '19': {
            1: {
                'gc_room': 'https://gc.ksamata.ru/dbo1-boo',
                'web_room': 'https://web.ksamatacenter.com/room/dbo1-boo',
                'sales_page': 'https://t.ksamata.ru/dbo/tarif-1boo',
                'tariffs': 'https://gc.ksamata.ru/dbo/tarif/curator-boo',
                'oto': 'https://gc.ksamata.ru/dbo/br_mdboo',
                'mission': 'https://gc.ksamata.ru/pl/tasks/mission/process?id=1978504',
            },
            2: {
                'gc_room': 'https://gc.ksamata.ru/dbo2-boo',
                'web_room': 'https://web.ksamatacenter.com/room/dbo2-boo',
                'sales_page': 'https://t.ksamata.ru/dbo/tarif-zboo',
                'sales_note': 'тарифы с записью 2,3 дня',
                'tariffs': 'https://gc.ksamata.ru/dbo/tarif/max-boo',
                'mission': 'https://salebot.pro/projects/98250/messages?sheet_id=274836',
                'meditation': 'https://gc.ksamata.ru/meditation-dboboo',
                'dojim_note': 'дожим в ГК по куп больш курс',
            },
            3: {
                'gc_room': 'https://gc.ksamata.ru/dbo3-boo',
                'web_room': 'https://web.ksamatacenter.com/room/dbo3-boo',
                'tariffs': 'https://gc.ksamata.ru/dbo/tarif/max-int-boo',
            },
            4: {
                'gc_room': 'https://gc.ksamata.ru/dbo4-boo',
                'web_room': 'https://web.ksamatacenter.com/room/dbo4-boo',
            },
            5: {
                'gc_room': 'https://gc.ksamata.ru/dbo5-boo',
                'web_room': 'https://web.ksamatacenter.com/room/dbo5-boo',
            },
        },
        '15': {
            1: {
                'gc_room': 'https://gc.ksamata.ru/1dbo-boo',
                'web_room': 'https://web.ksamatacenter.com/room/1dbo-boo',
                'sales_page': 'https://t.ksamata.ru/dbo/tarif-1boo',
                'tariffs': 'https://gc.ksamata.ru/dbo/tarif/curator-boo',
                'oto': 'https://gc.ksamata.ru/dbo/br_mdboo',
                'mission': 'https://gc.ksamata.ru/pl/tasks/mission/process?id=1978505',
            },
            2: {
                'gc_room': 'https://gc.ksamata.ru/2dbo-boo',
                'web_room': 'https://web.ksamatacenter.com/room/2dbo-boo',
                'sales_page': 'https://t.ksamata.ru/dbo/tarif-zboo',
                'sales_note': 'тарифы с записью 2,3 дня',
                'tariffs': 'https://gc.ksamata.ru/dbo/tarif/max-boo',
                'mission': 'https://salebot.pro/projects/98250/messages?sheet_id=274838',
            },
            3: {
                'gc_room': 'https://gc.ksamata.ru/3dbo-boo',
                'web_room': 'https://web.ksamatacenter.com/room/3dbo-boo',
                'tariffs': 'https://gc.ksamata.ru/dbo/tarif/max-int-boo',
            },
            4: {
                'gc_room': 'https://gc.ksamata.ru/4dbo-boo',
                'web_room': 'https://web.ksamatacenter.com/room/4dbo-boo',
            },
            5: {
                'gc_room': 'https://gc.ksamata.ru/5dbo-boo',
                'web_room': 'https://web.ksamatacenter.com/room/5dbo-boo',
            },
        },
    },
}


# ============================================================
# INSERT LOGIC
# ============================================================

def insert_funnel(conn, fdata):
    """Insert a single funnel and all related records. Returns funnel_id or None if skipped."""
    num = fdata['num']

    # Idempotency check
    existing = conn.execute("SELECT id FROM funnels WHERE num = ?", (num,)).fetchone()
    if existing:
        print(f"  Funnel #{num} already exists (id={existing[0]}), skipping.")
        return None

    # Lookup / create lookup table entries
    source_id = get_or_create(conn, 'sources', fdata['source'])
    product_id = get_or_create(conn, 'products', fdata['product'])
    contractor_id = get_or_create(conn, 'contractors', fdata['contractor'])

    # Collect all tag names needed for this funnel
    all_tag_names = set()
    for raw in [fdata['tag_19_raw'], fdata['tag_15_raw'], fdata['reg_tags_raw']]:
        all_tag_names.update(parse_tag_string(raw))
    tag_map = ensure_tags(conn, all_tag_names)

    # Insert into funnels
    cur = conn.execute("""
        INSERT INTO funnels(
            num, source_id, product_id, contractor_id, variant,
            product_name, landing_url, start_date,
            block_name, sheet_name, tag_19_raw, tag_15_raw, reg_tags_raw,
            dash_sales_url, dash_pereliv_url,
            regi_total_url, regi_15_url, regi_19_url, regi_notime_url,
            room_ids_json
        ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    """, (
        num, source_id, product_id, contractor_id, fdata['variant'],
        fdata['product_name'], fdata['landing_url'], fdata['start_date'],
        fdata['block_name'], fdata['sheet_name'],
        fdata['tag_19_raw'], fdata['tag_15_raw'], fdata['reg_tags_raw'],
        fdata['dash_sales_url'], fdata['dash_pereliv_url'],
        fdata['regi_total_url'], fdata['regi_15_url'],
        fdata['regi_19_url'], fdata['regi_notime_url'],
        fdata['room_ids_json'],
    ))
    funnel_id = cur.lastrowid
    print(f"  Inserted funnel #{num} -> id={funnel_id}")

    # Insert funnel_tags
    insert_funnel_tags(conn, funnel_id, tag_map, 'time_19', fdata['tag_19_raw'])
    insert_funnel_tags(conn, funnel_id, tag_map, 'time_15', fdata['tag_15_raw'])
    insert_funnel_tags(conn, funnel_id, tag_map, 'reg',     fdata['reg_tags_raw'])

    # Insert salebot_configs
    for slot, sb in fdata['salebot'].items():
        conn.execute(
            "INSERT INTO salebot_configs(funnel_id, time_slot, condition, calculator) VALUES(?,?,?,?)",
            (funnel_id, slot, sb.get('condition', ''), sb.get('calculator', ''))
        )

    # Insert funnel_days
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


def add_pereliv_funnels(db_path=DB_PATH):
    if not os.path.exists(db_path):
        raise FileNotFoundError(f"Database not found: {db_path}")

    conn = sqlite3.connect(db_path)
    conn.execute("PRAGMA foreign_keys = ON")

    print(f"Connected to: {db_path}")
    print("\n--- Inserting funnel #27 (БОО перелив с СПБ) ---")
    insert_funnel(conn, FUNNEL_27)

    print("\n--- Inserting funnel #28 (ДБО перелив с БОО) ---")
    insert_funnel(conn, FUNNEL_28)

    conn.commit()
    print("\nCommit OK.")
    return conn


# ============================================================
# MAIN
# ============================================================

if __name__ == '__main__':
    conn = add_pereliv_funnels()

    print("\n--- Verification ---")
    verify_funnel(conn, 27)
    verify_funnel(conn, 28)

    conn.close()
    print("\nDone.")
