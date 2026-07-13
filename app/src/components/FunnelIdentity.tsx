'use client';

import { useRef, useState } from 'react';
import { Wand2, Copy, Check } from 'lucide-react';
import type { FunnelDetail } from '@/lib/funnels';
import { axesToTagNames } from '@/lib/ab-tags';
import Segmented from './Segmented';
import RefSelect from './RefSelect';

type Scenario = 'reg' | 'pay' | 'messenger';
type TimeSlot = '15' | '19';

export default function FunnelIdentity({ funnel }: { funnel: FunnelDetail }) {
  const [frontCode, setFrontCode] = useState(funnel.frontCode);
  const [status, setStatus] = useState(funnel.status === 'active' ? 'active' : 'draft');
  const [axes, setAxes] = useState(funnel.axes);
  const [comment, setComment] = useState(funnel.comment);
  const [ta, setTa] = useState(funnel.timeLabelA);
  const [tb, setTb] = useState(funnel.timeLabelB);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // AV-tags block: which offer scenario's tag set to show/copy.
  const [scenario, setScenario] = useState<Scenario>('reg');
  const [timeSlot, setTimeSlot] = useState<TimeSlot>('19');
  const [copiedTag, setCopiedTag] = useState<string | null>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const allEmpty = !axes.product && !axes.contractor && !axes.channel && !axes.direction;
  const name = `${axes.product} / ${axes.contractor} / ${axes.channel} / ${axes.direction}`;

  // Tag set for the selected scenario. axesToTagNames already omits empty axes,
  // so no bare "АВ Продукт: " placeholders leak through; the filter is a guard.
  const tagSets = axesToTagNames(axes);
  const currentTags = (
    scenario === 'reg' ? tagSets.reg
      : scenario === 'messenger' ? tagSets.messenger
        : timeSlot === '15' ? tagSets.time15 : tagSets.time19
  ).filter((t) => !t.endsWith(': '));

  function flagCopied(marker: string) {
    if (copyTimer.current) clearTimeout(copyTimer.current);
    setCopiedTag(marker);
    copyTimer.current = setTimeout(() => setCopiedTag(null), 1500);
  }
  async function copyTag(t: string) {
    try { await navigator.clipboard.writeText(t); } catch { return; }
    flagCopied(t);
  }
  async function copyAll() {
    try { await navigator.clipboard.writeText(currentTags.join('; ')); } catch { return; }
    flagCopied('__all__');
  }

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
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <span className="text-[10px] uppercase tracking-wide text-[var(--faint)]">АВ-теги · сценарий предложения</span>
          <button type="button" onClick={copyAll}
            className={`ml-auto inline-flex items-center gap-1 rounded-[6px] border px-2 py-[3px] text-[10px] font-semibold transition ${
              copiedTag === '__all__'
                ? 'border-[#8FD3AE] bg-[#DFF3E7] text-[#087443]'
                : 'border-[var(--line)] bg-white text-[var(--muted)] hover:border-[var(--ink)] hover:text-[var(--ink)]'
            }`}>
            {copiedTag === '__all__' ? <Check size={11} /> : <Copy size={11} />}
            {copiedTag === '__all__' ? 'Скопировано' : 'Копировать все'}
          </button>
        </div>

        <div className="mb-2 flex flex-wrap items-center gap-2">
          <Segmented
            options={[{ value: 'reg', label: 'Регистрация' }, { value: 'pay', label: 'Оплата' }, { value: 'messenger', label: 'Мессенджер' }]}
            value={scenario} onChange={(v) => setScenario(v as Scenario)} />
          {scenario === 'pay' && (
            <Segmented
              options={[{ value: '15', label: ta || '15:00' }, { value: '19', label: tb || '19:00' }]}
              value={timeSlot} onChange={(v) => setTimeSlot(v as TimeSlot)} />
          )}
        </div>

        <div className="flex flex-wrap gap-1.5">
          {currentTags.map((t) => {
            const isCopied = copiedTag === t;
            return (
              <button key={t} type="button" onClick={() => copyTag(t)} title="Клик — скопировать тег"
                className={`inline-flex items-center gap-1 rounded-full px-2 py-[3px] text-[10px] transition ${
                  isCopied
                    ? 'bg-[#DFF3E7] text-[#087443]'
                    : 'bg-[var(--chip)] text-[var(--muted)] hover:bg-[var(--line)] hover:text-[var(--ink)]'
                }`}>
                {isCopied && <Check size={10} />}
                {t}
              </button>
            );
          })}
        </div>
        <div className="mt-1.5 text-[10px] text-[var(--faint)]">Клик по тегу — скопировать</div>
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
