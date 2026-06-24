'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Toast from './Toast';

interface RefRow {
  id: number;
  name: string;
}

interface FunnelFormProps {
  mode: 'create' | 'edit';
  /** Full funnel detail for edit mode */
  initial?: {
    id: number;
    num: number;
    frontCode: string;
    status: 'active' | 'draft';
    productName: string;
    variant: string;
    landingUrl: string;
    startDate: string;
    blockName: string;
    axes: {
      product: string;
      contractor: string;
      channel: string;
      direction: string;
    };
    sourceName?: string;
  };
}

interface FormErrors {
  [key: string]: string;
}

interface ToastState {
  message: string;
  variant: 'success' | 'error';
  key: number;
}

// Regex guard for safe URL rendering
function isSafeUrl(url: string): boolean {
  return url.startsWith('http://') || url.startsWith('https://');
}

async function fetchRefs(kind: string): Promise<RefRow[]> {
  const res = await fetch(`/api/refs/${kind}`);
  if (!res.ok) return [];
  return res.json();
}

async function addRef(kind: string, name: string): Promise<RefRow | null> {
  const res = await fetch(`/api/refs/${kind}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) return null;
  return res.json();
}

interface RefSelectProps {
  label: string;
  kind: string;
  value: string;
  onChange: (val: string) => void;
  required?: boolean;
  error?: string;
}

function RefSelect({ label, kind, value, onChange, required, error }: RefSelectProps) {
  const [refs, setRefs] = useState<RefRow[]>([]);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [addError, setAddError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchRefs(kind).then((rows) => {
      setRefs(rows);
      setLoading(false);
    });
  }, [kind]);

  async function handleAdd() {
    const trimmed = newName.trim();
    if (!trimmed) {
      setAddError('Введите название');
      return;
    }
    setAddError('');
    const row = await addRef(kind, trimmed);
    if (!row) {
      setAddError('Ошибка при добавлении');
      return;
    }
    setRefs((prev) => {
      // Avoid duplicate
      if (prev.some((r) => r.id === row.id)) return prev;
      return [...prev, row].sort((a, b) => a.name.localeCompare(b.name));
    });
    onChange(row.name);
    setNewName('');
    setAdding(false);
  }

  return (
    <div className="flex flex-col gap-1">
      <label className="text-[12px] font-semibold text-[var(--color-text-secondary)]">
        {label}
        {required && <span className="ml-1 text-[#B42318]">*</span>}
      </label>

      {loading ? (
        <div className="h-9 rounded-[8px] border border-[var(--color-border-soft)] bg-white/60 px-3 py-2 text-[13px] text-[var(--color-text-secondary)]">
          Загрузка...
        </div>
      ) : (
        <select
          value={value}
          onChange={(e) => {
            if (e.target.value === '__add__') {
              setAdding(true);
            } else {
              onChange(e.target.value);
            }
          }}
          className={[
            'h-9 w-full rounded-[8px] border bg-white px-3 py-2 text-[13px] text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]',
            error
              ? 'border-[#B42318]'
              : 'border-[var(--color-border-soft)]',
          ].join(' ')}
        >
          <option value="">— выберите —</option>
          {refs.map((r) => (
            <option key={r.id} value={r.name}>
              {r.name}
            </option>
          ))}
          <option value="__add__">＋ Добавить новое...</option>
        </select>
      )}

      {adding && (
        <div className="mt-1 flex gap-2">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
            placeholder="Название..."
            className="min-w-0 flex-1 rounded-[6px] border border-[var(--color-border-soft)] bg-white px-2.5 py-1.5 text-[12px] text-[var(--color-text)] placeholder:text-[var(--color-text-secondary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)]"
            autoFocus
          />
          <button
            type="button"
            onClick={handleAdd}
            className="rounded-[6px] border border-[var(--color-border-soft)] bg-white px-3 py-1.5 text-[12px] font-semibold text-[var(--color-text)] transition hover:border-[#111111]"
          >
            Добавить
          </button>
          <button
            type="button"
            onClick={() => {
              setAdding(false);
              setNewName('');
              setAddError('');
            }}
            className="rounded-[6px] border border-[var(--color-border-soft)] bg-white px-3 py-1.5 text-[12px] text-[var(--color-text-secondary)] transition hover:border-[#111111]"
          >
            Отмена
          </button>
        </div>
      )}

      {(error || addError) && (
        <p className="text-[11px] text-[#B42318]">{error || addError}</p>
      )}
    </div>
  );
}

export default function FunnelForm({ mode, initial }: FunnelFormProps) {
  const router = useRouter();
  const toastKeyRef = useRef(0);

  const [fields, setFields] = useState({
    num: initial?.num ?? '',
    frontCode: initial?.frontCode ?? '',
    status: (initial?.status ?? 'draft') as 'active' | 'draft',
    productName: initial?.productName ?? '',
    variant: initial?.variant ?? '',
    landingUrl: initial?.landingUrl ?? '',
    startDate: initial?.startDate ?? '',
    blockName: initial?.blockName ?? '',
    product: initial?.axes.product ?? '',
    contractor: initial?.axes.contractor ?? '',
    channel: initial?.axes.channel ?? '',
    direction: initial?.axes.direction ?? '',
    sourceName: initial?.sourceName ?? '',
  });

  const [errors, setErrors] = useState<FormErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);

  function showToast(message: string, variant: 'success' | 'error') {
    toastKeyRef.current += 1;
    setToast({ message, variant, key: toastKeyRef.current });
  }

  function set(field: string, value: string | number) {
    setFields((prev) => ({ ...prev, [field]: value }));
    // Clear error on change
    if (errors[field]) {
      setErrors((prev) => {
        const next = { ...prev };
        delete next[field];
        return next;
      });
    }
  }

  function validate(): FormErrors {
    const errs: FormErrors = {};
    const numVal = Number(fields.num);

    if (!fields.num || isNaN(numVal) || numVal <= 0 || !Number.isInteger(numVal)) {
      errs.num = 'Введите положительное целое число';
    }

    if (fields.frontCode && !/^f\d+$/.test(fields.frontCode)) {
      errs.frontCode = 'Должен быть вида f123 или пустым';
    }

    if (fields.landingUrl && !isSafeUrl(fields.landingUrl)) {
      // Allow empty or http/https
      try {
        new URL(fields.landingUrl);
        // URL is syntactically valid but not http/https
        // We'll store it but warn
      } catch {
        errs.landingUrl = 'Некорректный URL';
      }
    }

    if (fields.startDate && !/^\d{4}-\d{2}-\d{2}$/.test(fields.startDate)) {
      errs.startDate = 'Формат: ГГГГ-ММ-ДД';
    }

    if (!fields.product) errs.product = 'Обязательное поле';
    if (!fields.contractor) errs.contractor = 'Обязательное поле';
    if (!fields.channel) errs.channel = 'Обязательное поле';
    if (!fields.direction) errs.direction = 'Обязательное поле';
    if (!fields.sourceName) errs.sourceName = 'Обязательное поле';

    return errs;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    const errs = validate();
    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      return;
    }

    setSubmitting(true);

    const payload = {
      num: Number(fields.num),
      frontCode: fields.frontCode,
      status: fields.status,
      productName: fields.productName,
      variant: fields.variant,
      landingUrl: fields.landingUrl,
      startDate: fields.startDate,
      blockName: fields.blockName,
      product: fields.product,
      contractor: fields.contractor,
      channel: fields.channel,
      direction: fields.direction,
      sourceName: fields.sourceName,
    };

    try {
      let res: Response;

      if (mode === 'create') {
        res = await fetch('/api/funnels', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      } else {
        res = await fetch(`/api/funnels/${initial!.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      }

      if (res.status === 409) {
        setErrors({ num: `Воронка с номером ${fields.num} уже существует` });
        setSubmitting(false);
        return;
      }

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? 'Ошибка сервера');
      }

      showToast(
        mode === 'create' ? 'Воронка создана' : 'Воронка сохранена',
        'success'
      );

      // Navigate back after short delay to let Toast show
      setTimeout(() => {
        router.push('/');
      }, 800);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Произошла ошибка';
      showToast(msg, 'error');
      setSubmitting(false);
    }
  }

  const inputClass = (field: string) =>
    [
      'h-9 w-full rounded-[8px] border bg-white px-3 py-2 text-[13px] text-[var(--color-text)] placeholder:text-[var(--color-text-secondary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]',
      errors[field] ? 'border-[#B42318]' : 'border-[var(--color-border-soft)]',
    ].join(' ');

  const labelClass = 'text-[12px] font-semibold text-[var(--color-text-secondary)]';
  const errClass = 'text-[11px] text-[#B42318]';

  const landingUrlSafe = fields.landingUrl && isSafeUrl(fields.landingUrl);

  return (
    <>
      <form onSubmit={handleSubmit} className="mx-auto max-w-[640px] px-4 py-8">
        <div className="mb-6 flex items-center gap-3">
          <button
            type="button"
            onClick={() => router.push('/')}
            className="text-[13px] text-[var(--color-text-secondary)] underline hover:text-[var(--color-text)] transition"
          >
            ← Список воронок
          </button>
          <h1 className="text-[18px] font-semibold text-[var(--color-text)]">
            {mode === 'create' ? 'Новая воронка' : `Редактировать воронку #${initial?.num}`}
          </h1>
        </div>

        <div className="grid gap-4 rounded-[12px] border border-[var(--color-border-soft)] bg-[var(--color-bg-panel)] p-6">
          {/* ── Basic fields ─────────────────────────────────────────── */}
          <div className="grid grid-cols-2 gap-4">
            {/* num */}
            <div className="flex flex-col gap-1">
              <label className={labelClass}>
                Номер (num) <span className="text-[#B42318]">*</span>
              </label>
              <input
                type="number"
                min={1}
                step={1}
                value={fields.num}
                onChange={(e) => set('num', e.target.value)}
                placeholder="33"
                className={inputClass('num')}
              />
              {errors.num && <p className={errClass}>{errors.num}</p>}
            </div>

            {/* frontCode */}
            <div className="flex flex-col gap-1">
              <label className={labelClass}>Код фронта (frontCode)</label>
              <input
                type="text"
                value={fields.frontCode}
                onChange={(e) => set('frontCode', e.target.value)}
                placeholder="f33"
                className={inputClass('frontCode')}
              />
              {errors.frontCode && <p className={errClass}>{errors.frontCode}</p>}
            </div>
          </div>

          {/* status */}
          <div className="flex flex-col gap-1">
            <label className={labelClass}>Статус</label>
            <select
              value={fields.status}
              onChange={(e) => set('status', e.target.value)}
              className="h-9 w-full rounded-[8px] border border-[var(--color-border-soft)] bg-white px-3 py-2 text-[13px] text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
            >
              <option value="draft">Черновик</option>
              <option value="active">Активна</option>
            </select>
          </div>

          {/* productName */}
          <div className="flex flex-col gap-1">
            <label className={labelClass}>Название продукта</label>
            <input
              type="text"
              value={fields.productName}
              onChange={(e) => set('productName', e.target.value)}
              placeholder="БОО 5-дневный"
              className={inputClass('productName')}
            />
          </div>

          {/* variant */}
          <div className="flex flex-col gap-1">
            <label className={labelClass}>Вариант</label>
            <input
              type="text"
              value={fields.variant}
              onChange={(e) => set('variant', e.target.value)}
              placeholder="А, Б, В..."
              className={inputClass('variant')}
            />
          </div>

          {/* landingUrl */}
          <div className="flex flex-col gap-1">
            <label className={labelClass}>Landing URL</label>
            <input
              type="text"
              value={fields.landingUrl}
              onChange={(e) => set('landingUrl', e.target.value)}
              placeholder="https://..."
              className={inputClass('landingUrl')}
            />
            {errors.landingUrl && <p className={errClass}>{errors.landingUrl}</p>}
            {/* XSS guard: only render as link when safe */}
            {fields.landingUrl && (
              <div className="text-[11px] text-[var(--color-text-secondary)]">
                {landingUrlSafe ? (
                  <a
                    href={fields.landingUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[var(--color-accent)] underline"
                  >
                    {fields.landingUrl}
                  </a>
                ) : (
                  <span className="text-[#B42318]">
                    Небезопасный URL — не будет отображён как ссылка: {fields.landingUrl}
                  </span>
                )}
              </div>
            )}
          </div>

          {/* startDate */}
          <div className="flex flex-col gap-1">
            <label className={labelClass}>Дата старта (ГГГГ-ММ-ДД)</label>
            <input
              type="date"
              value={fields.startDate}
              onChange={(e) => set('startDate', e.target.value)}
              className={inputClass('startDate')}
            />
            {errors.startDate && <p className={errClass}>{errors.startDate}</p>}
          </div>

          {/* blockName */}
          <div className="flex flex-col gap-1">
            <label className={labelClass}>Блок</label>
            <input
              type="text"
              value={fields.blockName}
              onChange={(e) => set('blockName', e.target.value)}
              placeholder="Название блока"
              className={inputClass('blockName')}
            />
          </div>

          {/* ── АВ-axes ─────────────────────────────────────────────── */}
          <hr className="border-[var(--color-border-soft)]" />
          <p className="text-[12px] font-semibold text-[var(--color-text-secondary)]">
            АВ-оси (из справочников)
          </p>

          <RefSelect
            label="Продукт"
            kind="products"
            value={fields.product}
            onChange={(v) => set('product', v)}
            required
            error={errors.product}
          />

          <RefSelect
            label="Подрядчик"
            kind="contractors"
            value={fields.contractor}
            onChange={(v) => set('contractor', v)}
            required
            error={errors.contractor}
          />

          {/* channel — free text (no dedicated ref table) */}
          <div className="flex flex-col gap-1">
            <label className={labelClass}>
              Канал <span className="text-[#B42318]">*</span>
            </label>
            <input
              type="text"
              value={fields.channel}
              onChange={(e) => set('channel', e.target.value)}
              placeholder="ВК, ТГ, Email..."
              className={inputClass('channel')}
            />
            {errors.channel && <p className={errClass}>{errors.channel}</p>}
          </div>

          {/* direction — free text */}
          <div className="flex flex-col gap-1">
            <label className={labelClass}>
              Направление <span className="text-[#B42318]">*</span>
            </label>
            <input
              type="text"
              value={fields.direction}
              onChange={(e) => set('direction', e.target.value)}
              placeholder="Горячая, Холодная..."
              className={inputClass('direction')}
            />
            {errors.direction && <p className={errClass}>{errors.direction}</p>}
          </div>

          <RefSelect
            label="Источник"
            kind="sources"
            value={fields.sourceName}
            onChange={(v) => set('sourceName', v)}
            required
            error={errors.sourceName}
          />

          {/* ── Submit ──────────────────────────────────────────────── */}
          <div className="mt-2 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={() => router.push('/')}
              className="rounded-[8px] border border-[var(--color-border-soft)] bg-white px-4 py-2 text-[13px] text-[var(--color-text)] transition hover:border-[#111111]"
            >
              Отмена
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="rounded-[8px] bg-[var(--color-accent)] px-5 py-2 text-[13px] font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
            >
              {submitting
                ? 'Сохранение...'
                : mode === 'create'
                  ? 'Создать воронку'
                  : 'Сохранить изменения'}
            </button>
          </div>
        </div>
      </form>

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 pointer-events-none">
          <Toast
            key={toast.key}
            message={toast.message}
            variant={toast.variant}
            onClose={() => setToast(null)}
          />
        </div>
      )}
    </>
  );
}
