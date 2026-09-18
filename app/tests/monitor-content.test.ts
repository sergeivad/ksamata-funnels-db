/**
 * Признак «ответ 200, но за ним пусто». Образцы — настоящие страницы Bizon,
 * обрезанные до первых 4 КБ: заголовок лежит в <head>, дальше смотреть незачем.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  hasSoftMissingRule,
  softMissingReason,
  SOFT_MISSING_MAX_BYTES,
} from '../src/lib/monitor-content';

const fixture = (name: string) =>
  fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8');

describe('признак пропавшей комнаты', () => {
  it('срабатывает на странице несуществующей комнаты', () => {
    expect(softMissingReason('web.ksamatacenter.com', fixture('web-room-missing.html')))
      .toBe('Веб-комната не найдена');
  });

  it('молчит на странице живой комнаты', () => {
    expect(softMissingReason('web.ksamatacenter.com', fixture('web-room-live.html')))
      .toBeNull();
  });

  it('молчит на хосте, для которого правила нет', () => {
    expect(hasSoftMissingRule('gc.ksamata.ru')).toBe(false);
    expect(softMissingReason('gc.ksamata.ru', fixture('web-room-missing.html'))).toBeNull();
  });

  it('не принимает слова из текста страницы за заголовок', () => {
    const body = '<html><head><title>Суставы</title></head><body>Веб-комната не найдена</body></html>';
    expect(softMissingReason('web.ksamatacenter.com', body)).toBeNull();
  });

  it('бюджет чтения тела — 8 КБ', () => {
    expect(SOFT_MISSING_MAX_BYTES).toBe(8192);
  });
});
