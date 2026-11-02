# Recursive factorial — prints fact(10) = 3628800
# fact(n): n in $a0, result in $v0.
.text
.globl main
main:
    li $a0, 10
    jal fact
    move $a0, $v0
    li $v0, 1
    syscall
    li $v0, 10
    syscall

fact:
    ble $a0, 1, fact_base      # immediate-form branch pseudo
    addiu $sp, $sp, -16
    sw $ra, 12($sp)
    sw $a0, 8($sp)             # save n
    addiu $a0, $a0, -1
    jal fact                   # $v0 = fact(n-1)
    lw $a0, 8($sp)             # restore n
    mul $v0, $a0, $v0          # n * fact(n-1)
    lw $ra, 12($sp)
    addiu $sp, $sp, 16
    jr $ra
fact_base:
    li $v0, 1
    jr $ra
