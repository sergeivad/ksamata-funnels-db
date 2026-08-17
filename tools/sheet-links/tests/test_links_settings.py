import importlib
import os

import links_settings


def test_db_path_resolves_from_repo_root_regardless_of_cwd(monkeypatch, tmp_path):
    """Пути строятся от расположения модуля, а не от cwd — общее правило
    для всех путей в links_settings (см. docstring модуля)."""
    before = links_settings.DB_PATH
    monkeypatch.chdir(tmp_path)
    importlib.reload(links_settings)
    try:
        assert links_settings.DB_PATH == before
        assert os.path.isabs(links_settings.DB_PATH)
        assert os.path.basename(links_settings.DB_PATH) == 'ksamata_funnels.db'
        assert not links_settings.DB_PATH.startswith(str(tmp_path))
    finally:
        importlib.reload(links_settings)
