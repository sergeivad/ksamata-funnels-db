import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db/client';
import { SCENARIOS, type Scenario } from '@/lib/ab-tags';
import { tagTemplatePutSchema } from '@/lib/validation';
import { replaceTemplateScenario } from '@/lib/tag-templates';
import { resyncAllFunnels } from '@/lib/funnels';
import { internalError } from '@/lib/http';

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
    replaceTemplateScenario(db, scenario as Scenario, parsed.data.names);
    resyncAllFunnels(db); // propagate the new defaults to every funnel (overrides preserved)
    return NextResponse.json({ ok: true, names: parsed.data.names });
  } catch (err: unknown) {
    return internalError('PUT /api/tag-templates/[scenario]', err);
  }
}
