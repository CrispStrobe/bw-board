radio.setGroup(1)
radio.setTransmitPower(7)
basic.forever(function () {
    if (input.buttonIsPressed(Button.A)) { radio.sendNumber(0) } else { radio.sendNumber(1) }
    if (input.buttonIsPressed(Button.B)) { radio.sendNumber(2) } else { radio.sendNumber(3) }
})
