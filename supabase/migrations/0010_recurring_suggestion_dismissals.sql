-- ============================================================================
-- Dismissed recurring-detection suggestions
--   When the user dismisses a "looks recurring" suggestion, remember its stable
--   signature so it isn't offered again. (Approving a suggestion instead creates
--   a rule, which then covers the group so it stops being suggested.)
-- ============================================================================

create table public.recurring_suggestion_dismissals (
  user_id    uuid not null references auth.users (id) on delete cascade,
  signature  text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, signature)
);

alter table public.recurring_suggestion_dismissals enable row level security;

create policy "owner_all" on public.recurring_suggestion_dismissals
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
