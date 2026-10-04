import { create } from 'zustand';
import { db } from '../utils/db';
import { uid } from '../utils/id';
import type { DrillHole, HoleProgress, SurveyPoint } from '../types/drill-hole';
import type { DrillRun } from '../types/drill-run';
import { buildHoleProgress } from '../utils/recovery';

export interface HoleInput {
  holeNo: string;
  coordX: number;
  coordY: number;
  collarElevation: number;
  designDepth: number;
  designOreFrom: number;
  designOreTo: number;
  startDate: string;
  rigNo: string;
  shift: string;
  surveyData: SurveyPoint[];
  remark?: string;
}

/** 终孔报告（钻探班组维护：回次进尺之外的终孔深度与终孔日期） */
export interface FinalReportInput {
  finalDepth: number;
  endDate?: string;
}

interface HoleState {
  holes: DrillHole[];
  currentHoleId: string;
  hydrated: boolean;
  hydrate: () => Promise<void>;
  setCurrentHole: (id: string) => void;
  addHole: (input: HoleInput) => Promise<DrillHole>;
  /** 地质设计组维护：设计孔深与设计见矿层位（不动终孔报告） */
  updateHole: (id: string, patch: Partial<HoleInput>) => Promise<void>;
  /** 钻探班组维护：终孔深度与终孔日期（不动设计见矿层位） */
  updateFinalReport: (id: string, patch: FinalReportInput) => Promise<void>;
  removeHole: (id: string) => Promise<void>;
  /** 当前钻孔 */
  currentHole: () => DrillHole | undefined;
}

/** 钻孔台帐与当前孔 */
export const useHoleStore = create<HoleState>()((set, get) => ({
  holes: [],
  currentHoleId: '',
  hydrated: false,

  hydrate: async () => {
    const holes = await db.holes.orderBy('holeNo').toArray();
    set({ holes, currentHoleId: get().currentHoleId || holes[0]?.id || '', hydrated: true });
  },

  setCurrentHole: (id) => set({ currentHoleId: id }),

  addHole: async (input) => {
    const hole: DrillHole = {
      id: uid('hole'),
      holeNo: input.holeNo.trim(),
      coordX: Number(input.coordX) || 0,
      coordY: Number(input.coordY) || 0,
      collarElevation: Number(input.collarElevation) || 0,
      designDepth: Number(input.designDepth) || 0,
      designOreFrom: Number(input.designOreFrom) || 0,
      designOreTo: Number(input.designOreTo) || 0,
      // 终孔报告由钻探班组另行登记，建孔时不带入
      finalDepth: 0,
      startDate: input.startDate,
      rigNo: input.rigNo,
      shift: input.shift,
      surveyData: input.surveyData,
      remark: input.remark?.trim() || undefined,
    };
    await db.holes.put(hole);
    set({ holes: [...get().holes, hole].sort((a, b) => a.holeNo.localeCompare(b.holeNo)), currentHoleId: hole.id });
    return hole;
  },

  updateHole: async (id, patch) => {
    const current = get().holes.find((h) => h.id === id);
    if (!current) return;
    // 地质设计组只动设计与台帐字段，终孔深度 / 终孔日期（钻探班组）保持原样
    const next: DrillHole = {
      ...current,
      ...patch,
      finalDepth: current.finalDepth,
      endDate: current.endDate,
    };
    await db.holes.put(next);
    set({ holes: get().holes.map((h) => (h.id === id ? next : h)) });
  },

  updateFinalReport: async (id, patch) => {
    const current = get().holes.find((h) => h.id === id);
    if (!current) return;
    // 钻探班组只动终孔报告字段，设计孔深 / 设计见矿层位保持原样
    const next: DrillHole = {
      ...current,
      finalDepth: Number(patch.finalDepth) || 0,
      endDate: patch.endDate || undefined,
    };
    await db.holes.put(next);
    set({ holes: get().holes.map((h) => (h.id === id ? next : h)) });
  },

  removeHole: async (id) => {
    await db.holes.delete(id);
    set({ holes: get().holes.filter((h) => h.id !== id) });
  },

  currentHole: () => get().holes.find((h) => h.id === get().currentHoleId),
}));

/** 钻孔进度派生（终孔深度 / 未达设计 / 待补勘） */
export function holeProgressList(holes: DrillHole[], runs: DrillRun[]): HoleProgress[] {
  return holes.map((hole) => buildHoleProgress(hole, runs.filter((run) => run.holeId === hole.id)));
}
