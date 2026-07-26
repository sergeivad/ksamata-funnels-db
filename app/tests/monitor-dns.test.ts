/**
 * Классификатор IP-адресов: пускаем ли чекер на адрес, который вернул резолвер.
 * Сети здесь нет — на вход подаются готовые строки адресов.
 */
import { describe, it, expect } from 'vitest';
import { isPrivateAddress } from '../src/lib/monitor-dns';

describe('isPrivateAddress — IPv4', () => {
  it('пускает обычные публичные адреса', () => {
    for (const ip of ['93.184.216.34', '8.8.8.8', '1.1.1.1', '213.180.204.242']) {
      expect(isPrivateAddress(ip), ip).toBe(false);
    }
  });

  it('заворачивает петлю, приватные сети и link-local', () => {
    for (const ip of [
      '127.0.0.1',
      '127.1.2.3',
      '10.0.0.5',
      '172.16.0.1',
      '172.31.255.254',
      '192.168.1.1',
      '169.254.169.254', // метаданные облака — главная цель SSRF
      '0.0.0.0',
    ]) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
  });

  it('не путает соседей приватных диапазонов с ними самими', () => {
    // 172.15/172.32 лежат ВНЕ 172.16.0.0/12, 11.x — вне 10/8.
    for (const ip of ['172.15.0.1', '172.32.0.1', '11.0.0.1', '192.169.0.1', '169.253.0.1']) {
      expect(isPrivateAddress(ip), ip).toBe(false);
    }
  });

  it('заворачивает CGNAT, мультикаст и зарезервированное', () => {
    for (const ip of ['100.64.0.1', '224.0.0.1', '240.0.0.1', '255.255.255.255', '198.18.0.1']) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
  });
});

describe('isPrivateAddress — IPv6', () => {
  it('пускает публичные адреса', () => {
    for (const ip of ['2606:4700:4700::1111', '2a02:6b8::2:242']) {
      expect(isPrivateAddress(ip), ip).toBe(false);
    }
  });

  it('заворачивает петлю, ULA и link-local', () => {
    for (const ip of ['::1', '::', 'fc00::1', 'fd12:3456::1', 'fe80::1', 'FE80::1']) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
  });

  it('распаковывает IPv4, вложенный в IPv6, и судит по нему', () => {
    // ::ffff:127.0.0.1 — та же петля, записанная как IPv6-mapped.
    expect(isPrivateAddress('::ffff:127.0.0.1')).toBe(true);
    expect(isPrivateAddress('::ffff:7f00:1')).toBe(true);
    expect(isPrivateAddress('::ffff:169.254.169.254')).toBe(true);
    expect(isPrivateAddress('64:ff9b::10.0.0.1')).toBe(true);
    // Тот же приём с публичным адресом внутри — пропускаем.
    expect(isPrivateAddress('::ffff:93.184.216.34')).toBe(false);
  });

  it('заворачивает зону-суффикс и мусор, а не пытается угадать', () => {
    for (const ip of ['fe80::1%eth0', 'не адрес', '', '999.1.1.1']) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
  });
});
