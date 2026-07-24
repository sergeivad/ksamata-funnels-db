import { describe, it, expect } from 'vitest';
import { normalizeUrl, splitUrlField } from '../src/lib/monitor-urls';

describe('normalizeUrl', () => {
  it('приводит голый хост к каноническому виду со слэшем', () => {
    expect(normalizeUrl('https://t.chistkaives.ru')).toBe('https://t.chistkaives.ru/');
    expect(normalizeUrl('https://t.chistkaives.ru/')).toBe('https://t.chistkaives.ru/');
  });

  it('сохраняет схему http как есть — её и надо проверять', () => {
    expect(normalizeUrl('http://lp.ksamata.ru/izh-yo')).toBe('http://lp.ksamata.ru/izh-yo');
  });

  it('срезает мусорный хвост', () => {
    expect(normalizeUrl('https://t.ksamatacenter.ru/rsya/dbo/a"')).toBe(
      'https://t.ksamatacenter.ru/rsya/dbo/a'
    );
    expect(normalizeUrl('  https://lp.ksamata.ru/rd-yo  ')).toBe('https://lp.ksamata.ru/rd-yo');
  });

  it('отбраковывает не-http, пустые и бесхостовые значения', () => {
    expect(normalizeUrl('')).toBeNull();
    expect(normalizeUrl('https://')).toBeNull();
    expect(normalizeUrl('нет ссылки')).toBeNull();
    expect(normalizeUrl('mailto:a@b.ru')).toBeNull();
    expect(normalizeUrl('https://localhost')).toBeNull();
  });

  it('отбраковывает IP-литералы, чтобы чекер не ходил во внутреннюю сеть', () => {
    expect(normalizeUrl('http://127.0.0.1/')).toBeNull();
    expect(normalizeUrl('http://10.0.0.5/')).toBeNull();
    expect(normalizeUrl('http://169.254.169.254/')).toBeNull(); // метаданные облака
    expect(normalizeUrl('http://192.168.1.1/admin')).toBeNull();
    expect(normalizeUrl('https://8.8.8.8/')).toBeNull(); // публичный IP — тоже не цель
    expect(normalizeUrl('http://[::1]/')).toBeNull();
    expect(normalizeUrl('http://[fd00::1]/x')).toBeNull();
    // URL сам приводит эти записи к 127.0.0.1 — проверяем нормализованный хост.
    expect(normalizeUrl('http://0177.0.0.1/')).toBeNull();
    expect(normalizeUrl('http://2130706433/')).toBeNull();
  });

  it('пропускает обычные доменные имена, в том числе с цифрами', () => {
    expect(normalizeUrl('https://lp.ksamata.ru/izh-yo')).toBe('https://lp.ksamata.ru/izh-yo');
    expect(normalizeUrl('https://t2.ksamata.ru/a')).toBe('https://t2.ksamata.ru/a');
  });
});

describe('splitUrlField', () => {
  it('возвращает пустой массив на пустом входе', () => {
    expect(splitUrlField('')).toEqual([]);
    expect(splitUrlField(null)).toEqual([]);
    expect(splitUrlField(undefined)).toEqual([]);
  });

  it('не ломает одиночную ссылку с путём', () => {
    expect(splitUrlField('https://lp.ksamata.ru/dtx-yo')).toEqual(['https://lp.ksamata.ru/dtx-yo']);
  });

  it('разбирает многоссылочное поле воронки №6 (в т.ч. двойной пробел)', () => {
    const raw =
      'https://t.chistkaives.ru / https://t.chistkaives.ru/boo  / https://t.detoxveslife.ru / https://t.detoxveslife.ru/boo / https://t.ksamatacenter.ru/rsya/boo/a';
    expect(splitUrlField(raw)).toEqual([
      'https://t.chistkaives.ru/',
      'https://t.chistkaives.ru/boo',
      'https://t.detoxveslife.ru/',
      'https://t.detoxveslife.ru/boo',
      'https://t.ksamatacenter.ru/rsya/boo/a',
    ]);
  });

  it('разбирает поле воронки №7 с хвостовой кавычкой', () => {
    const raw =
      'https://t.sustavy-spina.ru/spb / https://t.sustavy-spina.ru/ / https://t.spina-pozvon.ru/ / https://t.spina-pozvon.ru/spb / https://t.ksamatacenter.ru/rsya/dbo/a"';
    expect(splitUrlField(raw)).toEqual([
      'https://t.sustavy-spina.ru/spb',
      'https://t.sustavy-spina.ru/',
      'https://t.spina-pozvon.ru/',
      'https://t.spina-pozvon.ru/spb',
      'https://t.ksamatacenter.ru/rsya/dbo/a',
    ]);
  });

  it('схлопывает дубли внутри одного поля', () => {
    expect(splitUrlField('https://a.ru / https://a.ru/')).toEqual(['https://a.ru/']);
  });
});
