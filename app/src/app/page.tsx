'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronRight, Download, X } from 'lucide-react';
import FunnelCard from '@/components/FunnelCard';
import Toast from '@/components/Toast';
import GroupToggle from '@/components/GroupToggle';
import FacetBar from '@/components/FacetBar';
import Segmented from '@/components/Segmented';
import { confirmUnsavedNavigation } from '@/lib/useUnsavedGuard';
import { useCanEdit } from '@/components/AuthProvider';
import { compareByFrontCodeDesc } from '@/lib/funnel-sort';
import { isFunnelVisible, isSearching } from '@/lib/funnel-search';
import {
  buildGroups,
  clearAxis,
  drillInto,
  isGroupBy,
  matchesFilters,
  type AxisFilters,
  type AxisKey,
  type GroupBy,
} from '@/lib/funnel-facets';
import { funnelHref } from '@/lib/front-code';
import {
  type FunnelStatus,
  type StatusFilter,
  isStatusFilter,
  countLabel,
  STATUS_TOAST,
} from '@/lib/status';

const LS_KEY = 'funnels.groupBy';
const LS_STATUS_KEY = 'funnels.statusFilter';

const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'Все' },
  { value: 'active', label: 'Активные' },
  { value: 'draft', label: 'Черновики' },
  { value: 'archive', label: 'Архив' },
];

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
  status: FunnelStatus;
  productName: string;
  name: string;
  axes: FunnelAxes;
  funnelType: string | null;
}

interface ToastState {
  message: string;
  variant: 'success' | 'error';
  key: number;
}

/**
 * Чем назвать воронку в диалоге удаления. Показывать `num` тут нельзя: на
 * карточке, которую человек только что нажал, написан F-код, и «Удалить
 * воронку №70?» спрашивало про воронку с другим номером на экране.
 */
function funnelLabel(f: FunnelListItem): string {
  if (f.frontCode) return f.frontCode;
  const hasAxes = Object.values(f.axes).some((v) => v.trim() !== '');
  if (hasAxes) return `«${f.name}»`;
  if (f.productName.trim()) return `«${f.productName.trim()}»`;
  return 'без кода и названия';
}

export default function HomePage() {
  const router = useRouter();
  const canEdit = useCanEdit();
  const [funnels, setFunnels] = useState<FunnelListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [toast, setToast] = useState<ToastState | null>(null);
  const toastKeyRef = useRef(0);
  const [groupBy, setGroupBy] = useState<GroupBy>('none');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [search, setSearch] = useState('');
  // Фильтры осей живут только в состоянии страницы: сохранённый в localStorage
  // фильтр через неделю читается как «база усохла».
  const [filters, setFilters] = useState<AxisFilters>({});

  // Load groupBy / statusFilter from localStorage on mount (client-only)
  useEffect(() => {
    try {
      const storedGroupBy = localStorage.getItem(LS_KEY);
      if (isGroupBy(storedGroupBy)) {
        setGroupBy(storedGroupBy);
      }
      const storedStatus = localStorage.getItem(LS_STATUS_KEY);
      if (isStatusFilter(storedStatus)) {
        setStatusFilter(storedStatus);
      }
    } catch {
      // localStorage unavailable — ignore
    }
  }, []);

  function handleGroupByChange(value: GroupBy) {
    setGroupBy(value);
    try {
      localStorage.setItem(LS_KEY, value);
    } catch {
      // localStorage unavailable — ignore
    }
  }

  function handleStatusFilterChange(value: string) {
    if (!isStatusFilter(value)) return;
    setStatusFilter(value);
    try {
      localStorage.setItem(LS_STATUS_KEY, value);
    } catch {
      // localStorage unavailable — ignore
    }
  }

  /**
   * Начало поиска само переводит список на «Все»: искать человек идёт по всей
   * базе, а не внутри раздела, в котором стоит, — запрос по архивной воронке с
   * «Активных» отвечал «Ничего не найдено», то есть «такой воронки нет».
   * Вместе с разделом снимаются и фильтры осей — по тому же доводу.
   * Переключаем только на переходе «пусто → есть запрос»: раздел, выбранный
   * уже поверх поиска, следующая же буква иначе сбрасывала бы обратно.
   */
  function handleSearchChange(value: string) {
    if (!isSearching(search) && isSearching(value)) {
      handleStatusFilterChange('all');
      setFilters({});
    }
    setSearch(value);
  }

  function showToast(message: string, variant: 'success' | 'error') {
    toastKeyRef.current += 1;
    setToast({ message, variant, key: toastKeyRef.current });
  }

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadFailed(false);
    fetch('/api/funnels')
      .then(async (r) => {
        // A 500 also returns JSON ({error: …}); without these checks it would
        // land in setFunnels and crash the page on funnels.filter.
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const data = await r.json();
        if (!Array.isArray(data)) throw new Error('unexpected payload');
        return data;
      })
      .then((data) => {
        if (cancelled) return;
        setFunnels(data);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setLoading(false);
        setLoadFailed(true);
      });
    return () => { cancelled = true; };
  }, [reloadKey]);

  const handleSetStatus = useCallback(
    async (funnel: FunnelListItem, newStatus: FunnelStatus) => {
      if (funnel.status === newStatus) return;
      const prevStatus = funnel.status;

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

        showToast(STATUS_TOAST[newStatus], 'success');
      } catch {
        // Rollback
        setFunnels((prev) =>
          prev.map((f) => (f.id === funnel.id ? { ...f, status: prevStatus } : f))
        );
        showToast('Не удалось изменить статус', 'error');
      }
    },
    []
  );

  const handleDuplicate = useCallback(
    async (funnel: FunnelListItem) => {
      // Duplicating navigates via router.push, which bypasses the <a>-click
      // guard — check dirty state explicitly before leaving.
      if (!confirmUnsavedNavigation()) return;
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
        router.push(funnelHref(duplicated));
      } catch {
        showToast('Не удалось дублировать воронку', 'error');
      }
    },
    [router]
  );

  const handleDelete = useCallback(
    async (funnel: FunnelListItem) => {
      if (!window.confirm(`Удалить воронку ${funnelLabel(funnel)}? Это действие нельзя отменить.`)) {
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
        // Rollback — порядок восстановится сам: список сортируется при рендере.
        setFunnels((prev) => [...prev, funnel]);
        showToast('Не удалось удалить воронку', 'error');
      }
    },
    []
  );

  /**
   * Выдача считается в два шага, и это не лишний проход: счётчики в меню оси
   * берутся без её собственного фильтра, поэтому `FacetBar` нужен список,
   * суженный вкладкой и поиском, но ещё не осями.
   */
  const searchedFunnels = useMemo(() => {
    return funnels
      .filter((f) => isFunnelVisible(f, statusFilter, search))
      .sort(compareByFrontCodeDesc);
  }, [funnels, statusFilter, search]);

  const visibleFunnels = useMemo(
    () => searchedFunnels.filter((f) => matchesFilters(f.axes, filters)),
    [searchedFunnels, filters]
  );

  function handlePickAxis(axis: AxisKey, value: string) {
    const step = drillInto(filters, groupBy, axis, value);
    setFilters(step.filters);
    handleGroupByChange(step.group);
  }

  /** Всё, чем сужен список: оси, раздел и поиск. Кнопка одна — и сбрасывает всё. */
  function resetAllFilters() {
    setFilters({});
    setSearch('');
    handleStatusFilterChange('all');
  }

  function handleClearAxis(axis: AxisKey) {
    const step = clearAxis(filters, groupBy, axis);
    setFilters(step.filters);
    handleGroupByChange(step.group);
  }

  function buildTitle(f: FunnelListItem): string {
    const allEmpty =
      !f.axes.product && !f.axes.contractor && !f.axes.channel && !f.axes.direction;
    return allEmpty ? 'Новая воронка (черновик)' : f.name;
  }

  function renderCard(funnel: FunnelListItem) {
    return (
      <FunnelCard
        key={funnel.id}
        funnel={{
          id: funnel.id,
          frontCode: funnel.frontCode,
          status: funnel.status,
          title: buildTitle(funnel),
          funnelType: funnel.funnelType,
        }}
        onSetStatus={(s) => handleSetStatus(funnel, s)}
        onDuplicate={() => handleDuplicate(funnel)}
        onDelete={() => handleDelete(funnel)}
      />
    );
  }

  function renderList() {
    if (groupBy === 'none') {
      return (
        <div className="grid gap-1.5">
          {visibleFunnels.map(renderCard)}
        </div>
      );
    }

    const groups = buildGroups(visibleFunnels, groupBy).filter(
      (group) => group.funnels.length > 0
    );
    return (
      <div className="grid gap-6">
        {groups.map((group) => (
          <section key={group.value}>
            {/* Заголовок группы — кнопка: клик оставляет в списке только её и
                переводит разбивку на следующую ось. Это ускоритель к строке
                фильтра, а не единственный путь: о нём надо знать заранее. */}
            <button
              type="button"
              onClick={() => handlePickAxis(groupBy, group.value)}
              title={`Показать только «${group.label}»`}
              className="group -ml-2 mb-2 inline-flex items-baseline gap-2 rounded-[6px] px-2 py-0.5 transition hover:bg-[var(--chip)]"
            >
              <h2 className="text-[13px] font-semibold text-[var(--color-text)]">
                {group.label}
              </h2>
              <span className="text-[11px] text-[var(--color-text-secondary)]">
                {group.funnels.length}
              </span>
              <ChevronRight className="h-3 w-3 self-center text-[var(--faint)] transition group-hover:text-[var(--color-text-secondary)]" />
            </button>
            <div className="grid gap-1.5">
              {group.funnels.map(renderCard)}
            </div>
          </section>
        ))}
      </div>
    );
  }

  return (
    <main className="mx-auto max-w-[900px] px-4 py-8">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-[18px] font-semibold text-[var(--color-text)]">
          Проектные воронки
        </h1>
        <p className="mt-1 text-[12px] text-[var(--color-text-secondary)]">
          Выберите воронку, чтобы открыть карточку и управлять правилами.
        </p>
      </div>

      {/* Search + status filter */}
      {!loading && funnels.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <div className="relative min-w-[220px] flex-1">
            <input
              type="text"
              value={search}
              onChange={(e) => handleSearchChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setSearch('');
              }}
              placeholder="Поиск: имя или f№…"
              className="w-full rounded-[8px] border border-[var(--color-border-soft)] bg-white px-3 py-1.5 pr-8 text-[13px] text-[var(--color-text)] placeholder:text-[var(--color-text-secondary)] focus:outline-none focus:ring-1 focus:ring-[var(--orange)]"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                aria-label="Очистить поиск"
                title="Очистить поиск"
                className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--color-text-secondary)] hover:text-[var(--color-text)]"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          {/* Вкладка остаётся живой и во время поиска: начало запроса уже
              перевело её на «Все», а дальше человек волен сузить выдачу до
              раздела — и увидит на вкладке ровно то, что фильтрует. */}
          <Segmented
            options={STATUS_OPTIONS}
            value={statusFilter}
            onChange={handleStatusFilterChange}
          />
        </div>
      )}

      {/* Фильтр по осям — всегда на экране: иначе о нём не догадаться */}
      {!loading && funnels.length > 0 && (
        <FacetBar
          items={searchedFunnels}
          filters={filters}
          onPick={handlePickAxis}
          onClear={handleClearAxis}
          onClearAll={() => setFilters({})}
        />
      )}

      {/* Grouping toggle + count */}
      {!loading && funnels.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <GroupToggle value={groupBy} onChange={handleGroupByChange} />
          <div className="flex items-center gap-3">
            <span className="text-[12px] text-[var(--color-text-secondary)]">
              {countLabel(visibleFunnels.length, funnels.length)}
            </span>
            {/* Экспорт отдаёт всю базу одним файлом — это ровно та ручка, ради
                которой чтение и держат закрытым, поэтому она только редактору. */}
            {canEdit && (
              <a
                href="/api/export"
                download
                className="flex items-center gap-1 text-[12px] text-[var(--color-text-secondary)] hover:text-[var(--color-text)]"
              >
                <Download size={15} />
                Экспорт CSV
              </a>
            )}
          </div>
        </div>
      )}

      {/* List */}
      {loading ? (
        <p className="text-[13px] text-[var(--color-text-secondary)]">Загрузка...</p>
      ) : loadFailed ? (
        <p className="text-[13px] text-[#B42318]">
          Не удалось загрузить воронки.{' '}
          <button
            type="button"
            onClick={() => setReloadKey((k) => k + 1)}
            className="font-semibold underline hover:no-underline"
          >
            Повторить
          </button>
        </p>
      ) : funnels.length === 0 ? (
        <p className="text-[13px] text-[var(--color-text-secondary)]">Нет воронок.</p>
      ) : visibleFunnels.length === 0 ? (
        /* Выход из тупика на виду: с четырьмя осями пустую выдачу теперь легко
           собрать, а понять, какое из условий её обнулило, — нет. */
        <div className="rounded-[8px] border border-dashed border-[var(--line)] px-5 py-7 text-center">
          <p className="text-[13px] text-[var(--color-text-secondary)]">Ничего не найдено.</p>
          <button
            type="button"
            onClick={resetAllFilters}
            className="mt-2.5 rounded-[8px] border border-[var(--color-border-soft)] bg-white px-3 py-1.5 text-[12px] text-[var(--color-text)] transition hover:border-[var(--color-text-secondary)]"
          >
            Сбросить фильтры
          </button>
        </div>
      ) : (
        renderList()
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
