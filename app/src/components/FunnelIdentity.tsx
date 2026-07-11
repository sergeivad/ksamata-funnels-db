'use client';

import { useState } from 'react';
import { Wand2 } from 'lucide-react';
import type { FunnelDetail } from '@/lib/funnels';
import { axesToTagNames } from '@/lib/ab-tags';
import Segmented from './Segmented';
import RefSelect from './RefSelect';

export default function FunnelIdentity({ funnel }: { funnel: FunnelDetail }) {
  const [frontCode, setFrontCode] = useState(funnel.frontCode);
  const [status, setStatus] = useState(funnel.status === 'active' ? 'active' : 'draft');
  const [axes, setAxes] = useState(funnel.axes);
  const [comment, setComment] = useState(funnel.comment);
  const [ta, setTa] = useState(funnel.timeLabelA);
  const [tb, setTb] = useState(funnel.timeLabelB);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const allEmpty = !axes.product && !axes.contractor && !axes.channel && !axes.direction;
  const name = `${axes.product} / ${axes.contractor} / ${axes.channel} / ${axes.direction}`;
  // Drop axis chips whose value is still empty (e.g. a fresh draft)
  const tags = axesToTagNames(axes).reg
    .map((t) => t.replace(/^АВ /, ''))
    .filter((t) => !t.endsWith(': '));

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/funnels/${funnel.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          frontCode, status,
          product: axes.product, contractor: axes.contractor, channel: axes.channel, direction: axes.direction,
          comment, timeLabelA: ta, timeLabelB: tb,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `Не удалось сохранить (${res.status})`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось сохранить');
    } finally { setSaving(false); }
  }

  const inp = 'h-7 rounded-[6px] border border-[var(--line-soft)] bg-white px-2 text-[12px] text-[var(--ink)]';

  return (
    <div className="rounded-[14px] border border-[var(--line-soft)] bg-[var(--card)] p-4">
      <div className="mb-1 flex flex-wrap items-center gap-2.5">
        <input aria-label="Код" value={frontCode} onChange={(e) => setFrontCode(e.target.value)}
          className="h-[26px] w-[56px] rounded-[6px] border border-[var(--line)] bg-[var(--chip)] px-1.5 text-center font-mono text-[12px] text-[var(--muted)]" />
        <span className={`text-[16px] font-medium ${allEmpty ? 'text-[var(--faint)]' : ''}`}>
          {allEmpty ? 'Новая воронка — заполните продукт и подрядчика' : name}
        </span>
        <span className="ml-auto">
          <Segmented options={[{ value: 'active', label: 'Активна' }, { value: 'draft', label: 'Черновик' }]} value={status} onChange={setStatus} />
        </span>
      </div>
      <div className="mb-3 flex items-center gap-1.5 text-[10px] text-[var(--faint)]">
        <Wand2 size={12} /> имя собирается из продукта · подрядчика · канала · направления
      </div>

      <div className="mb-3 grid grid-cols-2 gap-x-3 gap-y-2">
        <RefSelect kind="products" label="Продукт" value={axes.product} onChange={(v) => setAxes({ ...axes, product: v })} />
        <RefSelect kind="contractors" label="Подрядчик" value={axes.contractor} onChange={(v) => setAxes({ ...axes, contractor: v })} />
        <RefSelect kind="channels" label="Канал" value={axes.channel} onChange={(v) => setAxes({ ...axes, channel: v })} />
        <RefSelect kind="directions" label="Направление" value={axes.direction} onChange={(v) => setAxes({ ...axes, direction: v })} />
      </div>

      <label className="mb-3 flex flex-col gap-1">
        <span className="text-[10px] uppercase tracking-wide text-[var(--faint)]">Комментарий</span>
        <textarea value={comment} onChange={(e) => setComment(e.target.value)} placeholder="заметка по воронке…"
          className="min-h-[44px] rounded-[6px] border border-[var(--line-soft)] bg-white p-2 text-[12px] text-[var(--ink)]" />
      </label>

      <div className="mb-3 rounded-[9px] border border-dashed border-[var(--line)] bg-[var(--cream)] p-2.5">
        <div className="mb-1.5 text-[10px] uppercase tracking-wide text-[var(--faint)]">АВ-теги · генерируются автоматически</div>
        <div className="flex flex-wrap gap-1.5">
          {tags.map((t) => <span key={t} className="rounded-full bg-[var(--chip)] px-2 py-[3px] text-[10px] text-[var(--muted)]">{t}</span>)}
        </div>
      </div>

      <div className="mb-1 flex items-center gap-2">
        <span className="text-[10px] uppercase tracking-wide text-[var(--faint)]">Время</span>
        <input value={ta} onChange={(e) => setTa(e.target.value)} className={`${inp} w-[62px] text-center font-mono`} />
        <input value={tb} onChange={(e) => setTb(e.target.value)} className={`${inp} w-[62px] text-center font-mono`} />
        <button type="button" onClick={save} disabled={saving}
          className="ml-auto rounded-[8px] bg-[var(--orange)] px-4 py-1.5 text-[12px] font-semibold text-white disabled:opacity-60">
          {saving ? 'Сохранение…' : 'Сохранить идентификацию'}
        </button>
      </div>
      {error && (
        <div role="alert" className="mt-2 text-right text-[11px] font-medium text-[#B42318]">{error}</div>
      )}
    </div>
  );
}
