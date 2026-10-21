# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

### Added

- OpenGarage controllers over their local HTTP API, without the cloud: added
  by IP address, identified by their MAC at every read (a new address changes
  nothing).
- The garage door (open or closed), the distance sensor, the vehicle
  detection, the Wi-Fi signal, and the temperature and humidity when a sensor
  is fitted.
- Open and Close buttons, never a switch. The relay is a toggle, so every
  pulse is decided on the door read just now: "Open" only to a closed door,
  "Close" only to an open one; moving, stopped or unknown is refused.
  Opening is off by default; closing is always allowed, never queued, one try
  during a pause, and cancels a pending opening. After a pulse, another one
  waits until the door is read where it was sent (45 s at most, kept across a
  restart).
- Commands sent within 3.5 s or refused unsent, "sent, without confirmation"
  when no answer came back.
- Device key refused: openings held (15 min, 1 h, 6 h, then every 24 h),
  reads and closing go on; another key is tried at once. The key is never
  logged nor stored.
- Never read sooner than the refresh interval, after a restart included;
  HTTP 429 or 5xx: a pause of 1 min to 6 h; other failures: 30 s to 5 min.
- "Check the controllers" action; reachability on the transport badge; states
  within the Gladys rate limit, measurements spaced by a minute.
