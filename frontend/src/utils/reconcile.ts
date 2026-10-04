import type { DrillHole } from '../types/drill-hole';
import type { DrillRun } from '../types/drill-run';
import type { SupplementOrder, SupplementStatus } from '../types/supplement';
import { oreHorizonCoverage } from './recovery';
import { uid } from './id';

/** 补勘钻机容量：同时下发（占用）的补勘订单上限，排满的孔排队顺延 */
export const SUPPLEMENT_CAPACITY = 2;

/** 生成季度对账批次号，如 YD-2026Q3-lx7k2 */
export function quarterBatchNo(now: Date = new Date()): string {
  const quarter = Math.floor(now.getMonth() / 3) + 1;
  return `YD-${now.getFullYear()}Q${quarter}-${uid('batch')}`;
}

export interface ReconcilePlan {
  /** 本次新建的补勘订单（已下发 + 排队），需逐条落库，中断前已落库的不回滚 */
  orders: SupplementOrder[];
  /** 设计见矿层位已覆盖、无需补勘的孔数 */
  coveredCount: number;
  /** 已有在途补勘订单、本次跳过（照旧）的孔数 */
  skippedCount: number;
  /** 本次新下发数 */
  issuedCount: number;
  /** 本次新排队数 */
  queuedCount: number;
}

/**
 * 季度对账计划（纯函数，便于重试与测试）。
 *
 * - 拿「设计见矿层位」比对「实测回次」，覆盖不上（层位内有断档）的孔下发补勘；
 * - 已有在途订单（排队 / 已下发）的孔跳过，已下发的照旧、不重复开单；
 * - 已下发占用容量，排满的孔排队顺延，空位按序放（按孔号顺序）。
 *
 * 对账中断后重试：调用方逐条落库 orders，已落库的订单保留；
 * 重试时本函数对「已有在途订单」的孔跳过，即按设计侧比对结果重试、不重复下发。
 */
export function planReconciliation(
  holes: DrillHole[],
  runs: DrillRun[],
  existing: SupplementOrder[],
  capacity: number,
  batchNo: string,
  nowIso: string,
): ReconcilePlan {
  const open = existing.filter((order) => order.status === 'queued' || order.status === 'issued');
  const openByHole = new Map(open.map((order) => [order.holeId, order]));
  const issuedOccupied = open.filter((order) => order.status === 'issued').length;

  let occupied = issuedOccupied;
  const orders: SupplementOrder[] = [];
  let coveredCount = 0;
  let skippedCount = 0;
  let issuedCount = 0;
  let queuedCount = 0;

  const sorted = [...holes].sort((a, b) => a.holeNo.localeCompare(b.holeNo));
  for (const hole of sorted) {
    // 已下发（含排队中）的孔照旧，不重复开单
    if (openByHole.has(hole.id)) {
      skippedCount += 1;
      continue;
    }
    const { covered, gaps } = oreHorizonCoverage(hole, runs);
    if (covered) {
      coveredCount += 1;
      continue;
    }
    const status: SupplementStatus = occupied < capacity ? 'issued' : 'queued';
    if (status === 'issued') occupied += 1;
    orders.push({
      id: uid('sup'),
      holeId: hole.id,
      holeNo: hole.holeNo,
      designOreFrom: Number(hole.designOreFrom) || 0,
      designOreTo: Number(hole.designOreTo) || 0,
      gaps,
      status,
      batchNo,
      createdAt: nowIso,
      issuedAt: status === 'issued' ? nowIso : undefined,
    });
    if (status === 'issued') issuedCount += 1;
    else queuedCount += 1;
  }

  return { orders, coveredCount, skippedCount, issuedCount, queuedCount };
}
