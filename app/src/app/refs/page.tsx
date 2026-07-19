'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import RefTable from '@/components/RefTable';
import { confirmUnsavedNavigation } from '@/lib/useUnsavedGuard';

interface RefRow {
  id: number;
  name: string;
}

type RefsState = {
  products: RefRow[];
  contractors: RefRow[];
  sources: RefRow[];
  tags: RefRow[];
  channels: RefRow[];
  directions: RefRow[];
};

const KINDS: Array<{ key: keyof RefsState; label: string }> = [
  { key: 'products', label: 'Продукты' },
  { key: 'contractors', label: 'Подрядчики' },
  { key: 'sources', label: 'Источники' },
  { key: 'tags', label: 'Теги' },
  { key: 'channels', label: 'Каналы' },
  { key: 'directions', label: 'Направления' },
];

async function fetchKind(kind: string): Promise<RefRow[]> {
  const res = await fetch(`/api/refs/${kind}`);
  if (!res.ok) return [];
  return res.json();
}

export default function RefsPage() {
  const router = useRouter();
  const [refs, setRefs] = useState<RefsState>({
    products: [],
    contractors: [],
    sources: [],
    tags: [],
    channels: [],
    directions: [],
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all(KINDS.map(({ key }) => fetchKind(key).then((rows) => ({ key, rows })))).then(
      (results) => {
        const next = { ...refs };
        results.forEach(({ key, rows }) => {
          next[key] = rows;
        });
        setRefs(next);
        setLoading(false);
      }
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleAdd(kind: keyof RefsState, name: string) {
    const res = await fetch(`/api/refs/${kind}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) return;
    const row: RefRow = await res.json();
    setRefs((prev) => {
      const list = prev[kind];
      if (list.some((r) => r.id === row.id)) return prev;
      return {
        ...prev,
        [kind]: [...list, row].sort((a, b) => a.name.localeCompare(b.name)),
      };
    });
  }

  async function handleRename(
    kind: keyof RefsState,
    id: number,
    newName: string
  ): Promise<{ ok: boolean; error?: string }> {
    const res = await fetch(`/api/refs/${kind}/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: newName }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return { ok: false, error: body.error ?? 'Не удалось переименовать' };
    }
    const row: RefRow = await res.json();
    setRefs((prev) => ({
      ...prev,
      [kind]: prev[kind]
        .map((r) => (r.id === id ? row : r))
        .sort((a, b) => a.name.localeCompare(b.name)),
    }));
    return { ok: true };
  }

  async function handleDelete(
    kind: keyof RefsState,
    id: number
  ): Promise<{ ok: boolean; error?: string }> {
    const res = await fetch(`/api/refs/${kind}/${id}`, { method: 'DELETE' });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return { ok: false, error: body.error ?? 'Не удалось удалить' };
    }
    setRefs((prev) => ({
      ...prev,
      [kind]: prev[kind].filter((r) => r.id !== id),
    }));
    return { ok: true };
  }

  return (
    <main className="mx-auto max-w-[900px] px-4 py-8">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-[18px] font-semibold text-[var(--color-text)]">Справочники</h1>
          <p className="mt-1 text-[12px] text-[var(--color-text-secondary)]">
            Управление значениями продуктов, подрядчиков, источников, каналов, направлений и тегов.
          </p>
        </div>
        <button
          type="button"
          onClick={() => { if (confirmUnsavedNavigation()) router.push('/'); }}
          className="text-[13px] text-[var(--color-text-secondary)] underline hover:text-[var(--color-text)] transition"
        >
          ← Список воронок
        </button>
      </div>

      {loading ? (
        <p className="text-[13px] text-[var(--color-text-secondary)]">Загрузка...</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {KINDS.map(({ key, label }) => (
            <RefTable
              key={key}
              title={label}
              rows={refs[key]}
              onAdd={(name) => handleAdd(key, name)}
              onRename={(id, newName) => handleRename(key, id, newName)}
              onDelete={(id) => handleDelete(key, id)}
              readOnly={key === 'tags'}
            />
          ))}
        </div>
      )}
    </main>
  );
}
