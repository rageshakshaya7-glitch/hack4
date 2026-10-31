import { Prisma } from "@prisma/client";

/**
 * Concurrency-safe sequence number generator inside a Prisma transaction.
 * Produces strings like "SUB-0001", "SUB-0002", etc.
 */
export async function nextNumber(
  tx: Prisma.TransactionClient,
  prefix: string = "SUB"
): Promise<string> {
  const counter = await tx.numberCounter.upsert({
    where: { key: prefix },
    create: { key: prefix, lastValue: 1 },
    update: { lastValue: { increment: 1 } },
  });

  const padded = String(counter.lastValue).padStart(4, "0");
  return `${prefix}-${padded}`;
}

