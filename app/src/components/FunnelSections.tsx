'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { FunnelDetail } from '@/lib/funnels';
import type { DayCell } from '@/lib/funnel-days';
import type { BlockState } from '@/lib/funnel-blocks';
import { useUnsavedGuard } from '@/lib/useUnsavedGuard';
import FunnelIdentity from './FunnelIdentity';
import RoomsEditor from './RoomsEditor';
import BlockEditor from './BlockEditor';
import FunnelCompactView from './FunnelCompactView';
import Segmented from './Segmented';

interface Props {
  funnel: FunnelDetail;
  funnelId: number;
  initialDays: DayCell[];
  landings: BlockState;
  rest: BlockState[];
}

type CardMode = 'view' | 'edit';
const LS_CARD_MODE_KEY = 'funnels.cardMode';

function isCardMode(v: unknown): v is CardMode {
  return v === 'view' || v === 'edit';
}

/**
 * Renders the funnel card's editable sections (identity, blocks, rooms) and
 * aggregates their individual "unsaved changes" flags into a single
 * `beforeunload` guard, so leaving the page with any section dirty prompts
 * a native confirmation. Each section still saves independently — this is
 * only a client-side host for shared dirty-state tracking.
 */
export default function FunnelSections({ funnel, funnelId, initialDays, landings, rest }: Props) {
  const router = useRouter();
  const [dirtyMap, setDirtyMap] = useState<Record<string, boolean>>({});
  const [cardMode, setCardMode] = useState<CardMode>('edit');

  const setSectionDirty = useCallback((sectionKey: string, dirty: boolean) => {
    setDirtyMap((prev) => (prev[sectionKey] === dirty ? prev : { ...prev, [sectionKey]: dirty }));
  }, []);

  const anyDirty = useMemo(() => Object.values(dirtyMap).some(Boolean), [dirtyMap]);
  useUnsavedGuard(anyDirty);

  // Load the last-used card mode from localStorage on mount (client-only).
  // Defaults to 'edit' so existing users' workflow isn't disrupted.
  useEffect(() => {
    try {
      const stored = localStorage.getItem(LS_CARD_MODE_KEY);
      if (isCardMode(stored)) setCardMode(stored);
    } catch {
      // localStorage unavailable — ignore
    }
  }, []);

  function handleCardModeChange(value: string) {
    if (!isCardMode(value)) return;
    setCardMode(value);
    // The compact view renders from server props — refetch them so links
    // saved during this visit show up (client editors keep their own state).
    if (value === 'view') router.refresh();
    try {
      localStorage.setItem(LS_CARD_MODE_KEY, value);
    } catch {
      // localStorage unavailable — ignore
    }
  }

  return (
    <>
      <div className="mb-3 flex items-center gap-2.5">
        <Segmented
          options={[{ value: 'view', label: 'Просмотр' }, { value: 'edit', label: 'Редактирование' }]}
          value={cardMode}
          onChange={handleCardModeChange}
        />
        {cardMode === 'view' && anyDirty && (
          <span className="inline-flex items-center gap-1 text-[10px] text-[var(--orange)]">
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--orange)]" />
            есть несохранённые изменения
          </span>
        )}
      </div>

      {cardMode === 'view' && (
        <FunnelCompactView funnel={funnel} initialDays={initialDays} landings={landings} rest={rest} />
      )}

      {/* Kept mounted (just hidden) rather than unmounted on mode switch, so
          in-progress edits in each section survive toggling back and forth. */}
      <div className={cardMode === 'edit' ? '' : 'hidden'}>
        <FunnelIdentity funnel={funnel} onDirtyChange={(d) => setSectionDirty('identity', d)} />
        <div className="my-4 h-px bg-[var(--line-soft)]" />
        {/* Order: landings → rooms → remaining blocks (records, tariffs, ...) */}
        <BlockEditor
          funnelId={funnelId}
          initial={landings}
          timeLabelA={funnel.timeLabelA}
          timeLabelB={funnel.timeLabelB}
          onDirtyChange={(d) => setSectionDirty(`block:${landings.kind}`, d)}
        />
        <RoomsEditor
          funnelId={funnelId}
          initialDays={initialDays}
          replayEnabled={funnel.roomsReplayEnabled}
          timeLabelA={funnel.timeLabelA}
          timeLabelB={funnel.timeLabelB}
          onDirtyChange={(d) => setSectionDirty('rooms', d)}
        />
        {rest.map((b) => (
          <BlockEditor
            key={b.kind}
            funnelId={funnelId}
            initial={b}
            timeLabelA={funnel.timeLabelA}
            timeLabelB={funnel.timeLabelB}
            onDirtyChange={(d) => setSectionDirty(`block:${b.kind}`, d)}
          />
        ))}
      </div>
    </>
  );
}
