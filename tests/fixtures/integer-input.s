# Interactive integer input — asks for n, prints n^2
# Test drives syscall 5 via cpu.provideInput(...)
.data
prompt: .asciiz "n = "
result: .asciiz "n^2 = "

.text
.globl main
main:
    li $v0, 4
    la $a0, prompt
    syscall

    li $v0, 5
    syscall
    move $t0, $v0

    mul $t1, $t0, $t0

    li $v0, 4
    la $a0, result
    syscall

    move $a0, $t1
    li $v0, 1
    syscall

    li $v0, 10
    syscall
