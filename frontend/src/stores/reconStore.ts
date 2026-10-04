import { create } from 'zustand';
import { db } from '../utils/db';
import { uid } from '../utils/id';
import type { DrillHole } from '../types/drill-hole';
import type { DrillRun } from '../types/drill-run';
import type { IssueStatus, ReconItem, ReconRun, ReconStatus, SupplementTask } from '../types/recon';
import { RECON_STEP_MS, SUPPLEMENT_CAPACITY, buildReconItem, issuedCount, nextSeq, openTasks } from '../utils/recon';
import { gapsWithin } from '../utils/recovery';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** 中断请求标记（模块级单例：同一时刻只跑一个对账批次） */
let stopRequested = false;

interface ReconState {
  runs: ReconRun[];
  /** 当前选中批次的对账明细 */
  items: ReconItem[];
  tasks: SupplementTask[];
  activeReconId: string;
  /** 是否有批次正在比对 */
  running: boolean;
  hydrated: boolean;
  hydrate: () => Promise<void>;
  selectRun: (reconId: string) => Promise<void>;
  /** 发起季度对账，返回批次最终状态 */
  startRecon: (quarter: string) => Promise<ReconStatus>;
  /** 续跑被中断的批次：已比过的孔留着，只比剩下的 */
  resumeRecon: (reconId: string) => Promise<ReconStatus>;
  /** 请求中断当前对账（逐孔落库，已比过的保留） */
  requestStop: () => void;
  /** 下发失败后按设计侧重试：重读设计台账当前层位重新比对并下发 */
  retryIssue: (itemId: string) => Promise<IssueStatus>;
  completeTask: (taskId: string) => Promise<void>;
  cancelTask: (taskId: string) => Promise<void>;
}

/** 季度对账：设计见矿层位比对实测回次，覆盖不上的孔下发补勘 */
export const useReconStore = create<ReconState>()((set, get) => {
  /** 从库里重载批次 / 补勘任务 / 当前批次明细 */
  const reload = async () => {
    const [runs, tasks] = await Promise.all([db.reconRuns.orderBy('createdAt').reverse().toArray(), db.supplements.toArray()]);
    const activeReconId = get().activeReconId;
    const items = activeReconId
      ? (await db.reconItems.where('reconId').equals(activeReconId).toArray()).sort((a, b) => a.holeNo.localeCompare(b.holeNo))
      : [];
    set({ runs, tasks, items });
  };

  /**
   * 下发补勘：同季度同孔已有在册任务则照旧（不重复下发）；
   * 钻机容量排满则排队顺延，否则占空位下发。
   */
  const issueSupplement = async (run: ReconRun, item: ReconItem): Promise<'issued' | 'queued'> => {
    const tasks = await db.supplements.toArray();
    const existing = openTasks(tasks).find((task) => task.quarter === run.quarter && task.holeNo === item.holeNo);
    if (existing) return existing.status === 'issued' ? 'issued' : 'queued';
    const status = issuedCount(tasks) < SUPPLEMENT_CAPACITY ? 'issued' : 'queued';
    const now = new Date().toISOString();
    await db.supplements.put({
      id: uid('sup'),
      reconId: run.id,
      quarter: run.quarter,
      holeNo: item.holeNo,
      gaps: item.gaps,
      status,
      seq: nextSeq(tasks),
      createdAt: now,
      updatedAt: now,
    });
    return status;
  };

  /** 空位按序放：已下发腾出容量后，排队任务按序号依次补位 */
  const promoteQueued = async () => {
    const tasks = await db.supplements.toArray();
    let used = issuedCount(tasks);
    const queued = tasks.filter((task) => task.status === 'queued').sort((a, b) => a.seq - b.seq);
    const now = new Date().toISOString();
    for (const task of queued) {
      if (used >= SUPPLEMENT_CAPACITY) break;
      await db.supplements.update(task.id, { status: 'issued', updatedAt: now });
      used += 1;
    }
  };

  /** 对账主循环：逐孔比对落库，可中断、可续跑 */
  const processRun = async (reconId: string): Promise<ReconStatus> => {
    const run = await db.reconRuns.get(reconId);
    if (!run || run.status === 'done') return 'done';
    const [designs, holes, allRuns] = await Promise.all([
      db.designs.orderBy('holeNo').toArray(),
      db.holes.toArray(),
      db.runs.toArray(),
    ]);
    const holeByNo = new Map<string, DrillHole>(holes.map((hole) => [hole.holeNo, hole]));
    const runsByHole = new Map<string, DrillRun[]>();
    allRuns.forEach((runRow) => {
      const list = runsByHole.get(runRow.holeId) ?? [];
      list.push(runRow);
      runsByHole.set(runRow.holeId, list);
    });

    // 已比过的孔留着重试：续跑时直接跳过
    const doneItems = await db.reconItems.where('reconId').equals(reconId).toArray();
    const doneHoleNos = new Set(doneItems.map((item) => item.holeNo));
    let compared = doneHoleNos.size;

    const interrupt = async (note: string): Promise<ReconStatus> => {
      await db.reconRuns.update(reconId, { status: 'interrupted', note, finishedAt: new Date().toISOString() });
      return 'interrupted';
    };

    for (const design of designs) {
      if (stopRequested) {
        return interrupt('对账被中断，已比过的孔已保留，可续跑');
      }
      if (doneHoleNos.has(design.holeNo)) continue;
      try {
        const hole = holeByNo.get(design.holeNo);
        const holeRuns = hole ? runsByHole.get(hole.id) ?? [] : [];
        const item = buildReconItem(reconId, design, holeRuns);
        if (item.verdict === 'gap') {
          try {
            item.issueStatus = await issueSupplement(run, item);
          } catch {
            // 下发失败不拖垮整批对账：记下失败，留待按设计侧重试
            item.issueStatus = 'failed';
          }
        }
        await db.reconItems.put(item);
        compared += 1;
        await db.reconRuns.update(reconId, { total: designs.length, compared });
        await reload();
        await sleep(RECON_STEP_MS);
      } catch (error) {
        return interrupt(`比对 ${design.holeNo} 时出错：${(error as Error).message}`);
      }
    }
    await db.reconRuns.update(reconId, {
      total: designs.length,
      compared,
      status: 'done',
      finishedAt: new Date().toISOString(),
    });
    return 'done';
  };

  /** 跑一个批次并刷新界面状态 */
  const drive = async (reconId: string): Promise<ReconStatus> => {
    set({ activeReconId: reconId, running: true });
    stopRequested = false;
    try {
      return await processRun(reconId);
    } finally {
      set({ running: false });
      await reload();
    }
  };

  return {
    runs: [],
    items: [],
    tasks: [],
    activeReconId: '',
    running: false,
    hydrated: false,

    hydrate: async () => {
      // 页面重开时，上次「对账中」的批次视为已中断：已比过的孔保留，可续跑
      await db.reconRuns
        .where('status')
        .equals('running')
        .modify({ status: 'interrupted', note: '对账中断，已比过的孔已保留，可续跑' });
      const runs = await db.reconRuns.orderBy('createdAt').reverse().toArray();
      const tasks = await db.supplements.toArray();
      const activeReconId = get().activeReconId || runs[0]?.id || '';
      const items = activeReconId
        ? (await db.reconItems.where('reconId').equals(activeReconId).toArray()).sort((a, b) => a.holeNo.localeCompare(b.holeNo))
        : [];
      set({ runs, tasks, items, activeReconId, hydrated: true });
    },

    selectRun: async (reconId) => {
      const items = reconId
        ? (await db.reconItems.where('reconId').equals(reconId).toArray()).sort((a, b) => a.holeNo.localeCompare(b.holeNo))
        : [];
      set({ activeReconId: reconId, items });
    },

    startRecon: async (quarter) => {
      if (get().running) return 'interrupted';
      const run: ReconRun = {
        id: uid('recon'),
        quarter,
        status: 'running',
        total: 0,
        compared: 0,
        createdAt: new Date().toISOString(),
      };
      await db.reconRuns.put(run);
      return drive(run.id);
    },

    resumeRecon: async (reconId) => {
      if (get().running) return 'interrupted';
      await db.reconRuns
        .where('id')
        .equals(reconId)
        .modify((run) => {
          run.status = 'running';
          delete run.note;
          delete run.finishedAt;
        });
      return drive(reconId);
    },

    requestStop: () => {
      stopRequested = true;
    },

    retryIssue: async (itemId) => {
      const item = await db.reconItems.get(itemId);
      if (!item) return 'none';
      const run = await db.reconRuns.get(item.reconId);
      if (!run) throw new Error('对账批次不存在，无法重试');
      // 按设计侧重试：以设计台账当前层位为准，与实测回次重新比对
      const design = await db.designs.where('holeNo').equals(item.holeNo).first();
      if (!design) throw new Error(`设计台账中查无 ${item.holeNo}，无法按设计侧重试`);
      const hole = await db.holes.where('holeNo').equals(item.holeNo).first();
      const holeRuns = hole ? await db.runs.where('holeId').equals(hole.id).toArray() : [];
      const gaps = gapsWithin(design.oreFrom, design.oreTo, holeRuns);
      let next: ReconItem;
      if (gaps.length === 0) {
        next = { ...item, oreFrom: design.oreFrom, oreTo: design.oreTo, gaps: [], verdict: 'covered', issueStatus: 'none' };
      } else {
        const retried: ReconItem = { ...item, oreFrom: design.oreFrom, oreTo: design.oreTo, gaps, verdict: 'gap' };
        next = { ...retried, issueStatus: await issueSupplement(run, retried) };
      }
      next.comparedAt = new Date().toISOString();
      await db.reconItems.put(next);
      await reload();
      return next.issueStatus;
    },

    completeTask: async (taskId) => {
      await db.supplements.update(taskId, { status: 'done', updatedAt: new Date().toISOString() });
      await promoteQueued();
      await reload();
    },

    cancelTask: async (taskId) => {
      await db.supplements.update(taskId, { status: 'cancelled', updatedAt: new Date().toISOString() });
      await promoteQueued();
      await reload();
    },
  };
});
