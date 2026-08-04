import combo


def test_key_of_собирает_пятёрку_в_порядке_осей():
    tags = frozenset({
        'АВ Продукт: ДБО', 'АВ Подрядчик: NR',
        'АВ Канал: ВК', 'АВ Направление: In Stream',
        'АВ Автоворонка', 'АВ Этап: Регистрация',
    })
    assert combo.key_of(tags) == ('ДБО', 'NR', 'ВК', 'In Stream', 'АВ Автоворонка')
    assert combo.is_complete(combo.key_of(tags))


def test_key_of_ставит_none_на_отсутствующую_ось():
    tags = frozenset({'АВ Продукт: БОО', 'АВ Канал: Сайт',
                      'АВ Направление: СЕО', 'АВ Подрядчик: НИМБ'})
    key = combo.key_of(tags)
    assert key[4] is None
    assert not combo.is_complete(key)


def test_axis_conflicts_ловит_задвоенную_ось():
    """f55: у заказа сразу РСЯ и Реклама. av_value молча берёт меньшее,
    поэтому конфликт обязан ловиться отдельно — иначе он невидим."""
    tags = frozenset({
        'АВ Продукт: ЖИВО-суставы-триал', 'АВ Подрядчик: ИНХАУЗ',
        'АВ Канал: Яндекс', 'АВ Направление: РСЯ', 'АВ Направление: Реклама',
        'АВ Прямые',
    })
    assert combo.axis_conflicts(tags) == {'АВ Направление': ['РСЯ', 'Реклама']}


def test_axis_conflicts_пуст_когда_конфликтов_нет():
    tags = frozenset({'АВ Продукт: ДБО', 'АВ Канал: ВК'})
    assert combo.axis_conflicts(tags) == {}


def test_axis_conflicts_ловит_два_маркера_типа():
    tags = frozenset({'АВ Автоворонка', 'АВ Прямые'})
    assert combo.axis_conflicts(tags) == {'тип воронки': ['АВ Автоворонка', 'АВ Прямые']}


def test_label_помечает_пропуски_тире():
    assert combo.label(('ДБО', None, 'ВК', 'In Stream', 'АВ Автоворонка')) == \
        'ДБО / — / ВК / In Stream / АВ Автоворонка'
