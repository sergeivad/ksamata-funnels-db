#!/usr/bin/env python3
"""
Adds 3 new "Яндекс Реклама квиз" funnels to the existing ksamata_funnels.db:
  #29 — БОО Яндекс Реклама квиз
  #30 — ДБО Яндекс Реклама квиз
  #31 — СВС Яндекс Реклама квиз БОО

All data is hardcoded; the Excel source file is NOT parsed.
Script is idempotent: skips a funnel if it already exists (by num).
"""

import sqlite3
import re
import os

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT_DIR = os.path.abspath(os.path.join(BASE_DIR, '..', '..'))
DB_PATH = os.path.join(ROOT_DIR, 'ksamata_funnels.db')


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

FUNNEL_29 = {
    'num': 29,
    'source': 'Яндекс Реклама квиз',
    'product': 'БОО',
    'contractor': 'Алексей',
    'variant': '',
    'product_name': 'БОО Яндекс Реклама квиз',
    'landing_url': 'http://lp.ksamata.ru/boo-kvrd',
    'start_date': '2022-08-01',
    'block_name': '',
    'sheet_name': '',
    'predspisok_url': '',
    'tag_19_raw': 'автоворонки, Яндекс Холодный квиз РД, БОО',
    'tag_15_raw': 'автоворонки, Яндекс Холодный квиз РД, БОО',
    'reg_tags_raw': 'автоворонки, Яндекс Холодный квиз РД, БОО',
    'dash_sales_url': 'https://gc.ksamata.ru/pl/logic/funnel/dashboard?id=134037#pk=alltime',
    'dash_pereliv_url': '',
    'regi_total_url': 'https://gc.ksamata.ru/pl/user/user/index?uc%5Bsegment_id%5D=&uc%5Brule_string%5D=%7B%22type%22%3A%22user_hasdealrule%22%2C%22inverted%22%3A0%2C%22params%22%3A%7B%22linkedRule%22%3A%7B%22type%22%3A%22andrule%22%2C%22inverted%22%3A0%2C%22params%22%3A%7B%22mode%22%3A%22and%22%2C%22children%22%3A%5B%7B%22type%22%3A%22deal_created_at%22%2C%22inverted%22%3A0%2C%22params%22%3A%7B%22value%22%3A%7B%22from%22%3A%2220.05.2022%22%2C%22to%22%3A%2224.05.2022%22%2C%22toNDays%22%3A%22%22%2C%22fromNDays%22%3A%22%22%2C%22dateType%22%3A%22prev_day%22%2C%22withTime%22%3A%22false%22%7D%2C%22valueMode%22%3Anull%7D%7D%2C%7B%22type%22%3A%22deal_offer_id%22%2C%22inverted%22%3A0%2C%22params%22%3A%7B%22value%22%3A%7B%22selected_id%22%3A%5B3790589%5D%2C%22selected_tags%22%3A%5B%22%D0%A0%D0%B5%D0%B3%D0%B8%D1%81%D1%82%D1%80%D0%B0%D1%86%D0%B8%D1%8F%22%5D%2C%22all_object_with_tags%22%3Afalse%7D%2C%22valueMode%22%3Anull%7D%7D%5D%7D%7D%2C%22countCondition%22%3A%7B%22checker%22%3A%22nlt%22%2C%22numval%22%3A%22%22%7D%7D%2C%22maxSize%22%3A%22%22%7D&formParams%5Bclarity_uid%5D=wIMVGIqMM-l54Ric6Z1s6gW9Zhwq0Vn1',
    'regi_15_url': 'https://gc.ksamata.ru/pl/user/user/index?uc%5Bsegment_id%5D=&uc%5Brule_string%5D=%7B%22type%22%3A%22andrule%22%2C%22inverted%22%3A0%2C%22params%22%3A%7B%22mode%22%3A%22and%22%2C%22children%22%3A%5B%7B%22type%22%3A%22UserContext_formfieldvalue%22%2C%22inverted%22%3A0%2C%22params%22%3A%7B%22fieldId%22%3A705606%2C%22fieldValue%22%3A%7B%22selected_id%22%3A%5B%22%D0%A3%D0%B4%D0%BE%D0%B1%D0%BD%D0%BE+%D1%81%D0%BC%D0%BE%D1%82%D1%80%D0%B5%D1%82%D1%8C+%D0%B2+17%3A00%22%5D%7D%2C%22valueMode%22%3A2%7D%7D%2C%7B%22type%22%3A%22user_hasdealrule%22%2C%22inverted%22%3A0%2C%22params%22%3A%7B%22linkedRule%22%3A%7B%22type%22%3A%22andrule%22%2C%22inverted%22%3A0%2C%22params%22%3A%7B%22mode%22%3A%22and%22%2C%22children%22%3A%5B%7B%22type%22%3A%22deal_created_at%22%2C%22inverted%22%3A0%2C%22params%22%3A%7B%22value%22%3A%7B%22from%22%3A%2220.05.2022%22%2C%22to%22%3A%2224.05.2022%22%2C%22toNDays%22%3A%22%22%2C%22fromNDays%22%3A%22%22%2C%22dateType%22%3A%22prev_day%22%2C%22withTime%22%3A%22false%22%7D%2C%22valueMode%22%3Anull%7D%7D%2C%7B%22type%22%3A%22deal_offer_id%22%2C%22inverted%22%3A0%2C%22params%22%3A%7B%22value%22%3A%7B%22selected_id%22%3A%5B3790589%5D%2C%22selected_tags%22%3A%5B%22%D0%A0%D0%B5%D0%B3%D0%B8%D1%81%D1%82%D1%80%D0%B0%D1%86%D0%B8%D1%8F%22%5D%2C%22all_object_with_tags%22%3Afalse%7D%2C%22valueMode%22%3Anull%7D%7D%5D%7D%7D%2C%22countCondition%22%3A%7B%22checker%22%3A%22nlt%22%2C%22numval%22%3A%22%22%7D%7D%7D%5D%7D%2C%22maxSize%22%3A%22%22%7D&formParams%5Bclarity_uid%5D=wIMVGIqMM-l54Ric6Z1s6gW9Zhwq0Vn1',
    'regi_19_url': 'https://gc.ksamata.ru/pl/user/user/index?uc%5Bsegment_id%5D=&uc%5Brule_string%5D=%7B%22type%22%3A%22andrule%22%2C%22inverted%22%3A0%2C%22className%22%3A%22app%3A%3Acomponents%3A%3Alogic%3A%3Arule%3A%3AAndRule%22%2C%22params%22%3A%7B%22children%22%3A%5B%7B%22type%22%3A%22UserContext_formfieldvalue%22%2C%22inverted%22%3A0%2C%22className%22%3A%22app%3A%3Acomponents%3A%3Alogic%3A%3Arule%3A%3AFormFieldValueRule%22%2C%22params%22%3A%7B%22valueMode%22%3A2%2C%22fieldId%22%3A705606%2C%22fieldValue%22%3A%7B%22selected_id%22%3A%5B%22%D0%A3%D0%B4%D0%BE%D0%B1%D0%BD%D0%BE+%D1%81%D0%BC%D0%BE%D1%82%D1%80%D0%B5%D1%82%D1%8C+%D0%B2+20%3A00%22%5D%7D%2C%22caseSensitive%22%3Afalse%7D%7D%2C%7B%22type%22%3A%22user_hasdealrule%22%2C%22inverted%22%3A0%2C%22className%22%3A%22app%3A%3Amodules%3A%3Auser%3A%3Amodels%3A%3Arule%3A%3AHasDealRule%22%2C%22params%22%3A%7B%22linkedRule%22%3A%7B%22type%22%3A%22andrule%22%2C%22inverted%22%3A0%2C%22className%22%3A%22app%3A%3Acomponents%3A%3Alogic%3A%3Arule%3A%3AAndRule%22%2C%22params%22%3A%7B%22children%22%3A%5B%7B%22type%22%3A%22deal_created_at%22%2C%22inverted%22%3A0%2C%22className%22%3A%22app%3A%3Amodules%3A%3Asales%3A%3Arules%3A%3ADealCreatedAtRule%22%2C%22params%22%3A%7B%22value%22%3A%7B%22from%22%3A%2220.05.2022%22%2C%22to%22%3A%2224.05.2022%22%2C%22toNDays%22%3A%22%22%2C%22fromNDays%22%3A%22%22%2C%22dateType%22%3A%22prev_day%22%2C%22withTime%22%3A%22false%22%7D%2C%22valueMode%22%3Anull%7D%7D%2C%7B%22type%22%3A%22deal_offer_id%22%2C%22inverted%22%3A0%2C%22className%22%3A%22app%3A%3Acomponents%3A%3Alogic%3A%3Arule%3A%3Asales%3A%3AOfferIdDealContextRule%22%2C%22params%22%3A%7B%22value%22%3A%7B%22selected_id%22%3A%5B3790589%5D%2C%22selected_tags%22%3A%5B%22%D0%A0%D0%B5%D0%B3%D0%B8%D1%81%D1%82%D1%80%D0%B0%D1%86%D0%B8%D1%8F%22%5D%2C%22all_object_with_tags%22%3Afalse%7D%2C%22valueMode%22%3Anull%7D%7D%5D%2C%22mode%22%3A%22and%22%7D%7D%2C%22countCondition%22%3Anull%7D%7D%5D%2C%22mode%22%3A%22and%22%7D%7D&formParams%5Bclarity_uid%5D=wIMVGIqMM-l54Ric6Z1s6gW9Zhwq0Vn1',
    'regi_notime_url': 'https://gc.ksamata.ru/pl/user/user/index?uc%5Bsegment_id%5D=&uc%5Brule_string%5D=%7B%22type%22%3A%22andrule%22%2C%22inverted%22%3A0%2C%22className%22%3A%22app%3A%3Acomponents%3A%3Alogic%3A%3Arule%3A%3AAndRule%22%2C%22params%22%3A%7B%22children%22%3A%5B%7B%22type%22%3A%22UserContext_formfieldvalue%22%2C%22inverted%22%3A0%2C%22className%22%3A%22app%3A%3Acomponents%3A%3Alogic%3A%3Arule%3A%3AFormFieldValueRule%22%2C%22params%22%3A%7B%22valueMode%22%3A-1%2C%22fieldId%22%3Anull%2C%22fieldValue%22%3Anull%2C%22caseSensitive%22%3Afalse%7D%7D%2C%7B%22type%22%3A%22user_hasdealrule%22%2C%22inverted%22%3A0%2C%22className%22%3A%22app%3A%3Amodules%3A%3Auser%3A%3Amodels%3A%3Arule%3A%3AHasDealRule%22%2C%22params%22%3A%7B%22linkedRule%22%3A%7B%22type%22%3A%22andrule%22%2C%22inverted%22%3A0%2C%22className%22%3A%22app%3A%3Acomponents%3A%3Alogic%3A%3Arule%3A%3AAndRule%22%2C%22params%22%3A%7B%22children%22%3A%5B%7B%22type%22%3A%22deal_created_at%22%2C%22inverted%22%3A0%2C%22className%22%3A%22app%3A%3Amodules%3A%3Asales%3A%3Arules%3A%3ADealCreatedAtRule%22%2C%22params%22%3A%7B%22value%22%3A%7B%22from%22%3A%2220.05.2022%22%2C%22to%22%3A%2224.05.2022%22%2C%22toNDays%22%3A%22%22%2C%22fromNDays%22%3A%22%22%2C%22dateType%22%3A%22prev_day%22%2C%22withTime%22%3A%22false%22%7D%2C%22valueMode%22%3Anull%7D%7D%2C%7B%22type%22%3A%22deal_offer_id%22%2C%22inverted%22%3A0%2C%22className%22%3A%22app%3A%3Acomponents%3A%3Alogic%3A%3Arule%3A%3Asales%3A%3AOfferIdDealContextRule%22%2C%22params%22%3A%7B%22value%22%3A%7B%22selected_id%22%3A%5B3790589%5D%2C%22selected_tags%22%3A%5B%22%D0%A0%D0%B5%D0%B3%D0%B8%D1%81%D1%82%D1%80%D0%B0%D1%86%D0%B8%D1%8F%22%5D%2C%22all_object_with_tags%22%3Afalse%7D%2C%22valueMode%22%3Anull%7D%7D%5D%2C%22mode%22%3A%22and%22%7D%7D%2C%22countCondition%22%3Anull%7D%7D%5D%2C%22mode%22%3A%22and%22%7D%7D&formParams%5Bclarity_uid%5D=wIMVGIqMM-l54Ric6Z1s6gW9Zhwq0Vn1',
    'room_ids_json': '{}',
    'salebot': {
        '19': {'condition': 'boo-kvspb19', 'calculator': 'boo-kvspb_date = #{current_date}'},
        '15': {'condition': 'boo-kvspb15', 'calculator': 'boo-kvspb_date = #{current_date}'},
    },
    'days': {
        '19': {
            1: {
                'gc_room': 'https://gc.ksamata.ru/boo1-kvspb',
                'web_room': 'https://web.ksamatacenter.com/room/boo1-kvspb',
                'sales_page': 'https://t.ksamata.ru/dtx/tarif-1spbkv',
                'oto': 'https://gc.ksamata.ru/dtx/qh_imm_dbbkv',
                'bonuses': 'https://gc.ksamata.ru/boo/bonus_1',
                'mission': 'https://gc.ksamata.ru/pl/tasks/mission/process?id=1777415',
            },
            2: {
                'gc_room': 'https://gc.ksamata.ru/boo2-kvspb',
                'web_room': 'https://web.ksamatacenter.com/room/boo2-kvspb',
                'sales_page': 'https://t.ksamata.ru/dtx/tarif-2spbkv',
                'bonuses': 'https://gc.ksamata.ru/boo/bonus_2',
                'mission': 'https://salebot.pro/projects/98250/messages?sheet_id=210182',
                'meditation': 'https://gc.ksamata.ru/meditation-boodbbkvrd',
                'dojim_note': 'дожим в ГК по куп больш курс',
            },
            3: {
                'gc_room': 'https://gc.ksamata.ru/boo3-kvspb',
                'web_room': 'https://web.ksamatacenter.com/room/boo3-kvspb',
                'sales_page': 'https://t.ksamata.ru/dtx/tarif-2spbzkv',
                'sales_note': 'тарифы с записью',
                'meditation': 'https://gc.ksamata.ru/abl-boodbbkvrd',
                'dojim_note': 'дожим в ГК по куп мал курс',
            },
            4: {
                'gc_room': 'https://gc.ksamata.ru/boo4-kvspb',
                'web_room': 'https://web.ksamatacenter.com/room/boo4-kvspb',
                'replay_url': 'https://gc.ksamata.ru/boo4r-kvspb',
                'web_replay': 'https://web.ksamatacenter.com/room/boo4r-kvspb',
            },
            5: {
                'gc_room': 'https://gc.ksamata.ru/boo5-kvspb',
                'web_room': 'https://web.ksamatacenter.com/room/boo5-kvspb',
                'replay_url': 'https://gc.ksamata.ru/boo5r-kvspb',
                'web_replay': 'https://web.ksamatacenter.com/room/boo5r-kvspb',
            },
        },
        '15': {
            1: {
                'gc_room': 'https://gc.ksamata.ru/1boo-kvspb',
                'web_room': 'https://web.ksamatacenter.com/room/1boo-kvspb',
                'sales_page': 'https://t.ksamata.ru/dtx/tarif-1spbkv',
                'oto': 'https://gc.ksamata.ru/dtx/qh_imm_dbbkv',
                'mission': 'https://gc.ksamata.ru/pl/tasks/mission/process?id=1777418',
            },
            2: {
                'gc_room': 'https://gc.ksamata.ru/2boo-kvspb',
                'web_room': 'https://web.ksamatacenter.com/room/2boo-kvspb',
                'sales_page': 'https://t.ksamata.ru/dtx/tarif-2spbkv',
                'mission': 'https://salebot.pro/projects/98250/messages?sheet_id=210186',
            },
            3: {
                'gc_room': 'https://gc.ksamata.ru/3boo-kvspb',
                'web_room': 'https://web.ksamatacenter.com/room/3boo-kvspb',
                'sales_page': 'https://t.ksamata.ru/dtx/tarif-2spbzkv',
                'sales_note': 'тарифы с записью',
            },
            4: {
                'gc_room': 'https://gc.ksamata.ru/4boo-kvspb',
                'web_room': 'https://web.ksamatacenter.com/room/4boo-kvspb',
                'replay_url': 'https://gc.ksamata.ru/4rboo-kvspb',
                'web_replay': 'https://web.ksamatacenter.com/room/4rboo-kvspb',
            },
            5: {
                'gc_room': 'https://gc.ksamata.ru/5boo-kvspb',
                'web_room': 'https://web.ksamatacenter.com/room/5boo-kvspb',
                'replay_url': 'https://gc.ksamata.ru/5rboo-kvspb',
                'web_replay': 'https://web.ksamatacenter.com/room/5rboo-kvspb',
            },
        },
    },
}

FUNNEL_30 = {
    'num': 30,
    'source': 'Яндекс Реклама квиз',
    'product': 'ДБО',
    'contractor': 'Алексей',
    'variant': '',
    'product_name': 'ДБО Яндекс Реклама квиз',
    'landing_url': '',
    'start_date': '2022-08-01',
    'block_name': '',
    'sheet_name': '',
    'predspisok_url': '',
    'tag_19_raw': 'автоворонки, СПБ, Яндекс Холодный квиз Detox',
    'tag_15_raw': 'автоворонки, СПБ, Яндекс Холодный квиз Detox',
    'reg_tags_raw': 'автоворонки, СПБ, Яндекс Холодный квиз Detox',
    'dash_sales_url': 'https://gc.ksamata.ru/pl/logic/funnel/dashboard?id=134037#pk=alltime',
    'dash_pereliv_url': '',
    'regi_total_url': 'https://gc.ksamata.ru/pl/user/user/index?uc%5Bsegment_id%5D=&uc%5Brule_string%5D=%7B%22type%22%3A%22user_hasdealrule%22%2C%22inverted%22%3A0%2C%22className%22%3A%22app%3A%3Amodules%3A%3Auser%3A%3Amodels%3A%3Arule%3A%3AHasDealRule%22%2C%22params%22%3A%7B%22linkedRule%22%3A%7B%22type%22%3A%22andrule%22%2C%22inverted%22%3A0%2C%22className%22%3A%22app%3A%3Acomponents%3A%3Alogic%3A%3Arule%3A%3AAndRule%22%2C%22params%22%3A%7B%22children%22%3A%5B%7B%22type%22%3A%22deal_created_at%22%2C%22inverted%22%3A0%2C%22className%22%3A%22app%3A%3Amodules%3A%3Asales%3A%3Arules%3A%3ADealCreatedAtRule%22%2C%22params%22%3A%7B%22value%22%3A%7B%22from%22%3A%2220.05.2022%22%2C%22to%22%3A%2224.05.2022%22%2C%22toNDays%22%3A%22%22%2C%22fromNDays%22%3A%22%22%2C%22dateType%22%3A%22prev_day%22%2C%22withTime%22%3A%22false%22%7D%2C%22valueMode%22%3A%22NaN%22%7D%7D%2C%7B%22type%22%3A%22deal_offer_id%22%2C%22inverted%22%3A0%2C%22className%22%3A%22app%3A%3Acomponents%3A%3Alogic%3A%3Arule%3A%3Asales%3A%3AOfferIdDealContextRule%22%2C%22params%22%3A%7B%22value%22%3A%7B%22selected_id%22%3A%5B%223571852%22%5D%2C%22selected_tags%22%3A%5B%22%D0%A0%D0%B5%D0%B3%D0%B8%D1%81%D1%82%D1%80%D0%B0%D1%86%D0%B8%D1%8F%22%5D%2C%22all_object_with_tags%22%3A%22false%22%7D%2C%22valueMode%22%3A%22NaN%22%7D%7D%5D%2C%22mode%22%3A%22and%22%7D%7D%2C%22countCondition%22%3Anull%7D%7D&formParams%5Bclarity_uid%5D=wIMVGIqMM-l54Ric6Z1s6gW9Zhwq0Vn1',
    'regi_15_url': 'https://gc.ksamata.ru/pl/user/user/index?uc%5Bsegment_id%5D=&uc%5Brule_string%5D=%7B%22type%22%3A%22andrule%22%2C%22inverted%22%3A0%2C%22className%22%3A%22app%3A%3Acomponents%3A%3Alogic%3A%3Arule%3A%3AAndRule%22%2C%22params%22%3A%7B%22children%22%3A%5B%7B%22type%22%3A%22UserContext_formfieldvalue%22%2C%22inverted%22%3A0%2C%22className%22%3A%22app%3A%3Acomponents%3A%3Alogic%3A%3Arule%3A%3AFormFieldValueRule%22%2C%22params%22%3A%7B%22valueMode%22%3A2%2C%22fieldId%22%3A705606%2C%22fieldValue%22%3A%7B%22selected_id%22%3A%5B%22%D0%A3%D0%B4%D0%BE%D0%B1%D0%BD%D0%BE+%D1%81%D0%BC%D0%BE%D1%82%D1%80%D0%B5%D1%82%D1%8C+%D0%B2+17%3A00%22%5D%7D%2C%22caseSensitive%22%3Afalse%7D%7D%2C%7B%22type%22%3A%22user_hasdealrule%22%2C%22inverted%22%3A0%2C%22className%22%3A%22app%3A%3Amodules%3A%3Auser%3A%3Amodels%3A%3Arule%3A%3AHasDealRule%22%2C%22params%22%3A%7B%22linkedRule%22%3A%7B%22type%22%3A%22andrule%22%2C%22inverted%22%3A0%2C%22className%22%3A%22app%3A%3Acomponents%3A%3Alogic%3A%3Arule%3A%3AAndRule%22%2C%22params%22%3A%7B%22children%22%3A%5B%7B%22type%22%3A%22deal_created_at%22%2C%22inverted%22%3A0%2C%22className%22%3A%22app%3A%3Amodules%3A%3Asales%3A%3Arules%3A%3ADealCreatedAtRule%22%2C%22params%22%3A%7B%22value%22%3A%7B%22from%22%3A%2220.05.2022%22%2C%22to%22%3A%2224.05.2022%22%2C%22toNDays%22%3A%22%22%2C%22fromNDays%22%3A%22%22%2C%22dateType%22%3A%22prev_day%22%2C%22withTime%22%3A%22false%22%7D%2C%22valueMode%22%3Anull%7D%7D%2C%7B%22type%22%3A%22deal_offer_id%22%2C%22inverted%22%3A0%2C%22className%22%3A%22app%3A%3Acomponents%3A%3Alogic%3A%3Arule%3A%3Asales%3A%3AOfferIdDealContextRule%22%2C%22params%22%3A%7B%22value%22%3A%7B%22selected_id%22%3A%5B%223571852%22%5D%2C%22selected_tags%22%3A%5B%22%D0%A0%D0%B5%D0%B3%D0%B8%D1%81%D1%82%D1%80%D0%B0%D1%86%D0%B8%D1%8F%22%5D%2C%22all_object_with_tags%22%3A%22false%22%7D%2C%22valueMode%22%3Anull%7D%7D%5D%2C%22mode%22%3A%22and%22%7D%7D%2C%22countCondition%22%3Anull%7D%7D%5D%2C%22mode%22%3A%22and%22%7D%7D&formParams%5Bclarity_uid%5D=wIMVGIqMM-l54Ric6Z1s6gW9Zhwq0Vn1',
    'regi_19_url': 'https://gc.ksamata.ru/pl/user/user/index?uc%5Bsegment_id%5D=&uc%5Brule_string%5D=%7B%22type%22%3A%22andrule%22%2C%22inverted%22%3A0%2C%22className%22%3A%22app%3A%3Acomponents%3A%3Alogic%3A%3Arule%3A%3AAndRule%22%2C%22params%22%3A%7B%22children%22%3A%5B%7B%22type%22%3A%22UserContext_formfieldvalue%22%2C%22inverted%22%3A0%2C%22className%22%3A%22app%3A%3Acomponents%3A%3Alogic%3A%3Arule%3A%3AFormFieldValueRule%22%2C%22params%22%3A%7B%22valueMode%22%3A2%2C%22fieldId%22%3A705606%2C%22fieldValue%22%3A%7B%22selected_id%22%3A%5B%22%D0%A3%D0%B4%D0%BE%D0%B1%D0%BD%D0%BE+%D1%81%D0%BC%D0%BE%D1%82%D1%80%D0%B5%D1%82%D1%8C+%D0%B2+20%3A00%22%5D%7D%2C%22caseSensitive%22%3Afalse%7D%7D%2C%7B%22type%22%3A%22user_hasdealrule%22%2C%22inverted%22%3A0%2C%22className%22%3A%22app%3A%3Amodules%3A%3Auser%3A%3Amodels%3A%3Arule%3A%3AHasDealRule%22%2C%22params%22%3A%7B%22linkedRule%22%3A%7B%22type%22%3A%22andrule%22%2C%22inverted%22%3A0%2C%22className%22%3A%22app%3A%3Acomponents%3A%3Alogic%3A%3Arule%3A%3AAndRule%22%2C%22params%22%3A%7B%22children%22%3A%5B%7B%22type%22%3A%22deal_created_at%22%2C%22inverted%22%3A0%2C%22className%22%3A%22app%3A%3Amodules%3A%3Asales%3A%3Arules%3A%3ADealCreatedAtRule%22%2C%22params%22%3A%7B%22value%22%3A%7B%22from%22%3A%2220.05.2022%22%2C%22to%22%3A%2224.05.2022%22%2C%22toNDays%22%3A%22%22%2C%22fromNDays%22%3A%22%22%2C%22dateType%22%3A%22prev_day%22%2C%22withTime%22%3A%22false%22%7D%2C%22valueMode%22%3Anull%7D%7D%2C%7B%22type%22%3A%22deal_offer_id%22%2C%22inverted%22%3A0%2C%22className%22%3A%22app%3A%3Acomponents%3A%3Alogic%3A%3Arule%3A%3Asales%3A%3AOfferIdDealContextRule%22%2C%22params%22%3A%7B%22value%22%3A%7B%22selected_id%22%3A%5B%223571852%22%5D%2C%22selected_tags%22%3A%5B%22%D0%A0%D0%B5%D0%B3%D0%B8%D1%81%D1%82%D1%80%D0%B0%D1%86%D0%B8%D1%8F%22%5D%2C%22all_object_with_tags%22%3A%22false%22%7D%2C%22valueMode%22%3Anull%7D%7D%5D%2C%22mode%22%3A%22and%22%7D%7D%2C%22countCondition%22%3Anull%7D%7D%5D%2C%22mode%22%3A%22and%22%7D%7D&formParams%5Bclarity_uid%5D=wIMVGIqMM-l54Ric6Z1s6gW9Zhwq0Vn1',
    'regi_notime_url': 'https://gc.ksamata.ru/pl/user/user/index?uc%5Bsegment_id%5D=&uc%5Brule_string%5D=%7B%22type%22%3A%22andrule%22%2C%22inverted%22%3A0%2C%22params%22%3A%7B%22mode%22%3A%22and%22%2C%22children%22%3A%5B%7B%22type%22%3A%22UserContext_formfieldvalue%22%2C%22inverted%22%3A0%2C%22params%22%3A%7B%22fieldId%22%3Anull%2C%22fieldValue%22%3Anull%2C%22valueMode%22%3A-1%7D%7D%2C%7B%22type%22%3A%22user_hasdealrule%22%2C%22inverted%22%3A0%2C%22params%22%3A%7B%22linkedRule%22%3A%7B%22type%22%3A%22andrule%22%2C%22inverted%22%3A0%2C%22params%22%3A%7B%22mode%22%3A%22and%22%2C%22children%22%3A%5B%7B%22type%22%3A%22deal_created_at%22%2C%22inverted%22%3A0%2C%22params%22%3A%7B%22value%22%3A%7B%22from%22%3A%2220.05.2022%22%2C%22to%22%3A%2224.05.2022%22%2C%22toNDays%22%3A%22%22%2C%22fromNDays%22%3A%22%22%2C%22dateType%22%3A%22prev_day%22%2C%22withTime%22%3A%22false%22%7D%2C%22valueMode%22%3Anull%7D%7D%2C%7B%22type%22%3A%22deal_offer_id%22%2C%22inverted%22%3A0%2C%22params%22%3A%7B%22value%22%3A%7B%22selected_id%22%3A%5B3571852%5D%2C%22selected_tags%22%3A%5B%22%D0%A0%D0%B5%D0%B3%D0%B8%D1%81%D1%82%D1%80%D0%B0%D1%86%D0%B8%D1%8F%22%5D%2C%22all_object_with_tags%22%3Afalse%7D%2C%22valueMode%22%3Anull%7D%7D%5D%7D%7D%2C%22countCondition%22%3A%7B%22checker%22%3A%22nlt%22%2C%22numval%22%3A%22%22%7D%7D%7D%5D%7D%2C%22maxSize%22%3A%22%22%7D&formParams%5Bclarity_uid%5D=wIMVGIqMM-l54Ric6Z1s6gW9Zhwq0Vn1',
    'room_ids_json': '{}',
    'salebot': {
        '19': {'condition': 'dbo-bookv19', 'calculator': 'dbo-bookv_date = #{current_date}'},
        '15': {'condition': 'dbo-bookv15', 'calculator': 'dbo-bookv_date = #{current_date}'},
    },
    'days': {
        '19': {
            1: {
                'gc_room': 'https://gc.ksamata.ru/dbo1-bookv',
                'web_room': 'https://web.ksamatacenter.com/room/dbo1-bookv',
                'sales_page': 'https://t.ksamata.ru/dbo/tarif-1bookv',
                'tariffs': 'https://gc.ksamata.ru/dbo/tarif/curator-bookv',
                'oto': 'https://gc.ksamata.ru/dbo/br_mdbookv',
                'mission': 'https://gc.ksamata.ru/pl/tasks/mission/process?id=1985038',
            },
            2: {
                'gc_room': 'https://gc.ksamata.ru/dbo2-bookv',
                'web_room': 'https://web.ksamatacenter.com/room/dbo2-bookv',
                'sales_page': 'https://t.ksamata.ru/dbo/tarif-zbookv',
                'sales_note': 'тарифы с записью 2,3 дня',
                'tariffs': 'https://gc.ksamata.ru/dbo/tarif/max-bookv',
                'mission': 'https://salebot.pro/projects/98250/messages?sheet_id=276493',
                'meditation': 'https://gc.ksamata.ru/meditation-dbobookv',
                'dojim_note': 'дожим в ГК по куп больш курс',
            },
            3: {
                'gc_room': 'https://gc.ksamata.ru/dbo3-bookv',
                'web_room': 'https://web.ksamatacenter.com/room/dbo3-bookv',
                'tariffs': 'https://gc.ksamata.ru/dbo/tarif/max-int-bookv',
            },
            4: {
                'gc_room': 'https://gc.ksamata.ru/dbo4-bookv',
                'web_room': 'https://web.ksamatacenter.com/room/dbo4-bookv',
            },
            5: {
                'gc_room': 'https://gc.ksamata.ru/dbo5-bookv',
                'web_room': 'https://web.ksamatacenter.com/room/dbo5-bookv',
            },
        },
        '15': {
            1: {
                'gc_room': 'https://gc.ksamata.ru/1dbo-bookv',
                'web_room': 'https://web.ksamatacenter.com/room/1dbo-bookv',
                'sales_page': 'https://t.ksamata.ru/dbo/tarif-1bookv',
                'tariffs': 'https://gc.ksamata.ru/dbo/tarif/curator-bookv',
                'oto': 'https://gc.ksamata.ru/dbo/br_mdbookv',
                'mission': 'https://gc.ksamata.ru/pl/tasks/mission/process?id=1985039',
            },
            2: {
                'gc_room': 'https://gc.ksamata.ru/2dbo-bookv',
                'web_room': 'https://web.ksamatacenter.com/room/2dbo-bookv',
                'sales_page': 'https://t.ksamata.ru/dbo/tarif-zbookv',
                'sales_note': 'тарифы с записью 2,3 дня',
                'tariffs': 'https://gc.ksamata.ru/dbo/tarif/max-bookv',
                'mission': 'https://salebot.pro/projects/98250/messages?sheet_id=276496',
            },
            3: {
                'gc_room': 'https://gc.ksamata.ru/3dbo-bookv',
                'web_room': 'https://web.ksamatacenter.com/room/3dbo-bookv',
                'tariffs': 'https://gc.ksamata.ru/dbo/tarif/max-int-bookv',
            },
            4: {
                'gc_room': 'https://gc.ksamata.ru/4dbo-bookv',
                'web_room': 'https://web.ksamatacenter.com/room/4dbo-bookv',
            },
            5: {
                'gc_room': 'https://gc.ksamata.ru/5dbo-bookv',
                'web_room': 'https://web.ksamatacenter.com/room/5dbo-bookv',
            },
        },
    },
}

FUNNEL_31 = {
    'num': 31,
    'source': 'Яндекс Реклама квиз',
    'product': 'СВС',
    'contractor': 'Алексей',
    'variant': '',
    'product_name': 'СВС Яндекс Реклама квиз БОО',
    'landing_url': '',
    'start_date': '2022-08-01',
    'block_name': '',
    'sheet_name': '',
    'predspisok_url': '',
    'tag_19_raw': 'автоворонки, СВС, Яндекс Реклама квиз Детокс',
    'tag_15_raw': 'автоворонки, СВС, Яндекс Реклама квиз Детокс',
    'reg_tags_raw': 'автоворонки, СВС, Яндекс Реклама квиз Детокс',
    'dash_sales_url': 'https://gc.ksamata.ru/pl/logic/funnel/dashboard?id=134037#pk=alltime',
    'dash_pereliv_url': '',
    'regi_total_url': 'https://gc.ksamata.ru/pl/user/user/index?uc%5Bsegment_id%5D=&uc%5Brule_string%5D=%7B%22type%22%3A%22user_hasdealrule%22%2C%22inverted%22%3A0%2C%22params%22%3A%7B%22linkedRule%22%3A%7B%22type%22%3A%22andrule%22%2C%22inverted%22%3A0%2C%22params%22%3A%7B%22mode%22%3A%22and%22%2C%22children%22%3A%5B%7B%22type%22%3A%22deal_created_at%22%2C%22inverted%22%3A0%2C%22params%22%3A%7B%22value%22%3A%7B%22from%22%3A%2220.05.2022%22%2C%22to%22%3A%2224.05.2022%22%2C%22toNDays%22%3A%22%22%2C%22fromNDays%22%3A%22%22%2C%22dateType%22%3A%22prev_day%22%2C%22withTime%22%3A%22false%22%7D%2C%22valueMode%22%3Anull%7D%7D%2C%7B%22type%22%3A%22deal_offer_id%22%2C%22inverted%22%3A0%2C%22params%22%3A%7B%22value%22%3A%7B%22selected_id%22%3A%5B3572180%5D%2C%22selected_tags%22%3A%5B%22%D0%A0%D0%B5%D0%B3%D0%B8%D1%81%D1%82%D1%80%D0%B0%D1%86%D0%B8%D1%8F%22%5D%2C%22all_object_with_tags%22%3Afalse%7D%2C%22valueMode%22%3Anull%7D%7D%5D%7D%7D%2C%22countCondition%22%3A%7B%22checker%22%3A%22nlt%22%2C%22numval%22%3A%22%22%7D%7D%2C%22maxSize%22%3A%22%22%7D&formParams%5Bclarity_uid%5D=wIMVGIqMM-l54Ric6Z1s6gW9Zhwq0Vn1',
    'regi_15_url': 'https://gc.ksamata.ru/pl/user/user/index?uc%5Bsegment_id%5D=&uc%5Brule_string%5D=%7B%22type%22%3A%22andrule%22%2C%22inverted%22%3A0%2C%22params%22%3A%7B%22mode%22%3A%22and%22%2C%22children%22%3A%5B%7B%22type%22%3A%22UserContext_formfieldvalue%22%2C%22inverted%22%3A0%2C%22params%22%3A%7B%22fieldId%22%3A705606%2C%22fieldValue%22%3A%7B%22selected_id%22%3A%5B%22%D0%A3%D0%B4%D0%BE%D0%B1%D0%BD%D0%BE+%D1%81%D0%BC%D0%BE%D1%82%D1%80%D0%B5%D1%82%D1%8C+%D0%B2+17%3A00%22%5D%7D%2C%22valueMode%22%3A2%7D%7D%2C%7B%22type%22%3A%22user_hasdealrule%22%2C%22inverted%22%3A0%2C%22params%22%3A%7B%22linkedRule%22%3A%7B%22type%22%3A%22andrule%22%2C%22inverted%22%3A0%2C%22params%22%3A%7B%22mode%22%3A%22and%22%2C%22children%22%3A%5B%7B%22type%22%3A%22deal_created_at%22%2C%22inverted%22%3A0%2C%22params%22%3A%7B%22value%22%3A%7B%22from%22%3A%2220.05.2022%22%2C%22to%22%3A%2224.05.2022%22%2C%22toNDays%22%3A%22%22%2C%22fromNDays%22%3A%22%22%2C%22dateType%22%3A%22prev_day%22%2C%22withTime%22%3A%22false%22%7D%2C%22valueMode%22%3Anull%7D%7D%2C%7B%22type%22%3A%22deal_offer_id%22%2C%22inverted%22%3A0%2C%22params%22%3A%7B%22value%22%3A%7B%22selected_id%22%3A%5B3572180%5D%2C%22selected_tags%22%3A%5B%22%D0%A0%D0%B5%D0%B3%D0%B8%D1%81%D1%82%D1%80%D0%B0%D1%86%D0%B8%D1%8F%22%5D%2C%22all_object_with_tags%22%3Afalse%7D%2C%22valueMode%22%3Anull%7D%7D%5D%7D%7D%2C%22countCondition%22%3A%7B%22checker%22%3A%22nlt%22%2C%22numval%22%3A%22%22%7D%7D%7D%5D%7D%2C%22maxSize%22%3A%22%22%7D&formParams%5Bclarity_uid%5D=wIMVGIqMM-l54Ric6Z1s6gW9Zhwq0Vn1',
    'regi_19_url': 'https://gc.ksamata.ru/pl/user/user/index?uc%5Bsegment_id%5D=&uc%5Brule_string%5D=%7B%22type%22%3A%22andrule%22%2C%22inverted%22%3A0%2C%22params%22%3A%7B%22mode%22%3A%22and%22%2C%22children%22%3A%5B%7B%22type%22%3A%22UserContext_formfieldvalue%22%2C%22inverted%22%3A0%2C%22params%22%3A%7B%22fieldId%22%3A705606%2C%22fieldValue%22%3A%7B%22selected_id%22%3A%5B%22%D0%A3%D0%B4%D0%BE%D0%B1%D0%BD%D0%BE+%D1%81%D0%BC%D0%BE%D1%82%D1%80%D0%B5%D1%82%D1%8C+%D0%B2+20%3A00%22%5D%7D%2C%22valueMode%22%3A2%7D%7D%2C%7B%22type%22%3A%22user_hasdealrule%22%2C%22inverted%22%3A0%2C%22params%22%3A%7B%22linkedRule%22%3A%7B%22type%22%3A%22andrule%22%2C%22inverted%22%3A0%2C%22params%22%3A%7B%22mode%22%3A%22and%22%2C%22children%22%3A%5B%7B%22type%22%3A%22deal_created_at%22%2C%22inverted%22%3A0%2C%22params%22%3A%7B%22value%22%3A%7B%22from%22%3A%2220.05.2022%22%2C%22to%22%3A%2224.05.2022%22%2C%22toNDays%22%3A%22%22%2C%22fromNDays%22%3A%22%22%2C%22dateType%22%3A%22prev_day%22%2C%22withTime%22%3A%22false%22%7D%2C%22valueMode%22%3Anull%7D%7D%2C%7B%22type%22%3A%22deal_offer_id%22%2C%22inverted%22%3A0%2C%22params%22%3A%7B%22value%22%3A%7B%22selected_id%22%3A%5B3572180%5D%2C%22selected_tags%22%3A%5B%22%D0%A0%D0%B5%D0%B3%D0%B8%D1%81%D1%82%D1%80%D0%B0%D1%86%D0%B8%D1%8F%22%5D%2C%22all_object_with_tags%22%3Afalse%7D%2C%22valueMode%22%3Anull%7D%7D%5D%7D%7D%2C%22countCondition%22%3A%7B%22checker%22%3A%22nlt%22%2C%22numval%22%3A%22%22%7D%7D%7D%5D%7D%2C%22maxSize%22%3A%22%22%7D&formParams%5Bclarity_uid%5D=wIMVGIqMM-l54Ric6Z1s6gW9Zhwq0Vn1',
    'regi_notime_url': 'https://gc.ksamata.ru/pl/user/user/index?uc%5Bsegment_id%5D=&uc%5Brule_string%5D=%7B%22type%22%3A%22andrule%22%2C%22inverted%22%3A0%2C%22params%22%3A%7B%22mode%22%3A%22and%22%2C%22children%22%3A%5B%7B%22type%22%3A%22UserContext_formfieldvalue%22%2C%22inverted%22%3A0%2C%22params%22%3A%7B%22fieldId%22%3Anull%2C%22fieldValue%22%3Anull%2C%22valueMode%22%3A-1%7D%7D%2C%7B%22type%22%3A%22user_hasdealrule%22%2C%22inverted%22%3A0%2C%22params%22%3A%7B%22linkedRule%22%3A%7B%22type%22%3A%22andrule%22%2C%22inverted%22%3A0%2C%22params%22%3A%7B%22mode%22%3A%22and%22%2C%22children%22%3A%5B%7B%22type%22%3A%22deal_created_at%22%2C%22inverted%22%3A0%2C%22params%22%3A%7B%22value%22%3A%7B%22from%22%3A%2220.05.2022%22%2C%22to%22%3A%2224.05.2022%22%2C%22toNDays%22%3A%22%22%2C%22fromNDays%22%3A%22%22%2C%22dateType%22%3A%22prev_day%22%2C%22withTime%22%3A%22false%22%7D%2C%22valueMode%22%3Anull%7D%7D%2C%7B%22type%22%3A%22deal_offer_id%22%2C%22inverted%22%3A0%2C%22params%22%3A%7B%22value%22%3A%7B%22selected_id%22%3A%5B3572180%5D%2C%22selected_tags%22%3A%5B%22%D0%A0%D0%B5%D0%B3%D0%B8%D1%81%D1%82%D1%80%D0%B0%D1%86%D0%B8%D1%8F%22%5D%2C%22all_object_with_tags%22%3Afalse%7D%2C%22valueMode%22%3Anull%7D%7D%5D%7D%7D%2C%22countCondition%22%3A%7B%22checker%22%3A%22nlt%22%2C%22numval%22%3A%22%22%7D%7D%7D%5D%7D%2C%22maxSize%22%3A%22%22%7D&formParams%5Bclarity_uid%5D=wIMVGIqMM-l54Ric6Z1s6gW9Zhwq0Vn1',
    'room_ids_json': '{}',
    'salebot': {
        '19': {'condition': 'svs-yakvboo19', 'calculator': 'svs-yakvboo_date = #{current_date}'},
        '15': {'condition': 'svs-yakvboo15', 'calculator': 'svs-yakvboo_date = #{current_date}'},
    },
    'days': {
        '19': {
            1: {
                'gc_room': 'https://gc.ksamata.ru/svs1-yakvboo',
                'web_room': 'https://web.ksamatacenter.com/room/svs1-yakvboo',
                'sales_page': 'https://t.ksamata.ru/svs/tarif-1yakvboo',
                'tariffs': 'https://gc.ksamata.ru/hv/tarif/curator-yakvboo',
                'oto': 'https://gc.ksamata.ru/svs/back-int-wyakvboo',
                'bonuses': 'https://gc.ksamata.ru/svs/bonus1',
                'mission': 'https://gc.ksamata.ru/pl/tasks/mission/process?id=1627566',
            },
            2: {
                'gc_room': 'https://gc.ksamata.ru/svs2-yakvboo',
                'web_room': 'https://web.ksamatacenter.com/room/svs2-yakvboo',
                'sales_page': 'https://t.ksamata.ru/svs/tarif-zyakvboo',
                'sales_note': 'тарифы с записью ГЛАВНОГО занятия',
                'tariffs': 'https://gc.ksamata.ru/hv/tarif/max-yakvboo',
                'bonuses': 'https://gc.ksamata.ru/svs/bonus2',
                'mission': 'https://salebot.pro/projects/98250/messages?sheet_id=171733',
                'meditation': 'https://gc.ksamata.ru/meditation-svsyakvboo',
                'dojim_note': 'дожим в ГК по куп больш курс',
            },
            3: {
                'gc_room': 'https://gc.ksamata.ru/svs3-yakvboo',
                'web_room': 'https://web.ksamatacenter.com/room/svs3-yakvboo',
                'tariffs': 'https://gc.ksamata.ru/hv/tarif/max-int-yakvboo',
                'bonuses': 'https://gc.ksamata.ru/svs/bonus3',
            },
            4: {
                'gc_room': 'https://gc.ksamata.ru/svs4-yakvboo',
                'web_room': 'https://web.ksamatacenter.com/room/svs4-yakvboo',
                'replay_url': 'https://gc.ksamata.ru/4rsvs-yakvboo',
                'web_replay': 'https://web.ksamatacenter.com/room/4rsvs-yakvboo',
            },
            5: {
                'gc_room': 'https://gc.ksamata.ru/svs5-yakvboo',
                'web_room': 'https://web.ksamatacenter.com/room/svs5-yakvboo',
                'replay_url': 'https://gc.ksamata.ru/5rsvs-yakvboo',
                'web_replay': 'https://web.ksamatacenter.com/room/5rsvs-yakvboo',
            },
        },
        '15': {
            1: {
                'gc_room': 'https://gc.ksamata.ru/1svs-yakvboo',
                'web_room': 'https://web.ksamatacenter.com/room/1svs-yakvboo',
                'sales_page': 'https://t.ksamata.ru/svs/tarif-1yakvboo',
                'mission': 'https://gc.ksamata.ru/pl/tasks/mission/process?id=1628657',
            },
            2: {
                'gc_room': 'https://gc.ksamata.ru/2svs-yakvboo',
                'web_room': 'https://web.ksamatacenter.com/room/2svs-yakvboo',
                'sales_page': 'https://t.ksamata.ru/svs/tarif-zyakvboo',
                'sales_note': 'тарифы с записью ГЛАВНОГО занятия',
                'mission': 'https://salebot.pro/projects/98250/messages?sheet_id=171753',
            },
            3: {
                'gc_room': 'https://gc.ksamata.ru/3svs-yakvboo',
                'web_room': 'https://web.ksamatacenter.com/room/3svs-yakvboo',
            },
            4: {
                'gc_room': 'https://gc.ksamata.ru/4svs-yakvboo',
                'web_room': 'https://web.ksamatacenter.com/room/4svs-yakvboo',
                'replay_url': 'https://gc.ksamata.ru/r4svs-yakvboo',
                'web_replay': 'https://web.ksamatacenter.com/room/r4svs-yakvboo',
            },
            5: {
                'gc_room': 'https://gc.ksamata.ru/5svs-yakvboo',
                'web_room': 'https://web.ksamatacenter.com/room/5svs-yakvboo',
                'replay_url': 'https://gc.ksamata.ru/r5svs-yakvboo',
                'web_replay': 'https://web.ksamatacenter.com/room/r5svs-yakvboo',
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
            block_name, sheet_name, predspisok_url,
            tag_19_raw, tag_15_raw, reg_tags_raw,
            dash_sales_url, dash_pereliv_url,
            regi_total_url, regi_15_url, regi_19_url, regi_notime_url,
            room_ids_json
        ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    """, (
        num, source_id, product_id, contractor_id, fdata['variant'],
        fdata['product_name'], fdata['landing_url'], fdata['start_date'],
        fdata['block_name'], fdata['sheet_name'], fdata['predspisok_url'],
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


def add_quiz_funnels(db_path=DB_PATH):
    if not os.path.exists(db_path):
        raise FileNotFoundError(f"Database not found: {db_path}")

    conn = sqlite3.connect(db_path)
    conn.execute("PRAGMA foreign_keys = ON")

    print(f"Connected to: {db_path}")
    print("\n--- Inserting funnel #29 (БОО Яндекс Реклама квиз) ---")
    insert_funnel(conn, FUNNEL_29)

    print("\n--- Inserting funnel #30 (ДБО Яндекс Реклама квиз) ---")
    insert_funnel(conn, FUNNEL_30)

    print("\n--- Inserting funnel #31 (СВС Яндекс Реклама квиз БОО) ---")
    insert_funnel(conn, FUNNEL_31)

    conn.commit()
    print("\nCommit OK.")
    return conn


# ============================================================
# MAIN
# ============================================================

if __name__ == '__main__':
    conn = add_quiz_funnels()

    print("\n--- Verification ---")
    verify_funnel(conn, 29)
    verify_funnel(conn, 30)
    verify_funnel(conn, 31)
