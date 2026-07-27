#!/usr/bin/env python3
"""Карта расхождений тегов воронок.

Сводит три источника — реестр предложений GetCourse, историю выгрузок
deal_export и ksamata_funnels.db — в один XLSX с 16 классами находок.

Эталона нет: скрипт ничего не чинит, только показывает расхождения.

Запуск из корня репозитория:

    GC_DEV_KEY=... GC_API_KEY=... GC_DOMAIN=... python3 tools/audit/run_audit.py

Без сети (только база и выгрузки, классы 9-12 и 14 будут пусты):

    python3 tools/audit/run_audit.py --no-api
"""

import argparse
import datetime
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import api_source
import db_source
import export_source
import findings as F
import paths
import report


def collect_findings(expectations, funnels, vocabulary, index, collisions,
                     groups, observations, offers):
    """Прогоняет все 16 классов. Порядок листов в отчёте задаёт report.

    Тринадцать из четырнадцати классов, зависящих от выгрузок, читают
    свёрнутые Group (по группе на тройку АВ-ключ × tag_type × набор
    тегов) — свёртка достаточна и удобнее для сравнения с базой.

    Класс 15 (find_drift) — исключение: его сигнатура принимает плоский
    список Observation, а не groups. Причина в самой природе дрейфа —
    свёртка по точному набору тегов теряет промежуточный переход, если
    набор менялся и вернулся к прежнему виду (A → B → A): first_seen/
    last_seen у такой группы съезжают на крайние даты, а середина
    молча пропадает. find_drift обходит наблюдения по их собственной
    file_date, поэтому ему нужны observations, а не groups.

    Отсюда — collect_findings принимает оба: groups для всего
    остального и observations отдельно для find_drift.
    """
    result = []
    # Считаем один раз: нужны и классу 7, и классу 9.
    order_dates = F.last_order_dates(observations)
    registry_keys = F.registry_keys_of(offers)

    result += F.find_missing_in_getcourse(groups, expectations, index)
    result += F.find_extra_axes(groups, vocabulary)
    result += F.find_unsupported_stage(groups)
    result += F.find_contradictory_legacy(groups, expectations, index)
    result += F.find_unresolved(groups, index, registry_keys, order_dates)
    result += F.find_key_collision_findings(collisions, expectations)
    result += F.find_unknown_av_keys(offers, index, order_dates)
    result += F.find_incomplete_offer_keys(offers)
    result += F.find_unknown_axes_in_registry(offers, vocabulary)
    result += F.find_offers_without_autofunnel(offers)
    result += F.find_silent_funnels(funnels, groups, index)
    result += F.find_unused_offers(offers, groups)
    result += F.find_drift(observations, index, expectations, order_dates)
    result += F.find_coverage(funnels, groups, index)
    return result


def main(argv=None, env=None):
    env = os.environ if env is None else env
    parser = argparse.ArgumentParser(description='Карта расхождений тегов воронок')
    parser.add_argument('--no-api', action='store_true',
                        help='не ходить в GetCourse; классы 9-12 и 14 останутся пустыми')
    parser.add_argument('--downloads', default=paths.DOWNLOADS_DIR,
                        help='каталог с выгрузками deal_export')
    parser.add_argument('--since', default=paths.SINCE_DATE.isoformat(),
                        help='нижняя граница по дате файла, ГГГГ-ММ-ДД')
    args = parser.parse_args(argv)

    since = datetime.date.fromisoformat(args.since)
    started_at = datetime.datetime.now()
    sources = []

    # В начале листа «Источники» — параметры самого прогона: без них читатель
    # не может понять, под каким окном и когда карта была построена.
    sources.append({'kind': 'параметры прогона', 'name': '--since', 'detail': args.since})
    sources.append({'kind': 'параметры прогона', 'name': 'каталог выгрузок',
                    'detail': args.downloads})
    sources.append({'kind': 'параметры прогона', 'name': 'дата и время прогона',
                    'detail': started_at.strftime('%Y-%m-%d %H:%M:%S')})

    print('Читаю базу…')
    expectations = db_source.load_expectations(paths.DB_PATH)
    funnels = db_source.load_funnels(paths.DB_PATH)
    vocabulary = db_source.load_tag_vocabulary(paths.DB_PATH)
    index = db_source.build_av_index(expectations)
    collisions = db_source.find_key_collisions(index)
    sources.append({
        'kind': 'база',
        'name': os.path.basename(paths.DB_PATH),
        'detail': f'{len(funnels)} воронок, {len(expectations)} пар, '
                  f'{len(index)} ключей, {len(collisions)} коллизий',
    })
    print(f'  воронок: {len(funnels)}, пар: {len(expectations)}, '
          f'ключей: {len(index)}, коллизий: {len(collisions)}')

    print('Ищу выгрузки…')
    files, file_stats = export_source.discover_export_files_with_stats(args.downloads, since)
    observations = export_source.load_observations(files)
    groups = F.group_observations(observations)
    for path in files:
        file_date = export_source.file_date_from_name(os.path.basename(path))
        file_observations = export_source.read_observations(path)
        sources.append({
            'kind': 'выгрузка',
            'name': os.path.basename(path),
            'detail': f'дата файла {file_date}, наблюдений: {len(file_observations)}',
        })
    sources.append({
        'kind': 'выгрузка (исключено)',
        'name': f'старше --since ({args.since})',
        'detail': f'{file_stats["excluded_too_old"]} файлов отброшено',
    })
    sources.append({
        'kind': 'выгрузка (исключено)',
        'name': 'нет колонки «Теги предложений»',
        'detail': f'{file_stats["excluded_no_tags_column"]} файлов отброшено',
    })
    print(f'  файлов: {len(files)}, наблюдений: {len(observations)}, групп: {len(groups)}')

    offers = []
    if args.no_api:
        print('API пропущен (--no-api): классы 9-12 и 14 будут пусты.')
        sources.append({'kind': 'API', 'name': '—', 'detail': 'пропущен (--no-api)'})
    else:
        print('Читаю реестр предложений GetCourse…')
        cfg = api_source.config_from_env(env)
        offers = api_source.load_offers(cfg)
        os.makedirs(paths.OUT_DIR, exist_ok=True)
        snapshot = os.path.join(paths.OUT_DIR, 'getcourse_offers_snapshot.json')
        api_source.save_snapshot(offers, snapshot)
        sources.append({
            'kind': 'API',
            'name': 'offer/get-offers + offer/get-offers-tags',
            'detail': f'{len(offers)} предложений, снимок: {os.path.basename(snapshot)}',
        })
        print(f'  предложений: {len(offers)}')

    print('Считаю находки…')
    result = collect_findings(expectations, funnels, vocabulary, index,
                              collisions, groups, observations, offers)

    os.makedirs(paths.OUT_DIR, exist_ok=True)
    out_path = os.path.join(paths.OUT_DIR, 'Карта_расхождений_тегов.xlsx')
    report.write_report(out_path, result, funnels, sources)

    by_class = {}
    for item in result:
        by_class[item.cls] = by_class.get(item.cls, 0) + 1
    print(f'\nНаходок всего: {len(result)}')
    for cls in sorted(F.CLASS_TITLES):
        print(f'  Класс {cls:>2}: {by_class.get(cls, 0):>5}  {F.CLASS_TITLES[cls]}')
    print(f'\nОтчёт: {out_path}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
