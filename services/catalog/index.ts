import { prisma } from "@/lib/db";

export async function listProducts(params?: {
  search?: string;
  type?: string;
  includeInactive?: boolean;
  page?: number;
  limit?: number;
}) {
  const page = Math.max(1, params?.page || 1);
  const limit = Math.max(1, Math.min(100, params?.limit || 25));
  const skip = (page - 1) * limit;

  const where: any = {};
  if (!params?.includeInactive) {
    where.isActive = true;
  }
  if (params?.type && params.type !== "ALL") {
    where.type = params.type;
  }
  if (params?.search) {
    where.name = { contains: params.search };
  }

  const [items, total] = await Promise.all([
    prisma.product.findMany({
      where,
      include: {
        variants: true,
        taxRules: {
          include: { taxRule: true },
        },
      },
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
    }),
    prisma.product.count({ where }),
  ]);

  return {
    items,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  };
}

export async function getProduct(id: string) {
  return prisma.product.findUnique({
    where: { id },
    include: {
      variants: true,
      taxRules: {
        include: { taxRule: true },
      },
    },
  });
}

export async function listActivePlans() {
  return prisma.plan.findMany({
    where: { isActive: true },
    orderBy: { createdAt: "asc" },
  });
}

export async function listPlans(params?: {
  includeInactive?: boolean;
  page?: number;
  limit?: number;
}) {
  const page = Math.max(1, params?.page || 1);
  const limit = Math.max(1, Math.min(100, params?.limit || 25));
  const skip = (page - 1) * limit;

  const where = params?.includeInactive ? {} : { isActive: true };

  const [items, total] = await Promise.all([
    prisma.plan.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
    }),
    prisma.plan.count({ where }),
  ]);

  return {
    items,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  };
}

export async function getPlan(id: string) {
  return prisma.plan.findUnique({
    where: { id },
  });
}

export async function listTaxRules(params?: { includeInactive?: boolean }) {
  const where = params?.includeInactive ? {} : { isActive: true };
  return prisma.taxRule.findMany({
    where,
    include: {
      products: true,
    },
    orderBy: { createdAt: "asc" },
  });
}

