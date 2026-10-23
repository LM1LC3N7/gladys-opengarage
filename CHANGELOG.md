# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

## [0.1.3] - 2026-10-23

## [0.1.2] - 2026-10-22

### Fixed

- A command refused because it waited too long in the queue no longer lets
  a later command run beside an earlier one still in progress: commands to a
  controller stay one at a time, in order.
- If the system clock goes back, the guard after a pulse is brought back to
  the current time: a refusal never lasts longer than planned.

## [0.1.1] - 2026-10-21

### Added

- OpenGarage controllers over their local HTTP API, without the cloud: added
  by IP address, identified by their MAC at every read (a new address changes
  nothing).
- The garage door (open or closed), the distance sensor, the vehicle
  detection, the Wi-Fi signal, and the temperature and humidity when a sensor
  is fitted.
- Open and Close buttons, never a switch. The relay is a toggle, so every
  pulse is decided on the door read just now: "Open" only to a closed door,
  "Close" only to an open one; moving, stopped or unknown is refused. Closing
  is the same pulse as opening, so both are off by default ("Allow the garage
  door pulses (open and close)"); one queue per controller, a close cancels
  a pending opening. From firmware 1.0.7, `close=1` / `open=1` let the
  controller check the door again on its own sensor; `click=1` before.
- Without Security+, a distance the controller rejects (0, above 500 cm, or
  none) makes the door unknown: nothing published, both buttons refused.
- After a pulse, another one waits until a read sent after it shows the door
  where it was sent, at least 15 s and at most 45 s after it. The guard is
  set and saved before the first byte leaves, so a restart keeps it.
- Commands sent within 3.5 s or refused unsent, "sent, without confirmation"
  when no answer came back.
- Device key refused: pulses held (15 min, 1 h, 6 h, then every 24 h), reads
  go on; another key is tried at once. The key is never logged nor stored, and
  a key that works on any controller is never fingerprinted in `/data`.
- Never read sooner than the refresh interval, after a restart included (the
  status then shows the outcome of the last read); HTTP 429 or 5xx: a pause
  of 1 min to 6 h; other failures: 30 s to 5 min.
- "Check the controllers" action; reachability on the transport badge; states
  within the Gladys rate limit, measurements spaced by a minute.

[Unreleased]: https://github.com/LM1LC3N7/gladys-opengarage/compare/v0.1.3...HEAD
[0.1.3]: https://github.com/LM1LC3N7/gladys-opengarage/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/LM1LC3N7/gladys-opengarage/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/LM1LC3N7/gladys-opengarage/releases/tag/v0.1.1
