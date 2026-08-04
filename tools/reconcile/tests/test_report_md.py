import orders_source
import report_md
import sections

META = {'export': 'deal_export_2026-08-01_01-48-36.xlsx',
        'sheet': 'Ссылки для сбора статы.xlsx',
        'today': '2026-08-04', 'funnels': 73, 'combos': 107}


def test_render_ставит_разделы_в_порядке_этапов():
    key = ('ДБО', 'RedBananas', 'ТГ', 'Реклама', 'АВ Автоворонка')
    report = sections.Report(
        missing=[sections.MissingCombo(
            key=key,
            stat=orders_source.ComboStat(key=key, orders=1, paid=1,
                                         last_created='2026-07-13 10:00:00'))],
        blind={'orders': 46557, 'paid': 26133})
    text = report_md.render(report, META)
    assert text.index('Этап 1') < text.index('Трек Р')


def test_render_показывает_связку_читаемо():
    key = ('ДБО', 'RedBananas', 'ТГ', 'Реклама', 'АВ Автоворонка')
    report = sections.Report(missing=[sections.MissingCombo(
        key=key, stat=orders_source.ComboStat(key=key, orders=1, paid=1,
                                              last_created='2026-07-13'))])
    assert 'ДБО / RedBananas / ТГ / Реклама / АВ Автоворонка' in \
        report_md.render(report, META)


def test_render_называет_размер_слепой_зоны():
    report = sections.Report(blind={'orders': 46557, 'paid': 26133})
    assert '26 133' in report_md.render(report, META)


def test_render_на_пустом_отчёте_говорит_что_разделы_пусты():
    text = report_md.render(sections.Report(blind={'orders': 0, 'paid': 0}),
                            META)
    assert 'расхождений нет' in text
