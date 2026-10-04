import type { DrillRun } from '../types/drill-run';
import type { HoleDesign } from '../types/design';
import type { DepthGap, ReconItem, ReconVerdict, SupplementTask } from '../types/recon';
import { gapsWithin } from './recovery';
import { uid } from './id';

/** 补勘钻机容量：同时处于「已下发」的补勘任务上限，排满的孔排队顺延 */
export const SUPPLEMENT_CAPACITY = 2;

/** 逐孔比对间隔（ms）：逐孔落库让进度可见，也给「中断对账」留出操作窗口 */
export const RECON_STEP_MS = 300;

/** 当前季度标签，如 2026-Q4 */
export function currentQuarter(now = new Date()): string {
  return `${now.getFullYear()}-Q${Math.floor(now.getMonth() / 3) + 1}`;
}

/** 最近几个季度选项（含当前季度，新的在前） */
export function quarterOptions(count = 4): string[] {
  const options: string[] = [];
  const now = new Date();
  let year = now.getFullYear();
  let quarter = Math.floor(now.getMonth() / 3) + 1;
  for (let i = 0; i < count; i += 1) {
    options.push(`${year}-Q${quarter}`);
    quarter -= 1;
    if (quarter === 0) {
      quarter = 4;
      year -= 1;
    }
  }
  return options;
}

/** 单孔比对：设计见矿层位是否被实测回次完整覆盖 */
export function compareHole(design: HoleDesign, runs: DrillRun[]): { verdict: ReconVerdict; gaps: DepthGap[] } {
  const gaps = gapsWithin(design.oreFrom, design.oreTo, runs);
  return { verdict: gaps.length > 0 ? 'gap' : 'covered', gaps };
}

/** 生成对账明细（逐孔落库，中断后已比过的孔留着重试） */
export function buildReconItem(reconId: string, design: HoleDesign, runs: DrillRun[]): ReconItem {
  const { verdict, gaps } = compareHole(design, runs);
  return {
    id: uid('item'),
    reconId,
    holeNo: design.holeNo,
    oreFrom: design.oreFrom,
    oreTo: design.oreTo,
    gaps,
    verdict,
    issueStatus: 'none',
    comparedAt: new Date().toISOString(),
  };
}

/** 在册（未结）补勘任务：已下发或排队顺延中 */
export function openTasks(tasks: SupplementTask[]): SupplementTask[] {
  return tasks.filter((task) => task.status === 'issued' || task.status === 'queued');
}

/** 已下发任务数（占用的钻机容量） */
export function issuedCount(tasks: SupplementTask[]): number {
  return tasks.filter((task) => task.status === 'issued').length;
}

/** 下一个排队序号 */
export function nextSeq(tasks: SupplementTask[]): number {
  return tasks.reduce((max, task) => Math.max(max, task.seq), 0) + 1;
}

/** 断档区间文本，如「155~160m、180~200m」 */
export function gapsText(gaps: DepthGap[]): string {
  return gaps.map((gap) => `${gap.from}~${gap.to}m`).join('、');
}
