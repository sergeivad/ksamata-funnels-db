import EditorGate from '@/components/EditorGate';

export default function RefsLayout({ children }: { children: React.ReactNode }) {
  return <EditorGate next="/refs">{children}</EditorGate>;
}
