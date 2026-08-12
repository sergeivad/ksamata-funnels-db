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
 * Правило: вкладка и запрос перемножаются, а по всем воронкам поиск идёт
 * потому, что при первом же нажатии список сам встаёт на «Все» (это делает
 * страница, `handleSearchChange`). Раньше это же решала сама функция —
 * игнорировала вкладку, пока идёт поиск, — и вкладка при этом врала: стояла
 * «Активные», а в выдаче был архив.
 */
describe('isFunnelVisible', () => {
  test('с вкладки «Все» поиск достаёт воронку любого статуса', () => {
    expect(isFunnelVisible(archived, 'all', 'f58')).toBe(true);
    expect(isFunnelVisible(draft, 'all', 'петров')).toBe(true);
    expect(isFunnelVisible(active, 'all', 'f70')).toBe(true);
  });

  test('«Все» показывает и архив — с запросом и без', () => {
    expect(isFunnelVisible(archived, 'all', 'жкт')).toBe(true);
    expect(isFunnelVisible(archived, 'all', '')).toBe(true);
  });

  test('вкладку, выбранную поверх поиска, запрос не отменяет', () => {
    expect(isFunnelVisible(archived, 'active', 'f58')).toBe(false);
    expect(isFunnelVisible(archived, 'archive', 'f58')).toBe(true);
  });

  test('не подходящая под запрос воронка не всплывает из чужого раздела', () => {
    expect(isFunnelVisible(archived, 'archive', 'сидоров')).toBe(false);
  });

  test('без запроса работает фильтрация по вкладке', () => {
    expect(isFunnelVisible(draft, 'draft', '')).toBe(true);
    expect(isFunnelVisible(draft, 'active', '   ')).toBe(false);
    expect(isFunnelVisible(active, 'all', '')).toBe(true);
  });
});
