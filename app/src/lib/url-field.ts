/**
 * Гигиена поля «Ссылка» в блоках воронки.
 *
 * Разбираем два разных случая, и наказание за них разное:
 *
 *  - **Класс A — подпись затекла в ссылку.** Значение начинается с http(s), но
 *    внутри пробел, скобки или кавычки: `https://t.ksamata.ru/ht/boo/a (ADS)`,
 *    `https://t.ksamata.ru/nr/dbo/b (https://t.ksamata.ru/nr/dbo/b)`,
 *    `https://t.ksamata.ru/nr/boo/d"`. Такое значение — всегда ошибка ввода, и
 *    оно дорого обходится: `normalizeUrl` не выбрасывает его, а кодирует пробел
 *    в `%20`, мониторинг заводит по нему отдельную цель, она отдаёт 404 и
 *    выглядит как упавший лендинг. Поэтому сохранение блокируется, а вместе с
 *    ошибкой отдаём готовую починку.
 *
 *  - **Класс B — в поле не ссылка вовсе.** `сайты`, `геткурс`,
 *    `Получить бонус 2` — это человеческие пометки в поле, где нет отдельной
 *    подписи. Мониторинг их молча игнорирует (`normalizeUrl` → null), вреда
 *    нет, поэтому только предупреждаем: запрет сломал бы сохранение воронок,
 *    где такие пометки живут годами.
 *
 * Модуль чистый (без DOM и БД) — его используют и редактор, и PUT-роут блоков,
 * чтобы правило было одно, а не два разошедшихся.
 */

/** Символы, которых в http(s)-ссылке быть не должно: пробелы, скобки, кавычки. */
const DIRT_IN_URL = /[\s()[\]{}"'«»]/;

/** Хвостовая пунктуация, которую безопасно срезать. Точку не трогаем — бывает частью пути. */
const TRAILING_JUNK = /[\s()[\]{}"'«»,;]+$/;

/**
 * Обрамление подписи в «слипшейся» строке: отделители (« — », «: ») и скобки с
 * кавычками, в которые её обычно заворачивают. `(ADS)` должно стать `ADS`.
 */
const LABEL_TRIM = /^[\s\-–—:|([{"'«]+|[\s\-–—:|)\]}"'»]+$/g;

const URL_TOKEN = /https?:\/\/\S+/i;

export type UrlFieldCheck =
  | { level: 'ok' }
  /** Класс B: сохранять можно, но проверять доступность нечего. */
  | { level: 'warn'; message: string }
  /**
   * Класс A: сохранять нельзя. `fix` — предлагаемая починка: чистая ссылка и
   * хвост, который стоит унести в подпись (если у блока есть поле подписи).
   */
  | { level: 'error'; message: string; fix: { url: string; label: string } };

/**
 * Разбирает «слипшееся» значение на чистую ссылку и остаток.
 * Экспортируется отдельно: тем же способом чинится строка по кнопке в редакторе.
 */
export function splitUrlAndLabel(raw: string): { url: string; label: string } {
  const match = URL_TOKEN.exec(raw);
  if (!match) return { url: '', label: raw.trim() };
  const url = match[0].replace(TRAILING_JUNK, '');
  const rest = (raw.slice(0, match.index) + ' ' + raw.slice(match.index + match[0].length))
    .replace(/\s+/g, ' ')
    .replace(LABEL_TRIM, '')
    .trim();
  // Хвост вида «(https://тот-же-адрес)» — не подпись, а дубль ссылки; он мусор.
  const restUrl = URL_TOKEN.exec(rest)?.[0].replace(TRAILING_JUNK, '');
  return { url, label: restUrl === url ? '' : rest };
}

/** Проверяет одно значение поля «Ссылка». Пустое поле — нормально: строку ещё заполняют. */
export function checkUrlField(raw: string): UrlFieldCheck {
  const value = raw.trim();
  if (value === '') return { level: 'ok' };

  if (!/^https?:\/\//i.test(value)) {
    return { level: 'warn', message: 'Это не ссылка — доступность проверяться не будет' };
  }

  if (DIRT_IN_URL.test(value)) {
    const fix = splitUrlAndLabel(value);
    return {
      level: 'error',
      message: 'В ссылке лишний текст: пробел, скобки или кавычки',
      fix,
    };
  }

  try {
    // eslint-disable-next-line no-new
    new URL(value);
  } catch {
    return { level: 'error', message: 'Ссылка не разбирается', fix: { url: '', label: value } };
  }

  return { level: 'ok' };
}

/** Индексы строк с ошибкой класса A — редактор по ним блокирует сохранение. */
export function urlFieldErrors(items: { url: string }[]): number[] {
  return items.flatMap((it, i) => (checkUrlField(it.url).level === 'error' ? [i] : []));
}
