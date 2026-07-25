#!/usr/bin/env python3
"""Шестнадцать классов находок.

Чистые функции: принимают готовые коллекции, возвращают list[Finding].
Ничего не читают с диска и из сети — поэтому тестируются без моков.
"""

from collections import defaultdict
from dataclasses import dataclass

from db_source import label_of
from normalize import (
    AUTOFUNNEL_TAG,
    AXES,
    MARKER_TAGS,
    PREDPISOK_STAGE,
    STAGE_MESSENGER,
    STAGE_PAYMENT,
    STAGE_PREFIX,
    STAGE_REG,
    av_key,
    classify,
    is_complete_key,
    is_external_tag,
    key_label,
)

CLASS_TITLES = {
    1: 'Тег ожидается в базе, но в GetCourse отсутствует',
    2: 'Ось есть в GetCourse, но её нет в словаре базы',
    3: 'Этап не поддержан моделью базы',
    4: 'Противоречивые легаси-теги на одном предложении',
    5: 'Тип не выводится: оплата без АВ Время или нет АВ Этап',
    6: 'Этап Предписок — типа в модели базы нет',
    7: 'Четвёрка полная, но воронки в базе нет',
    8: 'Коллизия АВ-ключа',
    9: 'АВ-четвёрка есть в GetCourse, но нет ни одной воронки',
    10: 'Предложение с неполной АВ-четвёркой',
    11: 'Ось есть в GetCourse, но отсутствует в словаре базы целиком',
    12: 'Предложение с АВ Этап, но без АВ Автоворонка',
    13: 'Воронка active, но ни одного наблюдения за период',
    14: 'Предложение с АВ-тегами и нулём заказов — кандидат в архив',
    15: 'Дрейф: тег появился или исчез',
    16: 'Покрытие наблюдениями',
}

# Легаси-теги направления: больше одного на предложении — противоречие.
CONTRADICTORY_LEGACY_PREFIXES = ('ВК NR', 'ВК HT', 'IS NR')


@dataclass(frozen=True)
class Finding:
    cls: int
    funnel: str
    tag_type: str
    subject: str
    detail: str
    evidence: str
    first_seen: str
    last_seen: str
    deals: int


@dataclass(frozen=True)
class Group:
    key: tuple
    tag_type: object   # str | None — None, когда тип не выводится
    reason: object     # str | None — причина, когда tag_type равен None
    tags: frozenset
    deals: int
    first_seen: object
    last_seen: object
    files: tuple


def group_observations(observations):
    """Сворачивает наблюдения в тройки (АВ-ключ × тип × набор тегов)."""
    buckets = defaultdict(list)
    for obs in observations:
        tag_type, reason = classify(obs.tags)
        buckets[(av_key(obs.tags), tag_type, reason, obs.tags)].append(obs)

    groups = []
    for (key, tag_type, reason, tags), items in buckets.items():
        dates = [i.file_date for i in items]
        groups.append(
            Group(
                key=key,
                tag_type=tag_type,
                reason=reason,
                tags=tags,
                deals=len(items),
                first_seen=min(dates),
                last_seen=max(dates),
                files=tuple(sorted({i.file_name for i in items})),
            )
        )
    groups.sort(key=lambda g: (-g.deals, key_label(g.key)))
    return groups


def _funnel_label(index, expectations_by_id, key):
    """Метка воронки по АВ-ключу; при коллизии и промахе — прочерк."""
    fids = index.get(key, set())
    if len(fids) != 1:
        return '—'
    exp = expectations_by_id.get(next(iter(fids)))
    return label_of(exp) if exp is not None else '—'


def _by_funnel_id(expectations):
    return {e.funnel_id: e for e in expectations}


def _freshness_key(group):
    """Самодостаточный ключ «свежести» группы — не зависит от порядка входа.

    (last_seen, deals, отсортированные теги): при равенстве last_seen
    побеждает группа с бо́льшим числом наблюдений, а если и это равно —
    устойчивый tie-break по кортежу отсортированных тегов. Без этого
    победитель при ничьей по дате решался порядком элементов во входном
    списке groups — оформительской сортировкой report'а, а не содержанием.
    """
    return (group.last_seen, group.deals, tuple(sorted(group.tags)))


def _latest_groups(groups):
    """Для каждой пары (ключ, тип) — только самое свежее наблюдение.

    Спек: сравнивать с базой надо текущее состояние, иначе древние
    наборы уедут в отчёт как ошибки. Победитель при ничьей по last_seen
    определяется _freshness_key (число наблюдений, затем теги), а не
    порядком групп во входном списке — см. её докстринг.
    """
    newest = {}
    for group in groups:
        if group.tag_type is None:
            continue
        slot = (group.key, group.tag_type)
        current = newest.get(slot)
        if current is None or _freshness_key(group) > _freshness_key(current):
            newest[slot] = group
    return list(newest.values())


def _stage_family(tags):
    """Семейство этапа: reg/messenger/payment/predpisok/none.

    В отличие от tag_type (см. classify), семейство выводится только из
    тегов этапа и не зависит от того, есть ли АВ Время. Так «Оплата без
    времени» и «Оплата с временем» — одно семейство, и свежая исправная
    группа вытесняет старую сломанную. reg и messenger — отдельные
    семейства: у одной воронки они существуют одновременно законно.
    """
    if STAGE_REG in tags:
        return 'reg'
    if STAGE_MESSENGER in tags:
        return 'messenger'
    if PREDPISOK_STAGE in tags:
        return 'predpisok'
    if STAGE_PAYMENT in tags:
        return 'payment'
    return 'none'


def _latest_by_stage_family(groups):
    """Для каждой пары (ключ, семейство этапа) — только свежее наблюдение.

    В отличие от _latest_groups, не пропускает группы с tag_type is None —
    именно такие группы дают классы 5 и 6. Свёртка по семейству, а не по
    tag_type, нужна чтобы свежая исправная группа ('time_19') вытесняла
    старую сломанную ('no_time') на том же АВ-ключе: у обеих семейство
    'payment', а tag_type разный.

    Победитель при ничьей по last_seen определяется _freshness_key (число
    наблюдений, затем теги), а не порядком групп во входном списке — см.
    её докстринг.
    """
    newest = {}
    for group in groups:
        slot = (group.key, _stage_family(group.tags))
        current = newest.get(slot)
        if current is None or _freshness_key(group) > _freshness_key(current):
            newest[slot] = group
    return list(newest.values())


# Владелец решил свернуть класс 1 так же, как ранее свернули класс 3: тег,
# которого не хватает более чем у этого числа воронок (пар ключ × tag_type),
# даёт одну сводную находку вместо перечисления по каждой воронке — иначе
# один шумный тег (например 'автоворонки') делает «Класс 1» равным единице
# почти у каждой воронки и топит полезный сигнал редких расхождений.
MASS_MISSING_TAG_THRESHOLD = 5


def find_missing_in_getcourse(groups, expectations, index):
    """Класс 1: база ждёт тег, а в свежем наблюдении его нет.

    Тег, отсутствующий более чем у MASS_MISSING_TAG_THRESHOLD пар (ключ ×
    tag_type), сворачивается в одну сводную находку (funnel='—'). Теги,
    встречающиеся у MASS_MISSING_TAG_THRESHOLD пар и менее, перечисляются
    поштучно как раньше — именно они полезный сигнал.
    """
    by_id = _by_funnel_id(expectations)
    by_slot = {(av_key(e.tags), e.tag_type): e for e in expectations}

    per_group = []
    for group in _latest_groups(groups):
        exp = by_slot.get((group.key, group.tag_type))
        if exp is None:
            continue
        missing = exp.tags - group.tags
        if not missing:
            continue
        per_group.append((group, _funnel_label(index, by_id, group.key), missing))

    tag_occurrences = defaultdict(list)
    for group, funnel_label, missing in per_group:
        for tag in missing:
            tag_occurrences[tag].append((group, funnel_label))

    mass_tags = {
        tag for tag, occ in tag_occurrences.items()
        if len(occ) > MASS_MISSING_TAG_THRESHOLD
    }

    result = []
    for tag in sorted(mass_tags):
        occ = tag_occurrences[tag]
        contributing = [g for g, _label in occ]
        labels = sorted({label for _g, label in occ if label != '—'})
        result.append(
            Finding(
                cls=1,
                funnel='—',
                tag_type='',
                subject=tag,
                detail=(f'База ожидает тег {tag} на {len(occ)} парах, '
                        'в GetCourse он отсутствует.'),
                evidence='; '.join(labels[:5]),
                first_seen=str(min(g.first_seen for g in contributing)),
                last_seen=str(max(g.last_seen for g in contributing)),
                deals=sum(g.deals for g in contributing),
            )
        )

    for group, funnel_label, missing in per_group:
        remaining = sorted(tag for tag in missing if tag not in mass_tags)
        if not remaining:
            continue
        result.append(
            Finding(
                cls=1,
                funnel=funnel_label,
                tag_type=group.tag_type,
                subject=', '.join(remaining),
                detail=f'Ожидается базой, нет в GetCourse. Ключ: {key_label(group.key)}',
                evidence='; '.join(group.files[:3]),
                first_seen=str(group.first_seen),
                last_seen=str(group.last_seen),
                deals=group.deals,
            )
        )
    return result


def find_extra_axes(groups, vocabulary):
    """Класс 2: в наблюдении есть АВ-тег, которого база не знает.

    В отличие от классов 1 и 4, этому классу тип (tag_type) не нужен вообще
    — он ищет неизвестные АВ-теги независимо от того, выводится ли этап.
    Поэтому свёртка идёт через _latest_by_stage_family, а не _latest_groups:
    последняя выбрасывает группы с tag_type is None (например, без АВ Этап
    или с непонятым этапом), и такие группы — включая ровно те, что несут
    неизвестные базе оси вроде 'АВ Время: 17' — тихо пропадали бы из отчёта.

    Теги из EXTERNAL_TAG_PREFIXES пропускаются: база их не знает намеренно.
    Маркеры типа воронки, наоборот, НЕ пропускаются — база их действительно
    не умеет выражать, и это настоящий пробел модели, а не решённый вопрос.
    """
    result = []
    for group in _latest_by_stage_family(groups):
        unknown = sorted(
            tag for tag in group.tags
            if tag.startswith('АВ ') and tag not in vocabulary
            and not is_external_tag(tag)
        )
        if not unknown:
            continue
        result.append(
            Finding(
                cls=2,
                funnel='—',
                tag_type=group.tag_type or '',
                subject=', '.join(unknown),
                detail=f'Нет в таблице tags. Ключ: {key_label(group.key)}',
                evidence='; '.join(group.files[:3]),
                first_seen=str(group.first_seen),
                last_seen=str(group.last_seen),
                deals=group.deals,
            )
        )
    return result


def find_unsupported_stage(groups):
    """Класс 3: этап Предписок — тип в модели базы не поддержан.

    Решение владельца: классы 3 и 6 оба срабатывают на АВ Этап: Предписок,
    перечисляя одни и те же группы на двух листах отчёта — дублирование.
    Класс 3 сводится к ОДНОЙ итоговой строке (этап встретился хоть где-то —
    сколько групп и сколько заказов затронуто), а детальный список
    по-группе остаётся в классе 6 (find_unresolved). Не трогать класс 6.
    """
    hits = [group for group in groups if PREDPISOK_STAGE in group.tags]
    if not hits:
        return []

    files = []
    seen_files = set()
    for group in hits:
        for file_name in group.files:
            if file_name not in seen_files:
                seen_files.add(file_name)
                files.append(file_name)

    return [
        Finding(
            cls=3,
            funnel='—',
            tag_type='',
            subject=PREDPISOK_STAGE,
            detail=(
                'funnel_tags.tag_type разрешает только '
                'reg/time_19/time_15/messenger. '
                f'Групп с этим этапом: {len(hits)}, '
                f'заказов: {sum(g.deals for g in hits)}. Детали — класс 6.'
            ),
            evidence='; '.join(files[:3]),
            first_seen=str(min(g.first_seen for g in hits)),
            last_seen=str(max(g.last_seen for g in hits)),
            deals=sum(g.deals for g in hits),
        )
    ]


def find_contradictory_legacy(groups, expectations, index):
    """Класс 4: два и более взаимоисключающих легаси-тега направления."""
    by_id = _by_funnel_id(expectations)
    result = []
    for group in _latest_groups(groups):
        legacy = sorted(
            tag for tag in group.tags
            if any(tag.startswith(p) for p in CONTRADICTORY_LEGACY_PREFIXES)
        )
        # Один такой тег — норма. Противоречие начинается со второго.
        if len(legacy) < 2:
            continue
        result.append(
            Finding(
                cls=4,
                funnel=_funnel_label(index, by_id, group.key),
                tag_type=group.tag_type,
                subject=f'{len(legacy)} легаси-тега направления одновременно',
                detail=f'Ключ: {key_label(group.key)}',
                evidence=', '.join(legacy),
                first_seen=str(group.first_seen),
                last_seen=str(group.last_seen),
                deals=group.deals,
            )
        )
    return result


def find_unresolved(groups, index):
    """Классы 5, 6, 7 — взаимоисключающие причины неопознания.

    Каждая неопознанная группа попадает ровно в один класс.
    """
    result = []
    for group in _latest_by_stage_family(groups):
        if group.reason == 'no_time':
            cls, subject = 5, 'Оплата без АВ Время'
        elif group.reason == 'predpisok':
            cls, subject = 6, 'Этап Предписок'
        elif group.reason == 'no_stage':
            cls, subject = 5, 'Нет АВ Этап — тип не выводится'
        elif is_complete_key(group.key) and group.key not in index:
            cls, subject = 7, f'Нет воронки для {key_label(group.key)}'
        else:
            continue

        result.append(
            Finding(
                cls=cls,
                funnel='—',
                tag_type=group.tag_type or '',
                subject=subject,
                detail=f'Ключ: {key_label(group.key)}',
                evidence='; '.join(group.files[:3]),
                first_seen=str(group.first_seen),
                last_seen=str(group.last_seen),
                deals=group.deals,
            )
        )
    return result


# ─── Группа III. Полнота базы относительно реестра GetCourse ────────────────


def _offers_with_av(offers):
    return [o for o in offers if any(t.startswith('АВ ') for t in o.tags)]


def find_key_collision_findings(collisions, expectations):
    """Класс 8: один АВ-ключ указывает на две воронки. Угадывать нельзя."""
    by_id = _by_funnel_id(expectations)
    result = []
    for key, fids in sorted(collisions.items()):
        labels = sorted(
            label_of(by_id[fid]) for fid in fids if fid in by_id
        )
        result.append(
            Finding(
                cls=8,
                funnel='—',
                tag_type='',
                subject=key_label(key),
                detail='Ключ указывает более чем на одну воронку',
                evidence=', '.join(labels),
                first_seen='',
                last_seen='',
                deals=len(fids),
            )
        )
    return result


def find_unknown_av_keys(offers, index):
    """Класс 9: четвёрка живёт в GetCourse, а воронки под неё в базе нет."""
    counts = defaultdict(list)
    for offer in _offers_with_av(offers):
        key = av_key(offer.tags)
        if is_complete_key(key) and key not in index:
            counts[key].append(offer)

    result = []
    for key, group in sorted(counts.items()):
        titles = sorted({o.title for o in group if o.title})
        result.append(
            Finding(
                cls=9,
                funnel='—',
                tag_type='',
                subject=key_label(key),
                detail=f'Предложений с такой четвёркой: {len(group)}',
                evidence='; '.join(titles[:3]),
                first_seen='',
                last_seen='',
                deals=len(group),
            )
        )
    return result


def find_incomplete_offer_keys(offers):
    """Класс 10: у предложения с АВ-тегами четвёрка неполна."""
    result = []
    for offer in _offers_with_av(offers):
        key = av_key(offer.tags)
        if is_complete_key(key):
            continue
        missing = [AXES[i] for i, part in enumerate(key) if part is None]
        result.append(
            Finding(
                cls=10,
                funnel='—',
                tag_type='',
                subject=f'{offer.title} (id {offer.offer_id})',
                detail='Не хватает осей: ' + ', '.join(missing),
                evidence=key_label(key),
                first_seen='',
                last_seen='',
                deals=0,
            )
        )
    return result


def find_unknown_axes_in_registry(offers, vocabulary):
    """Класс 11: ось есть в реестре, но её нет в словаре базы целиком.

    Маркеры типа воронки исключены: двоеточия в них нет, поэтому разбор
    «часть до двоеточия» выдавал весь тег за имя новой оси, и «АВ Прямые»,
    «АВ Квиз», «АВ Квиз-Лайт» попадали сюда как три неизвестные оси.

    Теги из EXTERNAL_TAG_PREFIXES тоже исключены: база их не знает намеренно,
    так что это не расхождение (см. комментарий в normalize).
    """
    counts = defaultdict(set)
    for offer in _offers_with_av(offers):
        for tag in offer.tags:
            if (tag.startswith('АВ ') and tag not in vocabulary
                    and tag not in MARKER_TAGS and not is_external_tag(tag)):
                axis = tag.split(':', 1)[0] if ':' in tag else tag
                counts[axis].add(offer.offer_id)

    result = []
    for axis, offer_ids in sorted(counts.items()):
        result.append(
            Finding(
                cls=11,
                funnel='—',
                tag_type='',
                subject=axis,
                detail=f'Предложений с этой осью: {len(offer_ids)}',
                evidence=', '.join(str(i) for i in sorted(offer_ids)[:5]),
                first_seen='',
                last_seen='',
                deals=len(offer_ids),
            )
        )
    return result


def find_offers_without_autofunnel(offers):
    """Класс 12: есть АВ Этап, но нет НИ ОДНОГО маркера типа воронки.

    Маркеров четыре и они взаимоисключающие (MARKER_TAGS в normalize):
    «Автоворонка», «Прямые», «Квиз», «Квиз-Лайт». Проверять только первый
    нельзя — на реестре 2026-07-25 так получалось 88 находок, из которых
    85 несли альтернативный маркер и были размечены правильно.
    """
    result = []
    for offer in _offers_with_av(offers):
        has_stage = any(t.startswith(STAGE_PREFIX) for t in offer.tags)
        if not has_stage or offer.tags & MARKER_TAGS:
            continue
        result.append(
            Finding(
                cls=12,
                funnel='—',
                tag_type='',
                subject=offer.title,
                detail='Нет ни одного маркера типа воронки: '
                       + ', '.join(sorted(MARKER_TAGS)),
                evidence=str(offer.offer_id),
                first_seen='',
                last_seen='',
                deals=0,
            )
        )
    return result


# ─── Группа IV. Актуальность ────────────────────────────────────────────────
#
# Классы 13 и 14 намеренно НЕ сводятся: 13 смотрит от базы (воронка заведена,
# следов нет), 14 — от GetCourse (предложение существует, заказов нет).
# Воронка может попасть в 13, а её предложения — в 14; это разные выводы.


def find_silent_funnels(funnels, groups, index):
    """Класс 13: воронка active, но за период ни одного наблюдения."""
    seen_ids = set()
    for group in groups:
        seen_ids.update(index.get(group.key, set()))

    result = []
    for row in funnels:
        if row.status != 'active' or row.funnel_id in seen_ids:
            continue
        result.append(
            Finding(
                cls=13,
                funnel=label_of(row),
                tag_type='',
                subject=row.product_name,
                detail='Статус active, но наблюдений за период нет',
                evidence='',
                first_seen='',
                last_seen='',
                deals=0,
            )
        )
    return result


def find_unused_offers(offers, groups):
    """Класс 14: предложение с АВ-тегами, по которому нет заказов.

    Замена нерабочему полю status — у всех предложений оно равно 'draft'.
    """
    observed_keys = {g.key for g in groups if is_complete_key(g.key)}

    result = []
    for offer in _offers_with_av(offers):
        key = av_key(offer.tags)
        if not is_complete_key(key) or key in observed_keys:
            continue
        result.append(
            Finding(
                cls=14,
                funnel='—',
                tag_type='',
                subject=f'{offer.title} (id {offer.offer_id})',
                detail=f'Заказов за период нет. Ключ: {key_label(key)}',
                evidence=str(offer.offer_id),
                first_seen='',
                last_seen='',
                deals=0,
            )
        )
    return result


# ─── Группа V. Динамика и достоверность ─────────────────────────────────────

# Меньше этого числа наблюдений — данных слишком мало, чтобы делать выводы.
THIN_COVERAGE_THRESHOLD = 2


def _dominant_tagset(tagset_counts):
    """Из наборов тегов одной даты выбирает набор с наибольшим числом
    наблюдений; при равенстве — устойчиво наименьший по sorted(tagset).

    Не полагается на порядок обхода set/frozenset: сортировка по count
    (по убыванию) и по кортежу тегов (по возрастанию) детерминирована
    независимо от PYTHONHASHSEED.
    """
    return min(
        tagset_counts.items(),
        key=lambda pair: (-pair[1], tuple(sorted(pair[0]))),
    )


def find_drift(observations, index, expectations):
    """Класс 15: набор тегов у пары (ключ × тип) менялся между выгрузками.

    Дата берётся ПО ФАЙЛУ выгрузки, а не по созданию заказа: «Теги
    предложений» вычисляются в момент выгрузки, поэтому старый заказ
    в свежей выгрузке несёт свежие теги.

    Дрейф считается по последовательности дат файлов внутри слота
    (АВ-ключ × tag_type), а НЕ по свёрнутым Group. group_observations
    схлопывает наблюдения по точному набору тегов, и у набора, который
    менялся и вернулся к прежнему виду (A → B → A), first_seen/last_seen
    съезжают на крайние даты — промежуточный переход «появился/исчез»
    молча теряется. Здесь каждое наблюдение учитывается по его
    собственной file_date, поэтому такой возврат даёт две находки, а не
    одну.
    """
    by_id = _by_funnel_id(expectations)

    # (ключ, tag_type) -> file_date -> набор тегов -> число наблюдений
    slots = defaultdict(lambda: defaultdict(lambda: defaultdict(int)))
    for o in observations:
        tag_type, _reason = classify(o.tags)
        if tag_type is None:
            continue
        slots[(av_key(o.tags), tag_type)][o.file_date][o.tags] += 1

    result = []
    for (key, tag_type), by_date in sorted(
        slots.items(), key=lambda kv: (key_label(kv[0][0]), kv[0][1])
    ):
        timeline = []
        for file_date in sorted(by_date.keys()):
            tags, deals = _dominant_tagset(by_date[file_date])
            timeline.append((file_date, tags, deals))

        if len(timeline) < 2:
            continue

        for (older_date, older_tags, older_deals), (newer_date, newer_tags, newer_deals) in zip(
            timeline, timeline[1:]
        ):
            appeared = sorted(newer_tags - older_tags)
            disappeared = sorted(older_tags - newer_tags)
            if not appeared and not disappeared:
                continue
            parts = []
            if appeared:
                parts.append('появился: ' + ', '.join(appeared))
            if disappeared:
                parts.append('исчез: ' + ', '.join(disappeared))
            result.append(
                Finding(
                    cls=15,
                    funnel=_funnel_label(index, by_id, key),
                    tag_type=tag_type,
                    subject=', '.join(appeared + disappeared),
                    detail='; '.join(parts),
                    evidence=f'{key_label(key)} | между {older_date} и {newer_date}',
                    first_seen=str(older_date),
                    last_seen=str(newer_date),
                    deals=older_deals + newer_deals,
                )
            )
    return result


def find_coverage(funnels, groups, index):
    """Класс 16: сколько данных вообще есть по каждой воронке.

    Выгрузки — сегментные срезы с неизвестным охватом. Без этого листа
    отчёт создаёт ложное впечатление полноты.
    """
    stats = defaultdict(lambda: {'deals': 0, 'files': set(), 'last': None})
    for group in groups:
        for fid in index.get(group.key, set()):
            entry = stats[fid]
            entry['deals'] += group.deals
            entry['files'].update(group.files)
            if entry['last'] is None or group.last_seen > entry['last']:
                entry['last'] = group.last_seen

    result = []
    for row in funnels:
        entry = stats.get(row.funnel_id)
        deals = entry['deals'] if entry else 0
        files = len(entry['files']) if entry else 0
        last = entry['last'] if entry else None

        if deals == 0:
            subject = 'нет данных'
        elif deals < THIN_COVERAGE_THRESHOLD or files < THIN_COVERAGE_THRESHOLD:
            subject = 'мало данных — выводы ненадёжны'
        else:
            subject = 'покрытие достаточное'

        result.append(
            Finding(
                cls=16,
                funnel=label_of(row),
                tag_type='',
                subject=subject,
                detail=f'{deals} наблюдений из {files} файлов',
                evidence=row.status,
                first_seen='',
                last_seen=str(last) if last else '',
                deals=deals,
            )
        )
    return result
