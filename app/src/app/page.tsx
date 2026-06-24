'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import FunnelCard from '@/components/FunnelCard';
import Toast from '@/components/Toast';

interface FunnelAxes {
  product: string;
  contractor: string;
  channel: string;
  direction: string;
}

interface FunnelListItem {
  id: number;
  num: number;
  frontCode: string;
  status: 'active' | 'draft';
  productName: string;
  axes: FunnelAxes;
}

interface ToastState {
  message: string;
  variant: 'success' | 'error';
  key: number;
}

export default function HomePage() {
  const router = useRouter();
  const [funnels, setFunnels] = useState<FunnelListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<ToastState | null>(null);
  const toastKeyRef = useRef(0);

  function showToast(message: string, variant: 'success' | 'error') {
    toastKeyRef.current += 1;
    setToast({ message, variant, key: toastKeyRef.current });
  }

  useEffect(() => {
    fetch('/api/funnels')
      .then((r) => r.json())
      .then((data) => {
        setFunnels(data);
        setLoading(false);
      })
      .catch(() => {
        setLoading(false);
        showToast('Не удалось загрузить воронки', 'error');
      });
  }, []);

  const handleActivateToggle = useCallback(
    async (funnel: FunnelListItem) => {
      const newStatus = funnel.status === 'active' ? 'draft' : 'active';

      // Optimistic update
      setFunnels((prev) =>
        prev.map((f) => (f.id === funnel.id ? { ...f, status: newStatus } : f))
      );

      try {
        const res = await fetch(`/api/funnels/${funnel.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: newStatus }),
        });

        if (!res.ok) {
          throw new Error('Ошибка сервера');
        }

        const updated = await res.json();
        setFunnels((prev) =>
          prev.map((f) => (f.id === funnel.id ? { ...f, status: updated.status } : f))
        );

        showToast(
          newStatus === 'active' ? 'Воронка активирована' : 'Воронка переведена в черновик',
          'success'
        );
      } catch {
        // Rollback
        setFunnels((prev) =>
          prev.map((f) => (f.id === funnel.id ? { ...f, status: funnel.status } : f))
        );
        showToast('Не удалось изменить статус', 'error');
      }
    },
    []
  );

  const handleDuplicate = useCallback(
    async (funnel: FunnelListItem) => {
      try {
        const res = await fetch(`/api/funnels/${funnel.id}/duplicate`, {
          method: 'POST',
        });

        if (!res.ok) {
          throw new Error('Ошибка сервера');
        }

        const duplicated: FunnelListItem = await res.json();
        setFunnels((prev) => [...prev, duplicated]);
        showToast('Воронка дублирована', 'success');
      } catch {
        showToast('Не удалось дублировать воронку', 'error');
      }
    },
    []
  );

  const handleDelete = useCallback(
    async (funnel: FunnelListItem) => {
      if (!window.confirm(`Удалить воронку №${funnel.num}? Это действие нельзя отменить.`)) {
        return;
      }

      // Optimistic remove
      setFunnels((prev) => prev.filter((f) => f.id !== funnel.id));

      try {
        const res = await fetch(`/api/funnels/${funnel.id}`, {
          method: 'DELETE',
        });

        if (!res.ok) {
          throw new Error('Ошибка сервера');
        }

        showToast('Воронка удалена', 'success');
      } catch {
        // Rollback
        setFunnels((prev) => {
          // Re-insert in sorted position
          const arr = [...prev, funnel];
          arr.sort((a, b) => a.num - b.num);
          return arr;
        });
        showToast('Не удалось удалить воронку', 'error');
      }
    },
    []
  );

  const handleOpen = useCallback(
    (funnel: FunnelListItem) => {
      router.push(`/funnels/${funnel.id}`);
    },
    [router]
  );

  function buildTitle(f: FunnelListItem): string {
    const { product, contractor, channel, direction } = f.axes;
    return `${product} / ${contractor} / ${channel} / ${direction}`;
  }

  return (
    <main className="mx-auto max-w-[900px] px-4 py-8">
      {/* Header */}
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-[18px] font-semibold text-[var(--color-text)]">
            Проектные воронки
          </h1>
          <p className="mt-1 text-[12px] text-[var(--color-text-secondary)]">
            Выберите воронку, чтобы открыть карточку и управлять правилами.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {!loading && (
            <span className="text-[12px] text-[var(--color-text-secondary)]">
              {funnels.length} всего
            </span>
          )}
          <Link
            href="/funnels/new"
            className="inline-flex items-center gap-1 rounded-[8px] bg-[var(--color-accent)] px-3 py-2 text-[13px] font-semibold text-white transition hover:opacity-90"
          >
            ＋ Новая воронка
          </Link>
        </div>
      </div>

      {/* List */}
      {loading ? (
        <p className="text-[13px] text-[var(--color-text-secondary)]">Загрузка...</p>
      ) : funnels.length === 0 ? (
        <p className="text-[13px] text-[var(--color-text-secondary)]">Нет воронок.</p>
      ) : (
        <div className="grid gap-1.5">
          {funnels.map((funnel) => (
            <FunnelCard
              key={funnel.id}
              funnel={{
                id: funnel.id,
                frontCode: funnel.frontCode,
                status: funnel.status,
                title: buildTitle(funnel),
              }}
              onActivateToggle={() => handleActivateToggle(funnel)}
              onDuplicate={() => handleDuplicate(funnel)}
              onDelete={() => handleDelete(funnel)}
              onOpen={() => handleOpen(funnel)}
            />
          ))}
        </div>
      )}

      {/* Toast portal */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 pointer-events-none">
          <Toast
            key={toast.key}
            message={toast.message}
            variant={toast.variant}
            onClose={() => setToast(null)}
          />
        </div>
      )}
    </main>
  );
}
