/**
 * funnel-links.ts — helper for reading and writing funnel_links rows.
 *
 * replaceLinks uses a single transaction: delete all links for a funnel,
 * then insert the new items with position = array index (0-based).
 *
 * Pattern: injected `db` handle (same as other helpers) so tests can pass a
 * drizzle handle over a temp copy of the DB without touching the real one.
 */

import { eq, asc } from 'drizzle-orm';
import { type AnyDB } from '../db/client';
import { funnelLinks, funnels } from '../db/schema';

// ─── Public types ─────────────────────────────────────────────────────────────

export type LinkItem = { label: string; url: string };

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * List existing funnel_links rows for a funnel, ordered by position ascending.
 */
export function listLinks(
  db: AnyDB,
  funnelId: number,
): { id: number; label: string; url: string; position: number }[] {
  return db
    .select({
      id:       funnelLinks.id,
      label:    funnelLinks.label,
      url:      funnelLinks.url,
      position: funnelLinks.position,
    })
    .from(funnelLinks)
    .where(eq(funnelLinks.funnelId, funnelId))
    .orderBy(asc(funnelLinks.position))
    .all();
}

/**
 * Replace all funnel_links for a funnel in ONE transaction:
 *   1. DELETE all existing rows for this funnel.
 *   2. INSERT the given items with position = array index (0-based).
 *
 * An empty items array clears all links.
 * Does NOT check whether the funnel exists — callers (route handlers) must do that.
 */
export function replaceLinks(db: AnyDB, funnelId: number, items: LinkItem[]): void {
  db.transaction((tx) => {
    // Step 1: delete all existing links for this funnel
    tx.delete(funnelLinks).where(eq(funnelLinks.funnelId, funnelId)).run();

    // Step 2: insert new items with position = index
    for (let i = 0; i < items.length; i++) {
      tx.insert(funnelLinks).values({
        funnelId,
        label:    items[i].label,
        url:      items[i].url,
        position: i,
      }).run();
    }
  });
}

/**
 * Check whether a funnel exists by id.
 * Returns true if found.
 */
export function funnelExists(db: AnyDB, funnelId: number): boolean {
  const row = db
    .select({ id: funnels.id })
    .from(funnels)
    .where(eq(funnels.id, funnelId))
    .get();
  return row !== undefined;
}
