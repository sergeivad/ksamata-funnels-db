// Разделитель нескольких ссылок в одном поле (`landing_url` воронок №6, №7):
// слэш, окружённый пробелами. Слэши внутри пути под это не подпадают.
const SEPARATOR = /\s+\/\s+/;

// Хвостовой мусор из ручного ввода: кавычки, запятые, точка с запятой, пробелы.
// Точку НЕ трогаем — она бывает частью пути.
const TRAILING_JUNK = /[\s"'«»,;]+$/;

/**
 * Канонический вид URL для дедупликации и проверки.
 * Возвращает null, если это не пригодная для проверки http(s)-ссылка.
 */
export function normalizeUrl(raw: string): string | null {
  const trimmed = raw.trim().replace(TRAILING_JUNK, '');
  if (!/^https?:\/\//i.test(trimmed)) return null;
  try {
    const parsed = new URL(trimmed);
    // Хост без точки — это localhost или мусор вроде голого "https://".
    if (!parsed.hostname.includes('.')) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

/** Разбирает поле, где через " / " может лежать несколько ссылок. Дубли схлопывает. */
export function splitUrlField(raw: string | null | undefined): string[] {
  if (!raw) return [];
  const out: string[] = [];
  for (const part of raw.split(SEPARATOR)) {
    const url = normalizeUrl(part);
    if (url && !out.includes(url)) out.push(url);
  }
  return out;
}
