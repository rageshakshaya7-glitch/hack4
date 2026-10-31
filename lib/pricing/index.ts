export interface ProductPriceInput {
  salesPrice: number;
}

export interface VariantPriceInput {
  extraPrice: number;
}

export interface TaxRuleInput {
  id: string;
  name?: string;
  percentage: number;
  appliesToAll: boolean;
  isDefault: boolean;
  isActive: boolean;
  products?: Array<{ productId: string }>;
}

export interface LineComputeInput {
  unitPrice: number;
  quantity: number;
  taxPercent: number;
}

export interface LineComputeOutput {
  subtotal: number;
  taxAmount: number;
  amount: number;
}

export interface TaxBreakdownItem {
  percentage: number;
  subtotal: number;
  taxAmount: number;
}

export interface TotalsComputeOutput {
  subtotal: number;
  taxTotal: number;
  total: number;
  taxBreakdown: TaxBreakdownItem[];
}

export interface PlanAvailabilityInput {
  isActive: boolean;
  availableFrom: Date | string;
  availableTo?: Date | string | null;
}

export type PlanUnavailableReason = "NOT_STARTED" | "ENDED" | "INACTIVE";

export interface PlanAvailabilityResult {
  available: boolean;
  reason?: PlanUnavailableReason;
}

/**
 * Resolves unit price: base sales price + variant extra price
 */
export function resolveUnitPrice(
  product: ProductPriceInput,
  variant?: VariantPriceInput | null
): number {
  return (product.salesPrice || 0) + (variant?.extraPrice || 0);
}

/**
 * Resolves applicable tax rule:
 * 1. Most specific active product-scoped rule
 * 2. Default active appliesToAll rule
 * 3. Any active appliesToAll rule
 * 4. null
 */
export function resolveTaxRule(
  productId: string,
  rules: TaxRuleInput[]
): TaxRuleInput | null {
  const activeRules = rules.filter((r) => r.isActive);

  // 1. Check for product-scoped rule
  const productRule = activeRules.find(
    (r) => r.products && r.products.some((p) => p.productId === productId)
  );
  if (productRule) return productRule;

  // 2. Check for default appliesToAll rule
  const defaultGlobalRule = activeRules.find((r) => r.appliesToAll && r.isDefault);
  if (defaultGlobalRule) return defaultGlobalRule;

  // 3. Fallback to any appliesToAll rule
  const anyGlobalRule = activeRules.find((r) => r.appliesToAll);
  if (anyGlobalRule) return anyGlobalRule;

  return null;
}

/**
 * Computes subtotal, taxAmount (half-up rounding), and total amount for a line
 */
export function computeLine(input: LineComputeInput): LineComputeOutput {
  const subtotal = Math.round((input.unitPrice || 0) * (input.quantity || 0));
  // Round half-up: Math.floor(x + 0.5)
  const rawTax = (subtotal * (input.taxPercent || 0)) / 100;
  const taxAmount = Math.floor(rawTax + 0.5);
  const amount = subtotal + taxAmount;

  return {
    subtotal,
    taxAmount,
    amount,
  };
}

/**
 * Computes totals and tax breakdown from lines
 */
export function computeTotals(
  lines: Array<{
    subtotal: number;
    taxAmount: number;
    amount: number;
    taxPercent?: number;
  }>
): TotalsComputeOutput {
  let subtotal = 0;
  let taxTotal = 0;
  let total = 0;

  const breakdownMap = new Map<number, { subtotal: number; taxAmount: number }>();

  for (const line of lines) {
    subtotal += line.subtotal;
    taxTotal += line.taxAmount;
    total += line.amount;

    const pct = line.taxPercent ?? 0;
    const existing = breakdownMap.get(pct) || { subtotal: 0, taxAmount: 0 };
    existing.subtotal += line.subtotal;
    existing.taxAmount += line.taxAmount;
    breakdownMap.set(pct, existing);
  }

  const taxBreakdown: TaxBreakdownItem[] = Array.from(breakdownMap.entries())
    .map(([percentage, val]) => ({
      percentage,
      subtotal: val.subtotal,
      taxAmount: val.taxAmount,
    }))
    .sort((a, b) => b.percentage - a.percentage);

  return {
    subtotal,
    taxTotal,
    total,
    taxBreakdown,
  };
}

/**
 * Determines whether a plan is available on the specified date
 */
export function isPlanAvailable(
  plan: PlanAvailabilityInput,
  date: Date = new Date()
): PlanAvailabilityResult {
  if (!plan.isActive) {
    return { available: false, reason: "INACTIVE" };
  }

  const checkTime = new Date(date).getTime();
  const fromTime = new Date(plan.availableFrom).getTime();

  if (checkTime < fromTime) {
    return { available: false, reason: "NOT_STARTED" };
  }

  if (plan.availableTo) {
    const toTime = new Date(plan.availableTo).getTime();
    if (checkTime > toTime) {
      return { available: false, reason: "ENDED" };
    }
  }

  return { available: true };
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function getDaysInMonth(year: number, month: number): number {
  // month is 0-indexed (0 = Jan, 1 = Feb, etc.)
  return new Date(year, month + 1, 0).getDate();
}

/**
 * Adds billing periods to a date with month-end and leap-year clamping.
 * e.g. Jan 31 + 1 month -> Feb 28 (or Feb 29 in leap year)
 * Feb 29, 2024 + 1 year -> Feb 28, 2025
 */
export function addBillingPeriod(
  date: Date | string,
  period: "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY" | string,
  count: number = 1
): Date {
  const d = new Date(date);
  const normalizedPeriod = period.toUpperCase();

  if (normalizedPeriod === "DAILY") {
    const res = new Date(d);
    res.setDate(res.getDate() + count);
    return res;
  }

  if (normalizedPeriod === "WEEKLY") {
    const res = new Date(d);
    res.setDate(res.getDate() + count * 7);
    return res;
  }

  if (normalizedPeriod === "MONTHLY") {
    const year = d.getFullYear();
    const month = d.getMonth();
    const day = d.getDate();

    const targetTotalMonths = month + count;
    const targetYear = year + Math.floor(targetTotalMonths / 12);
    const targetMonth = ((targetTotalMonths % 12) + 12) % 12;

    const maxDays = getDaysInMonth(targetYear, targetMonth);
    const clampedDay = Math.min(day, maxDays);

    const res = new Date(d);
    res.setFullYear(targetYear, targetMonth, clampedDay);
    return res;
  }

  if (normalizedPeriod === "YEARLY") {
    const year = d.getFullYear();
    const month = d.getMonth();
    const day = d.getDate();

    const targetYear = year + count;
    let targetDay = day;

    // Handle Feb 29 leap day transition
    if (month === 1 && day === 29 && !isLeapYear(targetYear)) {
      targetDay = 28;
    }

    const res = new Date(d);
    res.setFullYear(targetYear, month, targetDay);
    return res;
  }

  throw new Error(`Unsupported billing period: ${period}`);
}

