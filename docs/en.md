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
- Before every pulse, Gladys reads the door again and checks the MAC address
  of the controller (a router giving the IP address to another controller
  never moves the wrong door). "Open" is only sent to a door read closed,
  "Close" only to a door read open. Already there: nothing is sent. Moving,
  stopped half way or unknown: refused.
- **Opening is off by default**: turn on "Allow opening the garage door". The
  permission is checked when the command arrives, after the read and right
  before the request leaves.
- **Closing is always allowed**, goes before the other commands, stays
  possible while the controller asks to wait (one try) and cancels an opening
  that has not left yet.
- After a pulse, the next one is refused until the door is read where it was
  sent (45 seconds at most), even after a restart: a second pulse would stop
  or reverse it. Use the wall button or the remote control to stop it.
- A command that cannot leave within 3.5 seconds is refused unsent; a command
  that left without an answer is reported "sent, without confirmation", and
  the door is read again in the following seconds. A successful command means
  the controller accepted the pulse: the door then takes 10 to 30 seconds to
  move.
- At most a second passes between the read and the pulse: if the door moves
  meanwhile (remote control), the pulse may stop it.

## Failures

- Device key refused by a controller: the openings of that controller are
  refused unsent for 15 min, then 1 h, 6 h and 24 h; saving another key tries
  again at once. The reads go on, and closing stays possible.
- A controller that asks to wait (HTTP 429 or 5xx) is paused for one minute
  to six hours, even after a restart.
- A controller that does not answer is read again after 30 s, 1, 2 then
  5 min, never sooner than the refresh interval. An answer without a readable
  MAC address counts as a failure, never as another controller.
- After a restart, Gladys waits a whole interval before reading again.

## Limits

- No automatic search: type the addresses.
- One key for every controller.
- No Security+ light or lock (firmware 1.2.x), no openings counter, no
  OpenGarage cloud nor MQTT.
