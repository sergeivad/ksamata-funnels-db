import textwrap

import pytest

import decisions


@pytest.fixture
def rules_file(tmp_path):
    path = tmp_path / 'decisions.yaml'
    path.write_text(textwrap.dedent("""
        - id: quiz-not-tracked
          match:
            продукт: [ЖКТ, ЖИВО]
            тип: [АВ Квиз, АВ Квиз-Лайт]
          verdict: не заводим
          why: решение 29.07 — карточки вышли бы пустыми
          since: 2026-07-29

        - id: leak-effective-from
          match:
            подрядчик: [НИМБ]
          verdict: ждёт ответа
          why: что значит effectiveFrom = null у существующего набора
          since: 2026-08-04
          waiting_for: besales
    """), encoding='utf-8')
    return str(path)


def test_load_читает_правила(rules_file):
    rules = decisions.load(rules_file)
    assert [r.id for r in rules] == ['quiz-not-tracked', 'leak-effective-from']


def test_covering_гасит_совпавшую_связку(rules_file):
    rules = decisions.load(rules_file)
    key = ('ЖКТ', 'НИМБ', 'Яндекс', 'РСЯ', 'АВ Квиз')
    assert decisions.covering(key, rules).id == 'quiz-not-tracked'


def test_covering_молчит_на_несовпавшей(rules_file):
    rules = decisions.load(rules_file)
    key = ('ДБО', 'NR', 'ВК', 'In Stream', 'АВ Автоворонка')
    assert decisions.covering(key, rules) is None


def test_covering_требует_совпадения_всех_осей_правила(rules_file):
    """Продукт подходит, тип — нет: правило не применяется."""
    rules = decisions.load(rules_file)
    key = ('ЖКТ', 'НИМБ', 'Яндекс', 'РСЯ', 'АВ Автоворонка')
    assert decisions.covering(key, rules) is None


def test_covering_не_гасит_связку_правилом_ждёт_ответа(rules_file):
    """«Ждёт ответа» — вопрос, а не решение. Погасив им связку, отчёт
    спрятал бы живую находку под видом разобранной."""
    rules = decisions.load(rules_file)
    key = ('ДБО', 'НИМБ', 'Яндекс', 'РСЯ', 'АВ Автоворонка')
    assert decisions.covering(key, rules) is None


def test_waiting_for_отделяет_ждущие_от_решённых(rules_file):
    rules = decisions.load(rules_file)
    waiting = [r for r in rules if r.waiting_for]
    assert [r.waiting_for for r in waiting] == ['besales']


def test_null_в_правиле_означает_ось_не_размечена(tmp_path):
    """Продления подписки размечены только продуктом. Правило «продукт:
    [ЖИВО]» без null погасило бы заодно все настоящие ЖИВО-воронки."""
    path = tmp_path / 'd.yaml'
    path.write_text(
        '- id: renewals\n'
        '  match:\n'
        '    продукт: [ЖИВО]\n'
        '    подрядчик: [null]\n'
        '    тип: [null]\n'
        '  verdict: не воронка\n'
        '  why: продления подписки\n'
        '  since: 2026-08-04\n', encoding='utf-8')
    rules = decisions.load(str(path))
    assert decisions.covering(('ЖИВО', None, None, None, None), rules).id == \
        'renewals'
    # настоящая ЖИВО-воронка гаснуть не должна
    assert decisions.covering(
        ('ЖИВО', 'НИМБ', 'Яндекс', 'РСЯ', 'АВ Автоворонка'), rules) is None


def test_load_на_отсутствующем_файле_даёт_пустой_список(tmp_path):
    assert decisions.load(str(tmp_path / 'нет.yaml')) == []


def test_load_падает_на_неизвестной_оси(tmp_path):
    """Опечатка в имени оси должна остановить прогон, а не тихо не сработать."""
    path = tmp_path / 'bad.yaml'
    path.write_text('- id: x\n  match:\n    прдукт: [ЖКТ]\n', encoding='utf-8')
    with pytest.raises(ValueError, match='прдукт'):
        decisions.load(str(path))
