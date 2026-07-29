import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db/client';
import { SCENARIOS, type Scenario } from '@/lib/ab-tags';
import { tagTemplatePutSchema } from '@/lib/validation';
import { replaceTemplateScenario } from '@/lib/tag-templates';
import { resyncAllFunnels } from '@/lib/funnels';
import { internalError } from '@/lib/http';
import { ValidationError } from '@/lib/errors';

type Params = { params: Promise<{ scenario: string }> };

export async function PUT(req: NextRequest, { params }: Params) {
  const { scenario } = await params;
  if (!SCENARIOS.includes(scenario as Scenario)) {
    return NextResponse.json(
      { error: `Invalid scenario "${scenario}". Must be one of: ${SCENARIOS.join(', ')}.` },
      { status: 400 }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = tagTemplatePutSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed', issues: parsed.error.issues }, { status: 400 });
  }

  try {
    // Both in one transaction: the template alone is not a valid state. If the
    // resync fails midway, a committed template would leave every funnel's
    // materialized tags describing the previous one, with nothing to show that
    // they disagree — and the next edit would silently build on the mismatch.
    db.transaction((tx) => {
      replaceTemplateScenario(tx, scenario as Scenario, parsed.data.names);
      resyncAllFunnels(tx); // propagate the new defaults to every funnel (overrides preserved)
    });
    return NextResponse.json({ ok: true, names: parsed.data.names });
  } catch (err: unknown) {
    // Маркер типа воронки в именах — вина запроса (replaceTemplateScenario),
    // а не сервера.
    if (err instanceof ValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    return internalError('PUT /api/tag-templates/[scenario]', err);
  }
}
