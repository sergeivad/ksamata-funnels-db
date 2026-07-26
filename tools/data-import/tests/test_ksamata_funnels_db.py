"""Скрипт полной сборки БД из Excel сносит файл базы — это должно быть осознанным действием."""

import pytest

LIVE_DATA = "живые данные".encode("utf-8")

from ksamata_funnels_db import claim_db_path, populate


def test_refuses_to_delete_an_existing_db(tmp_path):
    db = tmp_path / "ksamata_funnels.db"
    db.write_bytes(LIVE_DATA)

    with pytest.raises(SystemExit):
        claim_db_path(str(db), force=False)

    assert db.read_bytes() == LIVE_DATA


def test_deletes_an_existing_db_when_forced(tmp_path):
    db = tmp_path / "ksamata_funnels.db"
    db.write_bytes(LIVE_DATA)

    claim_db_path(str(db), force=True)

    assert not db.exists()


def test_accepts_a_path_with_no_db_yet(tmp_path):
    db = tmp_path / "ksamata_funnels.db"

    claim_db_path(str(db), force=False)

    assert not db.exists()


def test_populate_stops_before_touching_an_existing_db(tmp_path):
    """Защита стоит до чтения Excel — иначе «просто посмотреть» стоит базы."""
    db = tmp_path / "ksamata_funnels.db"
    db.write_bytes(LIVE_DATA)

    with pytest.raises(SystemExit):
        populate(str(db))

    assert db.read_bytes() == LIVE_DATA
