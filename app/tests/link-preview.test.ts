/**
 * Опознание ботов предпросмотра ссылок по User-Agent.
 *
 * Строки взяты настоящие — так, как площадки представляются на самом деле;
 * подогнанные под реализацию «telegrambot» ничего бы не проверяли.
 */
import { describe, it, expect } from 'vitest';
import { isLinkPreviewBot } from '../src/lib/link-preview';

describe('isLinkPreviewBot', () => {
  it('опознаёт ботов мессенджеров', () => {
    const bots = [
      'TelegramBot (like TwitterBot)',
      'WhatsApp/2.23.20.0 A',
      'Mozilla/5.0 (compatible; vkShare; +http://vk.com/dev/Share)',
      'Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)',
      'Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)',
      'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
      'Mozilla/5.0 (compatible; SkypeUriPreview Preview/0.5)',
      'Mozilla/5.0 (compatible; LinkedInBot/1.0; +https://www.linkedin.com)',
      'Mozilla/5.0 (Windows NT 6.1; WOW64) ViberUrlDownloader',
    ];
    for (const ua of bots) expect(isLinkPreviewBot(ua), ua).toBe(true);
  });

  it('не трогает людей и служебные обходчики', () => {
    // Живой браузер, мобильный браузер, curl из скрипта и собственный монитор
    // доступности лендингов — все должны получать обычный ответ.
    const humans = [
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
      'curl/8.4.0',
      'KsamataFunnelsMonitor/1.0',
      null,
      undefined,
      '',
    ];
    for (const ua of humans) expect(isLinkPreviewBot(ua), String(ua)).toBe(false);
  });

  it('не зависит от регистра', () => {
    expect(isLinkPreviewBot('telegrambot')).toBe(true);
    expect(isLinkPreviewBot('TELEGRAMBOT')).toBe(true);
  });
});
