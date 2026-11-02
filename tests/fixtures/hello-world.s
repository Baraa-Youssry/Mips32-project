# String output — prints "Hello, World!" followed by a newline
.data
msg: .asciiz "Hello, World!\n"

.text
.globl main
main:
    la $a0, msg
    li $v0, 4
    syscall
    li $v0, 10
    syscall
