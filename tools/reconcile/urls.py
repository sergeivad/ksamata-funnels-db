#!/usr/bin/env python3
"""Расщепление и нормализация адресов — порт правил monitor-urls.ts.

Оригинал: app/src/lib/monitor-urls.ts (splitUrlField + normalizeUrl).
Правило обязано применяться к ОБЕИМ сторонам сверки: и таблица
маркетологов, и база кладут по несколько адресов в одну ячейку, и
односторонняя нормализация даёт ложные пропажи. Проверено 04.08: f56 и
f84 были ошибочно сочтены отсутствующими именно из-за этого.

Форма нормализованного адреса — «хост/путь» без схемы и хвостового слеша.
Этого достаточно для сопоставления; живость адреса проверяет мониторинг
приложения, здесь сети нет.
"""

import re

_SEPARATORS = re.compile(r'[\s,;\n]+')
_SCHEME = re.compile(r'^https?://', re.IGNORECASE)


def split_field(cell):
    """Ячейка с одним или несколькими адресами -> список нормализованных.

    Отбрасывается всё, что адресом не является: пометки маркетолога в
    скобках («…/a (LP518)»), отдельные слова без точки в хосте («сайты»).
    """
    if cell is None:
        return []

    result = []
    for part in _SEPARATORS.split(str(cell)):
        candidate = part.strip().strip('()').lower()
        candidate = _SCHEME.sub('', candidate).rstrip('/')
        if not candidate:
            continue
        host = candidate.split('/', 1)[0]
        if '.' not in host:
            continue
        if candidate not in result:
            result.append(candidate)
    return result
