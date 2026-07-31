import EditorGate from '@/components/EditorGate';

export default function MonitoringLayout({ children }: { children: React.ReactNode }) {
  return <EditorGate next="/monitoring">{children}</EditorGate>;
}
