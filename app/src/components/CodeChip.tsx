interface CodeChipProps {
  code: string;
}

export default function CodeChip({ code }: CodeChipProps) {
  return (
    <span className="rounded-[5px] border border-[var(--color-border-soft)] bg-white/60 px-1.5 py-0.5 font-mono text-[10px] font-black uppercase leading-none text-[var(--color-text-secondary)]">
      {code}
    </span>
  );
}
