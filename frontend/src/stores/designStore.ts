import { create } from 'zustand';
import { db } from '../utils/db';
import { uid } from '../utils/id';
import type { HoleDesign } from '../types/design';
import type { DrillHole } from '../types/drill-hole';

export interface DesignInput {
  holeNo: string;
  designDepth: number;
  oreFrom: number;
  oreTo: number;
  remark?: string;
}

interface DesignState {
  designs: HoleDesign[];
  hydrated: boolean;
  hydrate: () => Promise<void>;
  addDesign: (input: DesignInput) => Promise<HoleDesign>;
  updateDesign: (id: string, patch: Partial<DesignInput>) => Promise<void>;
  removeDesign: (id: string) => Promise<void>;
  /** 按台帐回填缺失设计：没有设计见矿层位的孔按现有设计孔深生成（与 v3 升级回填同一规则） */
  backfillFromHoles: (holes: DrillHole[]) => Promise<number>;
}

/** 设计台账：地质设计组那份资料，只动 designs 表，不碰钻探班组的台帐与回次 */
export const useDesignStore = create<DesignState>()((set, get) => ({
  designs: [],
  hydrated: false,

  hydrate: async () => {
    const designs = await db.designs.orderBy('holeNo').toArray();
    set({ designs, hydrated: true });
  },

  addDesign: async (input) => {
    const design: HoleDesign = {
      id: uid('design'),
      holeNo: input.holeNo.trim(),
      designDepth: Number(input.designDepth) || 0,
      oreFrom: Number(input.oreFrom) || 0,
      oreTo: Number(input.oreTo) || 0,
      updatedAt: new Date().toISOString(),
      remark: input.remark?.trim() || undefined,
    };
    await db.designs.put(design);
    set({ designs: [...get().designs, design].sort((a, b) => a.holeNo.localeCompare(b.holeNo)) });
    return design;
  },

  updateDesign: async (id, patch) => {
    const current = get().designs.find((d) => d.id === id);
    if (!current) return;
    const next: HoleDesign = {
      ...current,
      ...patch,
      holeNo: patch.holeNo?.trim() ?? current.holeNo,
      updatedAt: new Date().toISOString(),
    };
    await db.designs.put(next);
    set({ designs: get().designs.map((d) => (d.id === id ? next : d)) });
  },

  removeDesign: async (id) => {
    await db.designs.delete(id);
    set({ designs: get().designs.filter((d) => d.id !== id) });
  },

  backfillFromHoles: async (holes) => {
    const existing = new Set(get().designs.map((d) => d.holeNo));
    const now = new Date().toISOString();
    const rows: HoleDesign[] = holes
      .filter((hole) => !existing.has(hole.holeNo))
      .map((hole) => ({
        id: uid('design'),
        holeNo: hole.holeNo,
        designDepth: hole.designDepth,
        oreFrom: 0,
        oreTo: hole.designDepth,
        updatedAt: now,
        remark: '按现有设计孔深回填',
      }));
    if (rows.length > 0) {
      await db.designs.bulkPut(rows);
      set({ designs: [...get().designs, ...rows].sort((a, b) => a.holeNo.localeCompare(b.holeNo)) });
    }
    return rows.length;
  },
}));
