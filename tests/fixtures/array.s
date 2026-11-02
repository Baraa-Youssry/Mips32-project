# Array sum via lw — prints 31 (3+1+4+1+5+9+2+6)
.data
arr:    .word 3, 1, 4, 1, 5, 9, 2, 6
count:  .word 8

.text
.globl main
main:
    la $t0, arr
    lw $t1, count
    li $t2, 0        # sum
    li $t3, 0        # index
loop:
    bge $t3, $t1, done
    lw $t4, 0($t0)
    addu $t2, $t2, $t4
    addiu $t0, $t0, 4
    addiu $t3, $t3, 1
    j loop
done:
    move $a0, $t2
    li $v0, 1
    syscall
    li $v0, 10
    syscall
