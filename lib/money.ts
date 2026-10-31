/**
 * Money utilities for Brightloop Billing Core.
 * All monetary amounts in the database and business logic are integers in minor units (paise).
 * 1 INR = 100 paise.
 */

export function toMinor(major: number | string): number {
  const num = typeof major === "string" ? parseFloat(major) : major;
  if (isNaN(num)) return 0;
  return Math.round(num * 100);
}

export function toMajor(minor: number): number {
  return (minor || 0) / 100;
}

export function formatMoney(minor: number, includeSymbol: boolean = true): string {
  const major = toMajor(minor || 0);
  if (includeSymbol) {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: "INR",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(major);
  }
  return new Intl.NumberFormat("en-IN", {
    style: "decimal",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(major);
}

