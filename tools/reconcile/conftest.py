"""Кладёт tools/reconcile и tools/audit в sys.path — плоские импорты.

Наш каталог вставляется последним, поэтому при совпадении имён (db_source
есть и там, и там) выигрывает наш.
"""

import os
import sys

BASE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, BASE)
sys.path.append(os.path.abspath(os.path.join(BASE, '..', 'audit')))
