# Responsive / multi-surface plan

Separate the experience across **desktop browser**, **mobile browser**, and the
**installed PWA** — without forking the screens.

## Framing: two axes, not three views
The three "views" are really two independent axes that combine:

| Axis | Values | Drives |
|---|---|---|
| **Form factor** (viewport width) | compact `<lg` · wide `≥lg` | **Layout**: bottom-nav single column vs sidebar + multi-column |
| **Display mode** (launch) | browser · standalone | **Chrome**: safe-area insets, status bar, install prompt |

- Mobile browser = compact + browser. Installed phone PWA = compact + standalone
  (same UI, minus browser bars). Desktop = wide + browser. Desktop PWA = wide +
  standalone. So the **visual fork is compact vs wide**; standalone is only
  presentational polish on top.
- Width is detected with **CSS breakpoints** (Tailwind `lg:`), so it works at SSR
  with no hydration flicker. Display mode uses `@media (display-mode: standalone)`
  plus a small client hook for the install button only.

## Locked decisions
1. **True desktop layout** — sidebar nav replaces the bottom bar on wide screens;
   content widens with multi-column where it helps.
2. **Dashboard re-layout** — key screens are genuinely re-arranged for big
   screens, not just widened.
3. **PWA = presentational only** — same UI as mobile browser; just remove browser
   chrome, add safe-area padding, hide the in-browser install prompt. No
   app-only features, offline mode, or push (for now).

## Architecture
- **`LayoutShell`** (replaces the current `max-w-[430px]` wrapper in
  `app/(app)/layout.tsx`): renders compact chrome (centered column + `BottomNav`)
  below `lg`, and wide chrome (persistent left **`SideNav`** + fluid content
  region, max ~1200px) at `lg+`. Both render the same route children.
- **Screens stay single components.** Each screen reads width via Tailwind
  responsive classes (and, where layout differs enough, a `useBreakpoint()` hook)
  to switch between its mobile stack and its desktop dashboard grid.
- **Standalone**: add `viewport-fit=cover`; pad the shell and nav with
  `env(safe-area-inset-*)`; `useDisplayMode()` hook to gate the install button.

## Desktop dashboard re-layouts (per screen)
- **Home**: left column = the hero top tile + spending-by-bucket; right column =
  recent activity + quick actions. Wider gauge/figures.
- **Insights**: multi-panel dashboard — gauge + category list in one panel,
  cash-flow + month nav in another, category detail opens in a side panel instead
  of a bottom sheet.
- **Activity**: **list + detail** two-pane — transactions list on the left,
  selected transaction's editor in a right pane (bottom sheet stays on mobile).
  Filters move to a left rail instead of a sheet.
- **Profile/Settings**: two-column settings groups; editors open in a centered
  modal rather than a bottom sheet.
- **Sheets → modals/side-panels on desktop**: a `Sheet` variant that renders as a
  centered dialog or right-side panel at `lg+`, so the same call sites work on
  both surfaces.

## PWA / standalone polish (folds in the deferred install work)
- Real **icons** (`/icons/icon-192.png`, `-512.png`, maskable variants) — missing
  today, which is why install doesn't work yet.
- **Service worker** for installability (cache shell; no offline data goal).
- **`beforeinstallprompt`** capture → an "Install app" affordance shown only in
  browser display mode.
- Safe-area insets + `theme-color` already partly set; finish for notch/home bar.

## Phasing
1. **Responsive foundation** — `LayoutShell`, `SideNav`, `useBreakpoint`/
   `useDisplayMode`, desktop-aware `Sheet`. No screen redesign yet; screens just
   widen. Ship + verify nothing regresses on mobile.
2. **Desktop dashboards** — re-layout Home, Insights, Activity (list+detail),
   Profile per above.
3. **Standalone polish** — icons, service worker, install prompt, safe areas.

Each phase is independently shippable and leaves mobile untouched first.
