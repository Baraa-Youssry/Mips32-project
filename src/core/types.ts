export const TEXT_BASE = 0x00400000;
export const DATA_BASE = 0x10010000;

export type Instruction = { op: string; args: string[]; line: number; source: string };
export type Program = {
  instructions: Instruction[];
  labels: Map<string, number>;
  data: Uint8Array;
  dataBase: number;
  textBase: number;
};
export type RunResult = { output: string[]; halted: boolean; steps: number };
