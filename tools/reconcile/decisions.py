#!/usr/bin/env python3
"""Файл решений — механизм против хождения по кругу.

Принятое решение становится строкой, по которой инструмент МОЛЧИТ:
совпавшие связки уходят в свёрнутый раздел «решено ранее». Пока решение
живёт абзацем в CLAUDE.md, оно не гасит ни одной строки отчёта, и каждая
сверка обсуждает его заново.

Правило совпадает, когда совпали ВСЕ перечисленные в нём оси. Ось, которую
правило не называет, не проверяется — так «квизы» пишутся одной осью, а не
перечислением всех связок.
"""

import os
from dataclasses import dataclass, field

import yaml

# Имена осей в файле решений — короткие и русские: файл ведёт человек.
AXIS_ALIASES = {
    'продукт': 0,
    'подрядчик': 1,
    'канал': 2,
    'направление': 3,
    'тип': 4,
}


SHEET_STATUS = 'sheet_status'
SHEET_LANDING = 'sheet_landing'
VALID_SCOPES = {SHEET_STATUS, SHEET_LANDING}


@dataclass(frozen=True)
class Decision:
    id: str
    match: dict
    verdict: str
    why: str
    since: str
    waiting_for: str = ''
    scope: str = ''
    # Только для scope: sheet_landing — чем опознать строку и что подставить.
    # Строка опознаётся по подрядчику и названию воронки, а НЕ по номеру:
    # номер съезжает от одной вставки в таблицу, и правило молча перестало
    # бы срабатывать либо, хуже, сработало бы на чужой строке.
    row_contractor: str = ''
    row_funnel: str = ''
    landing: str = ''
    _positions: dict = field(default_factory=dict, compare=False)


def load(path):
    """Читает decisions.yaml. Отсутствие файла — норма, а не ошибка."""
    if not os.path.exists(path):
        return []
    with open(path, encoding='utf-8') as handle:
        raw = yaml.safe_load(handle) or []

    rules = []
    for item in raw:
        scope = str(item.get('scope', '') or '')
        if scope and scope not in VALID_SCOPES:
            raise ValueError(
                f'Правило {item.get("id")}: неизвестная область «{scope}». '
                f'Допустимы: {", ".join(sorted(VALID_SCOPES))}')
        match = item.get('match') or {}
        positions = {}
        for alias, values in match.items():
            if alias not in AXIS_ALIASES:
                raise ValueError(
                    f'Правило {item.get("id")}: неизвестная ось «{alias}». '
                    f'Допустимы: {", ".join(sorted(AXIS_ALIASES))}')
            # null в списке значит «ось не размечена». Без этого нельзя
            # выразить связку вроде продлений подписки («АВ Продукт: ЖИВО»
            # и больше ничего): правило «продукт: [ЖИВО]» погасило бы заодно
            # все настоящие ЖИВО-воронки.
            positions[AXIS_ALIASES[alias]] = [
                None if v is None else str(v) for v in values]
        rules.append(Decision(
            id=str(item.get('id', '')),
            match=match,
            verdict=str(item.get('verdict', '')),
            why=str(item.get('why', '')),
            since=str(item.get('since', '')),
            waiting_for=str(item.get('waiting_for', '')),
            scope=scope,
            row_contractor=str((item.get('row') or {}).get('подрядчик', '')),
            row_funnel=str((item.get('row') or {}).get('воронка', '')),
            landing=str(item.get('landing', '')),
            _positions=positions,
        ))
    return rules


def scoped(scope, rules):
    """Первое решение, гасящее целую СВЕРКУ, а не отдельную связку.

    Такое решение выражает «этот источник по этому полю не эталон» —
    например, статус в таблице маркетологов после решения владельца 04.08.
    Гасить его перечислением воронок нельзя: список пришлось бы дописывать
    после каждой новой воронки, а забытая строка вернула бы вопрос.

    Правила с waiting_for пропускаются здесь по той же причине, что и в
    covering: вопрос без ответа не гасит ничего.
    """
    for rule in rules:
        if rule.scope == scope and not rule.waiting_for:
            return rule
    return None


def covering(key, rules):
    """Первое РЕШЕНИЕ, покрывающее связку, или None.

    Правила с waiting_for пропускаются намеренно: «ждёт ответа» — это
    вопрос, а не решение. Погасив им связку, отчёт спрятал бы живую
    находку под видом разобранной — ровно то, ради чего файл решений и
    заводился, но наизнанку. Такие правила живут в своём разделе отчёта.
    """
    for rule in rules:
        if not rule._positions or rule.waiting_for:
            continue
        if all(key[pos] in values for pos, values in rule._positions.items()):
            return rule
    return None
