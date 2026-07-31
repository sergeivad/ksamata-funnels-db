import type { MetadataRoute } from 'next';

/**
 * Сервис читается без авторизации, но попадать в поисковую выдачу ему незачем:
 * в карточках воронок URL лендов, ссылки GetCourse и внутренние комментарии.
 *
 * Это просьба, а не запрет — невежливый краулер её проигнорирует, поэтому
 * рядом работает заголовок `X-Robots-Tag` из мидлвары, который висит и на
 * ответах API.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: '*', disallow: '/' }],
  };
}
