import datetime

import funnels_source
import decisions
import orders_source
import sections
import sheet_source

TODAY = datetime.date(2026, 8, 1)


def funnel(label, key, status='active', landings=(), contractor='', product=''):
    return funnels_source.Funnel(
        funnel_id=abs(hash(label)) % 1000, front_code=label, status=status,
        label=label, key=key, landings=tuple(landings),
        contractor=contractor, product=product)


def stat(key, orders=10, paid=1, last='2026-07-31 10:00:00'):
    return orders_source.ComboStat(key=key, orders=orders, paid=paid,
                                   last_created=last)


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
