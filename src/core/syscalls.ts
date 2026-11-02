import { diagError } from '../diagnostics/errors';

export type SyscallHost = { readInt?: () => number; readString?: () => string; readChar?: () => number };
export function handleSyscall(v0: number, a0: number, host: SyscallHost, readCString: (address: number) => string): { text?: string; halt?: boolean; value?: number; string?: string } {
  switch (v0 | 0) {
    case 1: return { text: String(a0 | 0) }; // print integer
    case 4: return { text: readCString(a0 >>> 0) }; // print string
    case 5: return { value: host.readInt ? host.readInt() | 0 : 0 }; // read integer -> $v0
    case 8: return { string: host.readString ? host.readString() : '' }; // read string into buffer at $a0
    case 10: return { halt: true };
    case 11: return { text: String.fromCharCode(a0 & 0xff) }; // print char
    case 12: return { value: host.readChar ? host.readChar() | 0 : 0 }; // read char -> $v0
    default: throw diagError('SYS001', `Unsupported MARS syscall code ${v0 | 0}`);
  }
}
