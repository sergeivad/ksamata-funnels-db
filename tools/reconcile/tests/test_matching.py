import db_source
import matching
import sheet_source


def make_funnel(label, key, landings=(), contractor='', product='',
                status='active'):
    return db_source.Funnel(
        funnel_id=abs(hash(label)) % 1000, front_code=label, status=status,
        label=label, key=key, landings=tuple(landings),
        contractor=contractor, product=product)


F69 = make_funnel('f69', ('БОО', 'НИМБ', 'Сайт', 'СЕО', 'АВ Автоворонка'))
F8 = make_funnel('f8', ('ЖКТ', 'НИМБ', 'Яндекс', 'РСЯ', 'АВ Автоворонка'))
FUNNELS = [F69, F8]


def test_nearest_находит_воронку_без_маркера_типа():
    """454 заказа «Сайт / СЕО / НИМБ / БОО» — это f69 без типа в разметке."""
    near = matching.nearest(('БОО', 'НИМБ', 'Сайт', 'СЕО', None), FUNNELS)
    assert near.funnel is F69
    assert near.distance == 1
    assert near.diff == [('тип воронки', None, 'АВ Автоворонка')]


def test_nearest_находит_воронку_с_чужим_маркером():
    """24 заказа с «АВ Прямые» — это f8, размеченная как автоворонка."""
    near = matching.nearest(('ЖКТ', 'НИМБ', 'Яндекс', 'РСЯ', 'АВ Прямые'),
                            FUNNELS)
    assert near.funnel is F8
    assert near.distance == 1


def test_nearest_молчит_когда_похожего_нет():
    """RedBananas на канале ТГ — действительно новая воронка."""
    key = ('ДБО', 'RedBananas', 'ТГ', 'Реклама', 'АВ Автоворонка')
    assert matching.nearest(key, FUNNELS) is None


def test_nearest_молчит_при_расхождении_в_двух_осях():
    """Две разошедшиеся оси — это другая воронка, а не ошибка разметки.
    Замер 04.08: «ДБО / RedBananas / ТГ» подавался как «похоже на #18»,
    хотя отличался и подрядчиком, и каналом."""
    ht = make_funnel('#18', ('ДБО', 'HT', 'ВК', 'Реклама', 'АВ Автоворонка'))
    key = ('ДБО', 'RedBananas', 'ТГ', 'Реклама', 'АВ Автоворонка')
    assert matching.nearest(key, [ht]) is None


def test_nearest_предпочитает_расхождение_по_типу_а_не_по_продукту():
    """Замер 04.08: связку «ЖКТ / … / АВ Прямые» относило к f45 (другой
    продукт) вместо f8 (тот же продукт, отличается только тип) — обе на
    расстоянии одной оси, и спор разрешал алфавит метки."""
    f45 = make_funnel('f45', ('ЖИВО-суставы', 'НИМБ', 'Яндекс', 'РСЯ',
                              'АВ Прямые'))
    key = ('ЖКТ', 'НИМБ', 'Яндекс', 'РСЯ', 'АВ Прямые')
    assert matching.nearest(key, [f45, F8]).funnel is F8


def test_nearest_сортирует_метки_по_числу_а_не_по_алфавиту():
    """'f45' лексикографически меньше 'f8' — сравнивать надо номера."""
    a = make_funnel('f45', ('ДБО', 'НИМБ', 'Яндекс', 'РСЯ', 'АВ Прямые'))
    b = make_funnel('f8', ('ДБО', 'НИМБ', 'Яндекс', 'РСЯ', 'АВ Квиз'))
    key = ('ДБО', 'НИМБ', 'Яндекс', 'РСЯ', 'АВ Автоворонка')
    assert matching.nearest(key, [a, b]).funnel is b


def test_match_sheet_row_ступень_кода_когда_лендинга_нет():
    """У строки 5 в ячейке «Посадочная» название продукта, а не адрес.
    Без ступени кода F37 попадала в «строк таблицы без воронки»."""
    funnel = make_funnel('f37', ('БОО', 'НИМБ', 'Ютуб', 'Органика', None))
    row = sheet_source.SheetRow(5, 'f37', 'Ютуб органика',
                                'БЕЗОПАСНОЕ ОЧИЩЕНИЕ', 'Работает', ())
    result = matching.match_sheet_row(row, [funnel])
    assert result.funnel is funnel and result.tier == 'front_code'


def test_nearest_возвращает_точное_совпадение_с_расстоянием_ноль():
    near = matching.nearest(F8.key, FUNNELS)
    assert near.funnel is F8 and near.distance == 0


def test_match_sheet_row_первая_ступень_лендинг():
    funnel = make_funnel('f37', ('БОО', 'НИМБ', 'Ютуб', 'Органика', None),
                         landings=['t.ksamata.ru/boo/a'])
    row = sheet_source.SheetRow(5, '', 'Ютуб органика', 'БОО', 'Работает',
                                ('t.ksamata.ru/boo/a',))
    result = matching.match_sheet_row(row, [funnel])
    assert result.funnel is funnel and result.tier == 'landing'


def test_match_sheet_row_вторая_ступень_подрядчик_и_продукт():
    """Совпадение по второй ступени — САМО ПО СЕБЕ находка: лендинг разошёлся."""
    funnel = make_funnel('f37', ('БОО', 'НИМБ', 'Ютуб', 'Органика', None),
                         landings=['t.ksamata.ru/old'],
                         contractor='Ютуб органика', product='БОО')
    row = sheet_source.SheetRow(5, '', 'Ютуб органика', 'БОО', 'Работает',
                                ('t.ksamata.ru/new',))
    result = matching.match_sheet_row(row, [funnel])
    assert result.funnel is funnel and result.tier == 'contractor_product'


def test_match_sheet_row_не_находит_ничего():
    row = sheet_source.SheetRow(9, '', 'ВК NR', 'ЖИВО Суставы 490р',
                                'Работает', ('t.ksamata.ru/jivo/trial/nr/a',))
    result = matching.match_sheet_row(row, [])
    assert result.funnel is None and result.tier is None
