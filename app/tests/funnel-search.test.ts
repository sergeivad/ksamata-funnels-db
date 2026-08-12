import { describe, test, expect } from 'vitest';
import {
  isSearching,
  matchesSearch,
  isFunnelVisible,
  type SearchableFunnel,
} from '../src/lib/funnel-search';

const archived: SearchableFunnel = { name: 'ЖКТ — Иванов', frontCode: 'f58', status: 'archive' };
const draft: SearchableFunnel = { name: 'СВС — Петров', frontCode: 'f81', status: 'draft' };
const active: SearchableFunnel = { name: 'ДБО — Сидоров', frontCode: 'f70', status: 'active' };

describe('isSearching', () => {
  test('пустая строка и пробелы поиском не считаются', () => {
    expect(isSearching('')).toBe(false);
    expect(isSearching('   ')).toBe(false);
    expect(isSearching(' f5 ')).toBe(true);
  });
});

describe('matchesSearch', () => {
  test('ищет по имени и F-коду, без учёта регистра', () => {
    expect(matchesSearch(active, 'сидоров')).toBe(true);
    expect(matchesSearch(active, 'F70')).toBe(true);
    expect(matchesSearch(active, '70')).toBe(true);
    expect(matchesSearch(active, 'петров')).toBe(false);
  });

  test('пустой запрос пропускает всё', () => {
    expect(matchesSearch(active, '  ')).toBe(true);
  });
});

/**
 * Главное правило: поиск отменяет вкладку. До этого условия перемножались, и
 * найти воронку можно было только в том разделе, где человек уже стоит —
 * запрос по архивной воронке на «Активных» отвечал «Ничего не найдено».
 */
describe('isFunnelVisible', () => {
  test('поиск находит воронку любого статуса из любого раздела', () => {
    expect(isFunnelVisible(archived, 'active', 'f58')).toBe(true);
    expect(isFunnelVisible(draft, 'archive', 'петров')).toBe(true);
    expect(isFunnelVisible(active, 'draft', 'f70')).toBe(true);
  });

  test('архив виден при поиске и с вкладки «Все», которая его прячет', () => {
    expect(isFunnelVisible(archived, 'all', 'жкт')).toBe(true);
    expect(isFunnelVisible(archived, 'all', '')).toBe(false);
  });

  test('не подходящая под запрос воронка не всплывает из чужого раздела', () => {
    expect(isFunnelVisible(archived, 'archive', 'сидоров')).toBe(false);
  });

  test('без запроса работает прежняя фильтрация по вкладке', () => {
    expect(isFunnelVisible(draft, 'draft', '')).toBe(true);
    expect(isFunnelVisible(draft, 'active', '   ')).toBe(false);
    expect(isFunnelVisible(active, 'all', '')).toBe(true);
  });
});
