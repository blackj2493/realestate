# PureProperty.ca — Definitive Mobile Modification List
*(2026-06-14 · full-site mobile audit · companion to UX_AUDIT_2026-06-13.md + MOBILE_TERMINAL_SPEC_2026-06-13.md)*

## Executive summary
Mobile is PureProperty.ca's primary funnel — most traffic and most lead-gen — yet the site is a desktop terminal that was only partially ported to phones, and the gaps fall hardest on exactly the conversion-critical moments. Cold visitors hit a blank black landing screen while auth resolves; the Terminal's only search control is `hidden` below 640px and its desktop map instrument-deck overlays render unsuppressed on a 360px canvas; every onboarding/auth/lead input is 14px (triggering iOS auto-zoom); the underwriting moat slider has a 14px thumb; the AVM and Hidden-Equity tools dead-end on a disclaimer with no lead CTA and render their results below the fold with no scroll feedback; shared-report links unfurl blank in iMessage; and the watchlist — the most-revisited surface — omits the TRREB-mandatory brokerage line, a license-revocation exposure. Across all four personas (Cashflow Investor, Flipper, Smart Homebuyer, Builder), the pattern is the same: the data and the funnel exist, but on a phone they are off-screen, un-tappable, zoom-broken, or invisible at the exact instant a lead would form. The fixes below are overwhelmingly surgical (single-class swaps, attribute additions, `min-h-[44px]` floors), with a handful of structural mobile rebuilds (Terminal search overlay, map FAB→sheet, compare unified-scroll) that carry the heaviest lift.

## Cross-cutting foundation fixes
These recur across many routes; fix the root pattern once.

- **100dvh viewport (`min-h-screen` → `min-h-app`).** The `.min-h-app` utility already exists (globals.css:313-316, `100vh` fallback → `100dvh`) and `<body>` uses it; many inner wrappers re-assert `min-h-screen`. Swap at: `page.tsx:34,37` (landing), `apply/page.tsx:258,260`, `login/page.tsx:21,25`, `welcome/page.tsx:29`, `avm/page.tsx:18`, `properties/page.tsx:389` (Suspense spinner — the one visibly-centered artifact), `properties/[id]/page.tsx:228,292`, `properties/compare/page.tsx:48`, `(app)/dashboard/DashboardClient.tsx:82,92`, `(app)/analytics/AnalyticsClient.tsx:179`, `share/[token]/page.tsx:78`, `LegalDocument.tsx:25`. **Heals:** landing, apply, auth, avm, terminal, detail, compare, dashboard, analytics, share, legal.
- **Safe-area insets on top-anchored / bottom content (`pt-safe` / `pb-safe` / `px-safe`).** Utilities exist (globals.css:317-322,329); `viewportFit:'cover'` is global (layout.tsx:25). Add `pt-safe` to headers: `AppHeader.tsx:40`, `MobileNav.tsx:40`, `hero/TopNav.tsx:6`, `login/page.tsx:27`, `welcome/page.tsx:30`, `share/[token]/page.tsx:79`. Add `pb-safe` to bottom content/drawers/footers: `MobileNav.tsx:53` (nav, + `overscroll-contain`), `page.tsx:41` (landing `<main>`), `welcome/page.tsx:52`, `analytics/AnalyticsClient.tsx:180`, `dashboard/DashboardClient.tsx:100` (+`px-safe`), `share/[token]/page.tsx:118`, `LegalDocument.tsx:62`, `hidden-equity/page.tsx:11,22`, `whats-my-home-hiding/page.tsx:53`. **Heals:** every route with a sticky header, drawer, or bottom compliance line. (Note: in portrait browser the top inset resolves to ~0 — this is landscape/PWA hardening, not a portrait crisis.)
- **Input font-size ≥16px to kill iOS auto-zoom (`text-sm` → `text-base` on text inputs).** Below 16px, iOS Safari zooms on focus and shifts the form off-screen. Fix: `apply/page.tsx:57` (`inputClass`, feeds all 3 Step-1 inputs), `MagicLinkForm.tsx:155` (email — also the post-apply and /login/​hidden-equity gate). **Heals:** apply, login, register/welcome, hidden-equity gate. (OTP input at MagicLinkForm.tsx:92 is already `text-lg`=18px — no change.)
- **44px tap-target floor (add `min-h-[44px]`, or `h-11 w-11` for icon buttons).** The single most pervasive defect. Apply to: shell — `MobileNav.tsx:30,43` (trigger+close), `WatchlistAlertsBell.tsx:147,167-168` (bell+X), `AccountButton.tsx:30,47`; landing — `hero/TopNav.tsx:10-14` (LOGIN); apply — Pill base `:81`, Chip base `:106`, Back `:521`; auth — `VowGateOverlay.tsx:50`, `MagicLinkForm.tsx:101,113-123,124-131,164`, `AcceptTermsForm.tsx:25,102`; analytics — tabs `:312`, chips `:204,220`, LocationSearch (route-scoped `[&_input]:h-11`) `:192`; compare — `LensSelector.tsx:21`, `RentInput.tsx:22`, `CompareMediaCell.tsx:52,60`, `AnonBanner` `CompareClient.tsx:151`; avm — buttons `AVMCalculator.tsx:77-91`, selects `AVMPropertyForm.tsx:96,116,136`; detail — `slider.tsx:51` (::after hit-area), `MobileActionBar.tsx:44`, `ScheduleViewingForm.tsx:109,237`, `UnderwritingSandbox.tsx:263`; dashboard — `DashboardClient.tsx:121-128`, `WatchlistSection.tsx:107-109`, `PersonaSwitcher.tsx:35`; hidden-equity/consumer — `HiddenEquityForm.tsx` triggers, `RenovationFunnel.tsx:136`, `RenovationRevealLocked.tsx:54`, `ShareChallengeButton.tsx:49`; legal — `LegalDocument.tsx:32,35`. **Heals:** every interactive route.
- **Touch press feedback (`active:` states + `[touch-action:manipulation]`).** `hover:` never fires on touch, so cellular taps look dead for 1-3s and invite double-taps. Add to primary CTAs/chips: `MagicLinkForm.tsx:101,164`, `AcceptTermsForm.tsx:102`, apply Pill/Chip `:81,106`, `AssumptionsBar.tsx:57`, landing CTAs (`hero/TopNav.tsx`), legal links. **Heals:** apply, auth, compare, landing.
- **`hover:underline` → `underline` on legal/policy links** (color-alone fails WCAG 1.4.1 on touch): `apply/page.tsx:497,501`, `login/page.tsx:54,71,75`. **Heals:** apply, login.
- **TRREB §6.3(c) brokerage line — mandatory `ListOfficeName` at same weight as other details, never truncated to zero.** Highest compliance exposure. Fix: `ListingCardBody.tsx:124,187` (move to own line, drop `truncate`); persist+render on `WatchlistSection.tsx:116-128` (+ `useWatchlist.ts:20-27`, `PlaylistRow.tsx:50-57`, `ActivityRow.tsx:92-98`); `RecentlyViewed.tsx:44-54` (+ `recentlyViewed.ts`); compare identity card `CompareMobile.tsx:76` + `CompareClient.tsx:92`; listing-detail header weight `[id]/page.tsx:427-432` (`slate-400`→`slate-300`). **Heals:** terminal cards, dashboard watchlist + recently-viewed, compare, detail.
- **Theme leak: add `color-scheme: dark` to `:root`** (globals.css, after line 32). With `viewportFit:cover` + dark `themeColor`, iOS renders native scrollbars/`<input>` chrome/status-bar text in light mode against the dark UI. There is NO missing `dark` class problem — `rg "dark:"` returns zero matches, so adding `dark` to `<html>` is an inert no-op. Also retire off-token surfaces: `avm/page.tsx:18` and `page.tsx:18` `bg-black text-gray-100` → `bg-background text-foreground`. **Heals:** global native-control polish; avm/hidden-equity surface drift.
- **Decorative Mapbox/deck.gl bundle on cold mobile loads.** ~300-400KB JS + tile fetches for non-interactive background/hidden maps. Gate behind `useIsMobile`: landing `HeroBackground.tsx:24` (keep grid+wash); replace login `HeroBackground` with CSS-only (`login/page.tsx:23`); mount-gate Terminal `AlphaMap` on mobile list view (`properties/page.tsx:291-299`); IntersectionObserver-gate `DashboardHeatTile` (`DashboardClient.tsx:189`). **Heals:** landing, login, terminal, dashboard.
- **Mobile form-input hints (`autoComplete` / `inputMode` / `enterKeyHint` / `autoCapitalize`).** One-tap autofill is the difference between a lead and an abandon. Add across all lead/auth forms: `apply/page.tsx:359-387`, `MagicLinkForm.tsx:82,149`, `ScheduleViewingForm.tsx:152-226`, `AVMPropertyForm.tsx:55-61`, `HiddenEquityForm.tsx:284-285` (and city combobox), `DashboardConfigPanel.tsx:86-91`. **Heals:** apply, auth, terminal lead form, avm, hidden-equity, dashboard.

## Per-route modifications

### Global shell & viewport foundation
| Item | Severity | Modification (file:line + exact change) | Effort |
|---|---|---|---|
| Add `color-scheme: dark` to `:root` | medium | globals.css `:root` (after :32) add `color-scheme: dark;`. Do NOT add `dark` to `<html>` (inert — zero `dark:` variants exist). | S |
| AVM page off-token surface | low | `avm/page.tsx:18` `min-h-screen bg-black text-gray-100` → `min-h-app text-foreground`. | S |
| Interior pages use `min-h-screen` | medium | Replace `min-h-screen`→`min-h-app` at `properties/page.tsx:389`, `DashboardClient.tsx:82,92`, `AnalyticsClient.tsx:179`, `avm/page.tsx:18`, `[id]/page.tsx:228,292`, `compare/page.tsx:48`. | S |
| WatchlistAlertsBell dropdown clips off-screen | high | `WatchlistAlertsBell.tsx:162` `w-80` → `w-[min(20rem,calc(100vw-1rem))]` (keep `right-0`). | S |
| MobileNav close is 28px tap target | high | `MobileNav.tsx:43-44` `p-1` → `inline-flex h-11 w-11 items-center justify-center -mr-2`; same for bare X at `WatchlistAlertsBell.tsx:167-168`. | S |
| AccountButton auth CTA ~30px | high | `AccountButton.tsx:30,47` add `min-h-[44px]` (keep `px-3 text-[11px]`). No "Sign In Free" copy change. | S |
| Hamburger + bell are 36px | medium | `MobileNav.tsx:29-30` `p-2`→`h-11 w-11`; `WatchlistAlertsBell.tsx:147` `h-9 w-9`→`h-11 w-11`. | S |
| AppHeader no `pt-safe` | low | `AppHeader.tsx:40` add `pt-safe`; `MobileNav.tsx:40` Dialog.Content add `pt-safe`. | S |
| MobileNav drawer no `pb-safe`/`overscroll-contain` | medium | `MobileNav.tsx:53` `flex flex-col py-2` → `+ pb-safe overscroll-contain`. | S |
| `text-rendering: optimizeLegibility` scroll cost | low | globals.css:119 remove from `body`; keep antialiasing + font-feature-settings. | S |

### Landing / marketing home ( / )
| Item | Severity | Modification (file:line + exact change) | Effort |
|---|---|---|---|
| Auth-gate shows blank black screen | critical | `page.tsx:31` remove `if (!checked) return null`; render hero immediately, keep useEffect but `router.replace('/dashboard')` only when `user` found (drop `setChecked` gating). | S |
| No secondary "Explore the Terminal" CTA | critical | `page.tsx` after Apply `<Link>` (:63) add ghost link to `/properties` (`terminal-font mt-4 inline-flex h-11 …`). | S |
| Root divs use `min-h-screen` | high | `page.tsx:34,37` → `min-h-app`. | S |
| TopNav lacks `pt-safe` | high | `hero/TopNav.tsx:6` add `pt-safe`. | S |
| Full Mapbox/deck.gl on cold visit | high | `HeroBackground.tsx:24` gate `<HeroMapCanvas/>` behind `useIsMobile()` (`{!isMobile && …}`); mobile keeps grid+wash. | M |
| Hero h1 clamp floor pushes CTA below fold | high | `page.tsx:46` `clamp(2.75rem,9vw,9rem)`→`clamp(2rem,9vw,9rem)`; `:52` `mt-8`→`mt-5 sm:mt-8`; `:60` `mt-11`→`mt-7 sm:mt-11`. | S |
| LOGIN link ~20px, no touch feedback | medium | `hero/TopNav.tsx:10-14` → `inline-flex h-11 items-center px-2 … active:text-emerald-300 focus-visible:ring-1 …`. | S |
| Whole page `"use client"` for a redirect | medium | Optional once blank-screen fixed: convert `page.tsx` to RSC using `createSupabaseServerClient()` + `redirect('/dashboard')`. | M |
| `<main>` lacks `pb-safe` | low | `page.tsx:41` add `pb-safe` (only — left/right insets are 0). | S |
| Disclaimer 11px on mobile | low | `page.tsx:65` `text-[11px]`→`text-xs` (keep `md:text-xs`). | S |
| Overline tracking risks wrap near 360px | low | `page.tsx:42` `text-sm … tracking-[0.3em]`→`text-xs sm:text-sm tracking-[0.2em] sm:tracking-[0.3em]`. | S |

### Apply — the "velvet rope" onboarding ( /apply )
| Item | Severity | Modification (file:line + exact change) | Effort |
|---|---|---|---|
| Text inputs `text-sm` → iOS auto-zoom | critical | `apply/page.tsx:57` `inputClass` `text-sm`→`text-base` (fixes all 3 inputs; keep `py-2.5`). | S |
| MagicLinkForm email `text-sm` zoom | high | `MagicLinkForm.tsx:155` `text-sm`→`text-base`. | S |
| Chip buttons ~28-30px | high | `apply/page.tsx:106` add `min-h-[44px]` to Chip base (keep `py-1.5 text-xs`). | S |
| Pill buttons ~36px | high | `apply/page.tsx:81` add `min-h-[44px]` to Pill base (keep `py-2 text-sm`). | S |
| Inputs lack autocomplete/inputMode | medium | `apply/page.tsx:359-387` add name/email/organization autoComplete + `inputMode="email"` + autoCapitalize per field. | S |
| Submit redirects to 2nd login wall, discards email | high | `apply/page.tsx:252` append `&email=`+encoded; `login/page.tsx:13-18` accept+sanitize `email`→`initialEmail`; `MagicLinkForm.tsx:19,21` seed `useState(initialEmail ?? "")`. No auto-doSend. | M |
| Validation error invisible (no scroll/aria-live) | medium | `apply/page.tsx:333-337` add `ref`+`role="alert"`; in `handleNext`(:195)/`handleSubmit`(:211) `requestAnimationFrame(()=>errorRef.current?.scrollIntoView(...))`. | S |
| Hero stack pushes first field below fold | medium | `apply/page.tsx:266` `text-4xl … md:text-6xl`→`text-2xl md:text-4xl lg:text-6xl`; `:263` `py-10`→`py-6 md:py-10`; `:269` subtitle `hidden md:block`. | S |
| Step-3 label "VOW Terms" is jargon | medium | `apply/page.tsx:20` `"VOW Terms"`→`"Confirm & Submit"`. | S |
| No privacy reassurance at email field | medium | `apply/page.tsx` after :375 add one-line no-spam + `/privacy` link (`text-xs text-slate-500`). | S |
| Terms/Privacy `hover:underline` | low | `apply/page.tsx:497,501` `hover:underline`→`underline`. | S |
| Disabled Back ghost on Step 1 | low | `apply/page.tsx:514-528` step 1 → `<Link href="/">Cancel</Link>` (`min-h-[44px]`); Back button add `min-h-[44px]`. | S |
| Root `min-h-screen` | low | `apply/page.tsx:258,260` → `min-h-app`. | S |
| Chip/Pill no `active:` press state | low | `apply/page.tsx:81,106` add `active:bg-slate-800`. | S |

### Auth pages ( /login, /register, /welcome )
| Item | Severity | Modification (file:line + exact change) | Effort |
|---|---|---|---|
| Email input `text-sm` auto-zoom | high | `MagicLinkForm.tsx:155` `text-sm`→`text-base`. | S |
| VowGateOverlay CTA ~30px | high | `VowGateOverlay.tsx:50` `px-4 py-1.5`→`px-6 py-3 min-h-[44px]`. | S |
| Primary submit buttons ~36-40px | high | `MagicLinkForm.tsx:101,164` + `AcceptTermsForm.tsx:102` add `min-h-[44px] py-3`. | S |
| "Change email"/"Resend code" untappable | high | `MagicLinkForm.tsx:113-123,124-131` add `py-2 px-1 min-h-[44px]`. | S |
| Login Mapbox/deck.gl bundle | high | `login/page.tsx:23` replace `<HeroBackground variant="form"/>` with CSS-only (`bg-slate-950` + `grid-pattern` + emerald wash + scrim). | M |
| Submit buttons only `hover:` | medium | `MagicLinkForm.tsx:101,164` add `active:bg-cyan-500/30 [touch-action:manipulation]`; `AcceptTermsForm.tsx:102` `active:bg-emerald-600 …`. | S |
| Error `<p>` no `role="alert"` | medium | `MagicLinkForm.tsx:96,159` + `AcceptTermsForm.tsx:96` add `role="alert"`. | S |
| CheckRow no min-height | medium | `AcceptTermsForm.tsx:25` add `min-h-[44px] py-1` (optional `hover:bg-slate-800/40`). | S |
| Login+welcome `min-h-screen` | medium | `login/page.tsx:21,25` + `welcome/page.tsx:29` → `min-h-app`. | S |
| Login+welcome headers lack `pt-safe` | medium | `login/page.tsx:27` + `welcome/page.tsx:30` add `pt-safe`; `welcome/page.tsx:52` footer add `pb-safe`. | S |
| /login identity incoherence (T6) | medium | `login/page.tsx:52-58` collapse to one frame; relabel `/apply` link to "Learn about Terminal Access" or remove; single sub-copy. | S |
| Email input missing `inputMode`/`name` | low | `MagicLinkForm.tsx:149` add `inputMode="email" name="email"`. | S |
| OTP input missing `name` | low | `MagicLinkForm.tsx:82` add `name="otp" aria-label="One-time sign-in code"`. | S |
| Login h1 `text-4xl` wrap at 320px | low | `login/page.tsx:40` `text-4xl … md:text-6xl`→`text-3xl sm:text-4xl md:text-6xl`. Keep description paragraph. | S |
| OTP success jumps to hard nav | low | `MagicLinkForm.tsx:68-69` add `"success"` status + "Access granted" + `setTimeout(...,400)`. | S |
| Email step lacks no-spam assurance | low | `MagicLinkForm.tsx:176` append "… No spam — alerts are opt-in only." | S |

### The Terminal ( /properties ) — primary surface
| Item | Severity | Modification (file:line + exact change) | Effort |
|---|---|---|---|
| Suspense fallback `min-h-screen` | low | `page.tsx:389` → `min-h-app`. | S |
| LocationSearch hidden on every phone | critical | `TopCommandBar.tsx:55` add `block sm:hidden` Search-icon button in mobile row (:43-56) opening full-width LocationSearch overlay (autoFocus, `inputMode="search"`, `enterKeyHint="search"`); keep inline `hidden … sm:block` for sm+. | M |
| Desktop map instrument deck unsuppressed on mobile | critical | Add `hidden md:flex`/`md:block` to `MapControlRail.tsx:196`, `MapDrawer.tsx:117`, `MapModeDock.tsx:31`, `MapTimeline.tsx:43`; replace with one mobile FAB→bottom-sheet (rail tools + Listings/Heatmap/3D). `MapStatusHUD` `left-16`→`left-2 md:left-16` + `max-w-[calc(100vw-1rem)]`. | L |
| ListingMapPopup hardcoded 340px + 14px close | high | `ListingMapPopup.tsx:23` `popupW = Math.min(340, (dims?.width ?? 340) - 16)` used at :68,:76; close button :83-90 `p-0.5`→`p-2`. | M |
| Brokerage `truncate` clips to zero | high | `ListingCardBody.tsx:124,187` move brokerage to own line (`mt-0.5 text-[10px] normal-case … text-slate-500`), drop `truncate`. | S |
| LedgerRow non-semantic + 20-22px targets | medium | `LedgerRow.tsx:190` add `role="button" tabIndex={0} onKeyDown=…`; `LedgerPanel.tsx:184` wrap `role="list"`; checkbox :210 `compact && '-my-2.5 -ml-1 h-11 w-11'`; heart :239 `p-1`→`p-2.5`. | S |
| AlphaMap mounts in `display:none` on mobile list | medium | `page.tsx:291-299` gate mount: `{(!isMobile || mobileView==='map') && <AlphaMap …/>}` via `useIsMobile(767)`; keep resize nudge. | M |
| FilterChip popover `w-56` overflows right | medium | `FilterChip.tsx:54` + `InvestorChip.tsx:212` `w-56`→`w-56 max-w-[calc(100vw-1rem)]` (ideally `align=right` when overflowing). | S |
| VowGateOverlay "Login Required" value-free | medium | `page.tsx:270` message → value framing; `:317,342` pass `ctaLabel="See Sold Prices — Sign In Free"`. | S |
| ScheduleViewingForm lacks input hints + consent | medium | `ScheduleViewingForm.tsx:152-226` add autoComplete/inputMode/enterKeyHint per field; add consent line under submit (:234-241). | S |
| No persistent lead CTA in mobile list | medium | `page.tsx:282-370` add `md:hidden` sticky "Talk to an Investor Agent" above list/map toggle → 2-field sheet POSTing to `/api/viewing-requests`; offset from centered toggle. | M |
| FilterBar chip strip: 25-28px targets, hidden scroll, off-screen filters | high | `FilterBar.tsx:98` add `md:hidden` "Filters (N)" → bottom sheet (48px controls); interim: `py-1.5`→`py-2.5` on `FilterChip:31`/`InvestorChip:20`/`LayerChips:26`/`FilterBar:160` + right-edge fade. | L |
| ImageBentoGrid `h-[400px]` pushes price/brokerage below fold | medium | `ListingTerminal.tsx:303-307` `h-[400px]`→`h-56 sm:h-[400px]` AND relax `ImageBentoGrid.tsx:52` hero `min-h-[300px]`→`min-h-[180px] sm:min-h-[300px]` (+ thumb mins). | S |
| ListingTerminal mobile dismiss not in thumb zone | low | `ListingTerminal.tsx:555` add Back/Close to mobile sticky bar's left slot; optional header close `p-2`→`p-3`. | S |

### Listing detail ( /properties/[id] ) — 70/30 + underwriting
| Item | Severity | Modification (file:line + exact change) | Effort |
|---|---|---|---|
| Underwriting slider thumb 14px | critical | `slider.tsx:51` Thumb add `relative after:absolute after:inset-[-14px] after:content-['']` (≥44px hit-area); covers all sandbox knobs. | S |
| ImageBentoGrid fixed 2-col, no swipe/affordance | high | `ImageBentoGrid.tsx:36` gate bento `md:grid md:grid-cols-2 md:grid-rows-2` + add `md:hidden` full-bleed hero w/ "VIEW ALL PHOTOS (N)" pill; `PropertyGallery.tsx:15` `h-[420px]`→`h-[220px] sm:h-[320px] lg:h-[420px]`. | M |
| MediaGalleryOverlay no swipe | high | `MediaGalleryOverlay.tsx:108` add `onTouchStart`/`onTouchEnd` delta (±40px → `goToNext`/`goToPrevious`). | S |
| Specs grid hard `grid-cols-4` | medium | `page.tsx:444` `grid-cols-4`→`grid-cols-2 sm:grid-cols-4`; SpecCell value `:646` add `min-w-0 truncate`. | S |
| RoomMap list `overflow-hidden` clips Area | medium | `RoomMap.tsx:430` `overflow-hidden`→`overflow-x-auto`. | S |
| RoomMap treemap tiles no onClick; hint lies | medium | `RoomMap.tsx:315` add `onClick` toggle `setActiveId`; `:424` "Hover or tap"→"Tap a room for details". | S |
| SimilarProperties carousel no snap | medium | `SimilarProperties.tsx:64` add `snap-x snap-mandatory scroll-pl-4 -mx-4 px-4`; comp cards add `snap-start`. | S |
| MobileActionBar no "Run the numbers" jump | medium | `UnderwritingSandbox.tsx:130` add `id="underwriting-sandbox"`; MobileActionBar add gated Calculator button → `scrollIntoView`. | M |
| ScheduleViewingForm no autocomplete; freetext time | high | `ScheduleViewingForm.tsx:152,169,186` add autoComplete name/email/tel + `inputMode="email"`; `:202-210` freetext→`<select>` presets. | S |
| ListingEstimateCard light-scale chip/delta | medium | `ListingEstimateCard.tsx:19-23,186-188` swap pale classes for dark `emerald/amber/slate` + `rose-400`/`emerald-400`. | S |
| MobileActionBar Contact ~40px + label mismatch | medium | `MobileActionBar.tsx:44` `py-2.5`→`py-3`; `:48` "Contact"→"Book a Viewing". | S |
| ScheduleViewingForm CTA/submit ~36px | medium | `ScheduleViewingForm.tsx:109,237` `py-2`→`py-3`; optional `active:scale-95` on idle CTA. | S |
| Brokerage shown twice, header lighter | low | `[id]/page.tsx:427-432` header `text-slate-400`→`text-slate-300`; bottom Section as-is or drop. | S |
| No privacy micro-copy under submit | low | `ScheduleViewingForm.tsx:234-242` add no-spam + `/privacy` line. | S |
| SocialProofBar late-mount CLS | low | `SocialProofBar.tsx:69` reserve `min-h-[40px]` pulse during pending; keep honest zero-state. | S |
| Amortization `<select>` h-8 | low | `UnderwritingSandbox.tsx:263` `h-8`→`h-10`, `text-xs`→`text-sm`. | S |
| Contact scrolls to buried form (vs sheet) | low | `MobileActionBar.tsx:37-48` — future MobileContactSheet; interim pair with relabel/height fix. | M |
| Back link ~20px | low | `page.tsx:308-313` add `py-2 -my-2`. | S |
| `<main>` `min-h-screen` | low | `page.tsx:228,292` → `min-h-app`. | S |

### Compare properties ( /properties/compare )
| Item | Severity | Modification (file:line + exact change) | Effort |
|---|---|---|---|
| Per-row scrolls desync from identity header | high | `CompareMobile.tsx:40,70` — replace with ONE `overflow-x-auto` grid; metric label `sticky left-0 bg-slate-950 z-10 w-24`; uniform property columns sharing one scroll offset (mirror `MetricRow.tsx:21`). | L |
| AssumptionsBar ~180px sticky wall | high | `AssumptionsBar.tsx:30` slider blocks (:31-49) `hidden md:flex`; add `flex md:hidden` "Assumptions (…) ▾" → `<details>`/sheet; disclaimer `:69` `hidden md:block`. | M |
| LensSelector overflow + 28px targets | high | `LensSelector.tsx:21` `py-1`→`py-2.5`; add `short` to PersonaDef (personaConfig.ts:209 + 4 entries); `:28` render `md:hidden` short + `hidden md:inline` full. | M |
| RentInput h-6 (24px) | high | `RentInput.tsx:22` `h-6 w-20`→`h-10 w-full`, `px-1.5`→`px-2`; `:19` `inputMode="numeric"`→`"decimal"`. | S |
| CompareMediaCell arrows ~24px | medium | `CompareMediaCell.tsx:52,60` `p-1`→`p-2.5`; `left-1`/`right-1`→`left-2`/`right-2`. | S |
| Brokerage absent from identity card | high | `CompareMobile.tsx` after :76 add `ListOfficeName` at `text-[11px] text-slate-400`; same after `CompareClient.tsx:92`. Keep metric row. | S |
| No add/remove/swap on mobile | high | `CompareMobile.tsx:72` make card `relative` + absolute `×` (h-8 w-8) dropping id from `ids` via `router.replace`; show "Add another property" chip when <2. | S |
| Scroll containers no peek/fade/no-scrollbar | medium | `CompareMobile.tsx:40,70` add `no-scrollbar` + right-edge fade + `snap-x snap-mandatory`; cards `w-40`→`w-36`. | S |
| AnonBanner ~28px gate-first; LockedCell inert | high | `CompareClient.tsx:146-161` CTA `px-4 py-3 text-sm` + gain copy "Unlock deal scores + AVM estimates — free"; `LockedCell.tsx:3-9` wrap span in `/login?next=` link. | S |
| 17 flat core rows, no decision tier | medium | `CompareMobile.tsx` before :88 add mobile "decision strip" (Deal Score, vs Estimate, True DOM, Price Drop, Cap Rate) + remaining rows in `<details>`. | M |
| Empty state inline text link only | low | `CompareClient.tsx:48-53` → full-width primary button + one-line "how to pick properties". | S |
| "Differences only" no `active:` | low | `AssumptionsBar.tsx:57` add `active:scale-95 transition-transform`. | S |

### Analytics ( /analytics )
| Item | Severity | Modification (file:line + exact change) | Effort |
|---|---|---|---|
| Recharts Tooltip hover-only | high | `AnalyticsClient.tsx:363` add `trigger="click"` + `wrapperStyle={{zIndex:50}}` + `cursor={{fill:'rgba(100,116,139,0.15)'}}`. | S |
| Tooltip no viewport clamp | low | `AnalyticsClient.tsx:363` add `allowEscapeViewBox={{x:false,y:false}}`. | S |
| Chart `h-[380px]` eats viewport | high | `AnalyticsClient.tsx:328` → `h-[240px] sm:h-[320px] lg:h-[380px] p-3`. | S |
| Both Y-axes always render | high | `AnalyticsClient.tsx:355-362` right YAxis add `hide={!isSales}`. | S |
| Metric tabs + type chips ~26px | high | `AnalyticsClient.tsx:312,204,220` add `min-h-[44px] flex items-center` (keep `py-1 text-[10px]`). | S |
| LocationSearch input h-7 | high | `AnalyticsClient.tsx:192` `w-full md:w-80`→`+ [&_input]:h-11 md:[&_input]:h-7` (route-scoped, no shared-component regression). | S |
| Type chip strip `flex-wrap` 3-4 rows | medium | `AnalyticsClient.tsx:199` → `flex … overflow-x-auto no-scrollbar md:flex-wrap pb-1 -mx-4 px-4`; chips `:204,220` add `shrink-0`. | S |
| Root `min-h-screen` | medium | `AnalyticsClient.tsx:179` → `min-h-app`; `:180` add `pb-safe`. | S |
| No lead-capture CTA after data | high | `AnalyticsClient.tsx` after :408 add `md:hidden` sticky bar (`pb-safe`, gated `!loading`) → `/properties?city=${encodeURIComponent(region)}`. | M |
| KPI 10-11px + temperature 9px | medium | `AnalyticsClient.tsx:88,96` `text-[10px]/[11px]`→`text-xs`, label `slate-500`→`slate-400`; `:268` `text-[9px]`→`text-[11px]`, `px-2 py-1`; `:63` `text-[10px]`→`text-xs`. | S |
| XAxis `minTickGap={24}` drops ticks | low | `AnalyticsClient.tsx:341-344` `minTickGap` 24→16. | S |
| Outside-click dismiss mousedown-only | low | `LocationSearch.tsx:79` add `touchstart` listener (passive) + mirror cleanup `:80`. | S |

### AVM valuation page ( /avm )
| Item | Severity | Modification (file:line + exact change) | Effort |
|---|---|---|---|
| No lead CTA after result | critical | `AVMResultDisplay.tsx` after :156 add full-width CTA → `/contact?intent=avm&value=…` (h-12) + privacy micro-copy. | M |
| Result/loading/error below fold; no feedback | critical | `AVMCalculator.tsx:68` `grid grid-cols-1 lg:grid-cols-2`→`flex flex-col-reverse … lg:grid lg:grid-cols-2`; `:80-83` button `disabled={isLoading}` + "CALCULATING…". | M |
| Cold visitors redirected w/ wrong copy, no next | high | `page.tsx:14` `redirect('/hidden-equity?next=/avm')`; `hidden-equity/page.tsx:7-19` read `next`→`MagicLinkForm`; swap copy when `next==='/avm'`. | S |
| Basement tier 4 blank options | high | `AVMPropertyForm.tsx:212` source `[1,2,…9]`→`[1,3,5,7,9]` (or fill empty BASEMENT_LABELS). | S |
| Condition selects fixed `w-40` overflow | high | `AVMPropertyForm.tsx:162,185,208` `w-40`→`w-auto flex-1 ml-3 max-w-[160px]`; labels `:155,178,201` add `shrink-0`. | S |
| Combined 96px h-padding squeezes to 224px | medium | `page.tsx:19` `px-6 py-8`→`px-4 py-6 sm:px-6 sm:py-8`; `AVMCalculator.tsx:70,96` `p-6`→`p-4 sm:p-6`. | S |
| City free-text, no input hints | medium | `AVMPropertyForm.tsx:55-61` add `inputMode="text" autoComplete="address-level2" autoCapitalize="words" autoCorrect="off"`; ideally `<datalist>` of GTA markets. | S |
| Validation error only in result panel | medium | `AVMCalculator.tsx` between :76 and :77 render in-form `{error && <p className="text-sm text-red-400 px-1">{error}</p>}`. | S |
| CALCULATE/RESET 40px; mis-tap clears form | medium | `AVMCalculator.tsx:77-91` add `h-11` both; RESET add `min-w-[72px]`. | S |
| Estimated value `text-4xl` overflow at 8 figures | medium | `AVMResultDisplay.tsx:110` → `text-3xl sm:text-4xl … whitespace-nowrap`; sub-row :113-121 `flex-wrap gap-y-1`. | S |
| 3-col bed/bath/parking ~64-72px cells | medium | `AVMPropertyForm.tsx:87` `gap-4`→`gap-2 sm:gap-4`; triggers `:96,116,136` add `h-11`. | S |
| 2-col city+type doesn't stack | medium | `AVMPropertyForm.tsx:50` `grid-cols-2`→`grid-cols-1 sm:grid-cols-2`. | S |
| Loading/error/empty `h-64` dead space | low | `AVMResultDisplay.tsx:81,89,97` `h-64`→`min-h-32 sm:h-64`. | S |
| Redundant `bg-black` wrapper | low | `page.tsx:18` `bg-black text-gray-100`→`bg-background text-foreground`. | S |

### Dashboard / watchlist ( /dashboard )
| Item | Severity | Modification (file:line + exact change) | Effort |
|---|---|---|---|
| Watchlist cards omit brokerage (§6.3(c)) | critical | `useWatchlist.ts:20-27` add `brokerage?`; populate `PlaylistRow.tsx:50-57`, `ActivityRow.tsx:92-98`; render `WatchlistSection.tsx` after :127 at `text-[10px] text-slate-500`. | M |
| RecentlyViewed omits brokerage | high | `recentlyViewed.ts` add `brokerage?`; populate at record-view; render `RecentlyViewed.tsx` after :53. | M |
| Empty watchlist renders nothing | high | `WatchlistSection.tsx:77` split: `if(loading) return null` then empty-state card + `<Link href="/properties">` CTA (`min-h-[44px]`). | S |
| WatchButton ~28px | high | `WatchlistSection.tsx:107-109` add `min-h-[44px] min-w-[44px] items-center justify-center` + `p-2` (scoped to this call site). | S |
| RegionScorecard `min-w-[1000px]`, no sticky col/affordance | high | `RegionScorecard.tsx:160` add `md:hidden` scroll hint + right-edge fade (`after:… from-slate-950`); higher-value: `md:hidden` stacked card view. | M |
| MarketActivityControls 9-control blob | high | `MarketActivityControls.tsx:104` → `flex gap-3 overflow-x-auto no-scrollbar pb-1 sm:flex-wrap …`; children `whitespace-nowrap shrink-0`; MinSelect `py-1`→`py-1.5`. | M |
| WatchlistAlertsBell `w-80` overflow | high | `WatchlistAlertsBell.tsx:162` `w-80`→`w-[min(20rem,calc(100vw-1rem))]`; inner `:177` `max-h-96`→`max-h-[70dvh]` + `pb-safe`. | S |
| Empty-dashboard CTA ~32px | medium | `DashboardClient.tsx:121-128` `py-2`→`py-3` + `min-h-[44px]`. | S |
| Empty CTA opens panel off-screen above | medium | `DashboardConfigPanel.tsx:53` add `id="dashboard-config"`; `DashboardClient.tsx:123` onClick `setShowConfig(true)` + rAF `scrollIntoView`. | S |
| MarketActivityPanel nested-scroll trap | medium | `MarketActivityPanel.tsx:161,193` `max-h-[360px] overflow-y-auto`→`overflow-y-auto md:max-h-[360px]`. | S |
| MobileNav drawer no `pb-safe` | medium | `MobileNav.tsx:53` add `pb-safe`. | S |
| PersonaSwitcher 30px icon-only, no radio name | medium | `PersonaSwitcher.tsx:35` `py-2`→`py-3`; `:28-34` add `aria-label={p.label}`. | S |
| Config search no input hints; dropdown hidden by keyboard | medium | `DashboardConfigPanel.tsx:86-91` add `type="search" inputMode="search" autoComplete="off" autoCorrect="off" spellCheck={false} enterKeyHint="search"`; `:93` `max-h-60`→`max-h-48`. | S |
| DashboardHeatTile eager WebGL | medium | `DashboardClient.tsx:189` wrap in IntersectionObserver gate (rootMargin 200px) → placeholder until near viewport. | M |
| WatchlistSummary Price Range overflow | low | `WatchlistSummary.tsx:5-13` value div add `truncate` + `title={value}`. | S |
| `<main>` no safe-area padding | low | `DashboardClient.tsx:100` add `px-safe pb-safe`. | S |
| Watchlist `grid-cols-2` ~138px cards | low | `WatchlistSection.tsx:98` `gap-3`→`gap-2 sm:gap-3` (keep grid-cols-2 — density is north star). | S |

### Hidden Equity funnel ( /hidden-equity )
| Item | Severity | Modification (file:line + exact change) | Effort |
|---|---|---|---|
| Gate `<main>` no top inset, no header | medium | `page.tsx:11,22` add `pt-[max(env(safe-area-inset-top),4rem)]` (or `pt-safe` + min pad). | S |
| 3-col bed/bath/parking 70-80px, 40px triggers | high | `HiddenEquityForm.tsx:146` `gap-4`→`gap-2`; triggers `:154,174,194` add `h-11`. | S |
| Condition selects `w-40` truncate | high | `HiddenEquityForm.tsx:213-275` stack label-above-select; triggers `:220,242,264` `w-40`→`w-full h-11`. | S |
| Report renders off-screen, no scroll/focus | high | `HiddenEquityTool.tsx:147` add `reportRef`; after `setResult` (:101) `reportRef.current?.scrollIntoView({behavior:'smooth',block:'start'})`. | S |
| No lead CTA on report | high | `HiddenEquityReport.tsx` between :159 and :168 insert emerald "Book a free call →" `/contact` block (py-3). | S |
| Value-prop single sentence, no preview/trust | high | `page.tsx:12-16` outcome-first h1 + 2-3 bullet/blurred teaser before `MagicLinkForm`; replace "Members only". | M |
| City datalist + `autoComplete="off"` blocks iOS cascade | high | `HiddenEquityForm.tsx:90` drop `autoComplete="off"`; `:73` `cities.includes(v.trim())`; best: filtered combobox. | M |
| Report Row truncates 4-item flex labels | medium | `HiddenEquityReport.tsx:20-34` 2-line mobile (`sm:flex …`), drop label `truncate`; optional `hidden sm:inline-block` PaybackBar. | M |
| "Other moves" `<details>` no chevron/affordance | low | `HiddenEquityReport.tsx:140` add `<ChevronDown/>` + rotate-on-open. | S |
| Sqft `type=number` wrong keypad | low | `HiddenEquityForm.tsx:284-285` `type="number" min={1}`→`type="text" inputMode="numeric"`. | S |
| Primary CTA + MagicLink submit ~40px | medium | `HiddenEquityTool.tsx:131-134` add `h-11`; `MagicLinkForm.tsx:101,164` `py-2.5`→`py-3`. | S |
| Disabled CTA opacity-40, no progress hint | medium | `HiddenEquityTool.tsx:136` dynamic label "Complete location above to unlock"/"Calculating…"/"Reveal my hidden equity". | S |
| Funnel duplication vs /whats-my-home-hiding (T5) | medium | `page.tsx` after :16 add cross-link to `/whats-my-home-hiding`; add reciprocal "Sign in for home value →" on the consumer page. | S |
| Tree loading/error bare; no retry | low | `HiddenEquityTool.tsx:122-126` skeleton block (`h-11 animate-pulse`); error branch add retry Button. | S |
| No no-spam/PIPEDA + vague expiry | low | `MagicLinkForm.tsx:175-177` specify TTL ("valid for 10 minutes") + "No spam, unsubscribe anytime · PIPEDA-compliant". | S |

### Consumer funnel ( /whats-my-home-hiding )
| Item | Severity | Modification (file:line + exact change) | Effort |
|---|---|---|---|
| Result invisible after submit | critical | `RenovationFunnel.tsx` add `resultRef` on Card (:148) + `useEffect(()=>{if(result)resultRef.current?.scrollIntoView(...)},[result])`. | S |
| Condition `w-40` triggers waste/overflow/clip | high | `HiddenEquityForm.tsx:214,236,258` wrapper `flex flex-col … sm:flex-row …`; triggers `:220,242,264` `w-40`→`w-full sm:w-44`. | S |
| Renovation Row truncates 27-30-char labels | high | `HiddenEquityReport.tsx:22-33` 2-line mobile (`flex flex-col … sm:flex-row`), drop label `truncate`; optional `hidden sm:inline-block` PaybackBar. | M |
| City datalist unreliable on iOS | high | `HiddenEquityForm.tsx:85-97` replace with filtered combobox (reuse `cityQuery`); `:73` `cities.includes(v.trim())`; add `inputMode="search" autoCapitalize="words"`. | M |
| Inputs/CTAs 40px across funnel | medium | `RenovationFunnel.tsx:136` `size="lg"`; `HiddenEquityForm.tsx` triggers `min-h-[44px]`; `RenovationRevealLocked.tsx:54` + `ShareChallengeButton.tsx:49` `py-2.5`→`py-3`; `HiddenEquityReport.tsx:140` `flex items-center min-h-[44px]`. | S |
| Blurred teaser is literal "$000,000" | high | `RenovationRevealLocked.tsx:31-33` compute blurred real cost-band from `props.catalog` (costLow/costHigh), keep `blur-sm select-none aria-hidden`; reframe copy. | M |
| No PIPEDA assurance; faint unlock button | medium | `RenovationRevealLocked.tsx:54` `bg-cyan-500/20`→`bg-cyan-600 text-white`; `:59` add no-spam + PIPEDA + `/privacy` (verify route). | S |
| No loading state in result panel | medium | `RenovationFunnel.tsx:155-159` when `submitting` render pulse skeletons; else keep placeholder. | S |
| Heading + py-10 + mb-8 ~200px before first field | low | `page.tsx:53` `py-10`→`pt-4 pb-10 sm:py-10`; `:54` `text-3xl`→`text-2xl sm:text-3xl`; `:55` `mb-8`→`mb-4 sm:mb-8`. | S |
| "Other moves" undiscoverable on touch | low | `HiddenEquityReport.tsx:140` `flex min-h-[44px] items-center gap-1 … active:text-cyan-300` + `<ChevronDown/>`; `text-xs`→`text-sm`. | S |
| Sqft `type=number` wrong keypad | low | `HiddenEquityForm.tsx:284-285` `type="text" inputMode="numeric" enterKeyHint="done"`. | S |
| Disclaimers/basis 10-11px | low | `Disclaimers.tsx:3` `text-[11px]`→`text-xs`, `slate-500`→`slate-400`; `HiddenEquityReport.tsx:158` `text-[10px]`→`text-xs`. | S |
| `<main>` no `pb-safe` | low | `page.tsx:53` add `pb-safe`. | S |

### Shared report ( /share/[token] )
| Item | Severity | Modification (file:line + exact change) | Effort |
|---|---|---|---|
| No Open Graph metadata — blank unfurl | critical | `share/[token]/page.tsx` add `generateMetadata` (wrap supabase lookup in `cache()`); return title/description/openGraph image = `media_urls[0]` (use directly, NOT `/_next/image` — preserve TRREB watermark) + static fallback; `twitter:summary_large_image`. | M |
| No branded not-found | high | Add `src/app/share/[token]/not-found.tsx` (route-scoped dark shell + Logo + "expired" headline + "Browse current listings →" `/properties` + `pt-safe`/`pb-safe`). | S |
| Header CTA text-only, jargon, dead zone | high | `page.tsx:84` give 44px target + `active:bg-muted` + "Find more properties →"; add full-width end-of-list CTA after :114 ("See all properties on PureProperty →"). | S |
| Sticky header no `pt-safe` | medium | `page.tsx:79` add `pt-safe`. | S |
| Footer no `pb-safe` (MLS attribution) | medium | `page.tsx:118` add `pb-safe`. | S |
| Empty-state `p-12` ~190px at 320px | medium | `page.tsx:100` `p-12`→`px-6 py-10 sm:p-12`. | S |
| Sharer note no clamp, overflows fold | low | `page.tsx:93-96` lift note to `<blockquote … line-clamp-3>`; `:92` `text-2xl`→`text-xl sm:text-2xl`. | S |
| No loading.tsx — blank dark screen | low | Add `share/[token]/loading.tsx` (dark shell + header + 3 `aspect-[4/3]` pulse skeletons). | S |
| Grid `gap-6` wall-to-wall | low | `page.tsx:110` `gap-6`→`gap-4 sm:gap-6` (leave `px-4`; do not touch shared PropertyCard padding). | S |
| Root `min-h-screen` | low | `page.tsx:78` → `min-h-app`. | S |

### Legal pages ( /privacy, /terms )
| Item | Severity | Modification (file:line + exact change) | Effort |
|---|---|---|---|
| "Template Notice" tells leads policy is unreviewed | critical | Delete final SECTIONS entry: `privacy/page.tsx:125-131` + `terms/page.tsx:142-147`. Keep `TODO(legal)` source comments. | S |
| Contact email plain text (no mailto) | high | `LegalDocument.tsx:51-54` add `renderParagraph` splitting on email regex → `<a href="mailto:…" className="text-cyan-400 underline … break-words">`; apply to intro (:44) + section (:52). | S |
| Header nav links text-xs, sub-44px | high | `LegalDocument.tsx:31-38` nav `gap-1`; Links `:32,35` `px-2 py-3 text-slate-300 … hover:text-cyan-300`. | S |
| Intro ~230-word wall | medium | `LegalDocument.tsx:44` change `intro` prop to `string[]` rendered `space-y-3 text-slate-300 break-words`; split INTRO in `privacy/page.tsx:18` (~3) + `terms/page.tsx:18` (~2-3). | M |
| h2 only 2px above body | medium | `LegalDocument.tsx:49` `text-base`→`text-lg … border-l-2 border-cyan-700 pl-3`. | S |
| Footer 11px slate-600 (2.66:1) | medium | `LegalDocument.tsx:62` `text-[11px] text-slate-600`→`text-xs text-slate-400` + `pb-safe`. | S |
| Footer no `pb-safe` | medium | `LegalDocument.tsx:62` add `pb-safe` (folded into legibility fix). | S |
| Root `min-h-screen` | low | `LegalDocument.tsx:25` → `min-h-app`. | S |
| No bottom return path | low | `LegalDocument.tsx` after :59 add "Apply for Terminal Access" link to `/apply` (`bg-cyan-500 px-5 py-3`). | S |
| No section `id` anchors | low | `LegalDocument.tsx:48` add `id={s.heading…slug}` for deep-linking. | S |

## Prioritized action list (do-this-order)

**P0 — credibility / funnel-breaking (this week)**
- `[P0]` **Legal "Template Notice" sections live** — /privacy, /terms — critical/S — public "unreviewed draft" admission is the worst trust signal hitting due-diligence leads.
- `[P0]` **Watchlist cards omit brokerage line** — /dashboard — critical/M — TRREB §6.3(c) violation on the most-revisited surface = feed-revocation risk.
- `[P0]` **Landing blank black screen until auth resolves** — / — critical/S — 95%+ anonymous traffic stares at a void that reads as a failed load → bounce.
- `[P0]` **Shared report has no OG metadata** — /share/[token] — critical/M — the route exists only to be tapped from a text; blank unfurl kills the entire viral loop.
- `[P0]` **All onboarding/auth inputs are 14px (iOS auto-zoom)** — /apply, /login, /hidden-equity — critical/S — every required field zooms and shifts the form off-screen on the primary device.
- `[P0]` **AVM result + no lead CTA** — /avm — critical/M — every viewer is an authenticated high-intent lead; result is below fold with no feedback and dead-ends on a disclaimer.
- `[P0]` **Hidden-equity & consumer results invisible after submit** — /hidden-equity, /whats-my-home-hiding — critical/S — form-filled never converts to result-seen; silent no-feedback = abandon.
- `[P0]` **Underwriting slider thumb 14px** — /properties/[id] — critical/S — the financial-persona moat is physically un-grabbable.
- `[P0]` **Terminal search hidden on every phone** — /properties — critical/M — the primary wayfinding action is absent on the funnel's main surface.
- `[P0]` **Desktop map deck unsuppressed on mobile** — /properties — critical/L — tapping "Map" yields colliding overlays that make the canvas unusable.

**P1 — high mobile-conversion lift**
- `[P1]` **No "Explore the Terminal" CTA on landing** — / — critical/S — forces a 3-step form as the only path before any value is shown.
- `[P1]` **Apply submit → 2nd login wall, discards email** — /apply — high/M — double email entry at the funnel's most fragile point.
- `[P1]` **Cold /avm redirect → wrong copy, no return** — /avm — high/S — a shared AVM link dumps leads on mismatched product with no path back.
- `[P1]` **Analytics chart hover-only tooltip + lead CTA gap** — /analytics — high/S+M — intent-confirming data with no readout and no next step.
- `[P1]` **44px tap-target floor across all CTAs/chips/controls** — all routes — high/S — mis-taps in the hardest-to-reach corners read as an unresponsive app (Vow gate, AccountButton, chips, pills, watchlist heart, locked cells).
- `[P1]` **Gallery: bento no swipe/full-bleed; overlay no swipe** — /properties/[id] — high/S+M — the biggest trust signal is half-width and gesture-dead.
- `[P1]` **Compare desync scroll + RentInput 24px + AnonBanner/LockedCell** — /properties/compare — high/L+S — the decision step breaks alignment and squanders the highest-intent anon moment.
- `[P1]` **ScheduleViewingForm no autocomplete; freetext time** — /properties, /properties/[id] — high/S — friction at the revenue step on the funnel's main form.
- `[P1]` **Empty watchlist + RecentlyViewed brokerage + RegionScorecard/MarketActivity blobs** — /dashboard — high/S-M — fresh high-intent user sees a blank gap; second compliance gap; filter blobs bury data.
- `[P1]` **Hidden-equity/consumer: value-prop, city iOS cascade, blurred teaser, condition selects, lead CTA** — both consumer funnels — high/S-M — first required field stalls, fake "$000,000" teaser erodes trust, report dead-ends.
- `[P1]` **Decorative Mapbox/deck.gl bundles on cold loads** — /, /login — high/M — ~300-400KB + tiles on first impression over cellular.
- `[P1]` **Legal email mailto + nav targets; share not-found + header CTA** — /privacy, /terms, /share — high/S — dead taps and unstyled 404 leak warm leads.

**P2 — meaningful polish**
- `[P2]` 100dvh `min-h-app` swaps + safe-area insets (all routes, medium/S) — clipping and notch hardening.
- `[P2]` FilterBar/type-chip overflow + popover clamps + FilterChip `max-w` (/properties, /analytics, medium/S-L) — hidden filters become reachable.
- `[P2]` Specs/RoomMap/SimilarProperties reflow + treemap onClick (/properties/[id], medium/S) — moat data legible and interactive.
- `[P2]` AVM layout/padding/select/validation cluster (/avm, medium/S) — crowding and below-fold errors.
- `[P2]` Dashboard nested-scroll, persona a11y, config-panel scroll, heat-tile gate (/dashboard, medium/S-M) — onboarding + scroll friction.
- `[P2]` Legal intro split + h2 hierarchy + footer contrast (medium/S-M) — scannability and AA contrast.
- `[P2]` Hero/apply heading compaction, "VOW Terms" relabel, identity-coherence copy (medium/S) — above-fold and clarity.
- `[P2]` Theme: `color-scheme: dark`, off-token surfaces (medium-low/S) — native-control polish.
- `[P2]` ListingTerminal image height + mobile dismiss; analytics legibility/axis; persistent terminal lead CTA (medium/S-M).

**P3 — nice-to-have**
- `[P3]` `active:`/touch-feedback states, `hover:underline`→`underline`, OTP/email belt-and-suspenders attrs, success flash, disclaimer/legibility bumps, `optimizeLegibility` removal, peek/fade affordances, loading skeletons/CLS reservations, privacy micro-copy lines, funnel cross-links, section anchors, empty-state CTAs (all routes, low/S) — incremental trust + ergonomics polish.

## Confidence
Every item here was individually pressure-tested to ~95% confidence against the actual source (file:line, exact class strings, and the existence of the `min-h-app`/`pt-safe`/`pb-safe`/`no-scrollbar` utilities and the `useIsMobile` hook were all verified), so the modifications can be implemented as written with high confidence in correctness and location. The residual uncertainty is almost entirely in *magnitude*, not existence: the deck.gl/WebGL memory and TTI claims, the exact pixel fold on a given device, and the conversion lift of copy/CTA changes are asserted from static reading, not profiling or A/B data. Before shipping the structural rebuilds (Terminal search overlay, map FAB→bottom-sheet, compare unified-scroll, OG image with the TRREB-watermark constraint) a real-device pass on a 320px iPhone SE, a notched iPhone, and a mid-tier Snapdragon Android — plus an iMessage/WhatsApp unfurl check and an actual iOS Safari datalist test — would take overall certainty from ~95% to near-complete.