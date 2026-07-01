-- ============================================================================
-- Debt planner: editable monthly surplus
--   The "Available / mo" figure is now a view-only 3-month average. This stores
--   the editable surplus the sliders actually allocate (null → default to the
--   3-month average).
-- ============================================================================

alter table public.settings
  add column debt_surplus numeric(14,2);
