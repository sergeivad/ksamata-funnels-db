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
        ('АВ Этап: Предписок|АВ Продукт: ДБО', 'predspisok'),
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
