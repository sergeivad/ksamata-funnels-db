import os
import subprocess
import sys

import pytest

from normalize import (
    AUTOFUNNEL_TAG,
    LEGACY_AUTOFUNNEL_TAG,
    av_key,
    av_value,
    classify,
    fold,
    is_complete_key,
    key_label,
    normalize_tag,
    parse_tagset,
)


def test_normalize_trims_and_collapses_spaces():
    assert normalize_tag('  АВ   Продукт:  ДБО  ') == 'АВ Продукт: ДБО'


def test_normalize_applies_nfc():
    # 'й' как 'и' + U+0306 должен схлопнуться в единый кодпоинт
    decomposed = 'Лине' + 'й' + 'ка'
    assert decomposed != 'Линейка'
    assert normalize_tag(decomposed) == 'Линейка'


def test_parse_tagset_splits_on_pipe_and_drops_empties():
    assert parse_tagset('ДБО| РСЯ ||АВ Продукт: ДБО|') == frozenset(
        {'ДБО', 'РСЯ', 'АВ Продукт: ДБО'}
    )


def test_parse_tagset_handles_none_and_blank():
    assert parse_tagset(None) == frozenset()
    assert parse_tagset('   ') == frozenset()


def test_fold_is_case_insensitive_but_normalize_keeps_original():
    assert fold('АВ Автоворонка') == fold('ав автоворонка')
    assert normalize_tag('АВ Автоворонка') == 'АВ Автоворонка'


def test_av_value_extracts_axis():
    tags = frozenset({'АВ Продукт: ДБО', 'АВ Канал: ВК'})
    assert av_value(tags, 'АВ Продукт') == 'ДБО'
    assert av_value(tags, 'АВ Подрядчик') is None


def test_av_key_returns_four_axes_in_order():
    tags = parse_tagset(
        'АВ Продукт: ДБО|АВ Подрядчик: NR|АВ Канал: ВК|АВ Направление: In Stream'
    )
    assert av_key(tags) == ('ДБО', 'NR', 'ВК', 'In Stream')
    assert is_complete_key(av_key(tags)) is True


def test_av_key_marks_incomplete():
    tags = parse_tagset('АВ Продукт: ДБО|АВ Канал: ВК')
    key = av_key(tags)
    assert key == ('ДБО', None, 'ВК', None)
    assert is_complete_key(key) is False


def test_key_label_is_readable_and_marks_gaps():
    assert key_label(('ДБО', None, 'ВК', 'РСЯ')) == 'ДБО / — / ВК / РСЯ'


@pytest.mark.parametrize(
    'raw,expected_type',
    [
        ('АВ Этап: Регистрация|АВ Продукт: ДБО', 'reg'),
        ('АВ Этап: Мессенджер|АВ Продукт: ДБО', 'messenger'),
        ('АВ Этап: Оплата|АВ Время: 19', 'time_19'),
        ('АВ Этап: Оплата|АВ Время: 15', 'time_15'),
    ],
)
def test_classify_returns_tag_type(raw, expected_type):
    tag_type, reason = classify(parse_tagset(raw))
    assert tag_type == expected_type
    assert reason is None


@pytest.mark.parametrize(
    'raw,expected_reason',
    [
        ('АВ Этап: Оплата|АВ Продукт: ДБО', 'no_time'),
        ('АВ Этап: Предписок|АВ Продукт: ДБО', 'predpisok'),
        ('АВ Продукт: ДБО|ДБО', 'no_stage'),
    ],
)
def test_classify_returns_reason_when_type_undecidable(raw, expected_reason):
    tag_type, reason = classify(parse_tagset(raw))
    assert tag_type is None
    assert reason == expected_reason


def test_predpisok_spelling_is_exact_and_legacy_variant_is_distinct():
    # Легаси 'предсписок' — ДРУГОЙ тег, автоматически не сводится (спек, «Нормализация»).
    tag_type, reason = classify(parse_tagset('предсписок|АВ Продукт: ДБО'))
    assert reason == 'no_stage'


def test_autofunnel_constants_are_distinct():
    assert AUTOFUNNEL_TAG == 'АВ Автоворонка'
    assert LEGACY_AUTOFUNNEL_TAG == 'автоворонки'
    assert fold(AUTOFUNNEL_TAG) != fold(LEGACY_AUTOFUNNEL_TAG)


def test_av_value_is_deterministic_when_axis_has_two_values():
    """Регрессия: старая реализация шла циклом `for tag in tags: return
    первый совпавший` по frozenset. Если набору соответствует два тега одной
    оси (например 'АВ Продукт: ДБО' и 'АВ Продукт: ЖКТ'), результат зависел
    от порядка обхода множества, а он недетерминирован МЕЖДУ ПРОЦЕССАМИ
    из-за рандомизации хеша строк (PYTHONHASHSEED). Контракт: при конфликте
    возвращается лексикографически наименьшее значение оси.

    Внутри одного процесса (один hash seed) старая реализация вполне может
    случайно каждый раз обходить set в одном и том же порядке — поэтому
    достаточно всего лишь построить набор из разных перестановок вставки
    (это ничего не гарантирует, т.к. hash seed один и тот же) и всего один
    прогон это не ловит надёжно. Поэтому здесь тот же набор тегов с
    конфликтом по оси «АВ Продукт» прогоняется дважды: сначала прямым
    вызовом на двух эквивалентных frozenset, построенных в разном порядке
    вставки, а затем в отдельных дочерних процессах с разными значениями
    PYTHONHASHSEED — и в обоих случаях av_value обязана вернуть одно и то
    же (правильное) значение. На старой реализации второй шаг падает:
    результаты по разным seed-ам расходятся между 'ДБО' и 'ЖКТ'.
    """
    # Шаг 1: та же ось, тот же конфликт, но собранный в разном порядке.
    tags_a = parse_tagset('АВ Продукт: ЖКТ|АВ Продукт: ДБО|АВ Канал: ВК')
    tags_b = parse_tagset('АВ Канал: ВК|АВ Продукт: ДБО|АВ Продукт: ЖКТ')
    assert av_value(tags_a, 'АВ Продукт') == 'ДБО'
    assert av_value(tags_b, 'АВ Продукт') == 'ДБО'

    # Шаг 2: тот же набор в дочерних процессах с разным PYTHONHASHSEED —
    # это фактический источник недетерминизма, описанный в дефекте.
    audit_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    script = (
        "from normalize import parse_tagset, av_value\n"
        "tags = parse_tagset('АВ Продукт: ЖКТ|АВ Продукт: ДБО|АВ Канал: ВК')\n"
        "print(av_value(tags, 'АВ Продукт'))\n"
    )

    results = set()
    for seed in range(12):
        env = dict(os.environ, PYTHONHASHSEED=str(seed))
        proc = subprocess.run(
            [sys.executable, '-c', script],
            cwd=audit_dir,
            env=env,
            capture_output=True,
            text=True,
            check=True,
        )
        results.add(proc.stdout.strip())

    assert results == {'ДБО'}
