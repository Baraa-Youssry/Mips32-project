# Recursive Fibonacci — prints fib(10) = 55
# fib(n): n in $a0, result in $v0. Saves $ra/$s0 on a 16-byte frame.
.text
.globl main
main:
    li $a0, 10
    jal fib
    move $a0, $v0
    li $v0, 1
    syscall
    li $v0, 10
    syscall

fib:
    blt $a0, 2, fib_base
    addiu $sp, $sp, -16
    sw $ra, 12($sp)
    sw $s0, 8($sp)
    sw $a0, 4($sp)
    addiu $a0, $a0, -1
    jal fib
    move $s0, $v0
    lw $a0, 4($sp)
    addiu $a0, $a0, -2
    jal fib
    addu $v0, $v0, $s0
    lw $s0, 8($sp)
    lw $ra, 12($sp)
    addiu $sp, $sp, 16
    jr $ra
fib_base:
    move $v0, $a0
    jr $ra
