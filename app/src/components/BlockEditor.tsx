'use client';

import { useEffect, useRef, useState } from 'react';
import * as Icons from 'lucide-react';
import { getBlockDef, type BlockMode } from '@/lib/blocks';
import type { BlockState, BlockItem } from '@/lib/funnel-blocks';
import Switch from './Switch';
import Segmented from './Segmented';
import BlockListField from './BlockListField';

interface Props {
  funnelId: number;
  initial: BlockState;
  timeLabelA: string;
  timeLabelB: string;
  onDirtyChange?: (dirty: boolean) => void;
}

// When common, flatten slots to null; when by_time keep the slot as-is.
// Used both when building the save payload and when diffing the live items
// against the last-saved snapshot, so the two stay comparable.
function normalizeItems(items: BlockItem[], mode: BlockMode): BlockItem[] {
  return items.map((it) => (mode === 'common' ? { ...it, slot: null } : it));
}

type SavedSnapshot = { enabled: boolean; mode: BlockMode; items: BlockItem[] };

export default function BlockEditor({ funnelId, initial, timeLabelA, timeLabelB, onDirtyChange }: Props) {
  const def = getBlockDef(initial.kind);
  const [enabled, setEnabled] = useState(initial.enabled);
  const [mode, setMode] = useState<BlockMode>(initial.mode);
  const [items, setItems] = useState<BlockItem[]>(initial.items);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Snapshot of the last successfully persisted state (normalized the same
  // way the save payload is), used to derive the "unsaved changes" indicator.
  const [saved, setSaved] = useState<SavedSnapshot>({
    enabled: initial.enabled,
    mode: initial.mode,
    items: normalizeItems(initial.items, initial.mode),
  });

  const dirty =
    enabled !== saved.enabled ||
    mode !== saved.mode ||
    JSON.stringify(normalizeItems(items, mode)) !== JSON.stringify(saved.items);

  const onDirtyChangeRef = useRef(onDirtyChange);
  onDirtyChangeRef.current = onDirtyChange;
  useEffect(() => { onDirtyChangeRef.current?.(dirty); }, [dirty]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const Icon = (Icons as any)[def.icon] ?? Icons.Link;

  async function save(next?: { enabled?: boolean; mode?: BlockMode; items?: BlockItem[] }) {
    const payloadEnabled = next?.enabled ?? enabled;
    const payloadMode = next?.mode ?? mode;
    const payloadItems = normalizeItems(next?.items ?? items, payloadMode);
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/funnels/${funnelId}/blocks/${initial.kind}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: payloadEnabled, mode: payloadMode, items: payloadItems }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `Не удалось сохранить (${res.status})`);
      }
      setSaved({ enabled: payloadEnabled, mode: payloadMode, items: payloadItems });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось сохранить');
    } finally {
      setSaving(false);
    }
  }

  if (!enabled) {
    return (
      <div className="mb-2.5 flex items-center gap-2 rounded-[10px] border border-[var(--line-soft)] bg-[var(--card)] px-3.5 py-2.5 opacity-60">
        <Icon size={16} className="text-[var(--faint)]" />
        <span className="text-[13px] font-medium text-[var(--muted)]">{def.title}</span>
        <span className="ml-auto">
          <Switch checked={false} onChange={(v) => { setEnabled(v); save({ enabled: v }); }} />
        </span>
      </div>
    );
  }

  return (
    <div className="mb-2.5 rounded-[10px] border border-[var(--line-soft)] bg-[var(--paper)] p-3.5">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Icon size={17} className="text-[var(--orange)]" />
        <span className="text-[13px] font-medium">{def.title}</span>
        {def.modes.length > 1 && (
          <Segmented
            options={[{ value: 'common', label: 'Общее' }, { value: 'by_time', label: 'По времени' }]}
            value={mode}
            onChange={(v) => {
              const m = v as BlockMode;
              const transformed = m === 'common'
                ? items.map((it) => ({ ...it, slot: null as null }))
                : items.map((it) => ({ ...it, slot: (it.slot ?? '15') as '15' | '19' }));
              setMode(m);
              setItems(transformed);
              save({ mode: m, items: transformed });
            }}
          />
        )}
        <span className="ml-auto">
          <Switch checked={enabled} onChange={(v) => { setEnabled(v); save({ enabled: v }); }} />
        </span>
      </div>

      {mode === 'common' ? (
        <BlockListField fields={def.fields} slot={null} items={items}
          onChange={(next) => { setItems(next); }} />
      ) : (
        <div className="flex gap-3">
          <div className="min-w-0 flex-1">
            <div className="mb-1 text-[11px] font-medium text-[var(--muted)]">{timeLabelA}</div>
            <BlockListField fields={def.fields} slot="15" items={items} onChange={(next) => setItems(next)} />
          </div>
          <div className="flex-1">
            <div className="mb-1 text-[11px] font-medium text-[var(--muted)]">{timeLabelB}</div>
            <BlockListField fields={def.fields} slot="19" items={items} onChange={(next) => setItems(next)} />
          </div>
        </div>
      )}

      <div className="mt-3 flex items-center justify-end gap-3">
        {error && <span role="alert" className="text-[11px] font-medium text-[#B42318]">{error}</span>}
        {dirty && (
          <span className="inline-flex items-center gap-1 text-[10px] text-[var(--orange)]">
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--orange)]" />
            есть несохранённые изменения
          </span>
        )}
        <button type="button" onClick={() => save()} disabled={saving}
          className="rounded-[8px] bg-[var(--orange)] px-4 py-1.5 text-[12px] font-semibold text-white disabled:opacity-60">
          {saving ? 'Сохранение…' : 'Сохранить'}
        </button>
      </div>
    </div>
  );
}
