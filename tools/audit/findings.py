#!/usr/bin/env python3
"""Шестнадцать классов находок.

Чистые функции: принимают готовые коллекции, возвращают list[Finding].
Ничего не читают с диска и из сети — поэтому тестируются без моков.
"""

from collections import Counter, defaultdict
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
    is_av_tag,
    is_complete_key,
    is_complete_quad,
    is_external_tag,
    key_label,
    quad,
)
from retired import is_retired

CLASS_TITLES = {
    1: 'Тег ожидается в базе, но в GetCourse отсутствует',
    2: 'Ось есть в GetCourse, но её нет в словаре базы',
    3: 'Этап не поддержан моделью базы',
    4: 'Противоречивые легаси-теги на одном предложении',
    5: 'Тип не выводится: оплата без АВ Время или нет АВ Этап',
    6: 'Этап Предписок — типа в модели базы нет',
    7: 'Полный АВ-ключ (четвёрка + маркер) есть в заказах, но воронки в базе нет',
    8: 'Коллизия АВ-ключа',
    9: 'Полный АВ-ключ (четвёрка + маркер) есть в GetCourse, но нет ни одной воронки',
    10: 'Предложение с неполной АВ-четвёркой',
    11: 'Ось есть в GetCourse, но отсутствует в словаре базы целиком',
    12: 'Предложение с АВ Этап, но без маркера типа воронки',
    13: 'Воронка active, но ни одного наблюдения за период',
    14: 'Предложение с АВ-тегами и нулём заказов — кандидат в архив',
    15: 'Дрейф разметки АВ: тег появился у всей четвёрки или исчез у всей',
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


def observed_keys_of(groups):
    """Полные АВ-четвёрки, по которым в выгрузках есть заказы."""
    return {g.key for g in groups if is_complete_key(g.key)}


def registry_keys_of(offers):
    """Полные АВ-четвёрки, которые есть в реестре GetCourse ПРЯМО СЕЙЧАС.

    Реестр — это настоящее, выгрузки — прошлое. Разница между ними и позволяет
    отличить воронку без записи в базе от разметки, которая когда-то была и
    давно исправлена (см. find_unresolved).
    """
    result = set()
    for offer in offers:
        key = av_key(offer.tags)
        if is_complete_key(key):
            result.add(key)
    return result


def registry_av_tags(offers):
    """АВ-теги, которые встречаются в реестре GetCourse ПРЯМО СЕЙЧАС.

    То же разделение времён, что и у registry_keys_of, но на уровне тега.
    Нужно классу 2: он читает выгрузки, а «Теги предложений» вычисляются в
    момент выгрузки, поэтому файл вечно хранит разметку того дня. На прогоне
    2026-07-27 так висели три уже исправленных тега: `АВ Направление: Перелив
    с СВС` (в реестре теперь `С СВС`), `АВ продукт: ЖКТ-4вр` со строчной «п»
    (теперь `АВ Продукт:`) и легаси `АВ / Мессенджер` (вычищен целиком).
    Чинить нечего — в GetCourse этих тегов больше нет.
    """
    return {tag for offer in offers for tag in offer.tags if tag.startswith('АВ ')}


def last_order_dates(observations):
    """АВ-СВЯЗКА (четвёрка, не полный ключ) → дата последнего ЗАКАЗА, ISO-строка.

    Ключ — именно quad(av_key(...)), а не полный пятиэлементный ключ: отставка
    (retired.RETIRED_KEYS) решается по связке целиком, независимо от маркера
    типа воронки, поэтому и дата последнего заказа должна собираться по той же
    связке — иначе два наблюдения одной связки с разными (или отсутствующими)
    маркерами разъедутся по разным записям словаря, и is_retired получит
    неполную историю заказов.

    Именно дата заказа, а не дата файла выгрузки: отставка снимается тем, что
    связка снова продала, а не тем, что её застали в свежем срезе. Пустые и
    неразбираемые даты не отбрасываются — они доезжают до `is_retired`, который
    трактует их как «заказ был позже» и снимает отставку (fail-open).
    """
    result = {}
    for obs in observations:
        key = quad(av_key(obs.tags))
        if not is_complete_quad(key):
            continue
        created = (obs.deal_created or '').strip()
        current = result.get(key)
        if current is None or created > current:
            result[key] = created
    return result


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


def find_extra_axes(groups, vocabulary, order_dates=None, registry_tags=frozenset()):
    """Класс 2: в наблюдении есть АВ-тег, которого база не знает.

    В отличие от классов 1 и 4, этому классу тип (tag_type) не нужен вообще
    — он ищет неизвестные АВ-теги независимо от того, выводится ли этап.
    Поэтому свёртка идёт через _latest_by_stage_family, а не _latest_groups:
    последняя выбрасывает группы с tag_type is None (например, без АВ Этап
    или с непонятым этапом), и такие группы — включая ровно те, что несут
    неизвестные базе оси вроде 'АВ Время: 20' — тихо пропадали бы из отчёта.

    Теги из EXTERNAL_TAG_PREFIXES пропускаются: база их не знает намеренно.
    Маркеры типа воронки, наоборот, НЕ пропускаются, но с 2026-07-28 это уже
    не пробел модели: пятая ось умеет выражать все четыре маркера, и находка
    здесь означает не «база не умеет», а «этой конкретной воронке маркер не
    проставлен» (или воронки нет вовсе) — то есть отсутствующие данные,
    а не отсутствующая возможность.

    Ещё три фильтра, каждый повторяет решение, уже принятое в другом классе.
    Вместе они убирали 43 находки из 46 на прогоне 2026-07-27.

    Отставленные связки (`retired.RETIRED_KEYS`) — как в классах 7, 9, 14, 15.
    Тридцать находок были ровно ими: `АВ Подрядчик: Илья`, `АВ Направление:
    Реклама Мир`, `АВ Канал: ТГ`, `АВ Продукт: ЗП`. Словарь базы их не знает
    именно потому, что воронок под них нет — они отработали. Без общего фильтра
    отставка просто переезжает из класса в класс.

    Этапы (`АВ Этап:`) — ими владеют классы 3 (сводка) и 6 (детально по
    связкам). Девять находок были `АВ Этап: Предписок`, то есть третьим
    показом одного и того же на третьем листе отчёта.

    Теги, которых нет в текущем реестре (`registry_tags`) — как `registry_keys`
    в find_unresolved, и по той же причине: см. registry_av_tags. Пустой
    `registry_tags` отключает фильтр целиком, чтобы прогон с `--no-api` не
    прятал молча половину класса.
    """
    order_dates = order_dates or {}
    result = []
    for group in _latest_by_stage_family(groups):
        # RETIRED_KEYS и order_dates индексированы СВЯЗКОЙ (quad), а не полным
        # пятиэлементным ключом — см. предупреждение в retired.py. Передать
        # сюда group.key напрямую значит, что ни одна запись отставки никогда
        # не совпадёт: пятёрка не равна четвёрке ни при каком маркере.
        if is_retired(quad(group.key), order_dates.get(quad(group.key))):
            continue
        unknown = sorted(
            tag for tag in group.tags
            if tag.startswith('АВ ') and tag not in vocabulary
            and not is_external_tag(tag)
            and not tag.startswith(STAGE_PREFIX + ':')
            and (not registry_tags or tag in registry_tags)
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
        # Общий тег и его собственное уточнение — не противоречие: `ВК NR`
        # означает «направление не уточнено», `ВК NR IS` — уточнено. Правило
        # ловило их парой, потому что общий тег сам начинается с префикса из
        # списка; так набиралась 21 находка из 27. Оставляем только самые
        # уточнённые теги: противоречие — это два РАЗНЫХ уточнения сразу.
        legacy = [
            tag for tag in legacy
            if not any(other != tag and other.startswith(tag + ' ') for other in legacy)
        ]
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


def find_unresolved(groups, index, registry_keys=frozenset(), order_dates=None):
    """Классы 5, 6, 7 — взаимоисключающие причины неопознания.

    Каждая неопознанная группа попадает ровно в один класс.

    **Отставленные связки (`retired.RETIRED_KEYS`) не попадают ни в один.**
    Проверка стоит в начале цикла и потому накрывает все три класса разом:
    разметку связки, объявленной отработавшей, чинить незачем, каким бы
    именно способом она ни была сломана. Класс 7 задаёт тот же вопрос, что и
    класс 9 («воронки под эту четвёрку нет»), но по другому источнику: 9
    читает реестр GetCourse, 7 — историю выгрузок; без общего фильтра
    отставленная связка просто переезжает из класса в класс. Правило по дате
    то же: продала после решения — вернётся. На прогоне 2026-07-27 в классе 5
    так висели 11 находок из 37 — шестое место с тем же предикатом после
    классов 2, 7, 9, 11, 14 и 15.

    Класс 7 отсеивает вдобавок четвёрки, которых НЕТ в текущем реестре
    (`registry_keys`).
    «Теги предложений» вычисляются в момент выгрузки, поэтому файл хранит
    разметку такой, какой она была в тот день. Если тег в тот же день починили,
    старый файл несёт исчезнувшую четвёрку вечно — на живых данных так выглядели
    `БОО / НИМБ / Яндекс / Реклама` и `ДБО / НИМБ / Яндекс / Реклама`: один файл
    от 2026-05-20, 6 и 9 наблюдений, и больше нигде. Это слепок одного дня у
    воронок f6/f7, а не воронки без записи. Находка «заведите воронку» тут
    бессмысленна: заводить не подо что, и починить прошлое нельзя.

    Осознанный побочный эффект второго фильтра: если предложение УДАЛИЛИ из
    GetCourse, а заказы по нему шли, находка тоже исчезнет. Это верно по сути —
    под удалённое предложение воронку не заводят.

    `registry_keys` по умолчанию пуст, и тогда второй фильтр не работает вовсе
    (ни одна четвёрка не будет сочтена исторической) — прогон без обращения к
    API (`--no-api`) не должен молча прятать половину класса 7.
    """
    order_dates = order_dates or {}
    result = []
    for group in _latest_by_stage_family(groups):
        # Отставка — по связке (quad), см. предупреждение в retired.py: полный
        # ключ (с маркером) никогда не совпадёт ни с одной записью RETIRED_KEYS.
        if is_retired(quad(group.key), order_dates.get(quad(group.key))):
            continue

        if group.reason == 'no_time':
            cls, subject = 5, 'Оплата без АВ Время'
        elif group.reason == 'predpisok':
            cls, subject = 6, 'Этап Предписок'
        elif group.reason == 'no_stage':
            cls, subject = 5, 'Нет АВ Этап — тип не выводится'
        elif is_complete_key(group.key) and group.key not in index:
            if registry_keys and group.key not in registry_keys:
                continue
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


def find_unknown_av_keys(offers, index, order_dates):
    """Класс 9: четвёрка живёт в GetCourse, а воронки под неё в базе нет.

    Отставленные четвёрки (`retired.RETIRED_KEYS`) пропускаются — но только пока
    после даты решения по ним не было заказов. `order_dates` — результат
    `last_order_dates(observations)`; заказ позже даты отставки возвращает
    связку в отчёт.
    """
    counts = defaultdict(list)
    for offer in _offers_with_av(offers):
        key = av_key(offer.tags)
        # Полный ключ (не quad): здесь речь именно о ВОРОНКЕ конкретного типа,
        # а не о связке — без маркера нельзя понять, под какой ИМЕННО тип
        # (автоворонка? квиз?) искать funnel в index.
        if not is_complete_key(key) or key in index:
            continue
        # А вот отставка — по связке (см. предупреждение в retired.py).
        if is_retired(quad(key), order_dates.get(quad(key))):
            continue
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
    """Класс 10: у предложения с АВ-тегами четвёрка (СВЯЗКА) неполна.

    Проверяется именно quad, а не полный пятиэлементный ключ: класс 10 — про
    пропущенную ОСЬ, а про пропущенный МАРКЕР типа воронки уже отдельно
    отчитывается класс 12. Проверять здесь is_complete_key означало бы, что
    единственное предложение без маркера (но с полной четвёркой) попадало бы
    сразу в оба класса про один и тот же факт.

    Из того же соображения `missing` вычисляется по quad(key), а не по key:
    у key теперь пять элементов, а в AXES их четыре — enumerate(key) отдал бы
    AXES[4] и упал бы с IndexError на первом же предложении без маркера.
    """
    result = []
    for offer in _offers_with_av(offers):
        key = av_key(offer.tags)
        if is_complete_quad(key):
            continue
        missing = [AXES[i] for i, part in enumerate(quad(key)) if part is None]
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


def find_unknown_axes_in_registry(offers, vocabulary, order_dates=None):
    """Класс 11: ось есть в реестре, но её нет в словаре базы целиком.

    Маркеры типа воронки исключены: двоеточия в них нет, поэтому разбор
    «часть до двоеточия» выдавал весь тег за имя новой оси, и «АВ Прямые»,
    «АВ Квиз», «АВ Квиз-Лайт» попадали сюда как три неизвестные оси.

    Теги из EXTERNAL_TAG_PREFIXES тоже исключены: база их не знает намеренно,
    так что это не расхождение (см. комментарий в normalize).

    Этапы исключены — ими владеют классы 3 и 6, как и в классе 2.

    Отставленные связки пропускаются, как в классах 2, 7, 9, 14, 15. Замер
    2026-07-27: из 24 неизвестных базе значений 20 не встречались НИ НА ОДНОМ
    предложении живой связки — только на отставленных. Самые громкие
    (`АВ Подрядчик: Илья` на 313 предложениях, `АВ Направление: Реклама Мир`
    на 241) целиком оттуда, и без фильтра они держали класс на четырёх сотнях
    предложений, топя четыре живых значения.
    """
    order_dates = order_dates or {}
    counts = defaultdict(set)
    for offer in _offers_with_av(offers):
        key = av_key(offer.tags)
        # Отставка — по связке; см. предупреждение в retired.py.
        if is_retired(quad(key), order_dates.get(quad(key))):
            continue
        for tag in offer.tags:
            if (tag.startswith('АВ ') and tag not in vocabulary
                    and tag not in MARKER_TAGS and not is_external_tag(tag)
                    and not tag.startswith(STAGE_PREFIX + ':')):
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

    Отставленные четвёрки (`retired.RETIRED_KEYS`) пропускаются: решение «связка
    больше не крутится» уже принято, и повторять его каждым прогоном не нужно.
    """
    observed_keys = observed_keys_of(groups)

    result = []
    for offer in _offers_with_av(offers):
        key = av_key(offer.tags)
        if not is_complete_key(key) or key in observed_keys:
            continue
        # Дату не передаём: сюда доходят только четвёрки с нулём заказов.
        # Отставка — по связке (quad), не по полному ключу: см. retired.py.
        if is_retired(quad(key)):
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


def find_drift(observations, index, expectations, order_dates=None):
    """Класс 15: разметка АВ-таксономии у пары (ключ × тип) менялась между выгрузками.

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

    Учитываются ТОЛЬКО теги словаря АВ-таксономии (`is_av_tag`). Маркетинговая
    разметка GetCourse — `ОТО`, `big-course`, `допродажи`, названия лендов —
    в базе воронок не хранится, расходиться там нечему, а её переключения
    давали 68 находок из 103 на прогоне 2026-07-27 и топили остальные.
    Тем же фильтром уходят `АВ Мессенджер:` (свойство заказа, а не воронки)
    и легаси-тег «АВ / Мессенджер», вычищенный из GetCourse в июле 2026:
    его пропажу класс показывал 24 раза, по разу на воронку.

    Дрейфом считается только ЕДИНОГЛАСНАЯ смена: тег был у ВСЕХ наблюдений
    слота на старой дате и НИ У ОДНОГО на новой (или наоборот). Сосуществование
    двух разметок на одной дате — не дрейф, а смешанный слот. Прежнее правило
    брало «самый частый набор за день», и на слоте с двумя постоянными
    популяциями (у `ЖКТ / NR / ВК / Реклама` это 6633 обычных наблюдения
    против 126 квизовых, и так на КАЖДОЙ дате) большинство переворачивалось
    вместе с шириной сегмента выгрузки — скрипт отчитывался о смене типа
    воронки, которой не было. Порог тут не нужен и вреден: «у всех» и
    «ни у одного» не зависят от того, насколько полон срез.

    Отставленные четвёрки пропускаются по тому же правилу, что в классах 7,
    9 и 14 (`is_retired` + дата последнего заказа). Как разметили в мае связку,
    которую владелец объявил отработавшей, поправить уже нельзя и незачем;
    без этого фильтра отставка «переезжала» из класса в класс. `order_dates`
    по умолчанию `None` — тогда отставка считается безусловной, как и в
    классе 14, где нулевое число заказов установлено отдельно.

    ⚠️ С 2026-07-28 `av_key` — пятиэлементный (четыре оси + маркер типа
    воронки), и `slots` группирует ИМЕННО по нему. Значит смена маркера
    у связки (не разметки внутри одного типа, а перехода между двумя
    воронками одной четвёрки) уводит наблюдения в другой слот — у каждого
    из двух слотов остаётся одна дата в timeline, и оба гасятся фильтром
    `len(timeline) < 2` ниже, до правила «единогласной смены». Сигнал не
    пропадает целиком: он переезжает в классы 7/9 («нет воронки для такого
    ключа»), в более сильной формулировке. Но если ОБЕ воронки перехода уже
    есть в базе — сегодня это `f33`/`f43`, связка `ЖИВО / НИМБ / Яндекс / РСЯ`,
    — не срабатывает ничего: ни 7, ни 13, ни 15. Принятый размен (см.
    tools/audit/README.md), не баг этого класса — чинить не нужно.
    """
    if order_dates is None:
        order_dates = {}
    by_id = _by_funnel_id(expectations)

    # (ключ, tag_type) -> file_date -> список наборов тегов (по наблюдению)
    slots = defaultdict(lambda: defaultdict(list))
    for o in observations:
        tag_type, _reason = classify(o.tags)
        if tag_type is None:
            continue
        slots[(av_key(o.tags), tag_type)][o.file_date].append(o.tags)

    result = []
    for (key, tag_type), by_date in sorted(
        slots.items(), key=lambda kv: (key_label(kv[0][0]), kv[0][1])
    ):
        # Отставка — по связке; см. предупреждение в retired.py.
        if is_retired(quad(key), order_dates.get(quad(key))):
            continue
        timeline = []
        for file_date in sorted(by_date.keys()):
            tagsets = by_date[file_date]
            counts = Counter(
                tag for tagset in tagsets for tag in tagset if is_av_tag(tag)
            )
            deals = len(tagsets)
            # everywhere — тег у всех наблюдений даты; anywhere — хотя бы у одного.
            everywhere = frozenset(t for t, c in counts.items() if c == deals)
            anywhere = frozenset(counts)
            timeline.append((file_date, everywhere, anywhere, deals))

        if len(timeline) < 2:
            continue

        # Итог всей истории слота: что реально ушло и что реально пришло.
        # Тег, которого нет ни в одном из этих множеств, за время наблюдения
        # вернулся к прежнему состоянию — это переключение разметки туда и
        # обратно, а не её потеря. Без такого разделения переключения топят
        # настоящие пропажи.
        net_gone = timeline[0][1] - timeline[-1][2]
        net_new = timeline[-1][1] - timeline[0][2]

        for (older_date, older_all, older_any, older_deals), (
            newer_date,
            newer_all,
            newer_any,
            newer_deals,
        ) in zip(timeline, timeline[1:]):
            appeared = sorted(newer_all - older_any)
            disappeared = sorted(older_all - newer_any)
            if not appeared and not disappeared:
                continue
            parts = []
            if appeared:
                parts.append('появился: ' + ', '.join(appeared))
            if disappeared:
                parts.append('исчез: ' + ', '.join(disappeared))

            net_here = sorted((set(appeared) & net_new) | (set(disappeared) & net_gone))
            if net_here:
                parts.append('нетто за весь период: ' + ', '.join(net_here))
            else:
                parts.append('переключение — набор вернулся к прежнему виду')
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
