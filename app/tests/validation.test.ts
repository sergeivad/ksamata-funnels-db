import { describe, test, expect, it } from 'vitest';
import {
  funnelCreateSchema,
  funnelUpdateSchema,
  refCreateSchema,
  parseRouteId,
  tagTemplatePutSchema,
  tagsPatchSchema,
} from '../src/lib/validation';

const validFunnel = {
  num: 1,
  frontCode: 'f1',
  status: 'active' as const,
  productName: 'Суставы',
  variant: '',
  landingUrl: 'https://example.com',
  startDate: '2026-05-05',
  blockName: '',
  product: 'ТКМ',
  contractor: 'НИМБ',
  channel: 'Яндекс',
  direction: 'РСЯ',
  sourceName: 'main',
};

describe('funnelCreateSchema', () => {
  test('valid object passes', () => {
    expect(funnelCreateSchema.safeParse(validFunnel).success).toBe(true);
  });

  test('frontCode="" passes (new funnel without code)', () => {
    expect(
      funnelCreateSchema.safeParse({ ...validFunnel, frontCode: '' }).success
    ).toBe(true);
  });

  test('frontCode="f33" passes', () => {
    expect(
      funnelCreateSchema.safeParse({ ...validFunnel, frontCode: 'f33' }).success
    ).toBe(true);
  });

  test('frontCode="x7" is rejected', () => {
    expect(
      funnelCreateSchema.safeParse({ ...validFunnel, frontCode: 'x7' }).success
    ).toBe(false);
  });

  test('status="foo" is rejected', () => {
    expect(
      funnelCreateSchema.safeParse({ ...validFunnel, status: 'foo' }).success
    ).toBe(false);
  });

  test('status="draft" passes', () => {
    expect(
      funnelCreateSchema.safeParse({ ...validFunnel, status: 'draft' }).success
    ).toBe(true);
  });

  test('status="archive" passes', () => {
    expect(
      funnelCreateSchema.safeParse({ ...validFunnel, status: 'archive' }).success
    ).toBe(true);
  });

  test('empty product is rejected', () => {
    expect(
      funnelCreateSchema.safeParse({ ...validFunnel, product: '' }).success
    ).toBe(false);
  });

  test('120-char ref field passes, 121-char is rejected', () => {
    expect(
      funnelCreateSchema.safeParse({ ...validFunnel, contractor: 'a'.repeat(120) }).success
    ).toBe(true);
    expect(
      funnelCreateSchema.safeParse({ ...validFunnel, contractor: 'a'.repeat(121) }).success
    ).toBe(false);
  });

  test('over-length productName is rejected', () => {
    expect(
      funnelCreateSchema.safeParse({ ...validFunnel, productName: 'x'.repeat(201) }).success
    ).toBe(false);
  });

  test('startDate="" passes', () => {
    expect(
      funnelCreateSchema.safeParse({ ...validFunnel, startDate: '' }).success
    ).toBe(true);
  });

  test('startDate="2026-13-99" is rejected', () => {
    expect(
      funnelCreateSchema.safeParse({ ...validFunnel, startDate: '2026-13-99' }).success
    ).toBe(false);
  });

  test('landingUrl="" passes', () => {
    expect(
      funnelCreateSchema.safeParse({ ...validFunnel, landingUrl: '' }).success
    ).toBe(true);
  });

  test('landingUrl="not a url" is rejected', () => {
    expect(
      funnelCreateSchema.safeParse({ ...validFunnel, landingUrl: 'not a url' }).success
    ).toBe(false);
  });

  test('landingUrl="https://example.com" passes', () => {
    expect(
      funnelCreateSchema.safeParse({ ...validFunnel, landingUrl: 'https://example.com' }).success
    ).toBe(true);
  });

  test('num=0 is rejected', () => {
    expect(
      funnelCreateSchema.safeParse({ ...validFunnel, num: 0 }).success
    ).toBe(false);
  });
});

describe('funnelUpdateSchema', () => {
  test('empty object passes (all optional)', () => {
    expect(funnelUpdateSchema.safeParse({}).success).toBe(true);
  });

  test('partial valid update passes', () => {
    expect(
      funnelUpdateSchema.safeParse({ status: 'draft', productName: 'Позвоночник' }).success
    ).toBe(true);
  });

  test('status="archive" passes in partial update', () => {
    expect(
      funnelUpdateSchema.safeParse({ status: 'archive' }).success
    ).toBe(true);
  });

  test('invalid status still rejected in partial update', () => {
    expect(
      funnelUpdateSchema.safeParse({ status: 'foo' }).success
    ).toBe(false);
  });

  test('invalid frontCode still rejected in partial update', () => {
    expect(
      funnelUpdateSchema.safeParse({ frontCode: 'x7' }).success
    ).toBe(false);
  });
});

describe('refCreateSchema', () => {
  test('valid name passes', () => {
    expect(refCreateSchema.safeParse({ name: 'Яндекс' }).success).toBe(true);
  });

  test('empty name is rejected', () => {
    expect(refCreateSchema.safeParse({ name: '' }).success).toBe(false);
  });

  test('121-char name is rejected', () => {
    expect(
      refCreateSchema.safeParse({ name: 'a'.repeat(121) }).success
    ).toBe(false);
  });

  test('120-char name passes', () => {
    expect(
      refCreateSchema.safeParse({ name: 'a'.repeat(120) }).success
    ).toBe(true);
  });

  test('whitespace-only name is rejected', () => {
    expect(refCreateSchema.safeParse({ name: '   ' }).success).toBe(false);
  });

  test('surrounding whitespace is trimmed away', () => {
    const parsed = refCreateSchema.safeParse({ name: '  Яндекс  ' });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.name).toBe('Яндекс');
  });
});

describe('funnelCreateSchema axis trimming', () => {
  test('whitespace-only axis is rejected', () => {
    expect(
      funnelCreateSchema.safeParse({ ...validFunnel, product: '   ' }).success
    ).toBe(false);
  });

  test('axis surrounding whitespace is trimmed away', () => {
    const parsed = funnelCreateSchema.safeParse({ ...validFunnel, contractor: ' НИМБ ' });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.contractor).toBe('НИМБ');
  });
});

describe('parseRouteId', () => {
  test('parses plain digits', () => {
    expect(parseRouteId('12')).toBe(12);
  });

  test('rejects trailing garbage, floats, negatives and empty', () => {
    expect(parseRouteId('12abc')).toBeNull();
    expect(parseRouteId('12.9')).toBeNull();
    expect(parseRouteId('-1')).toBeNull();
    expect(parseRouteId('')).toBeNull();
    expect(parseRouteId('abc')).toBeNull();
  });
});

describe('tagTemplatePutSchema', () => {
  it('accepts a list of trimmed names', () => {
    const r = tagTemplatePutSchema.safeParse({ names: ['автоворонки', 'АВ Этап: Регистрация'] });
    expect(r.success).toBe(true);
  });
  it('rejects empty and over-long names', () => {
    expect(tagTemplatePutSchema.safeParse({ names: [''] }).success).toBe(false);
    expect(tagTemplatePutSchema.safeParse({ names: ['x'.repeat(121)] }).success).toBe(false);
  });
});

describe('tagsPatchSchema', () => {
  it('accepts a partial per-scenario add/remove map', () => {
    const r = tagsPatchSchema.safeParse({ reg: { add: ['промо'], remove: ['автоворонки'] } });
    expect(r.success).toBe(true);
  });
  it('rejects unknown scenario keys', () => {
    expect(tagsPatchSchema.safeParse({ nope: { add: [], remove: [] } }).success).toBe(false);
  });
});
