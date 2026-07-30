'use client';

import { useRef, useState } from 'react';
import { Trash2, Plus, Copy, Check, AlertCircle, ExternalLink, ListPlus, Wand2 } from 'lucide-react';
import type { BlockItem } from '@/lib/funnel-blocks';
import { parsePastedLine, missingStandardLabels } from '@/lib/block-fill';
import { checkUrlField } from '@/lib/url-field';
import { copyText } from '@/lib/clipboard';
import { useCanEdit } from './AuthProvider';

interface Props {
  fields: 1 | 2;
  slot: '15' | '19' | null;
  items: BlockItem[];
  onChange: (items: BlockItem[]) => void;
  /** Only for kind==='links' (fields===2): show the "Стандартный набор" button. */
  showStandardSet?: boolean;
}

export default function BlockListField({ fields, slot, items, onChange, showStandardSet }: Props) {
  const canEdit = useCanEdit();
  const rows = items.filter((it) => it.slot === slot);

  // Which row currently flashes a copy result (index within `rows`).
  const [copyFlash, setCopyFlash] = useState<{ index: number; ok: boolean } | null>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function update(indexInRows: number, patch: Partial<BlockItem>) {
    // Поля в просмотре readOnly, но Enter и вставка на readOnly-инпуте всё
    // равно доходят до обработчика — мутацию отсекаем здесь, а не только в вёрстке.
    if (!canEdit) return;
    let seen = -1;
    onChange(
      items.map((it) => {
        if (it.slot !== slot) return it;
        seen += 1;
        return seen === indexInRows ? { ...it, ...patch } : it;
      }),
    );
  }

  function remove(indexInRows: number) {
    if (!canEdit) return;
    let seen = -1;
    onChange(items.filter((it) => (it.slot === slot ? ++seen !== indexInRows : true)));
  }

  function add() {
    if (!canEdit) return;
    onChange([...items, { slot, label: '', url: '' }]);
  }

  /**
   * Чинит строку класса A: чистая ссылка остаётся в поле, а затекший хвост
   * уходит в подпись — но только если поле подписи есть и оно пустое, иначе
   * чужую подпись бы затёрло.
   */
  function fixRow(indexInRows: number) {
    if (!canEdit) return;
    const row = rows[indexInRows];
    const check = checkUrlField(row.url);
    if (check.level !== 'error') return;
    const takeLabel = fields === 2 && !row.label.trim() && check.fix.label !== '';
    update(indexInRows, { url: check.fix.url, ...(takeLabel ? { label: check.fix.label } : {}) });
  }

  const missingStandard = showStandardSet ? missingStandardLabels(rows.map((r) => r.label)) : [];

  function addStandardSet() {
    if (!canEdit) return;
    if (missingStandard.length === 0) return;
    onChange([...items, ...missingStandard.map((label) => ({ slot, label, url: '' }))]);
  }

  function handleUrlPaste(indexInRows: number, e: React.ClipboardEvent<HTMLInputElement>) {
    if (!canEdit) return;
    const text = e.clipboardData.getData('text');
    // Single line — default behaviour. Trim first: a copied spreadsheet cell
    // ends with "\n" but is still one line, not a multi-row paste.
    if (!text.trim().includes('\n')) return;
    e.preventDefault();

    const lines = text.split('\n').map((l) => l.trim()).filter((l) => l !== '');
    if (lines.length === 0) return;

    const parsed = lines.map(parsePastedLine);
    const [first, ...rest] = parsed;
    const currentRow = rows[indexInRows];

    let seen = -1;
    const withFirstApplied = items.map((it) => {
      if (it.slot !== slot) return it;
      seen += 1;
      if (seen !== indexInRows) return it;
      const nextLabel = fields === 2 && !currentRow.label.trim() && first.label ? first.label : it.label;
      return { ...it, url: first.url, label: nextLabel };
    });

    if (rest.length === 0) {
      onChange(withFirstApplied);
      return;
    }

    // Insert the remaining rows right after the current row (within this slot).
    let insertAt = -1;
    let seen2 = -1;
    withFirstApplied.forEach((it, idx) => {
      if (it.slot === slot) {
        seen2 += 1;
        if (seen2 === indexInRows) insertAt = idx;
      }
    });
    const newRows: BlockItem[] = rest.map((p) => ({ slot, label: fields === 2 ? p.label : '', url: p.url }));
    const next = [
      ...withFirstApplied.slice(0, insertAt + 1),
      ...newRows,
      ...withFirstApplied.slice(insertAt + 1),
    ];
    onChange(next);
  }

  async function copy(indexInRows: number, url: string) {
    const value = url.trim();
    if (!value) return;
    const ok = await copyText(value);
    if (copyTimer.current) clearTimeout(copyTimer.current);
    setCopyFlash({ index: indexInRows, ok });
    copyTimer.current = setTimeout(() => setCopyFlash(null), 1500);
  }

  const gtc =
    fields === 2
      ? 'minmax(120px,260px) minmax(0,1fr) 24px 24px 24px'
      : 'minmax(0,1fr) 24px 24px 24px';

  return (
    <div className="flex flex-col gap-1.5">
      {fields === 2 && rows.length > 0 && (
        <div className="grid gap-2 text-[10px] uppercase tracking-wide text-[var(--faint)]" style={{ gridTemplateColumns: gtc }}>
          <span>Описание</span><span>Ссылка</span><span /><span /><span />
        </div>
      )}
      {rows.map((row, i) => {
        const hasUrl = row.url.trim() !== '';
        const openableUrl = /^https?:\/\//i.test(row.url.trim()) ? row.url.trim() : null;
        const flash = copyFlash?.index === i ? copyFlash : null;
        const check = checkUrlField(row.url);
        const urlBorder =
          check.level === 'error'
            ? 'border-[#B42318]'
            : check.level === 'warn'
              ? 'border-[#B4841C]'
              : 'border-[var(--line-soft)]';
        return (
          <div key={i} className="flex flex-col gap-1">
          <div className="grid items-center gap-2" style={{ gridTemplateColumns: gtc }}>
            {fields === 2 && (
              <input
                value={row.label}
                onChange={(e) => update(i, { label: e.target.value })}
                placeholder="описание…"
                readOnly={!canEdit}
                className="h-7 w-full min-w-0 rounded-[6px] border border-[var(--line-soft)] bg-white px-2 text-[12px] text-[var(--ink)]"
              />
            )}
            {/* URL input + hover tooltip showing the full link */}
            <div className="group relative min-w-0">
              <input
                value={row.url}
                onChange={(e) => update(i, { url: e.target.value })}
                onKeyDown={(e) => e.key === 'Enter' && add()}
                onPaste={(e) => handleUrlPaste(i, e)}
                placeholder="ссылка…"
                title={row.url}
                readOnly={!canEdit}
                aria-invalid={check.level === 'error'}
                className={`h-7 w-full min-w-0 rounded-[6px] border ${urlBorder} bg-white px-2 font-mono text-[12px] text-[var(--ink)]`}
              />
              {hasUrl && (
                <span
                  role="tooltip"
                  className="pointer-events-none absolute bottom-full left-0 z-10 mb-1 hidden w-max max-w-[min(420px,90vw)] break-all rounded-[6px] bg-[var(--ink)] px-2 py-1 font-mono text-[11px] leading-snug text-white opacity-0 shadow-md transition-opacity duration-150 group-hover:block group-hover:opacity-100"
                >
                  {row.url}
                </span>
              )}
            </div>
            {openableUrl ? (
              <a
                href={openableUrl}
                target="_blank"
                rel="noreferrer"
                aria-label="Открыть в новой вкладке"
                title="Открыть в новой вкладке"
                className="flex justify-center text-[var(--faint)] transition hover:text-[var(--ink)]"
              >
                <ExternalLink size={15} />
              </a>
            ) : (
              <span
                aria-hidden
                className="flex justify-center text-[var(--faint)] opacity-30"
              >
                <ExternalLink size={15} />
              </span>
            )}
            <button
              type="button"
              onClick={() => copy(i, row.url)}
              disabled={!hasUrl}
              aria-label={flash ? (flash.ok ? 'Скопировано' : 'Не удалось скопировать') : 'Копировать ссылку'}
              title={flash ? (flash.ok ? 'Скопировано' : 'Не удалось скопировать') : 'Копировать ссылку'}
              className={`flex justify-center transition disabled:cursor-default disabled:opacity-30 ${
                flash
                  ? flash.ok
                    ? 'text-[#087443]'
                    : 'text-[#B42318]'
                  : 'text-[var(--faint)] hover:text-[var(--ink)]'
              }`}
            >
              {flash ? (flash.ok ? <Check size={15} /> : <AlertCircle size={15} />) : <Copy size={15} />}
            </button>
            {canEdit ? (
              <button type="button" onClick={() => remove(i)} aria-label="Удалить строку" className="flex justify-center text-[var(--faint)] hover:text-[var(--ink)]">
                <Trash2 size={15} />
              </button>
            ) : (
              // Колонка остаётся на месте: сетка задана gridTemplateColumns, и
              // выпавшая ячейка сдвинула бы всю строку влево.
              <span aria-hidden />
            )}
          </div>
          {check.level !== 'ok' && (
            <p
              role={check.level === 'error' ? 'alert' : undefined}
              className={`flex flex-wrap items-center gap-2 pl-0.5 text-[11px] ${
                check.level === 'error' ? 'text-[#B42318]' : 'text-[#8A6512]'
              }`}
            >
              <span>{check.message}</span>
              {check.level === 'error' && canEdit && (
                <button
                  type="button"
                  onClick={() => fixRow(i)}
                  className="flex items-center gap-1 font-semibold text-[var(--orange)]"
                >
                  <Wand2 size={12} /> Исправить
                </button>
              )}
            </p>
          )}
          </div>
        );
      })}
      {canEdit && (
      <div className="mt-1 flex flex-wrap items-center gap-3">
        <button type="button" onClick={add} className="flex w-fit items-center gap-1 text-[12px] font-semibold text-[var(--orange)]">
          <Plus size={13} /> добавить
        </button>
        {showStandardSet && missingStandard.length > 0 && (
          <button
            type="button"
            onClick={addStandardSet}
            className="flex w-fit items-center gap-1 text-[12px] font-semibold text-[var(--muted)] transition hover:text-[var(--ink)]"
          >
            <ListPlus size={13} /> Стандартный набор
          </button>
        )}
      </div>
      )}
    </div>
  );
}
