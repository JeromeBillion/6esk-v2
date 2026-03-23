# Frontend UI System

## Scope

This document is the current implementation guide for the `6esk` frontend.

Use it as the operational source of truth for:

- visual language
- shared interaction patterns
- frontend ownership boundaries
- demo-mode expectations
- route-level UI behavior

The target-state product intent still lives in `docs/figma-ai-crm-ui-target-state.md`.
This document explains how that intent now exists in the real app.

## Source Of Truth

The live frontend is implemented in:

- `src/app/components`
- `src/app/components/landing`
- `src/app/workspace/components`
- `src/app/workspace/pages`
- route clients under `src/app/*`

The retired Figma export folder `New 6esk UI/` is not a runtime dependency.

## Visual Direction

The app should stay aligned to this style:

- modern minimal
- calm, dense, high-signal layouts
- subtle borders over heavy fills
- restrained shadows
- clear typography hierarchy
- one primary action per area where possible
- dark mode and light mode with the same layout language

Do not introduce a separate visual system for auth, public, support, mail, analytics, admin, or modal flows.

## Shared UI Rules

### Shell And Branding

- `src/app/components/AppShell.tsx` is the signed-in shell
- `src/app/components/PublicPageFrame.tsx` is the public/auth shell
- `src/app/components/BrandMark.tsx` is the shared product mark
- the live brand asset is `src/app/assets/new-logo.jpeg`

### Theme

- theme state is managed through `src/app/lib/theme.ts`
- the platform rail uses a direct toggle icon:
  - moon in light mode
  - sun in dark mode
- theme changes must preserve the same component geometry and hierarchy in both modes

### Feedback And Modal Language

Use the shared workspace modal stack instead of ad hoc banners:

- `ActionFeedbackModal.tsx`
- `ConfirmActionModal.tsx`
- `HistoryModal.tsx`
- `MacroPickerModal.tsx`
- `MergeModal.tsx`
- `VoiceCallModal.tsx`

Success and error feedback should follow the same modal language across the app.

### Density And Controls

- search inputs in workspace headers should stay compact and aligned with adjacent primary controls
- tags, metadata actions, and ownership metadata should stay visually secondary
- controls should auto-save when the action is low-risk and immediately reversible
- avoid redundant save buttons when a select change already performs the commit

## Support UI Behavior

Primary implementation:

- `src/app/workspace/pages/SupportWorkspace.tsx`

Rules:

- ticket selection changes only from the left queue or right-rail interaction history
- scrolling the middle timeline may update the viewed ticket id/channel in the header, but should not silently retarget composer actions
- the center pane shows customer-wide omnichannel interaction history
- email messages in the same thread share one thread container
- WhatsApp and voice keep their own container styles
- support pane widths and composer height are adjustable and persist locally
- the right rail order is:
  - customer details
  - interaction history
  - tags
  - ownership
  - metadata
  - recent activity

## Mail UI Behavior

Primary implementation:

- `src/app/workspace/pages/MailWorkspace.tsx`

Rules:

- the mailbox identity shown beside `Inbox` is the signed-in user in live mode
- demo mode uses the generic support mailbox
- the page does not expose mailbox switching into other users' inboxes

## Landing Page

Primary implementation:

- `src/app/components/landing/LandingPageClient.tsx`
- `src/app/components/landing/WavesCanvas.tsx`
- `src/app/components/landing/BlurRevealText.tsx`
- `src/app/components/landing/CardStackShowcase.tsx`

Rules:

- keep the hero visually dark and high-contrast
- motion should feel intentional, not noisy
- landing and product surfaces must share branding and theme behavior

## Demo Mode

Primary implementation:

- `src/app/lib/demo-mode.ts`
- `src/app/lib/mock-data.ts`
- `src/app/lib/mock-attachments.ts`

Rules:

- demo mode should expose enough permutations to visually validate the UI
- sample data must cover support, mail, analytics, admin, merge reviews, and new ticket flows
- attachment links shown in demo mode should resolve to working mock downloads

## Local Dev Sync

- `npm run dev` must only run from a checkout that already includes the latest `origin/main`
- the enforced check lives in `scripts/check-main-sync.js` and runs through the `predev` script
- the check fetches `origin` and blocks local dev if the current checkout is missing remote `main` commits
- do not auto-pull inside the dev command itself; local work must be rebased or fast-forwarded deliberately
- one-time bypass is allowed only with `SKIP_MAIN_SYNC_CHECK=1`

## Maintenance Rule

If a future prototype, export, or scratch implementation is introduced, do not leave it as a second frontend stack inside the repo.

Either:

- promote it into the real app, or
- document the useful decisions here and retire it
