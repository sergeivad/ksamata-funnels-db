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
                 item.stat.last_created[:10], combo.label(item.key))
                for item in report.missing]),
        '',
        '## Этап 1. Кандидаты в archive',
        '',
        'Воронка `active`, но заказов нет дольше порога живости. '
        'Только что заведённые сюда не попадают — им нечего было накопить.',
        '',
        _table(['Воронка', 'Последний заказ', 'Связка'],
               [(item.funnel.label, item.last_created[:10] or 'никогда',
                 combo.label(item.funnel.key)) for item in report.dead]),
        '',
        '## Этап 2. Статус: таблица против базы',
        '',
        _table(['Воронка', 'В базе', 'В таблице', 'Строка таблицы'],
               [(item.funnel.label, item.funnel.status, item.row.status,
                 item.row.row_num) for item in report.status_drift]),
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
                 item.stat.last_created[:10], combo.label(item.key))
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
