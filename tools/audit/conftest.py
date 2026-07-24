"""Кладёт каталог tools/audit в sys.path, чтобы тесты использовали плоские импорты."""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
