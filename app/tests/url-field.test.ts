/**
 * Гигиена поля «Ссылка»: что блокируем, что только подсвечиваем.
 * Кейсы взяты из настоящих данных прода, а не выдуманы.
 */
import { describe, it, expect } from 'vitest';
import { checkUrlField, splitUrlAndLabel, urlFieldErrors } from '../src/lib/url-field';
import { normalizeUrl } from '../src/lib/monitor-urls';

describe('checkUrlField', () => {
  it('пропускает чистую ссылку', () => {
    expect(checkUrlField('https://t.ksamata.ru/nr/dbo/b').level).toBe('ok');
  });

  it('пропускает ссылку с query и якорем — & ? # не мусор', () => {
    expect(checkUrlField('https://gc.ksamata.ru/pl/tasks/mission/process?id=2186588&x=1#top').level).toBe('ok');
  });

  it('пропускает уже закодированный пробел: %20 — не пробел', () => {
    expect(checkUrlField('https://lp.ksamata.ru/a%20b').level).toBe('ok');
  });

  it('пустое поле — не ошибка, строку ещё заполняют', () => {
    expect(checkUrlField('').level).toBe('ok');
    expect(checkUrlField('   ').level).toBe('ok');
  });

  it('ругается на подпись, затекшую в ссылку, и предлагает починку', () => {
    const r = checkUrlField('https://t.ksamata.ru/ht/boo/a (ADS)');
    expect(r.level).toBe('error');
    if (r.level !== 'error') throw new Error('unreachable');
    expect(r.fix).toEqual({ url: 'https://t.ksamata.ru/ht/boo/a', label: 'ADS' });
  });

  it('ругается на хвостовую кавычку и срезает её', () => {
    const r = checkUrlField('https://t.ksamata.ru/nr/boo/d"');
    expect(r.level).toBe('error');
    if (r.level !== 'error') throw new Error('unreachable');
    expect(r.fix).toEqual({ url: 'https://t.ksamata.ru/nr/boo/d', label: '' });
  });

  it('дубль ссылки в скобках не превращается в подпись', () => {
    const r = checkUrlField('https://t.ksamata.ru/nr/dbo/b (https://t.ksamata.ru/nr/dbo/b)');
    expect(r.level).toBe('error');
    if (r.level !== 'error') throw new Error('unreachable');
    expect(r.fix).toEqual({ url: 'https://t.ksamata.ru/nr/dbo/b', label: '' });
  });

  it('текст вместо ссылки только предупреждает — такие пометки живут в блоках годами', () => {
    for (const v of ['сайты', 'геткурс', 'Получить бонус 2']) {
      expect(checkUrlField(v).level).toBe('warn');
    }
  });

  it('битую http-строку не пропускает', () => {
    expect(checkUrlField('https://').level).toBe('error');
  });
});

describe('связь с мониторингом', () => {
  it('именно ошибочные значения и порождают мусорные цели', () => {
    // Пробел не отбрасывается, а кодируется — отсюда призраки вида …/a%20(ADS).
    expect(normalizeUrl('https://t.ksamata.ru/ht/boo/a (ADS)')).toBe('https://t.ksamata.ru/ht/boo/a%20(ADS)');
    // А починенное значение даёт ровно ту же цель, что и чистая ссылка рядом.
    const fixed = splitUrlAndLabel('https://t.ksamata.ru/ht/boo/a (ADS)').url;
    expect(normalizeUrl(fixed)).toBe(normalizeUrl('https://t.ksamata.ru/ht/boo/a'));
  });

  it('предупреждение (класс B) целей не создаёт — блокировать нечего', () => {
    expect(normalizeUrl('сайты')).toBeNull();
  });
});

describe('urlFieldErrors', () => {
  it('отдаёт индексы только ошибочных строк', () => {
    const items = [
      { url: 'https://a.ru/x' },
      { url: 'сайты' },
      { url: 'https://b.ru/y "' },
      { url: '' },
    ];
    expect(urlFieldErrors(items)).toEqual([2]);
  });
});
