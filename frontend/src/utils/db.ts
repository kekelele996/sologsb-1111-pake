import Dexie, { type Table } from 'dexie';
import type { DrillHole } from '../types/drill-hole';
import type { DrillRun } from '../types/drill-run';
import type { CoreBox } from '../types/core-box';
import type { LithoLog } from '../types/litho-log';
import type { HoleDesign } from '../types/design';
import type { ReconItem, ReconRun, SupplementTask } from '../types/recon';

/** IndexedDB 库名（浏览器本地存储，无后端） */
export const DB_NAME = 'gbdrillcore-db';

/** 当前 schema 版本，与 db.version(n) 对应 */
export const SCHEMA_VERSION = 3;

class DrillCoreDB extends Dexie {
  holes!: Table<DrillHole, string>;
  runs!: Table<DrillRun, string>;
  boxes!: Table<CoreBox, string>;
  lithos!: Table<LithoLog, string>;
  meta!: Table<{ key: string; value: string }, string>;
  designs!: Table<HoleDesign, string>;
  reconRuns!: Table<ReconRun, string>;
  reconItems!: Table<ReconItem, string>;
  supplements!: Table<SupplementTask, string>;

  constructor() {
    super(DB_NAME);

    // v1：建表声明索引
    this.version(1).stores({
      holes: 'id, holeNo, rigNo, shift, startDate',
      runs: 'id, runNo, holeId, fromDepth, toDepth, shift',
      boxes: 'id, boxNo, holeId, shelfPos, boxedAt',
      lithos: 'id, holeId, fromDepth, toDepth, lithology',
      meta: 'key',
    });

    // v2：岩性表增加 (holeId+fromDepth) 复合索引，按深度区间查询更快；并回填历史 rqd 缺省值。
    // 升级前请在顶栏「导出备份」导出 JSON。
    this.version(2)
      .stores({
        holes: 'id, holeNo, rigNo, shift, startDate',
        runs: 'id, runNo, holeId, fromDepth, toDepth, shift',
        boxes: 'id, boxNo, holeId, shelfPos, boxedAt',
        lithos: 'id, holeId, fromDepth, toDepth, [holeId+fromDepth], lithology',
        meta: 'key',
      })
      .upgrade(async (tx) => {
        await tx
          .table('lithos')
          .toCollection()
          .modify((row: LithoLog) => {
            if (typeof row.rqd !== 'number') {
              row.rqd = 0;
            }
          });
      });

    // v3：设计资料与季度对账分库分管——新增 designs / reconRuns / reconItems / supplements 四张表。
    // 旧数据里的孔没有设计见矿层位，升级时按现有设计孔深回填设计台账（层位取 0~设计孔深全段）。
    // 升级前请在顶栏「导出备份」导出 JSON。
    this.version(3)
      .stores({
        holes: 'id, holeNo, rigNo, shift, startDate',
        runs: 'id, runNo, holeId, fromDepth, toDepth, shift',
        boxes: 'id, boxNo, holeId, shelfPos, boxedAt',
        lithos: 'id, holeId, fromDepth, toDepth, [holeId+fromDepth], lithology',
        meta: 'key',
        designs: 'id, holeNo',
        reconRuns: 'id, quarter, status, createdAt',
        reconItems: 'id, reconId, holeNo',
        supplements: 'id, reconId, quarter, holeNo, status, seq',
      })
      .upgrade(async (tx) => {
        const holes = (await tx.table('holes').toArray()) as DrillHole[];
        if (holes.length === 0) return;
        const now = new Date().toISOString();
        const rows: HoleDesign[] = holes.map((hole) => ({
          id: `design-${hole.id}`,
          holeNo: hole.holeNo,
          designDepth: hole.designDepth,
          oreFrom: 0,
          oreTo: hole.designDepth,
          updatedAt: now,
          remark: '升级回填：按现有设计孔深生成',
        }));
        await tx.table('designs').bulkPut(rows);
      });
  }
}

export const db = new DrillCoreDB();

export async function getMeta(key: string): Promise<string | undefined> {
  const row = await db.meta.get(key);
  return row?.value;
}

export async function setMeta(key: string, value: string): Promise<void> {
  await db.meta.put({ key, value });
}
