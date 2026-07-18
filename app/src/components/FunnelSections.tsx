'use client';

import { useCallback, useMemo, useState } from 'react';
import type { FunnelDetail } from '@/lib/funnels';
import type { DayCell } from '@/lib/funnel-days';
import type { BlockState } from '@/lib/funnel-blocks';
import { useUnsavedGuard } from '@/lib/useUnsavedGuard';
import FunnelIdentity from './FunnelIdentity';
import RoomsEditor from './RoomsEditor';
import BlockEditor from './BlockEditor';

interface Props {
  funnel: FunnelDetail;
  funnelId: number;
  initialDays: DayCell[];
  landings: BlockState;
  rest: BlockState[];
}

/**
 * Renders the funnel card's editable sections (identity, blocks, rooms) and
 * aggregates their individual "unsaved changes" flags into a single
 * `beforeunload` guard, so leaving the page with any section dirty prompts
 * a native confirmation. Each section still saves independently — this is
 * only a client-side host for shared dirty-state tracking.
 */
export default function FunnelSections({ funnel, funnelId, initialDays, landings, rest }: Props) {
  const [dirtyMap, setDirtyMap] = useState<Record<string, boolean>>({});

  const setSectionDirty = useCallback((sectionKey: string, dirty: boolean) => {
    setDirtyMap((prev) => (prev[sectionKey] === dirty ? prev : { ...prev, [sectionKey]: dirty }));
  }, []);

  const anyDirty = useMemo(() => Object.values(dirtyMap).some(Boolean), [dirtyMap]);
  useUnsavedGuard(anyDirty);

  return (
    <>
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
    </>
  );
}
