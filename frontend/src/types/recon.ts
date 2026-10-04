/** 对账批次状态：对账中 / 已中断（已比过的孔保留，可续跑） / 已完成 */
export type ReconStatus = 'running' | 'interrupted' | 'done';

/** 季度对账批次 */
export interface ReconRun {
  id: string;
  /** 对账季度，如 2026-Q4 */
  quarter: string;
  status: ReconStatus;
  /** 应比对的设计孔总数 */
  total: number;
  /** 已比对孔数（逐孔落库，中断后续跑不累） */
  compared: number;
  /** 发起时间 ISO */
  createdAt: string;
  /** 结束（完成或中断）时间 ISO */
  finishedAt?: string;
  /** 中断原因等说明 */
  note?: string;
}

/** 单孔比对结论：covered 层位被实测回次覆盖 / gap 覆盖不上 */
export type ReconVerdict = 'covered' | 'gap';

/** 补勘下发状态：无需下发 / 已下发 / 排队顺延 / 下发失败（按设计侧重试） */
export type IssueStatus = 'none' | 'issued' | 'queued' | 'failed';

/** 深度断档区间 */
export interface DepthGap {
  from: number;
  to: number;
}

/** 对账明细：逐孔落库，对账中断后已比过的孔留着重试 */
export interface ReconItem {
  id: string;
  /** 所属对账批次 */
  reconId: string;
  holeNo: string;
  /** 比对时的设计见矿层位（m） */
  oreFrom: number;
  oreTo: number;
  /** 设计见矿层位未被实测回次覆盖的断档 */
  gaps: DepthGap[];
  verdict: ReconVerdict;
  issueStatus: IssueStatus;
  /** 比对时间 ISO */
  comparedAt: string;
}

/** 补勘任务状态：已下发 / 排队顺延 / 已完成 / 已撤销 */
export type SupplementStatus = 'issued' | 'queued' | 'done' | 'cancelled';

/**
 * 补勘任务。补勘钻机容量有限：排满的孔排队顺延，
 * 已下发的照旧，空位按 seq 顺序补位。
 */
export interface SupplementTask {
  id: string;
  /** 来源对账批次 */
  reconId: string;
  quarter: string;
  holeNo: string;
  /** 需补勘的断档区间 */
  gaps: DepthGap[];
  status: SupplementStatus;
  /** 排队序号，空位按序放 */
  seq: number;
  createdAt: string;
  updatedAt: string;
}
