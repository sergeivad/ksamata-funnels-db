'use client';

import { useEffect, useRef, useState } from 'react';
import { Wand2, Copy, Check, AlertCircle, X, RotateCcw } from 'lucide-react';
import type { FunnelDetail } from '@/lib/funnels';
import { copyText } from '@/lib/clipboard';
import { isAxisTag } from '@/lib/ab-tags';
import { funnelHref } from '@/lib/front-code';
import Segmented from './Segmented';
import Switch from './Switch';
import { tagPatchBody } from '@/lib/tag-scenarios';
import RefSelect from './RefSelect';
import { useCanEdit } from './AuthProvider';
import { STATUS_META } from '@/lib/status';
import { FUNNEL_TYPE_KIND, FUNNEL_TYPE_LABEL } from '@/lib/funnel-type';
import { SCENARIOS, type Scenario } from '@/lib/ab-tags';

/**
 * Ключ ВИДИМОЙ вкладки — не то же самое, что сценарий хранения: две оплаты
 * прячутся за одной вкладкой «Оплата» с подпереключателем времени. Остальные
 * вкладки отображаются в сценарий один в один.
 */
type TabKey = 'reg' | 'pay' | 'messenger' | 'predspisok';
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
  funnelType: string;
  hasPredspisok: boolean;
};

interface Props { funnel: FunnelDetail; onDirtyChange?: (dirty: boolean) => void }

export default function FunnelIdentity({ funnel, onDirtyChange }: Props) {
  const canEdit = useCanEdit();
  // Код, на который сейчас стоит адресная строка вкладки — отдельно от
  // `saved.frontCode` (снимок формы), потому что форма хранит то, что ввёл
  // человек до нормализации сервером ('F95'), а адрес должен сравниваться с
  // тем, что сервер реально сохранил ('f95'); иначе повторное сохранение без
  // правки кода снова решало бы, что адрес устарел.
  const urlCodeRef = useRef(funnel.frontCode);
  const [frontCode, setFrontCode] = useState(funnel.frontCode);
  const [status, setStatus] = useState<string>(funnel.status);
  const [axes, setAxes] = useState(funnel.axes);
  // Пятая ось — тип воронки. Пустая строка означает «тип не выбран», как и на
  // сервере (см. FUNNEL_TYPE_LABEL): PATCH принимает '' как сброс.
  const [funnelType, setFunnelType] = useState<string>(funnel.funnelType ?? '');
  const [comment, setComment] = useState(funnel.comment);
  const [ta, setTa] = useState(funnel.timeLabelA);
  const [tb, setTb] = useState(funnel.timeLabelB);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Шаг предсписка есть не у всякой воронки: в реестре предложений GetCourse
  // этап заведён у меньшинства (Phase 16). Снятая галка убирает набор целиком,
  // а не только тег этапа, — оси и маркер типа оверрайдом не снимаются.
  const [hasPredspisok, setHasPredspisok] = useState(funnel.hasPredspisok);

  /**
   * Отражает ли рабочая копия оверрайдов предсписка то, что лежит на сервере.
   *
   * Отдельно от самого признака, потому что «галка поднята» и «слот можно
   * отправлять» — разные факты. Пока галка снята, движок сценария не строит,
   * seedOverrides сидирует слот пустым, и отправлять его нельзя: роут частичный
   * и очистит сохранённые оверрайды. После включения слот пересеивается с
   * сервера (см. save) — и только тогда становится отправляемым; если
   * дочитывание детали упало, он так и остаётся неотправляемым до перезагрузки
   * страницы, а не превращается в тихую потерю.
   */
  const [predspisokSeeded, setPredspisokSeeded] = useState(funnel.hasPredspisok);

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
    funnelType: funnel.funnelType ?? '',
    hasPredspisok: funnel.hasPredspisok,
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
    tb !== saved.tb ||
    funnelType !== (saved.funnelType ?? '') ||
    hasPredspisok !== saved.hasPredspisok;

  const onDirtyChangeRef = useRef(onDirtyChange);
  onDirtyChangeRef.current = onDirtyChange;

  // AV-tags block: which offer scenario's tag set to show/copy.
  const [scenario, setScenario] = useState<TabKey>('reg');
  const [timeSlot, setTimeSlot] = useState<TimeSlot>('19');
  // Which tag (or '__all__') currently flashes its copy result.
  const [copyFlash, setCopyFlash] = useState<{ marker: string; ok: boolean } | null>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // У типа без эфиров сценарий оплаты один: наборы 15 и 19 совпадают (тег
  // времени погашен движком), и две вкладки предлагали бы выбор, которого нет.
  const timeless = !funnel.typeHasTime;

  // Вкладка предсписка живёт по СОХРАНЁННОМУ признаку, а не по положению
  // галки. Разница существенная: пока правка не сохранена, у сервера набора
  // нет, и рабочая копия оверрайдов сценария сидирована пустой. Показать
  // вкладку сразу по клику значило бы дать редактировать набор, которого на
  // сервере нет, — и первое же «Сохранить теги» отправило бы пустой слот,
  // затерев сохранённые оверрайды вместе со свежей правкой.
  //
  // Что галка нажата, видно по ней самой; что набор появится после сохранения,
  // говорит подсказка «Набор дефолтных тегов обновится после “Сохранить
  // идентификацию”» ниже. В обратную сторону так же: снятая, но не сохранённая
  // галка вкладку не прячет — на сервере набор ещё есть, и слать его правильно.
  const tab: TabKey = scenario === 'predspisok' && !saved.hasPredspisok ? 'reg' : scenario;

  // Map the visible tab (+ pay timeSlot) to the canonical Scenario key.
  const activeScenario: Scenario =
    tab === 'reg' ? 'reg'
      : tab === 'messenger' ? 'messenger'
        : tab === 'predspisok' ? 'predspisok'
          : timeless ? 'time_19'
            : timeSlot === '15' ? 'time_15' : 'time_19';

  // Working copy of overrides, keyed by scenario. Seeded from the server tagSets:
  // custom chips → add[]; suppressed defaults → remove[].
  type Ov = { add: string[]; remove: string[] };
  const seedOverrides = (): Record<Scenario, Ov> => {
    const out = Object.fromEntries(
      SCENARIOS.map((s) => [s, { add: [] as string[], remove: [] as string[] }]),
    ) as Record<Scenario, Ov>;
    SCENARIOS.forEach((s) => {
      out[s].add = funnel.tagSets[s].tags.filter((t) => t.source === 'custom').map((t) => t.name);
      out[s].remove = [...funnel.tagSets[s].suppressed];
    });
    return out;
  };
  const [ov, setOv] = useState(seedOverrides);
  const [savedOv, setSavedOv] = useState(seedOverrides);

  // Осевые теги — производная от продукта/подрядчика/канала/направления, и
  // пересчитывает их сервер. Пока это читалось прямо из пропа, страница после
  // сохранения осей продолжала показывать теги от прежних: сервер уже отдал
  // новые в ответе на PATCH, а на экране оставались старые до перезагрузки.
  const [tagSets, setTagSets] = useState(funnel.tagSets);
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
  // До сохранения сервер ещё отдаёт прежний набор — гасим его на экране сразу,
  // чтобы галка и содержимое вкладки не расходились.
  const serverSet = activeScenario === 'predspisok' && !saved.hasPredspisok
    ? { tags: [], suppressed: [] }
    : tagSets[activeScenario];
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

  /**
   * Правка оверрайдов активного сценария. У безвременной воронки правка оплаты
   * ложится СРАЗУ В ОБА сценария: видимая вкладка одна, но строк в базе две, и
   * если держать в клиенте только одну, следующее сохранение отправит вторую
   * нетронутой — сервер увидит расхождение с обратным знаком и откатит правку
   * (см. mirrorPaymentOverrides в funnels.ts).
   */
  function editOv(update: (o: Ov) => Ov) {
    setOv((prev) => {
      const next = update(prev[activeScenario]);
      if (next === prev[activeScenario]) return prev;
      if (timeless && (activeScenario === 'time_15' || activeScenario === 'time_19')) {
        return { ...prev, time_15: next, time_19: next };
      }
      return { ...prev, [activeScenario]: next };
    });
  }

  function removeTag(name: string, source: 'axis' | 'default' | 'custom') {
    if (source === 'axis') return; // axis tags are identity — not removable
    editOv((s) =>
      source === 'custom'
        ? { ...s, add: s.add.filter((n) => n !== name) }
        : { ...s, remove: [...new Set([...s.remove, name])] }
    );
  }
  function restoreTag(name: string) {
    editOv((s) => ({ ...s, remove: s.remove.filter((n) => n !== name) }));
  }
  function addTag() {
    const name = tagInput.trim();
    if (!name) return;
    if (isAxisTag(name)) return; // axis tags are auto-managed — never manually added
    editOv((s) => {
      // Re-adding a suppressed default = restore; a brand-new name = custom add.
      if (s.remove.includes(name)) return { ...s, remove: s.remove.filter((n) => n !== name) };
      if (currentTags.includes(name) || s.add.includes(name)) return s; // no dup
      return { ...s, add: [...s.add, name] };
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
        body: JSON.stringify(tagPatchBody(ov, predspisokSeeded)),
      });
      const b = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(b?.error ?? `Не удалось сохранить теги (${res.status})`);
      }
      if (b?.tagSets) setTagSets(b.tagSets);
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
    // Признак до этого сохранения — нужен ниже, чтобы отличить включение
    // предсписка от прочих правок идентификации.
    const predspisokWasOff = !saved.hasPredspisok;
    // Snapshot the values being submitted (not re-read after the await) so a
    // save started mid-edit doesn't wrongly mark newer edits as "saved".
    const submitted: IdentitySnapshot = {
      frontCode, status,
      product: axes.product, contractor: axes.contractor, channel: axes.channel, direction: axes.direction,
      comment, ta, tb, funnelType, hasPredspisok,
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
          funnelType: submitted.funnelType,
          hasPredspisok: submitted.hasPredspisok,
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(body?.error ?? `Не удалось сохранить (${res.status})`);
      }
      setSaved(submitted);
      // Смена F-кода меняет канонический адрес карточки. Берём новый код из
      // ответа сервера, не из формы: сервер его нормализует (trim + нижний
      // регистр). replace, не push: старый адрес мёртв (обновление страницы
      // на нём даёт 404 — этот компонент не перечитывает URL сам), и держать
      // его в истории «назад» незачем.
      if (typeof body?.frontCode === 'string' && body.frontCode !== urlCodeRef.current) {
        urlCodeRef.current = body.frontCode;
        // Нативный History API, не router.replace: адрес карточки — это
        // динамический сегмент /funnels/[ref], и смена его значения меняет
        // ключ сегмента. Next 15 на смену ключа пересоздаёт поддерево
        // (FunnelSections — единый хост несохранённых правок блоков, комнат
        // и своих же тегов) и сбрасывает его состояние. window.history
        // Next 15 подхватывает сам, без пересоздания.
        window.history.replaceState(null, '', funnelHref({ frontCode: body.frontCode, id: funnel.id }));
      }
      // Осевые теги пересчитал сервер, но ответ PATCH — это сводка воронки без
      // tagSets, поэтому дочитываем деталь. Без этого чипы показывали бы теги
      // от прежних осей до перезагрузки страницы. Отдельный catch: сохранение
      // уже прошло, и неудача этого дочитывания не должна выглядеть как
      // несохранённые изменения.
      try {
        const detail = await (await fetch(`/api/funnels/${funnel.id}`)).json();
        if (detail?.tagSets) setTagSets(detail.tagSets);
        // Включили предсписок — пересеиваем рабочую копию оверрайдов ЭТОГО
        // сценария с сервера. Пока галка была снята, движок набора не строил,
        // и слот сидировался пустым; сохранить теги с таким слотом значит
        // затереть оверрайды, которые всё это время лежали в базе.
        //
        // Только при переходе «было снято → стало поднято» и только этот
        // сценарий: пересев остальных выбросил бы несохранённые правки тегов,
        // сделанные до нажатия «Сохранить идентификацию». Своих несохранённых
        // правок у предсписка в этот момент быть не может — вкладка была
        // скрыта.
        if (predspisokWasOff && submitted.hasPredspisok) {
          setPredspisokSeeded(Boolean(detail?.tagSets?.predspisok));
        }
        if (predspisokWasOff && submitted.hasPredspisok && detail?.tagSets?.predspisok) {
          const fresh: Ov = {
            add: detail.tagSets.predspisok.tags
              .filter((t: { source: string }) => t.source === 'custom')
              .map((t: { name: string }) => t.name),
            remove: [...detail.tagSets.predspisok.suppressed],
          };
          setOv((prev) => ({ ...prev, predspisok: fresh }));
          setSavedOv((prev) => ({ ...prev, predspisok: fresh }));
        }
      } catch {
        // Теги обновятся при следующей загрузке страницы. Но если этим
        // сохранением предсписок включили, слот оверрайдов остался пустым и
        // отправлять его нельзя — иначе следующее «Сохранить теги» затрёт
        // сохранённые оверрайды.
        if (predspisokWasOff && submitted.hasPredspisok) setPredspisokSeeded(false);
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
          placeholder="без кода" readOnly={!canEdit}
          title="F-код воронки. При заведении подставляется следующий свободный — замените на настоящий код ЛИК, когда он появится."
          className="h-[26px] w-[60px] rounded-[6px] border border-[var(--line)] bg-[var(--chip)] px-1.5 text-center font-mono text-[12px] text-[var(--muted)]" />
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
            disabled={!canEdit}
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
        <RefSelect
          kind={FUNNEL_TYPE_KIND}
          label={FUNNEL_TYPE_LABEL}
          value={funnelType}
          onChange={setFunnelType}
        />
      </div>

      <label className="mb-3 flex flex-col gap-1">
        <span className="text-[10px] uppercase tracking-wide text-[var(--faint)]">Комментарий</span>
        <textarea value={comment} onChange={(e) => setComment(e.target.value)} placeholder="заметка по воронке…" readOnly={!canEdit}
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
            options={[
              { value: 'reg', label: 'Регистрация' },
              { value: 'pay', label: 'Оплата' },
              { value: 'messenger', label: 'Мессенджер' },
              ...(saved.hasPredspisok ? [{ value: 'predspisok', label: 'Предсписок' }] : []),
            ]}
            value={tab} onChange={(v) => setScenario(v as TabKey)} />
          {tab === 'pay' && !timeless && (
            <Segmented
              options={[{ value: '15', label: ta || '15:00' }, { value: '19', label: tb || '19:00' }]}
              value={timeSlot} onChange={(v) => setTimeSlot(v as TimeSlot)} />
          )}
          {tab === 'pay' && timeless && (
            <span className="text-[10px] text-[var(--faint)]">
              у этого типа воронки нет эфиров по времени — набор оплаты один
            </span>
          )}
          {/*
            Признак шага, а не фильтр показа: снятая галка убирает набор
            предсписка и из карточки, и из funnel_tags. Стоит рядом со
            вкладками, потому что именно вкладку она и убирает — решение видно
            там же, где действует. Применяется по «Сохранить идентификацию»,
            как и оси: набор пересобирает сервер.
          */}
          <span className="ml-auto flex items-center gap-2">
            <Switch checked={hasPredspisok} onChange={setHasPredspisok}
              label="предсписок" disabled={!canEdit} />
          </span>
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
                {removable && canEdit && (
                  <button type="button" aria-label={`Убрать ${chip.name}`} onClick={() => removeTag(chip.name, chip.source)}
                    className="ml-0.5 text-[var(--faint)] hover:text-[#B42318]">
                    <X size={10} />
                  </button>
                )}
              </span>
            );
          })}
          {canEdit && (
            <span className="inline-flex items-center gap-1">
              <input value={tagInput} onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTag(); } }}
                placeholder="+ тег" aria-label="Добавить тег"
                className="h-[22px] w-[92px] rounded-full border border-dashed border-[var(--line)] bg-white px-2 text-[10px] text-[var(--ink)]" />
            </span>
          )}
        </div>

        {suppressedNames.length > 0 && (
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <span className="text-[10px] text-[var(--faint)]">Скрытые дефолты:</span>
            {suppressedNames.map((name) =>
              canEdit ? (
                <button key={name} type="button" onClick={() => restoreTag(name)} title="Клик — вернуть тег"
                  className="inline-flex items-center gap-1 rounded-full bg-transparent px-2 py-[3px] text-[10px] text-[var(--faint)] line-through hover:text-[var(--ink)] hover:no-underline">
                  <RotateCcw size={10} /> {name}
                </button>
              ) : (
                // В просмотре это факт («этот дефолт на воронке погашен»), а не
                // кнопка: вернуть тег без прав всё равно нельзя.
                <span key={name} className="rounded-full px-2 py-[3px] text-[10px] text-[var(--faint)] line-through">
                  {name}
                </span>
              )
            )}
          </div>
        )}

        <div className="mt-2 flex items-center gap-2">
          <span className="text-[10px] text-[var(--faint)]">
            {canEdit ? 'Клик по тегу — скопировать · × — убрать' : 'Клик по тегу — скопировать'}
          </span>
          {canEdit && (
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
          )}
        </div>
        {tagsError && <div role="alert" className="mt-1 text-right text-[11px] font-medium text-[#B42318]">{tagsError}</div>}
      </div>

      <div className="mb-1 flex items-center gap-2">
        <span className="text-[10px] uppercase tracking-wide text-[var(--faint)]">Время</span>
        <input value={ta} onChange={(e) => setTa(e.target.value)} readOnly={!canEdit} className={`${inp} w-[62px] text-center font-mono`} />
        <input value={tb} onChange={(e) => setTb(e.target.value)} readOnly={!canEdit} className={`${inp} w-[62px] text-center font-mono`} />
        {canEdit && (
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
        )}
      </div>
      {error && (
        <div role="alert" className="mt-2 text-right text-[11px] font-medium text-[#B42318]">{error}</div>
      )}
    </div>
  );
}
