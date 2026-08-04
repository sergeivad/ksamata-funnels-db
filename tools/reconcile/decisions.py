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


@dataclass(frozen=True)
class Decision:
    id: str
    match: dict
    verdict: str
    why: str
    since: str
    waiting_for: str = ''
    _positions: dict = field(default_factory=dict, compare=False)


def load(path):
    """Читает decisions.yaml. Отсутствие файла — норма, а не ошибка."""
    if not os.path.exists(path):
        return []
    with open(path, encoding='utf-8') as handle:
        raw = yaml.safe_load(handle) or []

    rules = []
    for item in raw:
        match = item.get('match') or {}
        positions = {}
        for alias, values in match.items():
            if alias not in AXIS_ALIASES:
                raise ValueError(
                    f'Правило {item.get("id")}: неизвестная ось «{alias}». '
                    f'Допустимы: {", ".join(sorted(AXIS_ALIASES))}')
            positions[AXIS_ALIASES[alias]] = [str(v) for v in values]
        rules.append(Decision(
            id=str(item.get('id', '')),
            match=match,
            verdict=str(item.get('verdict', '')),
            why=str(item.get('why', '')),
            since=str(item.get('since', '')),
            waiting_for=str(item.get('waiting_for', '')),
            _positions=positions,
        ))
    return rules


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
