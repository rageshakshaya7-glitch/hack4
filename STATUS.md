# Brightloop Billing Core - Development Status

## Status Overview
- Stage 1: Auth & Roles - IN PROGRESS
- Stage 2: Catalog, Pricing & Taxes - PENDING
- Stage 3: Customers & Subscriptions - PENDING
- Stage 4: Quotations & Order Processing - PENDING
- Stage 5: Testing, Perf Seed & Polish - PENDING

## Module 1: Auth & Roles
- [ ] Package initialization and configuration (Next.js, Tailwind, Prisma, Vitest)
- [ ] `lib/money.ts` minor unit integer math & INR formatting
- [ ] Password validation (`lib/validation/password.ts`)
- [ ] Auth helpers, session handling, permissions map (`lib/auth/`)
- [ ] Prisma schema with User, CustomerProfile, PasswordResetToken, AuditLog
- [ ] Rate limiting & email service (with console fallback)
- [ ] Registration (CUSTOMER only), Login, Logout, Forgot Password, Reset Password
- [ ] Admin Staff Management (/admin/staff)
- [ ] AppShell with role-aware sidebar navigation
- [ ] Route middleware & API ping checks
- [ ] Unit & integration tests for Stage 1

