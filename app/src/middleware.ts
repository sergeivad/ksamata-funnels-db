import { NextRequest, NextResponse } from 'next/server';
import {
  SESSION_COOKIE,
  isAllowed,
  resolveAccess,
  resolveSessionUser,
  type AccessDecision,
} from '@/lib/auth';

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
 * правкой и молча.
 *
 * Переменные окружения:
 *  - `ADMIN_USERS` — `имя:пароль`, через запятую или перевод строки;
 *  - `ADMIN_SESSION_SECRET` — ключ подписи сессии, обязателен в проде;
 *  - `ADMIN_BASIC_AUTH` — совместимость: одиночная учётка для curl/скриптов;
 *  - `PUBLIC_READ_ENABLED=false` — закрыть и чтение тоже (возврат к прежней модели);
 *  - `ADMIN_AUTH_DISABLED=true` — kill-switch: авторизации нет вообще.
 */

// Предупреждаем один раз на процесс — не заваливая лог на каждом запросе.
let warnedOpen = false;
let warnedKilled = false;

function warnOnce(decision: AccessDecision): void {
  if (decision === 'disabled' && !warnedKilled) {
    warnedKilled = true;
    console.warn(
      '[middleware] ADMIN_AUTH_DISABLED=true — авторизация выключена полностью: ' +
      'любой посетитель может править данные. Убери переменную, чтобы вернуть вход.'
    );
  }
  if (decision === 'open' && !warnedOpen) {
    warnedOpen = true;
    console.warn(
      '[middleware] ADMIN_USERS не задан — авторизация не настроена, править может кто угодно. ' +
      'Задай ADMIN_USERS="имя:пароль" и ADMIN_SESSION_SECRET, чтобы включить вход.'
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

  const { decision } = resolveAccess(process.env, {
    method: req.method,
    pathname: req.nextUrl.pathname,
    sessionUser,
    authHeader: req.headers.get('authorization'),
    origin: req.headers.get('origin'),
    host: req.headers.get('host'),
  });

  warnOnce(decision);

  if (isAllowed(decision)) {
    return withNoIndex(NextResponse.next());
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
