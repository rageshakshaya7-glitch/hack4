import { prisma } from "@/lib/db";
import { Prisma } from "@prisma/client";
import { nextNumber } from "@/lib/numbering";
import { logAudit } from "@/lib/audit";
import {
  isPlanAvailable,
  resolveUnitPrice,
  resolveTaxRule,
  computeLine,
  addBillingPeriod,
} from "@/lib/pricing";

export interface CreateSubscriptionInput {
  customerId: string;
  planId: string;
  startDate: Date | string;
  expiryDate?: Date | string;
  paymentTerms?: "IMMEDIATE" | "NET_15" | "NET_30";
  createdById: string;
  templateId?: string;
  quotationValidityDays?: number;
}

export interface LineItemInput {
  productId: string;
  variantId?: string | null;
  quantity: number;
}

export type SubscriptionStatus =
  | "DRAFT"
  | "QUOTATION"
  | "CONFIRMED"
  | "ACTIVE"
  | "CLOSED";

export type CloseReason =
  | "CUSTOMER_REQUEST"
  | "STAFF_CLOSED"
  | "EXPIRED"
  | "REJECTED"
  | "CANCELLED";

export async function createSubscription(
  input: CreateSubscriptionInput,
  tx?: Prisma.TransactionClient
) {
  const runner = async (client: Prisma.TransactionClient) => {
    // 1. Fetch customer and verify active
    const customer = await client.customerProfile.findUnique({
      where: { id: input.customerId },
    });
    if (!customer) {
      throw new Error("Customer profile not found");
    }
    if (!customer.isActive) {
      throw new Error("Cannot create subscription for a deactivated customer");
    }

    // 2. Fetch plan and check availability
    const plan = await client.plan.findUnique({
      where: { id: input.planId },
    });
    if (!plan) {
      throw new Error("Plan not found");
    }

    const startDate = new Date(input.startDate);
    const availability = isPlanAvailable(plan, startDate);
    if (!availability.available) {
      throw new Error(`Selected plan is not available: ${availability.reason}`);
    }

    // Suggested expiry date based on billing period if not provided
    const expiryDate = input.expiryDate
      ? new Date(input.expiryDate)
      : addBillingPeriod(startDate, plan.billingPeriod, 1);

    if (startDate >= expiryDate) {
      throw new Error("Start date must be strictly before expiry date");
    }

    // Generate unique sequential number atomically
    const number = await nextNumber(client, "SUB");

    // Create Subscription in DRAFT status
    const subscription = await client.subscription.create({
      data: {
        number,
        customerId: input.customerId,
        planId: input.planId,
        status: "DRAFT",
        startDate,
        expiryDate,
        paymentTerms: input.paymentTerms || "NET_15",
        templateId: input.templateId || null,
        quotationValidityDays: input.quotationValidityDays || null,
        createdById: input.createdById,
      },
    });

    // If plan has base recurring price > 0, auto-add Plan Fee line
    if (plan.price > 0) {
      // Check default tax for plan fee
      const activeTaxRules = await client.taxRule.findMany({
        where: { isActive: true },
        include: { products: true },
      });
      // Plan fee uses default appliesToAll tax rule if one exists
      const defaultTax = activeTaxRules.find((r) => r.appliesToAll && r.isDefault) || null;
      const taxPercent = defaultTax?.percentage || 0;
      const lineMath = computeLine({
        unitPrice: plan.price,
        quantity: 1,
        taxPercent,
      });

      await client.subscriptionLine.create({
        data: {
          subscriptionId: subscription.id,
          productId: null,
          variantId: null,
          description: `Plan Fee - ${plan.name}`,
          quantity: 1,
          unitPrice: plan.price,
          taxRuleId: defaultTax?.id || null,
          taxPercent,
          taxAmount: lineMath.taxAmount,
          amount: lineMath.amount,
          isPlanFee: true,
        },
      });
    }

    await logAudit(
      {
        userId: input.createdById,
        action: "SUBSCRIPTION_CREATED",
        entity: "Subscription",
        entityId: subscription.id,
        meta: { number: subscription.number, plan: plan.name, customerId: customer.id },
      },
      client
    );

    return client.subscription.findUnique({
      where: { id: subscription.id },
      include: {
        customer: true,
        plan: true,
        lines: {
          include: { product: true, variant: true },
        },
      },
    });
  };

  return tx ? runner(tx) : prisma.$transaction(runner);
}

export async function upsertLines(
  subscriptionId: string,
  productLines: LineItemInput[],
  actorId?: string,
  tx?: Prisma.TransactionClient
) {
  const runner = async (client: Prisma.TransactionClient) => {
    const sub = await client.subscription.findUnique({
      where: { id: subscriptionId },
      include: { plan: true, lines: true },
    });
    if (!sub) throw new Error("Subscription not found");

    if (sub.status !== "DRAFT" && sub.status !== "QUOTATION") {
      throw new Error(`Cannot modify lines when subscription is in status ${sub.status}`);
    }

    // Minimum quantity validation against plan
    for (const item of productLines) {
      if (item.quantity < sub.plan.minQuantity) {
        throw new Error(
          `Quantity (${item.quantity}) is less than plan minimum quantity (${sub.plan.minQuantity})`
        );
      }
    }

    // Remove existing non-plan-fee lines
    await client.subscriptionLine.deleteMany({
      where: {
        subscriptionId: sub.id,
        isPlanFee: false,
      },
    });

    // Fetch active catalog products, variants, and tax rules for snapshot calculation
    const allTaxRules = await client.taxRule.findMany({
      where: { isActive: true },
      include: { products: true },
    });

    for (const item of productLines) {
      const product = await client.product.findUnique({
        where: { id: item.productId },
        include: { variants: true },
      });
      if (!product) throw new Error(`Product not found: ${item.productId}`);

      let variant = null;
      if (item.variantId) {
        variant = product.variants.find((v) => v.id === item.variantId) || null;
      }

      // Snapshot unit price
      const unitPrice = resolveUnitPrice(product, variant);

      // Snapshot tax rule
      const taxRule = resolveTaxRule(product.id, allTaxRules as any);
      const taxPercent = taxRule?.percentage || 0;

      // Compute line totals
      const lineMath = computeLine({
        unitPrice,
        quantity: item.quantity,
        taxPercent,
      });

      const description = variant
        ? `${product.name} (${variant.attribute}: ${variant.value})`
        : product.name;

      await client.subscriptionLine.create({
        data: {
          subscriptionId: sub.id,
          productId: product.id,
          variantId: variant?.id || null,
          description,
          quantity: item.quantity,
          unitPrice,
          taxRuleId: taxRule?.id || null,
          taxPercent,
          taxAmount: lineMath.taxAmount,
          amount: lineMath.amount,
          isPlanFee: false,
        },
      });
    }

    await logAudit(
      {
        userId: actorId || null,
        action: "SUBSCRIPTION_LINES_UPDATED",
        entity: "Subscription",
        entityId: sub.id,
        meta: { lineCount: productLines.length },
      },
      client
    );

    return client.subscription.findUnique({
      where: { id: sub.id },
      include: {
        customer: true,
        plan: true,
        lines: {
          include: { product: true, variant: true },
        },
      },
    });
  };

  return tx ? runner(tx) : prisma.$transaction(runner);
}

export interface TransitionOptions {
  closeReason?: CloseReason;
  quotationValidUntil?: Date;
  bypassPlanCheck?: boolean; // For automated expiry closure
}

/**
 * Single state machine transition handler for Subscriptions.
 * Allowed transitions:
 * - DRAFT -> QUOTATION
 * - QUOTATION -> DRAFT (revise)
 * - QUOTATION -> CONFIRMED (rejected if quotationValidUntil is in past)
 * - QUOTATION -> CLOSED (REJECTED)
 * - DRAFT -> CLOSED (CANCELLED)
 * - CONFIRMED -> ACTIVE (sets nextBillingDate = startDate)
 * - CONFIRMED -> CLOSED
 * - ACTIVE -> CLOSED (only if plan.closable, unless automatic expiry)
 */
export async function transitionSubscription(
  subscriptionId: string,
  toStatus: SubscriptionStatus,
  actor: { userId?: string | null; role?: string },
  opts: TransitionOptions = {},
  tx?: Prisma.TransactionClient
) {
  const runner = async (client: Prisma.TransactionClient) => {
    const sub = await client.subscription.findUnique({
      where: { id: subscriptionId },
      include: { plan: true },
    });
    if (!sub) throw new Error("Subscription not found");

    const fromStatus = sub.status as SubscriptionStatus;
    if (fromStatus === toStatus) return sub;

    let updateData: any = { status: toStatus };

    // Validate transition
    if (fromStatus === "DRAFT" && toStatus === "QUOTATION") {
      if (opts.quotationValidUntil) {
        updateData.quotationValidUntil = opts.quotationValidUntil;
      }
    } else if (fromStatus === "QUOTATION" && toStatus === "DRAFT") {
      // Revise quotation back to draft
    } else if (fromStatus === "QUOTATION" && toStatus === "CONFIRMED") {
      if (sub.quotationValidUntil && new Date(sub.quotationValidUntil) < new Date()) {
        throw new Error("Cannot confirm an expired quotation. Please extend validity or revise.");
      }
    } else if (fromStatus === "QUOTATION" && toStatus === "CLOSED") {
      updateData.closedAt = new Date();
      updateData.closeReason = opts.closeReason || "REJECTED";
    } else if (fromStatus === "DRAFT" && toStatus === "CLOSED") {
      updateData.closedAt = new Date();
      updateData.closeReason = opts.closeReason || "CANCELLED";
    } else if (fromStatus === "CONFIRMED" && toStatus === "ACTIVE") {
      updateData.nextBillingDate = sub.startDate;
    } else if (fromStatus === "CONFIRMED" && toStatus === "CLOSED") {
      updateData.closedAt = new Date();
      updateData.closeReason = opts.closeReason || "CANCELLED";
    } else if (fromStatus === "ACTIVE" && toStatus === "CLOSED") {
      if (!opts.bypassPlanCheck && !sub.plan.closable) {
        throw new Error(`Plan "${sub.plan.name}" does not allow closing subscriptions early.`);
      }
      updateData.closedAt = new Date();
      updateData.closeReason = opts.closeReason || "CUSTOMER_REQUEST";
    } else {
      throw new Error(`Invalid status transition from ${fromStatus} to ${toStatus}`);
    }

    const updated = await client.subscription.update({
      where: { id: subscriptionId },
      data: updateData,
      include: { customer: true, plan: true, lines: true },
    });

    await logAudit(
      {
        userId: actor.userId || null,
        action: `SUBSCRIPTION_STATUS_${toStatus}`,
        entity: "Subscription",
        entityId: sub.id,
        meta: {
          fromStatus,
          toStatus,
          closeReason: updateData.closeReason,
          actorRole: actor.role,
        },
      },
      client
    );

    return updated;
  };

  return tx ? runner(tx) : prisma.$transaction(runner);
}

/**
 * Pause an ACTIVE subscription (if plan.pausable)
 */
export async function pauseSubscription(
  subscriptionId: string,
  actor: { userId?: string | null; role?: string }
) {
  const sub = await prisma.subscription.findUnique({
    where: { id: subscriptionId },
    include: { plan: true },
  });
  if (!sub) throw new Error("Subscription not found");
  if (sub.status !== "ACTIVE") {
    throw new Error("Only ACTIVE subscriptions can be paused");
  }
  if (!sub.plan.pausable) {
    throw new Error(`Plan "${sub.plan.name}" does not allow pausing`);
  }
  if (sub.isPaused) {
    throw new Error("Subscription is already paused");
  }

  const updated = await prisma.subscription.update({
    where: { id: subscriptionId },
    data: {
      isPaused: true,
      pausedAt: new Date(),
    },
  });

  await logAudit({
    userId: actor.userId || null,
    action: "SUBSCRIPTION_PAUSED",
    entity: "Subscription",
    entityId: sub.id,
    meta: { pausedAt: updated.pausedAt },
  });

  return updated;
}

/**
 * Resume a paused subscription.
 * RULE: If nextBillingDate is in the past, reset it to today so paused time is not billed later.
 */
export async function resumeSubscription(
  subscriptionId: string,
  actor: { userId?: string | null; role?: string }
) {
  const sub = await prisma.subscription.findUnique({
    where: { id: subscriptionId },
  });
  if (!sub) throw new Error("Subscription not found");
  if (!sub.isPaused) {
    throw new Error("Subscription is not paused");
  }

  const now = new Date();
  let nextBilling = sub.nextBillingDate;
  if (nextBilling && new Date(nextBilling) < now) {
    nextBilling = now;
  }

  const updated = await prisma.subscription.update({
    where: { id: subscriptionId },
    data: {
      isPaused: false,
      pausedAt: null,
      nextBillingDate: nextBilling,
    },
  });

  await logAudit({
    userId: actor.userId || null,
    action: "SUBSCRIPTION_RESUMED",
    entity: "Subscription",
    entityId: sub.id,
    meta: { adjustedNextBillingDate: nextBilling },
  });

  return updated;
}

/**
 * Renew an ACTIVE subscription (if plan.renewable).
 * Adds billing period to current expiryDate.
 */
export async function renewSubscription(
  subscriptionId: string,
  periods: number = 1,
  actor: { userId?: string | null; role?: string }
) {
  const sub = await prisma.subscription.findUnique({
    where: { id: subscriptionId },
    include: { plan: true },
  });
  if (!sub) throw new Error("Subscription not found");
  if (sub.status !== "ACTIVE") {
    throw new Error("Only ACTIVE subscriptions can be renewed");
  }
  if (!sub.plan.renewable) {
    throw new Error(`Plan "${sub.plan.name}" does not allow renewals`);
  }

  const newExpiry = addBillingPeriod(sub.expiryDate, sub.plan.billingPeriod, periods);

  const updated = await prisma.subscription.update({
    where: { id: subscriptionId },
    data: { expiryDate: newExpiry },
  });

  await logAudit({
    userId: actor.userId || null,
    action: "SUBSCRIPTION_RENEWED",
    entity: "Subscription",
    entityId: sub.id,
    meta: { previousExpiry: sub.expiryDate, newExpiry, periods },
  });

  return updated;
}

/**
 * Idempotent expiry check:
 * ACTIVE subscriptions with expiryDate < today are CLOSED (reason EXPIRED) if plan.autoCloseOnEnd.
 * Subscriptions with plan.autoCloseOnEnd === false stay ACTIVE (show "Expired, renewal needed" badge).
 */
export async function applyExpiryRules(today: Date = new Date()) {
  const activeSubs = await prisma.subscription.findMany({
    where: {
      status: "ACTIVE",
      expiryDate: { lt: today },
    },
    include: { plan: true },
  });

  let closedCount = 0;
  let flaggedCount = 0;

  for (const sub of activeSubs) {
    if (sub.plan.autoCloseOnEnd) {
      await transitionSubscription(
        sub.id,
        "CLOSED",
        { userId: null, role: "SYSTEM" },
        { closeReason: "EXPIRED", bypassPlanCheck: true }
      );
      closedCount++;
    } else {
      flaggedCount++;
    }
  }

  return {
    scannedCount: activeSubs.length,
    closedCount,
    flaggedCount,
  };
}

export async function listSubscriptions(params?: {
  customerId?: string;
  status?: string;
  planId?: string;
  expiringInDays?: number;
  isPaused?: boolean;
  isExpired?: boolean;
  search?: string;
  page?: number;
  limit?: number;
}) {
  const page = Math.max(1, params?.page || 1);
  const limit = Math.max(1, Math.min(100, params?.limit || 25));
  const skip = (page - 1) * limit;

  const where: any = {};

  if (params?.customerId) {
    where.customerId = params.customerId;
  }
  if (params?.status && params.status !== "ALL") {
    where.status = params.status;
  }
  if (params?.planId && params.planId !== "ALL") {
    where.planId = params.planId;
  }
  if (typeof params?.isPaused === "boolean") {
    where.isPaused = params.isPaused;
  }

  const now = new Date();
  if (params?.expiringInDays) {
    const target = new Date();
    target.setDate(target.getDate() + params.expiringInDays);
    where.expiryDate = { gte: now, lte: target };
  }

  if (params?.isExpired) {
    where.expiryDate = { lt: now };
  }

  if (params?.search) {
    where.OR = [
      { number: { contains: params.search } },
      { customer: { displayName: { contains: params.search } } },
      { customer: { company: { contains: params.search } } },
    ];
  }

  const [items, total] = await Promise.all([
    prisma.subscription.findMany({
      where,
      include: {
        customer: {
          select: { id: true, displayName: true, email: true, company: true },
        },
        plan: {
          select: {
            id: true,
            name: true,
            billingPeriod: true,
            autoCloseOnEnd: true,
            closable: true,
            pausable: true,
            renewable: true,
          },
        },
        lines: true,
      },
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
    }),
    prisma.subscription.count({ where }),
  ]);

  return {
    items,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  };
}

export async function getSubscription(id: string, customerProfileId?: string | null) {
  const where: any = { id };
  if (customerProfileId) {
    where.customerId = customerProfileId;
  }

  return prisma.subscription.findFirst({
    where,
    include: {
      customer: true,
      plan: true,
      lines: {
        include: {
          product: true,
          variant: true,
        },
      },
    },
  });
}

