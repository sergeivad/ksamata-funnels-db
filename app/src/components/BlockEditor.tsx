'use client';

import { useState } from 'react';
import * as Icons from 'lucide-react';
import { getBlockDef, type BlockMode } from '@/lib/blocks';
import type { BlockState, BlockItem } from '@/lib/funnel-blocks';
import Switch from './Switch';
import Segmented from './Segmented';
import BlockListField from './BlockListField';

interface Props { funnelId: number; initial: BlockState; timeLabelA: string; timeLabelB: string }

export default function BlockEditor({ funnelId, initial, timeLabelA, timeLabelB }: Props) {
  const def = getBlockDef(initial.kind);
  const [enabled, setEnabled] = useState(initial.enabled);
  const [mode, setMode] = useState<BlockMode>(initial.mode);
  const [items, setItems] = useState<BlockItem[]>(initial.items);
  const [saving, setSaving] = useState(false);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const Icon = (Icons as any)[def.icon] ?? Icons.Link;

  async function save(next?: { enabled?: boolean; mode?: BlockMode; items?: BlockItem[] }) {
    const payloadEnabled = next?.enabled ?? enabled;
    const payloadMode = next?.mode ?? mode;
    // When common, flatten slots to null; when by_time keep slot
    const payloadItems = (next?.items ?? items).map((it) =>
      payloadMode === 'common' ? { ...it, slot: null } : it,
    );
    setSaving(true);
    try {
      await fetch(`/api/funnels/${funnelId}/blocks/${initial.kind}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: payloadEnabled, mode: payloadMode, items: payloadItems }),
      });
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
            onChange={(v) => { const m = v as BlockMode; setMode(m); save({ mode: m }); }}
          />
        )}
        <span className="ml-auto">
          <Switch checked={true} onChange={(v) => { setEnabled(v); save({ enabled: v }); }} />
        </span>
      </div>

      {mode === 'common' ? (
        <BlockListField fields={def.fields} slot={null} items={items}
          onChange={(next) => { setItems(next); }} />
      ) : (
        <div className="flex gap-3">
          <div className="flex-1">
            <div className="mb-1 text-[11px] font-medium text-[var(--muted)]">{timeLabelA}</div>
            <BlockListField fields={def.fields} slot="15" items={items} onChange={(next) => setItems(next)} />
          </div>
          <div className="flex-1">
            <div className="mb-1 text-[11px] font-medium text-[var(--muted)]">{timeLabelB}</div>
            <BlockListField fields={def.fields} slot="19" items={items} onChange={(next) => setItems(next)} />
          </div>
        </div>
      )}

      <div className="mt-3 flex justify-end">
        <button type="button" onClick={() => save()} disabled={saving}
          className="rounded-[8px] bg-[var(--orange)] px-4 py-1.5 text-[12px] font-semibold text-white disabled:opacity-60">
          {saving ? 'Сохранение…' : 'Сохранить'}
        </button>
      </div>
    </div>
  );
}
