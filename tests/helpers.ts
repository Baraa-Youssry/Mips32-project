import { assemble } from '../src/core/assembler';
import { MipsCpu } from '../src/core/cpu';

export function execute(code: string, maxSteps?: number): MipsCpu {
  const cpu = new MipsCpu();
  cpu.load(assemble(code));
  cpu.run(maxSteps);
  return cpu;
}
