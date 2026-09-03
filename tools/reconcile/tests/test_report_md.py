import funnels_source
import orders_source
import report_md
import sections
import sheet_source

FUNNEL = funnels_source.Funnel(
    funnel_id=16, front_code='f16', status='archive', label='f16',
    key=('БОО', 'NR', 'ВК', 'In Stream', None),
    landings=('t.ksamata.ru/nr/boo/d',), source='ВК NR', product='БОО')

META = {'export': 'deal_export_2026-08-01_01-48-36.xlsx',
        'sheet': 'Ссылки для сбора статы.xlsx',
        'today': '2026-08-04', 'funnels': 73, 'combos': 107}


def test_render_ставит_разделы_в_порядке_этапов():
    key = ('ДБО', 'RedBananas', 'ТГ', 'Реклама', 'АВ Автоворонка')
    report = sections.Report(
        missing=[sections.MissingCombo(
            key=key,
            stat=orders_source.ComboStat(key=key, orders=1, paid=1,
                                         last_activity='2026-07-13 10:00:00'))],
        blind={'orders': 46557, 'paid': 26133})
    text = report_md.render(report, META)
    assert text.index('Этап 1') < text.index('Трек Р')


def test_render_показывает_связку_читаемо():
    key = ('ДБО', 'RedBananas', 'ТГ', 'Реклама', 'АВ Автоворонка')
    report = sections.Report(missing=[sections.MissingCombo(
        key=key, stat=orders_source.ComboStat(key=key, orders=1, paid=1,
                                              last_activity='2026-07-13'))])
    assert 'ДБО / RedBananas / ТГ / Реклама / АВ Автоворонка' in \
        report_md.render(report, META)


def test_render_называет_размер_слепой_зоны():
    report = sections.Report(blind={'orders': 46557, 'paid': 26133})
    assert '26 133' in report_md.render(report, META)


def test_render_на_пустом_отчёте_говорит_что_разделы_пусты():
    text = report_md.render(sections.Report(blind={'orders': 0, 'paid': 0}),
                            META)
    assert 'расхождений нет' in text


def test_раздел_про_разошедшийся_лендинг_печатается_даже_пустым():
    """Пустой раздел печатается явно: «расхождений нет» читается иначе, чем
    отсутствие раздела. Ровно тот же довод, по которому в аудите лист класса
    заводится всегда."""
    text = report_md.render(sections.Report(), META)
    assert 'Лендинг разошёлся' in text


def test_раздел_показывает_оба_статуса_и_адрес():
    """Статусы нужны для сортировки по важности: расхождение у архивной
    воронки и остановленной строки — не то же самое, что у живой пары."""
    report = sections.Report()
    report.landing_drift.append(sections.LandingDrift(
        funnel=FUNNEL, row=sheet_source.SheetRow(
            25, '', 'ВК NR', 'БОО', 'Стоп', ('t.ksamata.ru/nr/boo/a',))))
    text = report_md.render(report, META)
    assert 'f16' in text and 'archive' in text and 'Стоп' in text
    assert 't.ksamata.ru/nr/boo/a' in text


def test_раздел_про_неоднозначность_печатается_даже_пустым():
    assert 'не с чем однозначно связать' in report_md.render(sections.Report(), META)


def test_раздел_про_неоднозначность_перечисляет_всех_кандидатов():
    """Показать одну «наиболее вероятную» — то же самое, что выбрать за
    человека, только без честной пометки."""
    report = sections.Report()
    other = funnels_source.Funnel(
        funnel_id=15, front_code='f15', status='active', label='f15',
        key=('ДБО', 'NR', 'ВК', 'B', None), landings=(), source='ВК NR', product='ДБО')
    report.ambiguous.append(sections.AmbiguousRow(
        row=sheet_source.SheetRow(30, '', 'ВК NR', 'ДБО', 'Работает', ()),
        candidates=(FUNNEL, other)))
    text = report_md.render(report, META)
    assert 'f16, f15' in text
