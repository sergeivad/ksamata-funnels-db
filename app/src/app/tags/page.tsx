import { db } from '@/db/client';
import { listTemplate } from '@/lib/tag-templates';
import TagTemplateEditor from '@/components/TagTemplateEditor';
import type { Scenario } from '@/lib/ab-tags';

export default function TagsPage() {
  const t = listTemplate(db);
  const sections: { label: string; scenario: Scenario }[] = [
    { label: 'Регистрация', scenario: 'reg' },
    { label: 'Оплата · 15:00', scenario: 'time_15' },
    { label: 'Оплата · 19:00', scenario: 'time_19' },
    { label: 'Мессенджер', scenario: 'messenger' },
    { label: 'Предсписок', scenario: 'predspisok' },
  ];

  return (
    <main className="mx-auto max-w-[1120px] px-6 py-8">
      <h1 className="mb-1 text-[18px] font-semibold text-[var(--ink)]">Шаблон АВ-тегов</h1>
      <p className="mb-4 text-[12px] text-[var(--muted)]">
        Дефолтные теги для всех воронок по сценариям. Изменения применяются ко всем воронкам сразу
        (ручные правки на воронках сохраняются).
      </p>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {sections.map((s) => (
          <TagTemplateEditor key={s.scenario} label={s.label} scenario={s.scenario} initial={t[s.scenario]} />
        ))}
      </div>
    </main>
  );
}
