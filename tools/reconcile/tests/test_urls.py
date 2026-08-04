import urls


def test_split_field_разбирает_несколько_адресов_в_ячейке():
    cell = ('https://t.zdravo-telo.ru/rsy/jivo/trial/inhouse/a / '
            'https://gc.zdravo-telo.ru/jivo/sust/inhouse/a')
    assert urls.split_field(cell) == [
        't.zdravo-telo.ru/rsy/jivo/trial/inhouse/a',
        'gc.zdravo-telo.ru/jivo/sust/inhouse/a',
    ]


def test_split_field_срезает_схему_и_хвостовой_слеш():
    assert urls.split_field('https://t.ksamata.ru/nr/boo/a/') == [
        't.ksamata.ru/nr/boo/a']


def test_split_field_отбрасывает_пометки_маркетолога():
    """В таблице встречается «…/a (LP518)» — скобка не часть адреса."""
    assert urls.split_field('https://t.ksamata.ru/jivo/nr/a (LP518)') == [
        't.ksamata.ru/jivo/nr/a']


def test_split_field_игнорирует_текст_без_точки():
    """Класс B из url-field.ts: заметки вроде «сайты» адресами не являются."""
    assert urls.split_field('сайты, геткурс') == []


def test_split_field_на_пустой_ячейке_даёт_пустой_список():
    assert urls.split_field(None) == []
    assert urls.split_field('') == []


def test_split_field_приводит_регистр_к_нижнему():
    assert urls.split_field('HTTPS://T.Ksamata.RU/NR/BOO/A') == [
        't.ksamata.ru/nr/boo/a']
