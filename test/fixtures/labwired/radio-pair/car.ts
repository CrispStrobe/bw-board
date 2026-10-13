radio.setGroup(1)
radio.setTransmitPower(7)
radio.onReceivedNumber(function (receivedNumber) {
    if (receivedNumber == 0) { motors.dualMotorPower(Motor.A, 50) }
    if (receivedNumber == 1) { motors.dualMotorPower(Motor.A, 0) }
    if (receivedNumber == 2) { motors.dualMotorPower(Motor.B, 50) }
    if (receivedNumber == 3) { motors.dualMotorPower(Motor.B, 0) }
})
