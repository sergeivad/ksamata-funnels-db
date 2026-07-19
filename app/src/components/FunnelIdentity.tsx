'use client';

import { useEffect, useRef, useState } from 'react';
import { Wand2, Copy, Check, AlertCircle, X, RotateCcw } from 'lucide-react';
import type { FunnelDetail } from '@/lib/funnels';
import { copyText } from '@/lib/clipboard';
import { isAxisTag } from '@/lib/ab-tags';
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

  // AV-tags block: which offer scenario's tag set to show/copy.
  const [scenario, setScenario] = useState<Scenario>('reg');
  const [timeSlot, setTimeSlot] = useState<TimeSlot>('19');
  // Which tag (or '__all__') currently flashes its copy result.
  const [copyFlash, setCopyFlash] = useState<{ marker: string; ok: boolean } | null>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Map the visible tab (+ pay timeSlot) to the canonical Scenario key.
  const activeScenario: 'reg' | 'time_15' | 'time_19' | 'messenger' =
    scenario === 'reg' ? 'reg'
      : scenario === 'messenger' ? 'messenger'
        : timeSlot === '15' ? 'time_15' : 'time_19';

  // Working copy of overrides, keyed by scenario. Seeded from the server tagSets:
  // custom chips → add[]; suppressed defaults → remove[].
  type Ov = { add: string[]; remove: string[] };
  const seedOverrides = (): Record<'reg'|'time_15'|'time_19'|'messenger', Ov> => {
    const out = { reg: { add: [], remove: [] }, time_15: { add: [], remove: [] },
      time_19: { add: [], remove: [] }, messenger: { add: [], remove: [] } } as Record<'reg'|'time_15'|'time_19'|'messenger', Ov>;
    (['reg','time_15','time_19','messenger'] as const).forEach((s) => {
      out[s].add = funnel.tagSets[s].tags.filter((t) => t.source === 'custom').map((t) => t.name);
      out[s].remove = [...funnel.tagSets[s].suppressed];
    });
    return out;
  };
  const [ov, setOv] = useState(seedOverrides);
  const [savedOv, setSavedOv] = useState(seedOverrides);
  const [tagInput, setTagInput] = useState('');
  const [savingTags, setSavingTags] = useState(false);
  const [tagsError, setTagsError] = useState<string | null>(null);

  const tagsDirty = JSON.stringify(ov) !== JSON.stringify(savedOv);

  useEffect(() => { onDirtyChangeRef.current?.(dirty || tagsDirty); }, [dirty, tagsDirty]);

  const allEmpty = !axes.product && !axes.contractor && !axes.channel && !axes.direction;
  const name = `${axes.product} / ${axes.contractor} / ${axes.channel} / ${axes.direction}`;

  // Server-provided effective set already encodes template + axes. To reflect
  // live edits without a round-trip, re-derive: start from server tags of this
  // scenario, drop those in ov.remove, and append ov.add customs not already shown.
  const serverSet = funnel.tagSets[activeScenario];
  const removeSet = new Set(ov[activeScenario].remove);
  const shown = serverSet.tags
    .filter((t) => !(t.source !== 'axis' && removeSet.has(t.name)))
    .filter((t) => t.source !== 'custom'); // customs come from ov.add below
  const shownNames = new Set(shown.map((t) => t.name));
  const customChips = ov[activeScenario].add
    .filter((n) => !shownNames.has(n))
    .map((n) => ({ name: n, source: 'custom' as const }));
  const visibleChips = [...shown, ...customChips];

  // Suppressed defaults available to restore = server suppressed ∪ ov.remove (non-axis),
  // minus any the user re-added. Server 'default' names currently in removeSet.
  const suppressedNames = Array.from(new Set([...serverSet.suppressed, ...ov[activeScenario].remove]))
    .filter((n) => removeSet.has(n));

  const currentTags = visibleChips.map((c) => c.name); // for copy-all / copy-tag

  function removeTag(name: string, source: 'axis' | 'default' | 'custom') {
    if (source === 'axis') return; // axis tags are identity — not removable
    setOv((prev) => {
      const next = { ...prev, [activeScenario]: { ...prev[activeScenario] } };
      if (source === 'custom') {
        next[activeScenario].add = prev[activeScenario].add.filter((n) => n !== name);
      } else {
        next[activeScenario].remove = [...new Set([...prev[activeScenario].remove, name])];
      }
      return next;
    });
  }
  function restoreTag(name: string) {
    setOv((prev) => ({
      ...prev,
      [activeScenario]: { ...prev[activeScenario], remove: prev[activeScenario].remove.filter((n) => n !== name) },
    }));
  }
  function addTag() {
    const name = tagInput.trim();
    if (!name) return;
    if (isAxisTag(name)) return; // axis tags are auto-managed — never manually added
    setOv((prev) => {
      const s = prev[activeScenario];
      // Re-adding a suppressed default = restore; a brand-new name = custom add.
      if (s.remove.includes(name)) {
        return { ...prev, [activeScenario]: { ...s, remove: s.remove.filter((n) => n !== name) } };
      }
      if (currentTags.includes(name) || s.add.includes(name)) return prev; // no dup
      return { ...prev, [activeScenario]: { ...s, add: [...s.add, name] } };
    });
    setTagInput('');
  }

  async function saveTags() {
    setSavingTags(true);
    setTagsError(null);
    try {
      const res = await fetch(`/api/funnels/${funnel.id}/tags`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(ov),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => null);
        throw new Error(b?.error ?? `Не удалось сохранить теги (${res.status})`);
      }
      setSavedOv(ov);
    } catch (e) {
      setTagsError(e instanceof Error ? e.message : 'Не удалось сохранить теги');
    } finally {
      setSavingTags(false);
    }
  }

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

        {dirty && (
          <div className="mb-2 text-[10px] text-[var(--orange)]">
            Набор дефолтных тегов обновится после «Сохранить идентификацию».
          </div>
        )}

        <div className="flex flex-wrap items-center gap-1.5">
          {visibleChips.map((chip) => {
            const flash = copyFlash?.marker === chip.name ? copyFlash : null;
            const removable = chip.source !== 'axis';
            return (
              <span key={chip.name}
                className={`inline-flex items-center gap-1 rounded-full px-2 py-[3px] text-[10px] transition ${
                  flash
                    ? flash.ok ? 'bg-[#DFF3E7] text-[#087443]' : 'bg-[#FEF3F2] text-[#B42318]'
                    : chip.source === 'custom'
                      ? 'bg-[#EAF1FB] text-[#1B4F9C]'
                      : 'bg-[var(--chip)] text-[var(--muted)]'
                }`}>
                <button type="button" onClick={() => copyTag(chip.name)} title="Клик — скопировать тег" className="inline-flex items-center gap-1">
                  {flash && (flash.ok ? <Check size={10} /> : <AlertCircle size={10} />)}
                  {chip.name}
                </button>
                {removable && (
                  <button type="button" aria-label={`Убрать ${chip.name}`} onClick={() => removeTag(chip.name, chip.source)}
                    className="ml-0.5 text-[var(--faint)] hover:text-[#B42318]">
                    <X size={10} />
                  </button>
                )}
              </span>
            );
          })}
          <span className="inline-flex items-center gap-1">
            <input value={tagInput} onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTag(); } }}
              placeholder="+ тег" aria-label="Добавить тег"
              className="h-[22px] w-[92px] rounded-full border border-dashed border-[var(--line)] bg-white px-2 text-[10px] text-[var(--ink)]" />
          </span>
        </div>

        {suppressedNames.length > 0 && (
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <span className="text-[10px] text-[var(--faint)]">Скрытые дефолты:</span>
            {suppressedNames.map((name) => (
              <button key={name} type="button" onClick={() => restoreTag(name)} title="Клик — вернуть тег"
                className="inline-flex items-center gap-1 rounded-full bg-transparent px-2 py-[3px] text-[10px] text-[var(--faint)] line-through hover:text-[var(--ink)] hover:no-underline">
                <RotateCcw size={10} /> {name}
              </button>
            ))}
          </div>
        )}

        <div className="mt-2 flex items-center gap-2">
          <span className="text-[10px] text-[var(--faint)]">Клик по тегу — скопировать · × — убрать</span>
          <span className="ml-auto flex items-center gap-2">
            {tagsDirty && (
              <span className="inline-flex items-center gap-1 text-[10px] text-[var(--orange)]">
                <span className="h-1.5 w-1.5 rounded-full bg-[var(--orange)]" /> теги изменены
              </span>
            )}
            <button type="button" onClick={saveTags} disabled={savingTags || !tagsDirty}
              className="rounded-[8px] border border-[var(--line)] bg-white px-3 py-1 text-[11px] font-semibold text-[var(--ink)] disabled:opacity-50">
              {savingTags ? 'Сохранение…' : 'Сохранить теги'}
            </button>
          </span>
        </div>
        {tagsError && <div role="alert" className="mt-1 text-right text-[11px] font-medium text-[#B42318]">{tagsError}</div>}
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
