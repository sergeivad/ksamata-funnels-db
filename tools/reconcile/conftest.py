"""Кладёт tools/reconcile и tools/audit в sys.path — плоские импорты.

Имена модулей здесь не должны совпадать с именами в tools/audit: оба
каталога лежат в одном sys.path, и при совпадении победил бы тот, что
импортирован первым — молча и по-разному в разных прогонах. Поэтому
чтение базы называется funnels_source, а не db_source.
"""

import os
import sys

BASE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, BASE)
sys.path.append(os.path.abspath(os.path.join(BASE, '..', 'audit')))
