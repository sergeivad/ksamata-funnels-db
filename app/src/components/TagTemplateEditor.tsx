'use client';

import { useState } from 'react';
import { X } from 'lucide-react';

interface Props {
  label: string;
  scenario: 'reg' | 'time_15' | 'time_19' | 'messenger';
  initial: string[];
}

export default function TagTemplateEditor({ label, scenario, initial }: Props) {
  const [names, setNames] = useState<string[]>(initial);
  const [saved, setSaved] = useState<string[]>(initial);
  const [input, setInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty = JSON.stringify(names) !== JSON.stringify(saved);

  function add() {
    const n = input.trim();
    if (!n || names.includes(n)) { setInput(''); return; }
    setNames([...names, n]);
    setInput('');
  }
  function remove(n: string) { setNames(names.filter((x) => x !== n)); }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/tag-templates/${scenario}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ names }),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => null);
        throw new Error(b?.error ?? `Не удалось сохранить (${res.status})`);
      }
      setSaved(names);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось сохранить');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-[12px] border border-[var(--line-soft)] bg-[var(--card)] p-4">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-[13px] font-semibold text-[var(--ink)]">{label}</span>
        {dirty && <span className="h-1.5 w-1.5 rounded-full bg-[var(--orange)]" />}
        <button type="button" onClick={save} disabled={saving || !dirty}
          className="ml-auto rounded-[8px] bg-[var(--orange)] px-3 py-1 text-[11px] font-semibold text-white disabled:opacity-50">
          {saving ? 'Сохранение…' : 'Сохранить'}
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {names.map((n) => (
          <span key={n} className="inline-flex items-center gap-1 rounded-full bg-[var(--chip)] px-2 py-[3px] text-[11px] text-[var(--muted)]">
            {n}
            <button type="button" aria-label={`Убрать ${n}`} onClick={() => remove(n)} className="text-[var(--faint)] hover:text-[#B42318]">
              <X size={11} />
            </button>
          </span>
        ))}
        <input value={input} onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
          placeholder="+ тег" aria-label="Добавить тег"
          className="h-[24px] w-[110px] rounded-full border border-dashed border-[var(--line)] bg-white px-2 text-[11px]" />
      </div>
      <div className="mt-2 text-[10px] text-[var(--faint)]">
        АВ Продукт / Подрядчик / Канал / Направление добавляются автоматически из осей воронки.
      </div>
      {error && <div role="alert" className="mt-1 text-[11px] font-medium text-[#B42318]">{error}</div>}
    </div>
  );
}
