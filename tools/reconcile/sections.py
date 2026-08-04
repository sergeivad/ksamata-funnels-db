#!/usr/bin/env python3
"""Сборка разделов отчёта. Порядок разделов = порядок этапов разбора.

Ключевое разделение: связка без воронки в базе попадает в РАЗНЫЕ разделы в
зависимости от того, есть ли похожая воронка.

  нет похожей  -> missing     — воронки действительно не хватает (этап 1)
  есть похожая -> mislabelled — ошибка разметки в ГК (трек Р)

Замер 04.08: семь случаев из десяти — второй вид. Свалить их в один список
значит отправить разбор туда, где проблемы нет.
"""

import datetime
from dataclasses import dataclass, field

import combo
import decisions as decisions_module
import matching
import settings
import sheet_source


@dataclass
class MissingCombo:
    key: tuple
    stat: object


@dataclass
class IncompleteCombo:
    key: tuple
    stat: object


@dataclass
class MislabelledCombo:
    key: tuple
    stat: object
    near: object


@dataclass
class DeadFunnel:
    funnel: object
    last_created: str


@dataclass
class SheetOnly:
    row: object


@dataclass
class StatusDrift:
    funnel: object
    row: object


@dataclass
class Settled:
    key: tuple
    stat: object
    rule: object


@dataclass
class Report:
    missing: list = field(default_factory=list)
    incomplete: list = field(default_factory=list)
    mislabelled: list = field(default_factory=list)
    dead: list = field(default_factory=list)
    sheet_only: list = field(default_factory=list)
    status_drift: list = field(default_factory=list)
    settled: list = field(default_factory=list)
    waiting: list = field(default_factory=list)
    blind: dict = field(default_factory=dict)


def _is_live(last_created, today):
    """Связка жива, если последний заказ не старше LIVE_SINCE_DAYS."""
    if not last_created:
        return False
    stamp = datetime.date.fromisoformat(last_created[:10])
    return (today - stamp).days <= settings.LIVE_SINCE_DAYS


def _too_young(start_date, today):
    """Воронка ещё не прожила окно живости — судить её рано.

    Пустая дата старта молодостью не считается: у большинства старых воронок
    её просто не заполнили, и такое допущение вывело бы их всех из-под
    проверки.
    """
    if not start_date:
        return False
    try:
        stamp = datetime.date.fromisoformat(start_date[:10])
    except ValueError:
        return False
    return (today - stamp).days < settings.LIVE_SINCE_DAYS


def build(combos, blind, funnels, sheet_rows, rules, today):
    report = Report(blind=dict(blind))
    report.waiting = [rule for rule in rules if rule.waiting_for]

    by_key = {funnel.key: funnel for funnel in funnels}

    for key, stat in sorted(combos.items(), key=lambda kv: -kv[1].orders):
        if not _is_live(stat.last_created, today):
            continue
        if key in by_key:
            continue

        rule = decisions_module.covering(key, rules)
        if rule is not None:
            report.settled.append(Settled(key=key, stat=stat, rule=rule))
            continue

        near = matching.nearest(key, funnels)
        if near is not None:
            report.mislabelled.append(
                MislabelledCombo(key=key, stat=stat, near=near))
        elif combo.is_complete(key):
            report.missing.append(MissingCombo(key=key, stat=stat))
        else:
            # Похожей воронки нет И связка неполна — опознать нечем.
            # «ЖИВО» из одной оси не говорит, какой воронки не хватает;
            # это дырка разметки в ГК, а не пропавшая воронка. Разбор
            # 04.08: три такие связки из четырёх лежали в «не хватает
            # воронок» и уводили не туда.
            report.incomplete.append(IncompleteCombo(key=key, stat=stat))

    for funnel in funnels:
        if funnel.status != 'active':
            continue
        # Воронка, заведённая только что, заказов ещё не накопила — молчание
        # про неё ничего не значит. Разбор 04.08: f73, f74 и f78 со стартом
        # 2026-08-01 попали в кандидаты на архив, хотя выгрузка заказов
        # заканчивается 2026-08-01 01:48 и они физически не могли в неё
        # попасть.
        if _too_young(funnel.start_date, today):
            continue
        stat = combos.get(funnel.key)
        last = stat.last_created if stat else ''
        if not _is_live(last, today):
            report.dead.append(DeadFunnel(funnel=funnel, last_created=last))

    for row in sheet_rows:
        match = matching.match_sheet_row(row, funnels)
        if match.funnel is None:
            if sheet_source.is_live(row.status):
                report.sheet_only.append(SheetOnly(row=row))
            continue
        # Пустая ячейка статуса — «маркетолог не заполнил», а не «Стоп».
        # Без этой проверки f24, f25 и f26 попадали в расхождения статуса
        # только потому, что в таблице у них пусто.
        if not row.status:
            continue
        funnel_is_active = match.funnel.status == 'active'
        if sheet_source.is_live(row.status) != funnel_is_active:
            report.status_drift.append(
                StatusDrift(funnel=match.funnel, row=row))

    return report
