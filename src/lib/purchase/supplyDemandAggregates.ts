import {
  normalizeEmbeddedItem,
  normalizeEmbeddedOrder,
  type OpenPoDemandLine,
} from '../../hooks/useOpenPoDemandLines';
import { ageDays, groupLabel, linePoValue, type BrandSummary, type SkuSummary } from '../../components/supply/supplyDemandShared';

export function buildBrandSummaries(lines: OpenPoDemandLine[]): BrandSummary[] {
  const brandMap = new Map<
    string,
    {
      label: string;
      totalPo: number;
      totalValue: number;
      lineCount: number;
      customers: Set<string>;
      oldestCreatedAt: string | null;
      staleQty: number;
      staleLines: number;
      skuMap: Map<
        number,
        {
          item_id: number;
          item_name: string;
          item_alias: string | null;
          item_alias1: string | null;
          totalPo: number;
          totalValue: number;
          lineCount: number;
          customers: Set<string>;
          oldestCreatedAt: string | null;
        }
      >;
    }
  >();

  for (const row of lines) {
    const order = normalizeEmbeddedOrder(row.orders);
    const label = groupLabel(row);
    const brand = brandMap.get(label) ?? {
      label,
      totalPo: 0,
      totalValue: 0,
      lineCount: 0,
      customers: new Set<string>(),
      oldestCreatedAt: null,
      staleQty: 0,
      staleLines: 0,
      skuMap: new Map(),
    };

    brand.totalPo += row.qty_po;
    brand.totalValue += linePoValue(row);
    brand.lineCount += 1;
    if (order?.customer_name) brand.customers.add(order.customer_name);
    if (order?.created_at) {
      if (!brand.oldestCreatedAt || order.created_at < brand.oldestCreatedAt) {
        brand.oldestCreatedAt = order.created_at;
      }
      if (ageDays(order.created_at) >= 14) {
        brand.staleQty += row.qty_po;
        brand.staleLines += 1;
      }
    }

    const sku = brand.skuMap.get(row.item_id) ?? {
      item_id: row.item_id,
      item_name: row.item_name,
      item_alias: normalizeEmbeddedItem(row.items)?.alias ?? null,
      item_alias1: normalizeEmbeddedItem(row.items)?.alias1 ?? null,
      totalPo: 0,
      totalValue: 0,
      lineCount: 0,
      customers: new Set<string>(),
      oldestCreatedAt: null,
    };
    sku.totalPo += row.qty_po;
    sku.totalValue += linePoValue(row);
    sku.lineCount += 1;
    if (order?.customer_name) sku.customers.add(order.customer_name);
    if (order?.created_at) {
      if (!sku.oldestCreatedAt || order.created_at < sku.oldestCreatedAt) {
        sku.oldestCreatedAt = order.created_at;
      }
    }
    brand.skuMap.set(row.item_id, sku);
    brandMap.set(label, brand);
  }

  return [...brandMap.values()]
    .map((brand) => ({
      label: brand.label,
      totalPo: brand.totalPo,
      totalValue: brand.totalValue,
      lineCount: brand.lineCount,
      distinctSkus: brand.skuMap.size,
      customerCount: brand.customers.size,
      staleQty: brand.staleQty,
      staleLines: brand.staleLines,
      oldestCreatedAt: brand.oldestCreatedAt,
      skuRows: [...brand.skuMap.values()]
        .map((sku) => ({
          item_id: sku.item_id,
          item_name: sku.item_name,
          item_alias: sku.item_alias,
          item_alias1: sku.item_alias1,
          totalPo: sku.totalPo,
          totalValue: sku.totalValue,
          lineCount: sku.lineCount,
          customerCount: sku.customers.size,
          oldestCreatedAt: sku.oldestCreatedAt,
        }))
        .sort((a, b) => b.totalPo - a.totalPo),
    }))
    .sort((a, b) => b.totalPo - a.totalPo);
}

export function buildSkuSummaries(lines: OpenPoDemandLine[]): SkuSummary[] {
  const skuMap = new Map<
    number,
    {
      item_id: number;
      item_name: string;
      item_alias: string | null;
      item_alias1: string | null;
      brandLabel: string;
      totalPo: number;
      totalValue: number;
      lineCount: number;
      customers: Set<string>;
      oldestCreatedAt: string | null;
    }
  >();

  for (const row of lines) {
    const order = normalizeEmbeddedOrder(row.orders);
    const prev = skuMap.get(row.item_id) ?? {
      item_id: row.item_id,
      item_name: row.item_name,
      item_alias: normalizeEmbeddedItem(row.items)?.alias ?? null,
      item_alias1: normalizeEmbeddedItem(row.items)?.alias1 ?? null,
      brandLabel: groupLabel(row),
      totalPo: 0,
      totalValue: 0,
      lineCount: 0,
      customers: new Set<string>(),
      oldestCreatedAt: null,
    };

    prev.totalPo += row.qty_po;
    prev.totalValue += linePoValue(row);
    prev.lineCount += 1;
    if (order?.customer_name) prev.customers.add(order.customer_name);
    if (order?.created_at) {
      if (!prev.oldestCreatedAt || order.created_at < prev.oldestCreatedAt) {
        prev.oldestCreatedAt = order.created_at;
      }
    }
    skuMap.set(row.item_id, prev);
  }

  return [...skuMap.values()]
    .map((sku) => ({
      item_id: sku.item_id,
      item_name: sku.item_name,
      item_alias: sku.item_alias,
      item_alias1: sku.item_alias1,
      brandLabel: sku.brandLabel,
      totalPo: sku.totalPo,
      totalValue: sku.totalValue,
      lineCount: sku.lineCount,
      customerCount: sku.customers.size,
      oldestCreatedAt: sku.oldestCreatedAt,
    }))
    .sort((a, b) => b.totalPo - a.totalPo);
}

export function buildDemandTotals(lines: OpenPoDemandLine[], bySku: SkuSummary[], byBrand: BrandSummary[]) {
  let poPieces = 0;
  let totalValue = 0;
  const orderIds = new Set<number>();
  const customers = new Set<string>();

  for (const row of lines) {
    poPieces += row.qty_po;
    totalValue += linePoValue(row);
    orderIds.add(row.order_id);
    const order = normalizeEmbeddedOrder(row.orders);
    if (order?.customer_name) customers.add(order.customer_name);
  }

  return {
    lineCount: lines.length,
    poPieces,
    skuCount: bySku.length,
    brandCount: byBrand.length,
    orderCount: orderIds.size,
    customerCount: customers.size,
    totalValue,
  };
}

export function collectSalesReps(lines: OpenPoDemandLine[]): string[] {
  const names = new Set<string>();
  for (const row of lines) {
    const order = normalizeEmbeddedOrder(row.orders);
    if (order?.salesperson_name) names.add(order.salesperson_name);
  }
  return [...names].sort();
}
