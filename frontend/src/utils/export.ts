import type { Table } from 'dexie';
import { db, SCHEMA_VERSION } from './db';

export interface BackupPayload {
  app: string;
  schemaVersion: number;
  exportedAt: string;
  holes: unknown[];
  runs: unknown[];
  boxes: unknown[];
  lithos: unknown[];
  designs: unknown[];
  reconRuns: unknown[];
  reconItems: unknown[];
  supplements: unknown[];
}

/** 汇总全部本地表为 JSON 备份（schema 迁移前先导出） */
export async function buildBackup(): Promise<BackupPayload> {
  const [holes, runs, boxes, lithos, designs, reconRuns, reconItems, supplements] = await Promise.all([
    db.holes.toArray(),
    db.runs.toArray(),
    db.boxes.toArray(),
    db.lithos.toArray(),
    db.designs.toArray(),
    db.reconRuns.toArray(),
    db.reconItems.toArray(),
    db.supplements.toArray(),
  ]);
  return {
    app: 'gbdrillcore',
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    holes,
    runs,
    boxes,
    lithos,
    designs,
    reconRuns,
    reconItems,
    supplements,
  };
}

export async function exportBackupJson(): Promise<string> {
  return JSON.stringify(await buildBackup(), null, 2);
}

export function downloadText(filename: string, text: string, mime = 'application/json'): void {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** 导出 CSV（岩芯编目表打印用） */
export function downloadCsv<T extends Record<string, unknown>>(
  filename: string,
  rows: T[],
  columns: Array<{ key: keyof T; title: string }>,
): void {
  const header = columns.map((c) => `"${c.title}"`).join(',');
  const body = rows
    .map((row) => columns.map((c) => `"${String(row[c.key] ?? '').replace(/"/g, '""')}"`).join(','))
    .join('\n');
  downloadText(filename, `\ufeff${header}\n${body}`, 'text/csv');
}

/** 恢复 JSON 备份（旧版备份缺少的表跳过，不清空） */
export async function importBackup(text: string): Promise<Record<string, number>> {
  const payload = JSON.parse(text) as Partial<BackupPayload>;
  if (!payload || payload.app !== 'gbdrillcore') {
    throw new Error('备份文件格式不匹配（缺少 app=gbdrillcore 标记）');
  }
  const tables: Record<string, Table<unknown, string>> = {
    holes: db.holes,
    runs: db.runs,
    boxes: db.boxes,
    lithos: db.lithos,
    designs: db.designs,
    reconRuns: db.reconRuns,
    reconItems: db.reconItems,
    supplements: db.supplements,
  };
  const counts: Record<string, number> = {};
  await db.transaction('rw', Object.values(tables), async () => {
    for (const [key, table] of Object.entries(tables)) {
      const rows = payload[key as keyof BackupPayload];
      if (!Array.isArray(rows)) continue;
      counts[key] = rows.length;
      await table.clear();
      if (rows.length) await table.bulkPut(rows);
    }
  });
  return counts;
}
