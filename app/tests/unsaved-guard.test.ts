import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { registerUnsavedGuard, confirmUnsavedNavigation } from '../src/lib/useUnsavedGuard';

let confirmMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  confirmMock = vi.fn();
  vi.stubGlobal('window', { confirm: confirmMock });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('confirmUnsavedNavigation', () => {
  it('allows navigation without asking when nothing is dirty', () => {
    expect(confirmUnsavedNavigation()).toBe(true);
    expect(confirmMock).not.toHaveBeenCalled();
  });

  it('asks for confirmation while a guard is registered and respects the answer', () => {
    const unregister = registerUnsavedGuard();
    try {
      confirmMock.mockReturnValueOnce(false);
      expect(confirmUnsavedNavigation()).toBe(false);
      confirmMock.mockReturnValueOnce(true);
      expect(confirmUnsavedNavigation()).toBe(true);
      expect(confirmMock).toHaveBeenCalledTimes(2);
    } finally {
      unregister();
    }
  });

  it('stops asking after the guard is unregistered', () => {
    const unregister = registerUnsavedGuard();
    unregister();
    expect(confirmUnsavedNavigation()).toBe(true);
    expect(confirmMock).not.toHaveBeenCalled();
  });

  it('keeps asking while at least one of several guards remains', () => {
    const a = registerUnsavedGuard();
    const b = registerUnsavedGuard();
    a();
    confirmMock.mockReturnValueOnce(true);
    expect(confirmUnsavedNavigation()).toBe(true);
    expect(confirmMock).toHaveBeenCalledTimes(1);
    b();
    expect(confirmUnsavedNavigation()).toBe(true);
    expect(confirmMock).toHaveBeenCalledTimes(1);
  });
});
