import datetime

import funnels_source
import decisions
import orders_source
import sections
import sheet_source

TODAY = datetime.date(2026, 8, 1)


def funnel(label, key, status='active', landings=(), source='', product='',
           start_date='2024-01-01'):
    return funnels_source.Funnel(
        funnel_id=abs(hash(label)) % 1000, front_code=label, status=status,
        label=label, key=key, landings=tuple(landings),
        source=source, product=product, start_date=start_date)


def stat(key, orders=10, paid=1, last='2026-07-31 10:00:00'):
    return orders_source.ComboStat(key=key, orders=orders, paid=paid,
                                   last_activity=last)


F8 = funnel('f8', ('ЖКТ', 'НИМБ', 'Яндекс', 'РСЯ', 'АВ Автоворонка'))


def test_связка_без_похожей_воронки_идёт_в_missing():
    key = ('ДБО', 'RedBananas', 'ТГ', 'Реклама', 'АВ Автоворонка')
    report = sections.build({key: stat(key)}, {'orders': 0, 'paid': 0},
                            [F8], [], [], TODAY)
    assert [item.key for item in report.missing] == [key]


def test_связка_с_похожей_воронкой_идёт_в_mislabelled():
    """Ошибка разметки в ГК — трек Р, а не недостающая воронка."""
    key = ('ЖКТ', 'НИМБ', 'Яндекс', 'РСЯ', 'АВ Прямые')
    report = sections.build({key: stat(key)}, {'orders': 0, 'paid': 0},
                            [F8], [], [], TODAY)
    assert report.missing == []
    assert report.mislabelled[0].near.funnel is F8


def test_решённая_связка_уходит_в_settled_и_не_в_missing():
    key = ('ЖКТ', 'НИМБ', 'Яндекс', 'РСЯ', 'АВ Квиз')
    rules = [decisions.Decision(
        id='quiz-not-tracked', match={'тип': ['АВ Квиз']},
        verdict='не заводим', why='решение 29.07', since='2026-07-29',
        _positions={4: ['АВ Квиз']})]
    report = sections.build({key: stat(key)}, {'orders': 0, 'paid': 0},
                            [], [], rules, TODAY)
    assert report.missing == [] and report.mislabelled == []
    assert [item.key for item in report.settled] == [key]


def test_неполная_связка_без_похожей_воронки_идёт_в_incomplete():
    """«ЖИВО» из одной оси не говорит, какой воронки не хватает — это дырка
    разметки в ГК. Разбор 04.08: три такие связки лежали в «не хватает
    воронок» и уводили разбор не туда."""
    key = ('ЖИВО', None, None, None, None)
    report = sections.build({key: stat(key)}, {'orders': 0, 'paid': 0},
                            [F8], [], [], TODAY)
    assert report.missing == []
    assert [item.key for item in report.incomplete] == [key]


def test_только_что_заведённая_воронка_в_кандидаты_на_архив_не_идёт():
    """f73, f74, f78 со стартом 2026-08-01 попали в кандидаты на архив,
    хотя выгрузка заканчивается 2026-08-01 01:48 и заказов у них быть
    ещё не могло."""
    fresh = funnel('f73', ('ЖИВО-суставы-триал', 'NR', 'ВК', 'Реклама',
                           'АВ Прямые'), start_date='2026-08-01')
    report = sections.build({}, {'orders': 0, 'paid': 0}, [fresh], [], [],
                            datetime.date(2026, 8, 4))
    assert report.dead == []


def test_пустая_дата_старта_молодостью_не_считается():
    """У большинства старых воронок дата не заполнена — иначе проверка
    перестала бы работать для них всех."""
    old = funnel('f70', ('ГП', 'НИМБ', 'Сайт', 'СЕО', 'АВ Автоворонка'),
                 start_date='')
    report = sections.build({}, {'orders': 0, 'paid': 0}, [old], [], [], TODAY)
    assert [item.funnel.label for item in report.dead] == ['f70']


def test_воронка_active_без_свежих_заказов_идёт_в_dead():
    old = funnel('f70', ('ГП', 'НИМБ', 'Сайт', 'СЕО', 'АВ Автоворонка'))
    report = sections.build({}, {'orders': 0, 'paid': 0}, [old], [], [], TODAY)
    assert [item.funnel.label for item in report.dead] == ['f70']


def test_воронка_archive_в_dead_не_попадает():
    old = funnel('f6', ('БОО', 'НИМБ', 'Яндекс', 'РСЯ', 'АВ Автоворонка'),
                 status='archive')
    report = sections.build({}, {'orders': 0, 'paid': 0}, [old], [], [], TODAY)
    assert report.dead == []


def test_живая_строка_таблицы_без_воронки_идёт_в_sheet_only():
    row = sheet_source.SheetRow(9, '', 'ВК NR', 'ЖИВО Суставы 490р',
                                'Работает', ('t.ksamata.ru/jivo/trial/nr/a',))
    report = sections.build({}, {'orders': 0, 'paid': 0}, [], [row], [], TODAY)
    assert [item.row.funnel for item in report.sheet_only] == \
        ['ЖИВО Суставы 490р']


def test_строка_стоп_без_воронки_в_sheet_only_не_идёт():
    """13 несошедшихся строк — «Стоп»; шуметь ими нельзя."""
    row = sheet_source.SheetRow(20, '', 'ВК NR', 'БОО', 'Стоп',
                                ('t.ksamata.ru/nr/boo/a',))
    report = sections.build({}, {'orders': 0, 'paid': 0}, [], [row], [], TODAY)
    assert report.sheet_only == []


def test_пустой_статус_в_таблице_расхождением_не_считается():
    """Пустая ячейка — «маркетолог не заполнил», а не «Стоп». Без этой
    проверки f24, f25 и f26 попадали в расхождения на ровном месте."""
    live = funnel('f24', ('ДБО', 'НИМБ', 'Яндекс', 'РСЯ', 'АВ Автоворонка'),
                  landings=['t.ksamata.ru/dbo/a'])
    row = sheet_source.SheetRow(65, 'f24', 'НИМБ', 'ДБО', '',
                                ('t.ksamata.ru/dbo/a',))
    report = sections.build({}, {'orders': 0, 'paid': 0}, [live], [row], [],
                            TODAY)
    assert report.status_drift == []


def test_расхождение_статуса_попадает_в_status_drift():
    live = funnel('f9', ('БОО', 'НИМБ', 'Яндекс', 'РСЯ', 'АВ Автоворонка'),
                  landings=['t.ksamata.ru/boo/a'])
    row = sheet_source.SheetRow(7, 'f9', 'НИМБ', 'БОО', 'Стоп',
                                ('t.ksamata.ru/boo/a',))
    report = sections.build({}, {'orders': 0, 'paid': 0}, [live], [row], [],
                            TODAY)
    assert [item.funnel.label for item in report.status_drift] == ['f9']


def test_таблица_стоп_против_живых_заказов_это_устаревшая_таблица():
    """Разбор 04.08: все шесть «расхождений статуса» оказались одним и тем
    же — в таблице «Стоп», а заказы идут. У f31 5027 заказов за июль.
    Спрашивать по такому человека нечего: заказы подтверждают базу."""
    live = funnel('f31', ('ДЫХАНИЕ', 'НИМБ', 'Яндекс', 'РСЯ',
                          'АВ Автоворонка'),
                  landings=['t.ksamata.ru/dih/rsya/a'])
    row = sheet_source.SheetRow(15, 'f31', 'НИМБ', 'ДЫХАНИЕ', 'Стоп',
                                ('t.ksamata.ru/dih/rsya/a',))
    report = sections.build({live.key: stat(live.key)}, {'orders': 0, 'paid': 0},
                            [live], [row], [], TODAY)
    assert report.status_drift == []
    assert [item.funnel.label for item in report.sheet_stale] == ['f31']


def test_таблица_работает_против_мёртвых_заказов_это_устаревшая_таблица():
    """Обратная сторона того же правила: заказы согласны с базой."""
    shelved = funnel('f19', ('БОО', 'HT', 'ВК', 'Реклама', 'АВ Автоворонка'),
                     status='archive', landings=['t.ksamata.ru/ht/boo/a'])
    row = sheet_source.SheetRow(52, 'f19', 'HT', 'БОО', 'Работает',
                                ('t.ksamata.ru/ht/boo/a',))
    report = sections.build({}, {'orders': 0, 'paid': 0}, [shelved], [row], [],
                            TODAY)
    assert report.status_drift == []
    assert [item.funnel.label for item in report.sheet_stale] == ['f19']


def test_заказы_на_стороне_таблицы_оставляют_вопрос_к_базе():
    """Заказов нет, а в базе active — вот это настоящее расхождение."""
    live = funnel('f9', ('БОО', 'НИМБ', 'Яндекс', 'РСЯ', 'АВ Автоворонка'),
                  landings=['t.ksamata.ru/boo/a'])
    row = sheet_source.SheetRow(7, 'f9', 'НИМБ', 'БОО', 'Стоп',
                                ('t.ksamata.ru/boo/a',))
    report = sections.build({}, {'orders': 0, 'paid': 0}, [live], [row], [],
                            TODAY)
    assert report.sheet_stale == []
    assert [item.funnel.label for item in report.status_drift] == ['f9']


def _sheet_status_off():
    return decisions.Decision(
        id='sheet-status-not-authoritative', match={}, scope='sheet_status',
        verdict='статус из таблицы не сверяем', why='решение владельца 04.08',
        since='2026-08-04')


def test_решение_гасит_сверку_статусов_целиком():
    """04.08 владелец сказал: «в таблице я ничего не правлю, эти воронки
    рабочие». Значит колонка статуса там не эталон, и спрашивать по ней
    нечего — ни там, где заказы рассудили, ни там, где не смогли."""
    live = funnel('f9', ('БОО', 'НИМБ', 'Яндекс', 'РСЯ', 'АВ Автоворонка'),
                  landings=['t.ksamata.ru/boo/a'])
    row = sheet_source.SheetRow(7, 'f9', 'НИМБ', 'БОО', 'Стоп',
                                ('t.ksamata.ru/boo/a',))
    report = sections.build({}, {'orders': 0, 'paid': 0}, [live], [row],
                            [_sheet_status_off()], TODAY)
    assert report.status_drift == []
    assert report.sheet_stale == []
    assert report.sheet_status_off is not None


def test_без_решения_сверка_статусов_работает_как_раньше():
    live = funnel('f9', ('БОО', 'НИМБ', 'Яндекс', 'РСЯ', 'АВ Автоворонка'),
                  landings=['t.ksamata.ru/boo/a'])
    row = sheet_source.SheetRow(7, 'f9', 'НИМБ', 'БОО', 'Стоп',
                                ('t.ksamata.ru/boo/a',))
    report = sections.build({}, {'orders': 0, 'paid': 0}, [live], [row], [],
                            TODAY)
    assert report.sheet_status_off is None
    assert [item.funnel.label for item in report.status_drift] == ['f9']


def test_решение_по_статусам_не_гасит_строки_без_воронки():
    """Гасится сверка СТАТУСА, а не вся таблица: живая строка, которой в
    базе нет вовсе, — по-прежнему находка."""
    row = sheet_source.SheetRow(43, '', 'ВК NR', 'ЖИВО Суставы', 'Работает',
                                ('t.ksamata.ru/jivo/trial/nr/a',))
    report = sections.build({}, {'orders': 0, 'paid': 0}, [], [row],
                            [_sheet_status_off()], TODAY)
    assert [item.row.row_num for item in report.sheet_only] == [43]


def test_у_молодой_воронки_заказы_рассудить_не_могут():
    """Воронке два дня — молчание заказов о ней ничего не говорит, и
    списывать расхождение на устаревшую таблицу нельзя."""
    fresh = funnel('f73', ('ЖИВО-суставы-триал', 'NR', 'ВК', 'Реклама',
                           'АВ Прямые'), start_date='2026-08-01',
                   landings=['t.ksamata.ru/trial/nr/a'])
    row = sheet_source.SheetRow(44, 'f73', 'NR', 'Трайл', 'Стоп',
                                ('t.ksamata.ru/trial/nr/a',))
    report = sections.build({}, {'orders': 0, 'paid': 0}, [fresh], [row], [],
                            datetime.date(2026, 8, 3))
    assert report.sheet_stale == []
    assert [item.funnel.label for item in report.status_drift] == ['f73']


# --- Этап 2. Лендинг разошёлся (ступень source_product) --------------------
#
# Совпадение по третьей ступени — само по себе находка: строку опознали не по
# лендингу и не по коду, значит адрес в базе разошёлся с таблицей. До
# 2026-09-03 ступень не срабатывала вовсе (сверялась с подрядчиками вместо
# источников), и даже сработав, никуда не выводилась: sections брал из
# результата только funnel, а tier терялся. Обе половины чинятся вместе —
# работающая ступень без раздела в отчёте по-прежнему «третья проверка,
# которой нет».

def test_совпадение_по_источнику_и_продукту_идёт_в_landing_drift():
    f16 = funnel('f16', ('БОО', 'NR', 'ВК', 'In Stream', None),
                 status='archive', landings=('t.ksamata.ru/nr/boo/d',),
                 source='ВК NR', product='БОО')
    row = sheet_source.SheetRow(25, '', 'ВК NR', 'БОО', 'Стоп',
                                ('t.ksamata.ru/nr/boo/a',))
    report = sections.build({}, {'orders': 0, 'paid': 0}, [f16], [row], [], TODAY)
    assert [(item.funnel.label, item.row.row_num)
            for item in report.landing_drift] == [('f16', 25)]
    # И строка НЕ считается «без воронки»: воронка есть, разошёлся адрес.
    assert report.sheet_only == []


def test_совпадение_по_лендингу_в_landing_drift_не_идёт():
    f16 = funnel('f16', ('БОО', 'NR', 'ВК', 'In Stream', None),
                 landings=('t.ksamata.ru/nr/boo/a',), source='ВК NR', product='БОО')
    row = sheet_source.SheetRow(25, '', 'ВК NR', 'БОО', 'Работает',
                                ('t.ksamata.ru/nr/boo/a',))
    report = sections.build({}, {'orders': 0, 'paid': 0}, [f16], [row], [], TODAY)
    assert report.landing_drift == []


def test_совпадение_по_коду_в_landing_drift_не_идёт():
    """Код разошёлся не с лендингом, а вместо него: ступень 2, не 3."""
    f37 = funnel('f37', ('БОО', 'FAQ', 'ВК', 'A', None), source='ВК FAQ', product='БОО')
    row = sheet_source.SheetRow(5, 'f37', 'ВК FAQ', 'БОО', 'Работает', ())
    report = sections.build({}, {'orders': 0, 'paid': 0}, [f37], [row], [], TODAY)
    assert report.landing_drift == []
