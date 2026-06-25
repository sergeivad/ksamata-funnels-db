export type BlockKind =
  | 'landings' | 'records' | 'tariffs' | 'applications' | 'bonuses'
  | 'oto' | 'processes' | 'meditation' | 'links';

export type BlockMode = 'common' | 'by_time';

export interface BlockKindDef {
  kind: BlockKind;
  title: string;
  icon: string;          // lucide-react icon name
  fields: 1 | 2;         // 1 = url only; 2 = label + url
  modes: BlockMode[];    // ['common'] or ['common','by_time']
  defaultEnabled: boolean;
}

const C: BlockMode[] = ['common'];
const CB: BlockMode[] = ['common', 'by_time'];

export const BLOCK_KINDS: BlockKindDef[] = [
  { kind: 'landings',     title: 'Лендинги',          icon: 'Globe',      fields: 1, modes: C,  defaultEnabled: true  },
  { kind: 'records',      title: 'Записи',            icon: 'Video',      fields: 1, modes: CB, defaultEnabled: false },
  { kind: 'tariffs',      title: 'Страницы тарифов',  icon: 'Tag',        fields: 1, modes: CB, defaultEnabled: true  },
  { kind: 'applications', title: 'Оформление заявки', icon: 'FileText',   fields: 1, modes: CB, defaultEnabled: true  },
  { kind: 'bonuses',      title: 'Бонусы',            icon: 'Gift',       fields: 1, modes: CB, defaultEnabled: false },
  { kind: 'oto',          title: 'ОТО',               icon: 'Flame',      fields: 1, modes: CB, defaultEnabled: false },
  { kind: 'processes',    title: 'Процессы',          icon: 'Settings',   fields: 2, modes: CB, defaultEnabled: false },
  { kind: 'meditation',   title: 'Медитация / дожим', icon: 'Sparkles',   fields: 1, modes: CB, defaultEnabled: false },
  { kind: 'links',        title: 'Ссылки / дашборды', icon: 'Link',       fields: 2, modes: CB, defaultEnabled: true  },
];

const BY_KIND = new Map<string, BlockKindDef>(BLOCK_KINDS.map((d) => [d.kind, d]));

export function isBlockKind(k: string): k is BlockKind {
  return BY_KIND.has(k);
}

export function getBlockDef(k: BlockKind): BlockKindDef {
  const d = BY_KIND.get(k);
  if (!d) throw new Error(`Unknown block kind: ${k}`);
  return d;
}
