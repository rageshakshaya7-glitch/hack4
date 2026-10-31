# Implementation Plan - Brightloop Billing Core (Part 1)

## Stage 1: Auth & Roles
- Initialize project: Next.js 14 (App Router), TypeScript, Tailwind CSS, Lucide icons, Vitest, Prisma.
- Core utilities:
  - `lib/money.ts`: minor unit handling (paise), formatting with INR Indian numbering.
  - `lib/validation/password.ts`: shared Zod schema (>8 chars, uppercase, lowercase, special char).
  - `lib/auth/`: JWT via jose (7 days, httpOnly cookie), password hashing (bcrypt), session resolution & verification against DB, permission map (`can(role, permission)`), route helpers `requireAuth`, `requireRole`, API wrappers with standardized error responses `{ error: string, fields?: Record<string, string> }`.
  - Rate limiting (in-memory for login and password reset).
  - Mailer utility with console fallback.
  - AuditLog helper.
- Prisma schema: User, CustomerProfile, PasswordResetToken, AuditLog.
- Auth endpoints & pages:
  - Public registration (CUSTOMER only), login, logout, forgot/reset password.
  - Admin staff management (/admin/staff, /api/admin/staff).
  - App shell with role-aware sidebar and navigation.
  - Role-scoped dashboards (/admin, /staff, /portal).
  - Edge middleware for route protection.
  - Seed admin, staff, and customer accounts.

## Stage 2: Products, Plans & Taxes
- Prisma models: Product, ProductVariant, Plan, TaxRule, TaxRuleProduct.
- Pure catalog & pricing functions (`lib/pricing/`):
  - `resolveUnitPrice`: base price + variant extra.
  - `resolveTaxRule`: product-specific > default applies-to-all.
  - `computeLine`: subtotal, taxAmount (half-up rounding), total amount.
  - `computeTotals`: line items summation and tax breakdown.
  - `isPlanAvailable`: validity window check.
  - `addBillingPeriod`: period additions with month-end and leap-year clamping.
- Services in `services/catalog/`.
- Admin screens & APIs:
  - `/admin/products`: list, search, filter, create/edit with margin calculator, variant manager.
  - `/admin/plans`: list, availability badge, 4 rule toggles, period rules.
  - `/admin/taxes`: list, CRUD, atomic single default rule management.
- Staff read-only views & APIs.
- Unit tests for all pure pricing and billing period functions.
- Catalog seed data.

## Stage 3: Customers & Subscriptions
- Prisma models: NumberCounter, Subscription, SubscriptionLine.
- Number generator: atomic concurrency-safe `nextNumber(tx, prefix)`.
- Core subscription logic (`services/subscriptions/`):
  - `createSubscription`: Plan fee line + snapshot prices.
  - `upsertLines`: DRAFT/QUOTATION only, minimum quantity validation.
  - `transitionSubscription`: Atomic status state machine with AuditLog logging.
  - `pause`, `resume` (adjusts nextBillingDate if past), `renew`.
  - `applyExpiryRules`: autoClose handling vs expired flag.
- Staff UI:
  - `/staff/customers`: Customer listing, search, creation, view linked subscriptions.
  - `/staff/subscriptions`: Filterable table, detail view with status stepper, editable line items, audit timeline.
- Customer portal:
  - `/portal/subscriptions`: View owned subscriptions and self-service actions (pause/resume/renew/close according to plan rules).
- Seed data & performance seed script (`npm run seed:perf`).

## Stage 4: Quotations & Order Processing
- Unified design: Quotation IS a Subscription in DRAFT or QUOTATION status.
- Prisma models: QuotationTemplate, QuotationTemplateLine.
- Services in `services/quotations/`:
  - `createQuotationFromTemplate`, `createBlankQuotation`.
  - `sendQuotation`: DRAFT -> QUOTATION, validity calculation, email notification.
  - `extendQuotationValidity`, `approveQuotation` (with optional immediate activation), `rejectQuotation`, `reviseQuotation`.
- Staff UI:
  - `/staff/quotation-templates`: CRUD, preview with current catalog prices.
  - `/staff/quotations`: List, builder, printable quotation view.
- Customer Portal:
  - `/portal/quotations`: Customer review, accept/decline.

## Stage 5: Testing, Performance Seed, and Documentation
- Comprehensive Vitest test suite covering:
  - Unit tests for password validation, tokens, permissions, pricing, period math, number sequencing, state machine transitions, snapshot rules, expiry logic.
  - Integration/API tests for auth, route guarding, matrix checks, 404 security isolation.
- Run `seed:perf` (5,000+ subscriptions) and benchmark list query execution time.
- Verify end-to-end browser workflows.
- Produce STATUS.md, README.md, DEMO.md, and TESTING.md.

