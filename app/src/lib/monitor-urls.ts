// Разделитель нескольких ссылок в одном поле (`landing_url` воронок №6, №7):
// слэш, окружённый пробелами. Слэши внутри пути под это не подпадают.
const SEPARATOR = /\s+\/\s+/;

// Хвостовой мусор из ручного ввода: кавычки, запятые, точка с запятой, пробелы.
// Точку НЕ трогаем — она бывает частью пути.
const TRAILING_JUNK = /[\s"'«»,;]+$/;

// Хост из одних цифр и точек — IPv4-литерал. Проверяем уже нормализованный
// hostname, поэтому сюда же попадают http://0177.0.0.1/ и http://2130706433/:
// URL приводит обе записи к «127.0.0.1».
const IPV4_LITERAL = /^\d+(\.\d+)*$/;

/**
 * Цель мониторинга — публичная страница, у неё есть доменное имя. IP-литерал
 * (`http://127.0.0.1/`, `http://10.0.0.5/`, `http://169.254.169.254/` с
 * метаданными облака, `http://[::1]/`) в базе воронок означал бы либо опечатку,
 * либо попытку сделать из дашборда SSRF-оракул: чекер сходит по адресу, а код
 * ответа и финальный URL нарисуются на странице. Заводить такие цели незачем.
 */
function isIpLiteralHost(hostname: string): boolean {
  // IPv6 в URL всегда в скобках: hostname отдаётся как "[::1]".
  return hostname.startsWith('[') || IPV4_LITERAL.test(hostname);
}

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
    if (isIpLiteralHost(parsed.hostname)) return null;
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
