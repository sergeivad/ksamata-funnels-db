/**
 * Хелперы для тестов мониторинга.
 *
 * Тесты работают на временной КОПИИ реальной БД, а таблицы monitor_* — это наше
 * собственное состояние, а не исходные данные воронок. В рабочей копии разработчика
 * они запросто окажутся наполненными: локальный дев-сервер сам запускает планировщик,
 * тот делает syncMonitorTargets и заводит сотни целей. Тесты, которые проверяют
 * абсолютные числа, от этого краснеют на исправном коде.
 *
 * Поэтому каждый тест мониторинга стартует от чистого состояния: после
 * runMigratePhase6 вызываем clearMonitoringState.
 */
import type Database from 'better-sqlite3';

/**
 * Стираем всё состояние мониторинга: цели, их связи с воронками, текущие статусы,
 * историю смен и решения по группам (последние — чтобы стартовать от
 * задокументированного дефолта: ленды вкл, остальное выкл).
 * Порядок — от зависимых таблиц к monitor_targets, ради foreign_keys = ON.
 */
export function clearMonitoringState(sqlite: Database.Database) {
  sqlite.prepare(`DELETE FROM monitor_target_funnels`).run();
  sqlite.prepare(`DELETE FROM monitor_events`).run();
  sqlite.prepare(`DELETE FROM monitor_state`).run();
  sqlite.prepare(`DELETE FROM monitor_targets`).run();
  sqlite.prepare(`DELETE FROM monitor_source_kind_prefs`).run();
}
