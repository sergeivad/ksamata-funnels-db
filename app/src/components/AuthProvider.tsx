'use client';

import { createContext, useContext } from 'react';

export interface AuthState {
  /** Имя редактора или `null` для анонимного посетителя. */
  user: string | null;
  /** Показывать ли редакторские элементы. */
  canEdit: boolean;
}

const AuthContext = createContext<AuthState>({ user: null, canEdit: false });

/**
 * Право на правку приходит из серверного layout и раздаётся всему клиентскому
 * дереву через контекст — иначе флаг пришлось бы протаскивать пропсами через
 * пять уровней компонентов.
 *
 * Значение по умолчанию — «только просмотр»: компонент, отрисованный вне
 * провайдера (в тесте, в новой ветке дерева), скрывает кнопки правки, а не
 * показывает их. Это правильная сторона ошибки.
 */
export function AuthProvider({ value, children }: { value: AuthState; children: React.ReactNode }) {
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/** Права текущего посетителя. */
export function useAuth(): AuthState {
  return useContext(AuthContext);
}

/**
 * Короткая форма для самого частого случая.
 *
 * Это отражение прав в интерфейсе, а НЕ рубеж защиты: спрятанная кнопка ничего
 * не запрещает. Запрещают мидлвара и `requireEditor` в роутах.
 */
export function useCanEdit(): boolean {
  return useContext(AuthContext).canEdit;
}
