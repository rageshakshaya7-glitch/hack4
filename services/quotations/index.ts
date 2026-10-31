import { prisma } from "@/lib/db";
import { Prisma } from "@prisma/client";
import {
  createSubscription,
  upsertLines,
  transitionSubscription,
  SubscriptionStatus,
} from "@/services/subscriptions";
import { sendMail } from "@/lib/mail";
import { APP_URL } from "@/lib/env";
import { formatMoney } from "@/lib/money";
import { logAudit } from "@/lib/audit";

export const DEFAULT_VALIDITY_DAYS = 30;

export function isQuotationExpired(quotation: {
  status: string;
  quotationValidUntil?: Date | string | null;
}): boolean {
  if (quotation.status !== "QUOTATION") return false;
  if (!quotation.quotationValidUntil) return false;
  return new Date(quotation.quotationValidUntil).getTime() < Date.now();
}

export function getDaysLeft(quotation: {
  status: string;
  quotationValidUntil?: Date | string | null;
}): number | null {
  if (!quotation.quotationValidUntil) return null;
  const diffMs = new Date(quotation.quotationValidUntil).getTime() - Date.now();
  return Math.ceil(diffMs / (1000 * 60 * 60 * 24));
}

export async function createQuotationFromTemplate(
  input: {
    templateId: string;
    customerId: string;
    startDate?: Date | string;
    expiryDate?: Date | string;
    paymentTerms?: "IMMEDIATE" | "NET_15" | "NET_30";
  },
  actor: { userId: string; role: string }
) {
  return prisma.$transaction(async (tx) => {
    const template = await tx.quotationTemplate.findUnique({
      where: { id: input.templateId },
      include: {
        plan: true,
        lines: {
          include: { product: true, variant: true },
          orderBy: { sortOrder: "asc" },
        },
      },
    });

    if (!template || !template.isActive) {
      throw new Error("Quotation template not found or inactive");
    }

    // Create DRAFT subscription
    const startDate = input.startDate || new Date();
    const created = await createSubscription(
      {
        customerId: input.customerId,
        planId: template.planId,
        startDate,
        expiryDate: input.expiryDate,
        paymentTerms: input.paymentTerms || "NET_15",
        templateId: template.id,
        quotationValidityDays: template.validityDays,
        createdById: actor.userId,
      },
      tx
    );

    if (!created) throw new Error("Failed to create subscription");

    // Upsert template product lines
    const lineInputs = template.lines.map((l) => ({
      productId: l.productId,
      variantId: l.variantId,
      quantity: l.quantity,
    }));

    if (lineInputs.length > 0) {
      await upsertLines(created.id, lineInputs, actor.userId, tx);
    }

    return tx.subscription.findUnique({
      where: { id: created.id },
      include: {
        customer: true,
        plan: true,
        lines: { include: { product: true, variant: true } },
      },
    });
  });
}

export async function createBlankQuotation(
  input: {
    customerId: string;
    planId: string;
    startDate?: Date | string;
    expiryDate?: Date | string;
    paymentTerms?: "IMMEDIATE" | "NET_15" | "NET_30";
    validityDays?: number;
  },
  actor: { userId: string; role: string }
) {
  const startDate = input.startDate || new Date();
  return createSubscription({
    customerId: input.customerId,
    planId: input.planId,
    startDate,
    expiryDate: input.expiryDate,
    paymentTerms: input.paymentTerms || "NET_15",
    quotationValidityDays: input.validityDays || DEFAULT_VALIDITY_DAYS,
    createdById: actor.userId,
  });
}

export async function sendQuotation(
  id: string,
  actor: { userId: string; role: string }
) {
  return prisma.$transaction(async (tx) => {
    const sub = await tx.subscription.findUnique({
      where: { id },
      include: {
        customer: true,
        plan: true,
        lines: true,
      },
    });

    if (!sub) throw new Error("Quotation not found");
    if (sub.status !== "DRAFT") {
      throw new Error(`Quotation cannot be sent from status ${sub.status}`);
    }

    // Must have at least one product line
    const productLines = sub.lines.filter((l) => !l.isPlanFee);
    if (productLines.length === 0) {
      throw new Error("Cannot send quotation without any product lines");
    }

    if (!sub.customer.email) {
      throw new Error("Customer profile does not have an email address");
    }

    const validityDays = sub.quotationValidityDays || DEFAULT_VALIDITY_DAYS;
    const quotationValidUntil = new Date();
    quotationValidUntil.setDate(quotationValidUntil.getDate() + validityDays);

    const updated = await transitionSubscription(
      id,
      "QUOTATION",
      actor,
      { quotationValidUntil },
      tx
    );

    // Calculate total for email
    const totalAmount = sub.lines.reduce((sum, line) => sum + line.amount, 0);
    const portalUrl = `${APP_URL}/portal/quotations`;

    // Email notification
    await sendMail({
      to: sub.customer.email,
      subject: `Quotation ${sub.number} from Brightloop Software`,
      text: `Hello ${sub.customer.displayName},

We have prepared quotation ${sub.number} for your subscription to ${sub.plan.name}.
Total: ${formatMoney(totalAmount)}
This quotation is valid until ${quotationValidUntil.toLocaleDateString()}.

You can review and accept it in your customer portal:
${portalUrl}

Thank you,
Brightloop Software`,
      html: `<div style="font-family: sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px;">
        <h2 style="color: #0284c7;">Brightloop Software Quotation</h2>
        <p>Hello <strong>${sub.customer.displayName}</strong>,</p>
        <p>We have prepared quotation <strong>${sub.number}</strong> for your subscription to <strong>${sub.plan.name}</strong>.</p>
        <div style="background-color: #f8fafc; padding: 16px; border-radius: 6px; margin: 20px 0;">
          <p style="margin: 0; font-size: 18px; font-weight: bold;">Total Amount: ${formatMoney(totalAmount)}</p>
          <p style="margin: 8px 0 0 0; color: #64748b; font-size: 14px;">Valid until: ${quotationValidUntil.toLocaleDateString()}</p>
        </div>
        <p><a href="${portalUrl}" style="background-color: #0284c7; color: white; padding: 10px 20px; border-radius: 6px; text-decoration: none; display: inline-block;">Review & Accept in Portal</a></p>
      </div>`,
    });

    return updated;
  });
}

export async function extendQuotationValidity(
  id: string,
  days: number,
  actor: { userId: string; role: string }
) {
  if (days <= 0) throw new Error("Extension days must be greater than zero");

  const sub = await prisma.subscription.findUnique({
    where: { id },
  });
  if (!sub) throw new Error("Quotation not found");
  if (sub.status !== "QUOTATION") {
    throw new Error("Only quotations in QUOTATION status can have validity extended");
  }

  const baseDate = sub.quotationValidUntil && new Date(sub.quotationValidUntil) > new Date()
    ? new Date(sub.quotationValidUntil)
    : new Date();

  baseDate.setDate(baseDate.getDate() + days);

  const updated = await prisma.subscription.update({
    where: { id },
    data: {
      quotationValidUntil: baseDate,
    },
  });

  await logAudit({
    userId: actor.userId,
    action: "QUOTATION_VALIDITY_EXTENDED",
    entity: "Subscription",
    entityId: id,
    meta: { extendedByDays: days, newValidUntil: baseDate },
  });

  return updated;
}

export async function approveQuotation(
  id: string,
  actor: { userId: string; role: string },
  opts: { activateNow?: boolean } = {}
) {
  return prisma.$transaction(async (tx) => {
    // 1. Transition QUOTATION -> CONFIRMED
    const confirmed = await transitionSubscription(id, "CONFIRMED", actor, {}, tx);

    // 2. If activateNow is true, also transition CONFIRMED -> ACTIVE
    if (opts.activateNow) {
      return transitionSubscription(id, "ACTIVE", actor, {}, tx);
    }

    return confirmed;
  });
}

export async function rejectQuotation(
  id: string,
  reason: string,
  actor: { userId: string; role: string }
) {
  return transitionSubscription(
    id,
    "CLOSED",
    actor,
    { closeReason: "REJECTED" }
  );
}

export async function reviseQuotation(
  id: string,
  actor: { userId: string; role: string }
) {
  return transitionSubscription(id, "DRAFT", actor);
}

