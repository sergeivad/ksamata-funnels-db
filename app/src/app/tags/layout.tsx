import EditorGate from '@/components/EditorGate';

export default function TagsLayout({ children }: { children: React.ReactNode }) {
  return <EditorGate next="/tags">{children}</EditorGate>;
}
