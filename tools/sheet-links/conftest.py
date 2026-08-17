"""Кладёт tools/sheet-links в sys.path — импорты плоские.

Имена модулей здесь начинаются с links_ и не должны совпадать с именами в
tools/audit и tools/reconcile: все три каталога лежат в одном sys.path, и при
совпадении победил бы тот, что импортирован первым — молча и по-разному в
разных прогонах.
"""

import os
import sys

BASE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, BASE)
