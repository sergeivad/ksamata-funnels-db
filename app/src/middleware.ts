import { NextRequest, NextResponse } from 'next/server';
import {
  LOGIN_MAX_ATTEMPTS,
  SESSION_COOKIE,
  isAllowed,
  isKillSwitchIgnored,
  parseBasicHeader,
  resolveAccess,
  resolveSessionUser,
  type AccessDecision,
  type AuthEnv,
} from '@/lib/auth';
import { attemptKey, clearAttempts, isBlocked, registerFailure } from '@/lib/login-attempts';

/**
 * Первый рубеж доступа: «читают все, пишут свои».
 *
 *  - список воронок и карточки открыты анонимно;
 *  - справочники, теги, мониторинг, экспорт — только редактору;
 *  - любой не-GET — только редактору.
 *
 * Вся логика решения — в `@/lib/auth` (`resolveAccess`), чистая и Edge-безопасная;
 * здесь только запрос → решение → ответ. Ту же функцию вызывает `requireEditor`
 * в самих роутах: мидлвара не единственная защита, её `matcher` ломается одной
 * правкой и молча. Но верно и обратное: мидлвара формирует ответ раньше роута
 * (а на отказ роут вообще не исполняется), поэтому лимит перебора Basic должен
 * стоять именно здесь — раньше он висел только в `requireEditor` и был мёртвым
 * кодом на любом пути, который закрывает мидлвара (а закрывает она почти всё,
 * см. `matcher`).
 *
 * Переменные окружения:
 *  - `ADMIN_USERS` — `имя:пароль`, через запятую или перевод строки;
 *  - `ADMIN_SESSION_SECRET` — ключ подписи сессии, обязателен в проде;
 *  - `ADMIN_BASIC_AUTH` — совместимость: одиночная учётка для curl/скриптов;
 *  - `PUBLIC_READ_ENABLED=false` — закрыть и чтение тоже (возврат к прежней модели);
 *  - `ADMIN_AUTH_DISABLED=true` — kill-switch: авторизации нет вообще. В проде
 *    игнорируется (см. `isKillSwitchIgnored` в `@/lib/auth`) — забытая на
 *    боевом сервере переменная держала прод открытым на запись больше месяца.
 *
 * ⚠️ ЗАМЕРЕНО на `.next/standalone/server.js` (тот же процесс, что и в
 * Docker): счётчик `lib/login-attempts.ts` здесь и в `requireEditor` —
 * это ДВА РАЗНЫХ `globalThis`, не один. Пять неверных Basic сюда (лог дошёл
 * до «осталось попыток 5»), затем один неверный запрос в форму входа
 * (`POST /api/auth/login`, тот же ключ `ip|ed`) — залогировал «осталось
 * попыток 9», то есть начал считать с нуля, а не продолжил с 5. Это значит:
 * мидлвара исполняется в изолированном edge-runtime контексте, который не
 * делит `globalThis` с Node-рантаймом API-роутов, хотя оба живут в одном OS-
 * процессе. Итоговый лимит перебора Basic поэтому не `LOGIN_MAX_ATTEMPTS`, а
 * фактически до `2 × LOGIN_MAX_ATTEMPTS` суммарно на ключ (по разу на каждый
 * из двух независимых счётчиков) — но это не проблема в реальности: сюда
 * `matcher` пропускает вообще все запросы, так что второй счётчик
 * (`requireEditor`) в проде почти никогда не участвует — он страхует только
 * тот момент, когда сам `matcher` сломан или в обход мидлвары дёрнут
 * обработчик напрямую. Объединить два счётчика в один без общего Node-side
 * хранилища (KV, БД) нельзя — Edge и Node в проде физически разные рантаймы.
 */

// Предупреждаем один раз на процесс — не заваливая лог на каждом запросе.
// На globalThis, а не module-level `let`: в продовом бандле мидлвара (Edge)
// и API-роуты (Node) компилируются раздельно, и webpack эмитит для этого
// графа две копии модуля — см. «Process state must be a real singleton» в
// CLAUDE.md. Module-level флаг молча стал бы двумя разными переменными, и
// предупреждение печаталось бы дважды; для этих двух флагов цена ошибки
// нулевая, но паттерн — ровно тот, что проект запретил, поэтому не повторяем.
const WARNED_KEY = Symbol.for('ksamata.middleware.warnedOnce');
type WarnedGlobal = typeof globalThis & {
  [WARNED_KEY]?: { open: boolean; killed: boolean; killIgnored: boolean };
};

function warnedState(): { open: boolean; killed: boolean; killIgnored: boolean } {
  const g = globalThis as WarnedGlobal;
  if (!g[WARNED_KEY]) g[WARNED_KEY] = { open: false, killed: false, killIgnored: false };
  return g[WARNED_KEY];
}

function warnOnce(decision: AccessDecision): void {
  const state = warnedState();
  if (decision === 'disabled' && !state.killed) {
    state.killed = true;
    console.warn(
      '[middleware] ADMIN_AUTH_DISABLED=true — авторизация выключена полностью: ' +
      'любой посетитель может править данные. Убери переменную, чтобы вернуть вход.'
    );
  }
  if (decision === 'open' && !state.open) {
    state.open = true;
    console.warn(
      '[middleware] ADMIN_USERS не задан — авторизация не настроена, править может кто угодно. ' +
      'Задай ADMIN_USERS="имя:пароль" и ADMIN_SESSION_SECRET, чтобы включить вход.'
    );
  }
}

/**
 * Отдельная проверка, а не веточка внутри `warnOnce(decision)`: в проде
 * `resolveAccess` больше не сворачивает решение в `disabled` (см.
 * `isKillSwitchIgnored`), так что здесь нет никакого decision, по которому
 * можно было бы это заметить, — переменная стоит, а поведение как будто её
 * нет вообще. Не предупредить в этом случае значит поменять одно молчание на
 * другое: человек выставит `ADMIN_AUTH_DISABLED=true`, ничего не изменится, и
 * он пойдёт искать несуществующий баг вместо того, чтобы прочитать эту строку.
 */
function warnIfKillSwitchIgnored(env: AuthEnv): void {
  const state = warnedState();
  if (isKillSwitchIgnored(env) && !state.killIgnored) {
    state.killIgnored = true;
    console.warn(
      '[middleware] ADMIN_AUTH_DISABLED=true ПРОИГНОРИРОВАН: в проде эта переменная ' +
      'ничего не отключает, авторизация работает как обычно. Убери её из окружения, ' +
      'чтобы конфиг не врал. Чтобы править данные — задай ADMIN_USERS и ' +
      'ADMIN_SESSION_SECRET и войди на /login. Чтение и так публично; закрыть его ' +
      'можно через PUBLIC_READ_ENABLED=false. Отключить проверку на запись в проде ' +
      'нельзя вообще — это и есть смысл правки: забытая тут переменная больше ' +
      'месяца держала прод открытым на запись.'
    );
  }
}

/**
 * Сервис публично читаем, но индексировать его незачем: в карточках URL лендов,
 * ссылки GetCourse и внутренние комментарии. Заголовок вешается на каждый ответ,
 * включая API, — `robots.txt` покрывает только вежливые краулеры.
 */
function withNoIndex(res: NextResponse): NextResponse {
  res.headers.set('X-Robots-Tag', 'noindex, nofollow');
  return res;
}

export async function middleware(req: NextRequest): Promise<NextResponse> {
  const token = req.cookies.get(SESSION_COOKIE)?.value ?? null;
  const sessionUser = await resolveSessionUser(process.env, token, Math.floor(Date.now() / 1000));

  const authHeader = req.headers.get('authorization');
  const basic = parseBasicHeader(authHeader);

  // Лимит проверяется ДО решения о доступе: даже верный пароль в окне
  // блокировки не должен проходить (как и у формы входа) — иначе перебор
  // просто продолжат другим паролем на «нужном» последнем шаге.
  if (basic) {
    const key = attemptKey(req, basic.name);
    if (isBlocked(key, Date.now())) {
      console.warn(`[middleware] Basic заблокирован: user=${JSON.stringify(basic.name)}`);
      return withNoIndex(
        NextResponse.json({ error: 'Слишком много попыток, попробуй позже' }, { status: 429 })
      );
    }
  }

  const result = resolveAccess(process.env, {
    method: req.method,
    pathname: req.nextUrl.pathname,
    sessionUser,
    authHeader,
    origin: req.headers.get('origin'),
    host: req.headers.get('host'),
  });
  const { decision } = result;

  warnOnce(decision);
  warnIfKillSwitchIgnored(process.env);

  if (isAllowed(decision)) {
    // Обнуляем счётчик, только если доступ дал именно этот Basic — не сессия,
    // не kill-switch, не открытый дев-режим, и не «путь публичен независимо
    // от заголовка»: во всех этих случаях `result.user` не совпадёт с именем
    // из заголовка, и обнулять чужой счётчик по случайному совпадению не за
    // что.
    if (basic && result.user === basic.name) {
      clearAttempts(attemptKey(req, basic.name));
    }
    return withNoIndex(NextResponse.next());
  }

  // `forbidden-origin` срабатывает ДО проверки пароля (см. resolveAccess) —
  // Basic здесь мог быть и верным, считать его провалом нельзя: иначе
  // легитимный запрос с чужим Origin забанил бы свою же учётку. Во всех
  // остальных ветках, раз доступа нет, пароль (если Basic вообще был)
  // уже проверен и не совпал.
  if (basic && decision !== 'forbidden-origin') {
    const attempt = registerFailure(attemptKey(req, basic.name), Date.now());
    const left = Math.max(0, LOGIN_MAX_ATTEMPTS - attempt.count);
    console.warn(`[middleware] неудачный Basic: user=${JSON.stringify(basic.name)}, осталось попыток ${left}`);
  }

  switch (decision) {
    case 'redirect-login': {
      const url = req.nextUrl.clone();
      url.pathname = '/login';
      url.search = '';
      // Возврат только на путь внутри сервиса: `next` попадает в редирект после
      // входа, и принять сюда абсолютный URL значило бы получить открытый
      // редирект на чужой домен из-под нашей формы.
      const target = `${req.nextUrl.pathname}${req.nextUrl.search}`;
      if (target.startsWith('/') && !target.startsWith('//')) {
        url.searchParams.set('next', target);
      }
      return withNoIndex(NextResponse.redirect(url));
    }

    case 'forbidden-origin':
      return withNoIndex(
        new NextResponse('Запрос с постороннего источника', { status: 403 })
      );

    case 'misconfigured':
      return withNoIndex(
        new NextResponse(
          'Авторизация не настроена: задай ADMIN_USERS и ADMIN_SESSION_SECRET',
          { status: 503 }
        )
      );

    case 'unauthorized':
    default:
      // WWW-Authenticate оставляем ради curl и скриптов с ADMIN_BASIC_AUTH.
      // Браузерный вход идёт через форму /login, поэтому на страницах отдаётся
      // редирект, а не этот вызов пароля.
      return withNoIndex(
        new NextResponse('Требуется авторизация', {
          status: 401,
          headers: { 'WWW-Authenticate': 'Basic realm="Ksamata Funnels Admin"' },
        })
      );
  }
}

// Guard everything except Next internals and static assets.
export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
