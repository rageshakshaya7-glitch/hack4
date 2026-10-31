# Brightloop Billing Core - Authentication & Scoping Guide

## Overview
Authentication and role-based access control (RBAC) are strictly enforced **server-side** across all API routes, pages, and server actions. Client-side navigation guards and hidden UI buttons are cosmetic only.

## User Roles
- `ADMIN`: Global administration (manage staff, catalog write access, subscriptions, quotations, templates, manual expiry triggers).
- `STAFF`: Day-to-day operations (manage customers, create/manage subscriptions & quotations, templates, read-only catalog access).
- `CUSTOMER`: Customer self-service portal (strictly scoped to viewing and taking allowed actions on their own subscriptions and quotations).

## Route Protection

### 1. Edge Middleware (`middleware.ts`)
The Next.js edge middleware guards path boundaries using JWT verification:
- `/admin/**`: Restricted to users with role `ADMIN`.
- `/staff/**`: Restricted to users with role `ADMIN` or `STAFF`.
- `/portal/**`: Restricted to users with role `CUSTOMER`.
- `/login`, `/register`, `/forgot-password`, `/reset-password`: Public. Redirects authenticated users to their respective home dashboard.

### 2. Protecting API Routes (`lib/auth/api-handler.ts`)
Always wrap API route handlers using `withAuth` or `withRole`:

```typescript
import { withRole } from "@/lib/auth/api-handler";
import { NextResponse } from "next/server";

// Only accessible by ADMIN
export const POST = withRole(["ADMIN"], async (req, session) => {
  // session contains { userId, email, name, role, customerProfileId }
  return NextResponse.json({ ok: true });
});
```

### 3. Server Components & Server Functions
In server components or services, call `requireAuth()` or `requireRole()`:

```typescript
import { requireRole } from "@/lib/auth/session";

export default async function AdminPage() {
  const session = await requireRole("ADMIN");
  // Render admin content
}
```

## Scoping Customer Data (Multi-Tenant Isolation)
**CRITICAL RULE**: Customers must NEVER be able to read or mutate another customer's data by guessing or changing IDs.

When a user with role `CUSTOMER` accesses a resource:
1. Obtain `session.customerProfileId`. If null, deny with 401/403.
2. In database queries, always scope by `customerId: session.customerProfileId`.
3. If an ID is provided in the URL (e.g. `/api/portal/subscriptions/[id]`), query with both `id` AND `customerId: session.customerProfileId`.
4. If no record matches, return **HTTP 404** (Resource Not Found), NOT 403, to avoid leaking the existence of other records.

### Example:
```typescript
const sub = await prisma.subscription.findFirst({
  where: {
    id: params.id,
    customerId: session.customerProfileId, // Mandatory customer isolation
  },
});

if (!sub) {
  return jsonError("Subscription not found", 404);
}
```

