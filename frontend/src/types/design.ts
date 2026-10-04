/**
 * 钻孔设计资料（地质设计组维护）。
 * 与钻探班组的钻孔台帐 / 回次记录是分开的两份资料：
 * 设计组管设计孔深与设计见矿层位，班组管回次进尺与终孔报告，
 * 谁改了都只动自己那份，两边按孔号对应。
 */
export interface HoleDesign {
  id: string;
  /** 孔号（与钻探台帐按孔号对应） */
  holeNo: string;
  /** 设计孔深（m） */
  designDepth: number;
  /** 设计见矿层位起深度（m） */
  oreFrom: number;
  /** 设计见矿层位止深度（m） */
  oreTo: number;
  /** 最近修改时间 ISO */
  updatedAt: string;
  /** 备注 */
  remark?: string;
}
