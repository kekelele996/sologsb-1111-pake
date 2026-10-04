import { create } from 'zustand';
import { db } from '../utils/db';
import type { DrillHole } from '../types/drill-hole';
import type { DrillRun } from '../types/drill-run';
import type { SupplementOrder } from '../types/supplement';
import { planReconciliation, quarterBatchNo, SUPPLEMENT_CAPACITY } from '../utils/reconcile';

interface ReconcileResult {
  issued: number;
  queued: number;
  covered: number;
  skipped: number;
}

interface SupplementState {
  orders: SupplementOrder[];
  hydrated: boolean;
  hydrate: () => Promise<void>;
  /** 季度对账：设计见矿层位比对实测回次，覆盖不上的孔下发补勘（容量有限，排队顺延） */
  reconcile: (holes: DrillHole[], runs: DrillRun[]) => Promise<ReconcileResult>;
  /** 空位按序放：按排队先后把已下发容量补满 */
  issueNext: () => Promise<number>;
  /** 标记已下发订单完成（释放容量并补满排队） */
  markDone: (id: string) => Promise<void>;
  /** 取消订单（释放容量并补满排队） */
  cancelOrder: (id: string) => Promise<void>;
}

/** 补勘订单与季度对账：容量有限，已下发占用容量，排满排队顺延，空位按序放 */
export const useSupplementStore = create<SupplementState>()((set, get) => ({
  orders: [],
  hydrated: false,

  hydrate: async () => {
    const orders = await db.supplements.orderBy('createdAt').toArray();
    set({ orders, hydrated: true });
  },

  reconcile: async (holes, runs) => {
    const now = new Date().toISOString();
    const batchNo = quarterBatchNo(new Date());
    const plan = planReconciliation(holes, runs, get().orders, SUPPLEMENT_CAPACITY, batchNo, now);
    // 逐条落库：对账中断前已下发的订单保留，重试不回滚、不重复开单
    for (const order of plan.orders) {
      await db.supplements.put(order);
    }
    if (plan.orders.length > 0) {
      set({ orders: [...get().orders, ...plan.orders] });
    }
    // 空位按序放：补满已下发容量（含历史排队订单）
    await get().issueNext();
    return {
      issued: plan.issuedCount,
      queued: plan.queuedCount,
      covered: plan.coveredCount,
      skipped: plan.skippedCount,
    };
  },

  issueNext: async () => {
    const now = new Date().toISOString();
    const issued = get().orders.filter((order) => order.status === 'issued');
    const queued = get()
      .orders.filter((order) => order.status === 'queued')
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.holeNo.localeCompare(b.holeNo));
    let free = SUPPLEMENT_CAPACITY - issued.length;
    let promoted = 0;
    for (const order of queued) {
      if (free <= 0) break;
      const next: SupplementOrder = { ...order, status: 'issued', issuedAt: now };
      await db.supplements.put(next);
      set({ orders: get().orders.map((item) => (item.id === order.id ? next : item)) });
      free -= 1;
      promoted += 1;
    }
    return promoted;
  },

  markDone: async (id) => {
    const order = get().orders.find((item) => item.id === id);
    if (!order || order.status !== 'issued') return;
    const next: SupplementOrder = { ...order, status: 'done', doneAt: new Date().toISOString() };
    await db.supplements.put(next);
    set({ orders: get().orders.map((item) => (item.id === id ? next : item)) });
    // 空位按序放：完成释放的容量由排队补满
    await get().issueNext();
  },

  cancelOrder: async (id) => {
    const order = get().orders.find((item) => item.id === id);
    if (!order || (order.status !== 'queued' && order.status !== 'issued')) return;
    const next: SupplementOrder = { ...order, status: 'cancelled' };
    await db.supplements.put(next);
    set({ orders: get().orders.map((item) => (item.id === id ? next : item)) });
    await get().issueNext();
  },
}));

/** 在途订单（排队 + 已下发） */
export const openOrders = (orders: SupplementOrder[]): SupplementOrder[] =>
  orders.filter((order) => order.status === 'queued' || order.status === 'issued');

export const issuedOrders = (orders: SupplementOrder[]): SupplementOrder[] =>
  orders.filter((order) => order.status === 'issued');

export const queuedOrders = (orders: SupplementOrder[]): SupplementOrder[] =>
  orders.filter((order) => order.status === 'queued');

export const doneOrders = (orders: SupplementOrder[]): SupplementOrder[] =>
  orders.filter((order) => order.status === 'done');
