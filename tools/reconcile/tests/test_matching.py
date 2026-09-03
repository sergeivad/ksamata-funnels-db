import funnels_source
import matching
import sheet_source


def make_funnel(label, key, landings=(), source='', product='',
                status='active'):
    return funnels_source.Funnel(
        funnel_id=abs(hash(label)) % 1000, front_code=label, status=status,
        label=label, key=key, landings=tuple(landings),
        source=source, product=product)


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


def test_match_sheet_row_третья_ступень_источник_и_продукт():
    """Совпадение по третьей ступени — САМО ПО СЕБЕ находка: лендинг разошёлся."""
    funnel = make_funnel('f37', ('БОО', 'НИМБ', 'Ютуб', 'Органика', None),
                         landings=['t.ksamata.ru/old'],
                         source='Ютуб органика', product='БОО')
    row = sheet_source.SheetRow(5, '', 'Ютуб органика', 'БОО', 'Работает',
                                ('t.ksamata.ru/new',))
    result = matching.match_sheet_row(row, [funnel])
    assert result.funnel is funnel and result.tier == 'source_product'


def test_третья_ступень_сверяет_ИСТОЧНИК_а_не_подрядчика():
    """Регресс, из-за которого ступень молчала два года.

    В колонке таблицы «подрядчик» лежат ИСТОЧНИКИ («ВК NR», «Ютуб органика»,
    «Яндекс РСЯ»), а сверялись они с `contractors.name` («NR», «НИМБ»,
    «Внутренний»). Замер 2026-09-03: пересечение словарей РОВНО ноль, то есть
    ступень не могла сработать ни на одной из 68 строк — не «редко», а
    никогда.

    Прошлый тест этого не ловил, потому что сам подавал источник в поле
    подрядчика: фикстура повторяла замысел автора, а не то, что лежит в базе.
    Поэтому здесь имя подрядчика подаётся ЯВНО и совпадения быть не должно.
    """
    funnel = make_funnel('f16', ('БОО', 'NR', 'ВК', 'In Stream', None),
                         source='ВК NR', product='БОО')
    row = sheet_source.SheetRow(25, '', 'NR', 'БОО', 'Стоп', ())
    assert matching.match_sheet_row(row, [funnel]).funnel is None


def test_третья_ступень_молчит_на_неоднозначности():
    """Две воронки на одну пару — не повод выбрать первую по порядку.

    Пар (источник, продукт) в базе 68, неуникальных 7 — например «ВК NR + ДБО»
    держат f11, f15, f64 и f86. Выбор по порядку обхода дал бы молча неверную
    воронку; отказ оставляет строку в разделе «без воронки», что честно.
    """
    a = make_funnel('f11', ('ДБО', 'NR', 'ВК', 'A', None), source='ВК NR', product='ДБО')
    b = make_funnel('f15', ('ДБО', 'NR', 'ВК', 'B', None), source='ВК NR', product='ДБО')
    row = sheet_source.SheetRow(30, '', 'ВК NR', 'ДБО', 'Работает', ())
    result = matching.match_sheet_row(row, [a, b])
    assert result.funnel is None and result.tier is None


def test_третья_ступень_сжимает_пробелы_и_табы():
    """Таблицу набирают руками, и это видно: источник «Яндекс Директ  (холод)»
    несёт двойной пробел в ОБОИХ источниках, а ячейка продукта строки 30 —
    двадцать шесть табов в хвосте. Сравнение по сырой строке тут ломается на
    невидимом символе."""
    funnel = make_funnel('f21', ('СВС', 'Алексей', 'Яндекс', 'Холод', None),
                         source='Яндекс Директ  (холод)', product='СВС')
    row = sheet_source.SheetRow(7, '', 'Яндекс Директ (холод)', 'СВС \t\t',
                                'Работает', ())
    result = matching.match_sheet_row(row, [funnel])
    assert result.funnel is funnel and result.tier == 'source_product'


def test_третья_ступень_ниже_лендинга_и_кода():
    """Порядок ступеней — порядок надёжности признака. Совпадение по лендингу
    обязано победить совпадение по источнику даже на другой воронке."""
    by_landing = make_funnel('f95', ('БОО', 'HT', 'ВК', 'A', None),
                             landings=['t.ksamata.ru/x'], source='ВК HomeTraffic',
                             product='БОО-ВК')
    by_pair = make_funnel('f16', ('БОО', 'NR', 'ВК', 'B', None),
                          source='ВК NR', product='БОО')
    row = sheet_source.SheetRow(25, '', 'ВК NR', 'БОО', 'Стоп',
                                ('t.ksamata.ru/x',))
    assert matching.match_sheet_row(row, [by_landing, by_pair]).tier == 'landing'


def test_match_sheet_row_не_находит_ничего():
    row = sheet_source.SheetRow(9, '', 'ВК NR', 'ЖИВО Суставы 490р',
                                'Работает', ('t.ksamata.ru/jivo/trial/nr/a',))
    result = matching.match_sheet_row(row, [])
    assert result.funnel is None and result.tier is None
