#!/usr/bin/env python3
"""Рендер отчёта в markdown.

Порядок разделов повторяет порядок этапов разбора и этим отвечает на
вопрос «с чего начать». Пустой раздел печатается явно: «расхождений нет»
читается иначе, чем отсутствие раздела.
"""

import combo

EMPTY = '_расхождений нет_'


def _thousands(number):
    return f'{number:,}'.replace(',', ' ')


def _table(header, rows):
    if not rows:
        return EMPTY
    lines = ['| ' + ' | '.join(header) + ' |',
             '|' + '|'.join('---' for _ in header) + '|']
    lines.extend('| ' + ' | '.join(str(cell) for cell in row) + ' |'
                 for row in rows)
    return '\n'.join(lines)


def _status_sections(report):
    """Раздел про статусы — либо сверка, либо одна строка про решение.

    Печатать погашенную сверку «для полноты» нельзя: это ровно тот случай,
    когда решение принято, а отчёт всё равно каждый раз выкладывает его на
    стол. Достаточно сказать, что сверки нет и почему.
    """
    rule = report.sheet_status_off
    if rule is not None:
        return [
            '## Этап 2. Статус: таблица против базы',
            '',
            f'**Не сверяется** — решение `{rule.id}` от {rule.since}: '
            f'{rule.verdict}.',
            '',
            rule.why.strip(),
            '',
        ]
    return [
        '## Этап 2. Статус: таблица против базы',
        '',
        'Здесь только то, что заказы **не** рассудили: третий источник '
        'согласен с таблицей, а не с базой. Решает человек.',
        '',
        _table(['Воронка', 'В базе', 'В таблице', 'Строка таблицы'],
               [(item.funnel.label, item.funnel.status, item.row.status,
                 item.row.row_num) for item in report.status_drift]),
        '',
        '## Этап 2. Устарела таблица, не база',
        '',
        'Таблица расходится с базой, но заказы подтверждают базу. '
        'Правится ячейка в таблице; статус воронки не трогаем.',
        '',
        _table(['Воронка', 'В базе', 'В таблице', 'Строка', 'Последний заказ'],
               [(item.funnel.label, item.funnel.status, item.row.status,
                 item.row.row_num, item.last_activity[:10] or 'никогда')
                for item in report.sheet_stale]),
        '',
    ]


def render(report, meta):
    parts = [
        '# Сверка источников',
        '',
        f'Заказы: `{meta["export"]}` · таблица: `{meta["sheet"]}` · '
        f'прогон: {meta["today"]}',
        '',
        'Разделы идут в порядке этапов разбора — это и есть ответ на '
        '«с чего начать».',
        '',
        '## Этап 1. Воронок не хватает',
        '',
        'Заказы идут, а воронки в базе нет, и похожей тоже нет.',
        '',
        _table(['Заказов', 'Оплат', 'Последний', 'Связка'],
               [(_thousands(item.stat.orders), item.stat.paid,
                 item.stat.last_activity[:10], combo.label(item.key))
                for item in report.missing]),
        '',
        '## Этап 1. Кандидаты в archive',
        '',
        'Воронка `active`, но заказов нет дольше порога живости. '
        'Только что заведённые сюда не попадают — им нечего было накопить.',
        '',
        _table(['Воронка', 'Последний заказ', 'Связка'],
               [(item.funnel.label, item.last_activity[:10] or 'никогда',
                 combo.label(item.funnel.key)) for item in report.dead]),
        '',
        *_status_sections(report),
        '## Этап 2. Лендинг разошёлся',
        '',
        'Строку опознали по «источник + продукт» — значит ни лендинг, ни код '
        'не совпали. Адрес из таблицы в базе либо другой, либо его нет.',
        '',
        _table(['Воронка', 'В базе', 'Строка', 'В таблице', 'Лендинг строки'],
               [(item.funnel.label, item.funnel.status, item.row.row_num,
                 item.row.status or '—',
                 item.row.landings[0] if item.row.landings else '—')
                for item in report.landing_drift]),
        '',
        '## Этап 2. Строку не с чем однозначно связать',
        '',
        'Источник и продукт совпали сразу с несколькими воронками, и выбирать '
        'за человека инструмент не стал. Чинится в таблице: дописать в строку '
        'F-код или лендинг.',
        '',
        _table(['Строка', 'В таблице', 'Источник', 'Воронка', 'Кандидаты'],
               [(item.row.row_num, item.row.status or '—', item.row.contractor,
                 item.row.funnel,
                 ', '.join(f.label for f in item.candidates))
                for item in report.ambiguous]),
        '',
        '## Этап 2. Живые строки таблицы без воронки',
        '',
        _table(['Строка', 'Подрядчик', 'Воронка', 'Лендинг'],
               [(item.row.row_num, item.row.contractor, item.row.funnel,
                 item.row.landings[0] if item.row.landings else '—')
                for item in report.sheet_only]),
        '',
        '## Трек Р. Разметка в GetCourse',
        '',
        f'Заказов без осей вовсе: **{_thousands(report.blind.get("orders", 0))}**, '
        f'из них оплаченных — **{_thousands(report.blind.get("paid", 0))}**. '
        'Эти заказы нельзя приписать никакой воронке.',
        '',
        'Ниже — связки, у которых воронка есть, но размечены они неверно.',
        '',
        _table(['Заказов', 'Связка в заказах', 'Похоже на', 'Разница'],
               [(_thousands(item.stat.orders), combo.label(item.key),
                 item.near.funnel.label,
                 '; '.join(f'{axis}: {was or "—"} → {became or "—"}'
                           for axis, was, became in item.near.diff))
                for item in report.mislabelled]),
        '',
        '### Связки, которые нечем опознать',
        '',
        'Осей так мало, что сказать, какой воронке принадлежит заказ, '
        'нельзя. Это тоже разметка, а не пропавшие воронки.',
        '',
        _table(['Заказов', 'Оплат', 'Последний', 'Что размечено'],
               [(_thousands(item.stat.orders), item.stat.paid,
                 item.stat.last_activity[:10], combo.label(item.key))
                for item in report.incomplete]),
        '',
        f'## Ждёт ответа ({len(report.waiting)})',
        '',
        _table(['Кому', 'Вопрос'],
               [(rule.waiting_for, rule.why.strip()) for rule in report.waiting]),
        '',
        f'## Решено ранее ({len(report.settled)})',
        '',
        'Эти связки закрыты решением в `tools/reconcile/decisions.yaml` — '
        'обсуждать заново не нужно.',
        '',
        _table(['Заказов', 'Связка', 'Решение', 'Когда'],
               [(_thousands(item.stat.orders), combo.label(item.key),
                 item.rule.verdict, item.rule.since)
                for item in report.settled]),
        '',
    ]
    return '\n'.join(parts)
