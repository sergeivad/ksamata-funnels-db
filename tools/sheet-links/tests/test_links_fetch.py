import json

import pytest

from links_fetch import load_sheets, visible_titles


def test_visible_titles_skips_hidden():
    meta = {'sheets': [
        {'properties': {'sheetId': 1, 'title': 'ДБО'}},
        {'properties': {'sheetId': 2, 'title': 'ЩЗ', 'hidden': True}},
        {'properties': {'sheetId': 3, 'title': 'БОО', 'hidden': False}},
    ]}
    assert visible_titles(meta) == ['ДБО', 'БОО']


def test_visible_titles_on_empty_meta():
    assert visible_titles({}) == []


def test_load_sheets_reads_cache_without_network(tmp_path):
    cache = tmp_path / 'sheets.json'
    cache.write_text(json.dumps({'ДБО': [['a', 'b']]}), encoding='utf-8')
    assert load_sheets(str(cache)) == {'ДБО': [['a', 'b']]}


def test_load_sheets_without_cache_needs_network(monkeypatch, tmp_path):
    """Кеша нет — идём в сеть. Проверяем, что путь именно туда, а не молча пусто."""
    calls = []

    def fake_fetch():
        calls.append(1)
        return {'ДБО': [['x']]}

    monkeypatch.setattr('links_fetch._fetch_from_api', fake_fetch)
    cache = tmp_path / 'missing.json'
    assert load_sheets(str(cache)) == {'ДБО': [['x']]}
    assert calls == [1]
    # и результат осел в кеше
    assert json.loads(cache.read_text(encoding='utf-8')) == {'ДБО': [['x']]}
