/** 补勘订单状态：排队顺延 / 已下发 / 已完成 / 已取消 */
export type SupplementStatus = 'queued' | 'issued' | 'done' | 'cancelled';

/**
 * 补勘订单。
 * 季度对账时以「设计见矿层位」比对「实测回次」，覆盖不上的孔下发补勘。
 * 钻机容量有限：已下发占用容量，排满的孔排队顺延，空位按序放。
 */
export interface SupplementOrder {
  id: string;
  /** 所属钻孔 */
  holeId: string;
  /** 孔号（冗余，便于列表展示） */
  holeNo: string;
  /** 设计见矿层位起深度（m）· 对账时取设计侧快照 */
  designOreFrom: number;
  /** 设计见矿层位止深度（m）· 对账时取设计侧快照 */
  designOreTo: number;
  /** 实测回次未覆盖的断档区间（m） */
  gaps: Array<{ from: number; to: number }>;
  status: SupplementStatus;
  /** 对账批次号（如 YD-2026Q3-xxxx） */
  batchNo: string;
  /** 建单时间 ISO */
  createdAt: string;
  /** 下发时间 ISO（占用钻机容量） */
  issuedAt?: string;
  /** 完成时间 ISO（释放钻机容量） */
  doneAt?: string;
  /** 备注 */
  remark?: string;
}
