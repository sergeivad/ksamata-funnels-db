'use client';

import { useEffect, useRef, useState } from 'react';
import { Wand2, Copy, Check, AlertCircle } from 'lucide-react';
import type { FunnelDetail } from '@/lib/funnels';
import { axesToTagNames } from '@/lib/ab-tags';
import { copyText } from '@/lib/clipboard';
import Segmented from './Segmented';
import RefSelect from './RefSelect';
import { STATUS_META } from '@/lib/status';

type Scenario = 'reg' | 'pay' | 'messenger';
type TimeSlot = '15' | '19';

type IdentitySnapshot = {
  frontCode: string;
  status: string;
  product: string;
  contractor: string;
  channel: string;
  direction: string;
  comment: string;
  ta: string;
  tb: string;
};

interface Props { funnel: FunnelDetail; onDirtyChange?: (dirty: boolean) => void }

export default function FunnelIdentity({ funnel, onDirtyChange }: Props) {
  const [frontCode, setFrontCode] = useState(funnel.frontCode);
  const [status, setStatus] = useState<string>(funnel.status);
  const [axes, setAxes] = useState(funnel.axes);
  const [comment, setComment] = useState(funnel.comment);
  const [ta, setTa] = useState(funnel.timeLabelA);
  const [tb, setTb] = useState(funnel.timeLabelB);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Snapshot of the last successfully persisted state, used to derive the
  // "unsaved changes" indicator by comparing it against the live form state.
  const [saved, setSaved] = useState<IdentitySnapshot>({
    frontCode: funnel.frontCode,
    status: funnel.status,
    product: funnel.axes.product,
    contractor: funnel.axes.contractor,
    channel: funnel.axes.channel,
    direction: funnel.axes.direction,
    comment: funnel.comment,
    ta: funnel.timeLabelA,
    tb: funnel.timeLabelB,
  });

  const dirty =
    frontCode !== saved.frontCode ||
    status !== saved.status ||
    axes.product !== saved.product ||
    axes.contractor !== saved.contractor ||
    axes.channel !== saved.channel ||
    axes.direction !== saved.direction ||
    comment !== saved.comment ||
    ta !== saved.ta ||
    tb !== saved.tb;

  const onDirtyChangeRef = useRef(onDirtyChange);
  onDirtyChangeRef.current = onDirtyChange;
  useEffect(() => { onDirtyChangeRef.current?.(dirty); }, [dirty]);

  // AV-tags block: which offer scenario's tag set to show/copy.
  const [scenario, setScenario] = useState<Scenario>('reg');
  const [timeSlot, setTimeSlot] = useState<TimeSlot>('19');
  // Which tag (or '__all__') currently flashes its copy result.
  const [copyFlash, setCopyFlash] = useState<{ marker: string; ok: boolean } | null>(null);
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

  function flagCopied(marker: string, ok: boolean) {
    if (copyTimer.current) clearTimeout(copyTimer.current);
    setCopyFlash({ marker, ok });
    copyTimer.current = setTimeout(() => setCopyFlash(null), 1500);
  }
  async function copyTag(t: string) {
    flagCopied(t, await copyText(t));
  }
  async function copyAll() {
    flagCopied('__all__', await copyText(currentTags.join('; ')));
  }

  async function save() {
    // Snapshot the values being submitted (not re-read after the await) so a
    // save started mid-edit doesn't wrongly mark newer edits as "saved".
    const submitted: IdentitySnapshot = {
      frontCode, status,
      product: axes.product, contractor: axes.contractor, channel: axes.channel, direction: axes.direction,
      comment, ta, tb,
    };
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/funnels/${funnel.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          frontCode: submitted.frontCode, status: submitted.status,
          product: submitted.product, contractor: submitted.contractor, channel: submitted.channel, direction: submitted.direction,
          comment: submitted.comment, timeLabelA: submitted.ta, timeLabelB: submitted.tb,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `Не удалось сохранить (${res.status})`);
      }
      setSaved(submitted);
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
          <Segmented
            options={[
              { value: 'active', label: STATUS_META.active.label },
              { value: 'draft', label: STATUS_META.draft.label },
              { value: 'archive', label: STATUS_META.archive.label },
            ]}
            value={status}
            onChange={setStatus}
          />
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
              copyFlash?.marker === '__all__'
                ? copyFlash.ok
                  ? 'border-[#8FD3AE] bg-[#DFF3E7] text-[#087443]'
                  : 'border-[#F3B2AA] bg-[#FEF3F2] text-[#B42318]'
                : 'border-[var(--line)] bg-white text-[var(--muted)] hover:border-[var(--ink)] hover:text-[var(--ink)]'
            }`}>
            {copyFlash?.marker === '__all__' ? (copyFlash.ok ? <Check size={11} /> : <AlertCircle size={11} />) : <Copy size={11} />}
            {copyFlash?.marker === '__all__' ? (copyFlash.ok ? 'Скопировано' : 'Не удалось скопировать') : 'Копировать все'}
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
            const flash = copyFlash?.marker === t ? copyFlash : null;
            return (
              <button key={t} type="button" onClick={() => copyTag(t)}
                title={flash && !flash.ok ? 'Не удалось скопировать' : 'Клик — скопировать тег'}
                className={`inline-flex items-center gap-1 rounded-full px-2 py-[3px] text-[10px] transition ${
                  flash
                    ? flash.ok
                      ? 'bg-[#DFF3E7] text-[#087443]'
                      : 'bg-[#FEF3F2] text-[#B42318]'
                    : 'bg-[var(--chip)] text-[var(--muted)] hover:bg-[var(--line)] hover:text-[var(--ink)]'
                }`}>
                {flash && (flash.ok ? <Check size={10} /> : <AlertCircle size={10} />)}
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
        <span className="ml-auto flex items-center gap-2">
          {dirty && (
            <span className="inline-flex items-center gap-1 text-[10px] text-[var(--orange)]">
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--orange)]" />
              есть несохранённые изменения
            </span>
          )}
          <button type="button" onClick={save} disabled={saving}
            className="rounded-[8px] bg-[var(--orange)] px-4 py-1.5 text-[12px] font-semibold text-white disabled:opacity-60">
            {saving ? 'Сохранение…' : 'Сохранить идентификацию'}
          </button>
        </span>
      </div>
      {error && (
        <div role="alert" className="mt-2 text-right text-[11px] font-medium text-[#B42318]">{error}</div>
      )}
    </div>
  );
}
