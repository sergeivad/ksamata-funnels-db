"""Python не ведёт теги воронок — попытка писать их должна останавливать скрипт."""

import pytest

from tag_write_guard import FORCE_FLAG, guard_tag_write


def test_refuses_by_default():
    with pytest.raises(SystemExit) as err:
        guard_tag_write('add_dih_funnel.py')
    text = str(err.value)
    assert 'funnel_tags' in text
    assert FORCE_FLAG in text, 'в сообщении должен быть путь наружу'
    assert 'админку' in text, 'сообщение должно говорить, как надо'


def test_names_the_script_that_tried():
    with pytest.raises(SystemExit) as err:
        guard_tag_write('add_quiz_funnels.py')
    assert 'add_quiz_funnels.py' in str(err.value)


def test_lets_through_with_the_explicit_flag():
    guard_tag_write('add_av_tags.py', argv=['add_av_tags.py', FORCE_FLAG])


def test_lets_through_when_force_passed_directly():
    guard_tag_write('add_av_tags.py', force=True)


def test_flag_absent_from_argv_still_refuses():
    with pytest.raises(SystemExit):
        guard_tag_write('add_av_tags.py', argv=['add_av_tags.py', '--dry-run'])
