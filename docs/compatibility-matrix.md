# Compatibility Matrix — MIPS32 Offline IDE vs QtSPIM / MARS

Status legend:

| Symbol | Meaning |
|--------|---------|
| ✅ | Supported (tested) |
| ⚠️ | Partial — supported with documented differences |
| ❌ | Not implemented (deliberate; hidden where relevant) |
| 🚫 | Blocked by environment (cannot be verified in this build) |

Test counts below refer to the current suite (263 tests, all passing).

---

## 1. Assembly directives

| Directive | Status | Notes |
|-----------|--------|-------|
| `.text` / `.data` | ✅ | Section switching; instructions outside `.data` allowed after implicit `.text` |
| `.globl` / `.global` | ⚠️ | Accepted and ignored (single-file programs only) |
| `.word` | ✅ | Label or integer constants, comma separated |
| `.byte` / `.half` | ✅ | Little-endian placement |
| `.ascii` / `.asciiz` | ✅ | Escapes: `\n \t \r \0 \b \f \\ \"` |
| `.space` | ✅ | 0..1 MiB per directive |
| `.align` | ✅ | 0..4 (byte alignment exponent) |
| `.set` / `.eqv` / `.macro` | ❌ | MARS/QtSPIM macros not implemented |

## 2. Integer instructions

| Group | Status | Instructions |
|-------|--------|--------------|
| Arithmetic (R) | ✅ | `add addu sub subu mul` |
| Arithmetic (I) | ✅ | `addi addiu` |
| Multiply/divide | ✅ | `mult multu div divu mfhi mflo mthi mtlo` (64-bit HI/LO, BigInt-exact) |
| Logical | ✅ | `and or xor nor andi ori xori lui` |
| Shifts | ✅ | `sll srl sra sllv srlv srav` |
| Compare | ✅ | `slt sltu slti sltiu` |
| Loads/stores | ✅ | `lb lbu lh lhu lw sb sh sw` with alignment checks |
| Branches | ✅ | `beq bne blez bgtz bltz bgez` |
| Jumps | ✅ | `j jal jr jalr` |
| `nop` | ✅ | Assembles to `sll $zero,$zero,0` |
| Floating point | ❌ | No FPU: `add.s`, `lwc1`, … rejected at assembly with clear error; `$f0–$f31` shown as — in UI |
| COP0 (`mfc0` …) | ❌ | Status/Cause/EPC fields shown as — with "not implemented" tooltip |
| Branch delay slots | ⚠️ | **Not simulated** — branches take effect immediately (documented project choice) |
| Traps / exceptions (`teq`, overflow traps) | ❌ | Integer overflow wraps silently (MARS default behavior too) |

## 3. Pseudo-instructions

| Pseudo | Status | Expansion |
|--------|--------|-----------|
| `li` | ✅ | `addiu` for 16-bit, `lui`+`ori` for full 32-bit |
| `la` | ✅ | `lui`+`ori` with `%hi`/`%lo` fixups |
| `move` | ✅ | `addu rd, $zero, rs` |
| `not` / `neg` | ✅ | `nor rd, rs, $zero` / `subu rd, $zero, rs` |
| `b label` | ✅ | `j label` |
| `blt/bgt/ble/bge` (register) | ✅ | `slt $at, …` + `bne`/`beq $at, $zero, label` |
| `blt/bgt/ble/bge` (immediate) | ✅ | `slti $at, rs, k(+1)` + branch; range-checked |
| `subi` | ✅ | `addi rd, rs, −k` |
| `mul rd, rs, rt` | ⚠️ | Low 32 bits to `rd`; **HI/LO untouched** (MARS also leaves HI/LO for this pseudo form) |
| Bare-label loads/stores (`lw $t0, label`) | ✅ | `lui $at,%hi(label)` + `ori $at,$at,%lo(label)` + `lw $t0,0($at)` |
| `rem`, `ble/bge` with `$at` aliasing, `ulw/usw` | ❌ | Not supported |

**Register operand syntax:** strictly `$`-prefixed (`$t0`, `$31`). Bare integers are rejected with a
`register`-category error instead of being silently misparsed (regression-tested; BUG-1).

## 4. Syscalls (`syscall`, code in `$v0`)

| Code | Name | Status | Notes |
|------|------|--------|-------|
| 1 | print int | ✅ | `$a0` signed decimal |
| 4 | print string | ✅ | NUL-terminated at `$a0` |
| 5 | read int | ✅ | Pauses execution, UI input field, 32-bit validation, resume |
| 8 | read string | ✅ | `$a0` buffer, `$a1` length, NUL-terminated (capped at `$a1−1`) |
| 10 | exit | ✅ | Halt |
| 11 | print char | ✅ | Low byte of `$a0` |
| 12 | read char | ✅ | Pauses execution, first character of input |
| 30/31/32/33/35/36/40/41/42 (time, random, sleep, seed, …) | ❌ | Not implemented |
| FP syscalls (2, 3, 6, 7) | ❌ | No FPU |

## 5. Memory model

| Feature | Status | Notes |
|---------|--------|-------|
| Byte-addressed | ✅ | `0x00400000` text, `0x10010000` data |
| Little-endian | ✅ | Matches QtSPIM/MARS on x86/ARM hosts |
| Alignment faults | ✅ | `lw`/`sw` on non-multiple-of-4, `lh`/`sh` on odd → runtime error with address |
| Null page | ✅ | Effective address `< 0x1000` faults (`MEM003`); the rest of the sparse 32-bit space is readable — negative bases address high memory (e.g. `0xfffffffc`) |
| Sparse/paged | ✅ | Unwritten pages allocate on demand; Data view shows written words only |
| `%hi`/`%lo` relocation | ✅ | Two-pass label resolution |

## 6. Registers & ABI (documented project choices)

| Item | Our choice | QtSPIM/MARS | Status |
|------|-----------|-------------|--------|
| 32 GPRs + HI/LO + PC | ✅ | ✅ | Same names/indices (`$zero`..`$ra`) |
| `$sp` reset value | `0x7ffffffc` | ~`0x7ffffff4` | ⚠️ differs (aligned, within 8 bytes) |
| `$gp` reset value | `0x10008000` | similar | ⚠️ approximate |
| Register operands | `$`-prefixed only | `$`-prefixed | ✅ same |
| `$at` | Clobbered by `blt/bgt/ble/bge`, `la`-form loads | Same intent | ✅ documented |
| Caller/callee saved rules | Not enforced — exactly like QtSPIM (simulator never saves registers for you) | Same | ✅ recursion tests document this |
| FP registers `$f0–$f31` | ❌ shown as — | ✅ | See above |

## 7. UI features (vs QtSPIM)

| Feature | Status | Notes |
|---------|--------|-------|
| Menu bar (File/Simulator/Settings/Help) | ✅ | Dropdown menus with shortcuts |
| Toolbar: New/Open/Save/Assemble/Reinitialize/Run/Pause/Step/Stop | ✅ | Mirrors QtSPIM actions |
| Keyboard: F5 run, F6 assemble, F10 step | ✅ | F5 browser reload suppressed |
| Editor with MIPS highlighting | ✅ | CodeMirror, line numbers, fold |
| Text listing view | ⚠️ | Address + expanded op + operands + source line; **machine-code encoding omitted** — this build has no encoder, and fabricated opcodes are not shown |
| Data view | ✅ | Hex + ASCII, sparse-word rows |
| Console + Messages tabs | ✅ | Messages: timestamped, severity-colored, capped at 300 |
| Integer registers + modified highlight | ✅ | Amber highlight = changed by last step/run segment |
| FP register tab | ❌ | Visible with explicit NOT IMPLEMENTED notice |
| Status/Cause/EPC | ❌ | Shown as — with tooltips |
| Register window editable | ❌ | Read-only (QtSPIM allows editing — not implemented) |
| Resizable panels | ⚠️ | Horizontal column splitter only (no vertical splitter) |
| Light/dark theme | ✅ | Toggle in topbar + Settings menu |
| Breakpoints | ❌ | Not implemented (Step/Stop cover basic debugging) |
| Run > Reinitialize semantics | ✅ | Reloads last assembled program, clears regs/memory/console |
| Console input | ✅ | Focused automatically when program waits (syscalls 5/8/12) |
| Error diagnostics | ✅ | Structured codes (`INS/LBL/REG/DIR/MEM/RT/SYS/LEX/GEN` + `WRN/INF/HNT` analysis) with phase, column, explanation, actual/expected, did-you-mean suggestions, one-click quick fixes; CodeMirror lint gutter + diagnostics panel in Messages tab |

## 8. Environment

| Item | Status | Notes |
|------|--------|-------|
| Browser (desktop) | ✅ | Primary target; responsive down to 600 px |
| Android APK | 🚫 | **BLOCKED** — Android SDK not installed on this machine; `capacitor.config.ts` + `android:*` npm scripts ready, `android/` folder not generated |
| iOS | ❌ | Out of scope, never configured |
