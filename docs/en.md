# OpenGarage for Gladys Assistant

This integration shows your OpenGarage controllers in Gladys and drives your
garage door through their local HTTP API, on your network, without the
OpenGarage cloud.

**Never tested with a real device**: the integration follows the firmware API
and the open-garage library (the one of Home Assistant), but nobody has tried
it on a real controller yet. Your feedback is welcome.

Unofficial integration, not affiliated with OpenGarage.

## In Gladys

| Feature               | Detail                                            |
| --------------------- | ------------------------------------------------- |
| Garage door           | open / closed (opening sensor, read only)         |
| Open / Close          | two buttons, never a switch                       |
| Distance sensor       | in cm                                             |
| Vehicle in the garage | present / absent (unknown while the door is open) |
| Wi-Fi signal          | from 0 to 5                                       |
| Temperature, humidity | only when a sensor is fitted to the controller    |

## Setup

1. Give each controller a fixed IP address in your router.
2. In the settings of the controller, change the device key ("opendoor" by
   default).
3. In Gladys, install the OpenGarage integration from the store.
4. Type the IP addresses of the controllers (separated by commas) and the
   device key (the same for every controller).
5. Add the devices from the Discovery tab.

Reading the state needs no key; opening and closing do. The key is kept by
Gladys in its database, never shown again, sent only to your controllers (in
clear on your local network: they have no https). It never appears in the
logs, the statuses, the errors nor in `/data`.

"Check the controllers" shows what each address answered; it never reads a
controller sooner than the refresh interval.

## Command safety

The relay of an OpenGarage is a **toggle**: the same pulse opens a closed
door, closes an open one, and stops or reverses a moving one. Gladys takes it
into account:

- The door is never a switch: a "turn everything off" of a voice assistant or
  a scene cannot reach it. It has two buttons, Open and Close.
- **Open and Close are off by default**: turn on "Allow the garage door
  pulses (open and close)". Closing is the same pulse as opening: on a door
  that moved since it was read (closed meanwhile with the remote), "Close"
  would open it. While the permission is off, the doors are only read, and a
  scene or a voice assistant "close the garage" is refused (nothing is sent).
  The permission is checked when the command arrives, after the read and
  right before the request leaves.
- Before every pulse, Gladys reads the door again and checks the MAC address
  of the controller (a router giving the IP address to another controller
  never moves the wrong door). "Open" is only sent to a door read closed,
  "Close" only to a door read open. Already there: nothing is sent. Moving,
  stopped half way or unknown: refused.
- Without Security+, the door comes from the distance sensor: a distance of 0
  (no echo) or above 500 cm, or none, freezes the door state in the
  controller. Gladys then takes the door as unknown and refuses both buttons.
- Firmware 1.0.7 or later: Gladys sends `close=1` or `open=1`, and the
  controller checks the door again on its own sensor when the request
  arrives (it only closes a door it reads open, only opens a door it reads
  closed). Older: the toggle pulse (`click=1`), with the same rules; up to
  3.5 seconds may pass between the read and the pulse, and if the door moves
  meanwhile the pulse may stop or reverse it.
- One command at a time per controller; "Close" cancels, on arrival, an
  opening that has not left yet. While the controller asks to wait, or after
  a refused key, both buttons are refused.
- After a pulse, the next one is refused until a read made after the pulse
  shows the door where it was sent, and at least 15 seconds after it (45
  seconds at most), even after a restart: a second pulse would stop or
  reverse it. The distance sensor sees the expected state a little before the
  end of travel (closing, the panel leaves the sensor half way down; opening,
  it reaches it before the top stop): a pulse right after the guard is lifted
  may still stop a door finishing its travel. Use the wall button or the
  remote control to stop it.
- A command that cannot leave within 3.5 seconds is refused unsent; a command
  that left without an answer is reported "sent, without confirmation", and
  the door is read again in the following seconds. A successful command means
  the controller received it (it answers before acting): the door then takes
  10 to 30 seconds to move, up to 40 seconds when the alarm of the controller
  (5 or 10 seconds of beeps before the relay) is on.
- The automatic close of the controller (after a delay or at a set time)
  gives the same pulse: a close from Gladys right after it may stop or
  reverse the door. Do not double the automatic close of the controller with
  a Gladys scene at the same time.

## Failures

- Device key refused by a controller: the pulses of that controller are
  refused unsent for 15 min, then 1 h, 6 h and 24 h; saving another key tries
  again at once. The reads go on.
- A controller that asks to wait (HTTP 429 or 5xx) is paused for one minute
  to six hours, even after a restart.
- A controller that does not answer is read again after 30 s, 1, 2 then
  5 min, never sooner than the refresh interval. An answer without a readable
  MAC address counts as a failure, never as another controller.
- After a restart, Gladys waits a whole interval before reading again;
  meanwhile the status shows the outcome of the last read.

## Limits

- No automatic search: type the addresses.
- One key for every controller.
- The "sensor 2 only" mode cannot be read from `/jc`: without a valid
  distance sensor nor Security+, the door is unknown and the buttons refused.
- No Security+ light or lock (firmware 1.2.x), no openings counter, no
  OpenGarage cloud nor MQTT.
