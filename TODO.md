# TODO — OpenGarage v1

Handoff document: what is done, what was decided, what comes next. Keep it
up to date at the end of every milestone.

## Working method

- One milestone at a time, one commit per milestone, tests green before moving on.
- After each milestone: `npm run format:check`, `npm run lint`, `npm test`
  (Node 22 and 24), `npm audit --omit=dev`,
  `npx github:GladysAssistant/integration-store .`, then update README,
  `docs/en.md`, `docs/fr.md`, `CHANGELOG.md` and this file.
- The `gladys-assistant-integration` topic is added at the first real release
  only.

## Status

- [x] **Milestone 1 — local API** (2026-10-21): typed addresses, `/jc`
      polling, identity by MAC at every read, door, distance, vehicle,
      signal, temperature and humidity, Open and Close buttons on the toggle
      relay (decided on a fresh read, off by default, guard after each
      pulse), refused key and pauses persisted, manifest, docs en/fr.
      Tested against fakes and a loopback HTTP server only. The store
      validator was not run by the development agent (it cannot): to run
      from the real terminal.
- [x] **Review 1 fixes** (2026-10-21): I1-I6, M1, M2 (M3 gone with I1), see
      the Decisions.
- [ ] **Milestone 2 — real hardware** (testers with a controller): record
      real `/jc` and `/cc` answers as fixtures, fix what differs. To check
      first:
  - `door` on a classic distance-sensor controller (0/1 only?) and on the
    Security+ firmware (2-5); how long the door stays read "closed" after an
    opening pulse (the guard: 15 s minimum, 45 s maximum);
  - `vehicle` values (2 while the door is open, 3 when detection is off);
  - `temp`/`humid` names and unit (°C?) when a sensor is fitted;
  - the `result` codes of `/cc` (1, 2 for a wrong key, others), and what
    `close=1` / `open=1` answer when the controller does nothing;
  - `secv` on Security+ 1.0 and 2.0 controllers.
- [ ] **Milestone 3 — more**: Security+ light and lock (the lock release
      off by default), openings counter, per-controller keys, mDNS search if
      the firmware announces a service. Possible exception to the "close
      needs the permission" rule on Security+ 2.0 only, where `close=1` is a
      directional command that can never open (review 1 note): not done,
      to decide with Louis.
- [ ] **Milestone 4 — first release**: Docker image build check, Release
      workflow, topic, then the store validator once the image is published.

## Decisions

- Forum: no dedicated topic, no post from this module's work; one recap per
  wave in /t/10385, posted by the main session.
- Reuse: open-garage (MIT, the library of the Home Assistant integration,
  0.3.1) is Python, so its variables, door states, command and result codes
  are ported, not imported; no runtime dependency besides the SDK. Credited
  in `THIRD_PARTY_NOTICES.md` (copied into the image with `LICENSE`). The
  OpenGarage firmware (GPL-3.0) was only read by the reviewer for its
  documented behaviour; nothing of it is ported.
- Version 0.1.0 in `package.json`, `package-lock.json`, the manifest and the
  `docker_image` tag, set by hand at milestone 1 (the template's 1.0.0 was
  someone else's). The first release (patch) gives 0.1.1; every later
  version comes from the Release workflow.
- External ids: `gladys.externalIds('opengarage', mac)`, `mac` the 12
  lower-case hex digits of `/jc` `mac`. Feature keys are frozen: `door`,
  `open`, `close`, `distance`, `vehicle`, `signal`, `temperature`,
  `humidity`. A created feature is never removed (`publishDevices` keeps
  it); a layout flag, once seen, stays.
- Door: an `opening-sensor`/`binary` (closed only for `door` 0; open for
  1-4; nothing published for 5 or a missing value). Never a `switch` nor a
  commandable `binary`: two `button`/`push` features.
- Review 1 (I3): without Security+ (`secv` missing or 0), the firmware
  (check_status) keeps its last `door` when the distance is invalid (0, or
  above 500 cm) while `/jc` still gives that `dist`: such a reading (or one
  without `dist`) makes the door unknown (not published, both pulses
  refused) and the distance unpublished. "Sensor 2 only" cannot be read from
  `/jc`: refused, documented as a limit.
- Pulses: every pulse is decided on `/jc` read just now, after checking the
  MAC. "Open" only from `door` 0, "Close" only from `door` 1; already there:
  nothing sent (success); 2-5 or unknown: refused.
  - Review 1 decision I1 (coordinator, lot12_decision_toggle, as the
    step-by-step gateBox of gladys-blebox): closing is the same pulse as
    opening (a door closed by the remote between the read and the pulse
    would open), so BOTH need `allow_open` ("Allow the garage door pulses
    (open and close)", key unchanged), checked on arrival, after the read
    and in `beforeSend`; both go through the per-controller queue; a close
    cancels, on arrival, the openings not sent yet (queued ones included);
    a 429/5xx pause and a refused-key hold refuse both. Kept with `close=1`
    too (see the Security+ 2.0 note in milestone 3).
  - Review 1 (I2): `fwv` >= 107 (1.0.7, "explicit open and close options"):
    `close=1` / `open=1`, the controller checks the door again on its own
    sensor when the request arrives (it only acts on open or stopped /
    closed or closing; directional on Security+ 2.0); `fwv` missing or
    below: `click=1`, the same rules. Up to ~3.3 s may pass between the read
    and the pulse (documented).
- Guard (lessons of wave 2 and 3, review 1 I4, I6, M1): set in `beforeSend`
  (before the first byte, saved at once: a restart while the pulse is out
  keeps it) with its start state, expected state, `at` (when the pulse left,
  kept in `/data`) and a request number (memory only); removed only when the
  controller surely did nothing (`result` != 1, an HTTP 4xx, not sent). Any
  pulse is refused until a read whose request left AFTER the pulse (request
  numbers; after a restart, `at`) shows the expected state at least 15 s
  after the pulse (a distance sensor sees it before the end of travel; the
  controller alarm may delay the relay 5-10 s), or 45 s; never lifted on an
  unknown, moving, stopped or equal-to-start state. One pulse in flight per
  controller.
- Success of a command = the controller answered `result` 1: it answers
  BEFORE acting (and up to 10 s before the relay with its alarm on), so the
  door then moves for 10-40 s, longer than the 5 s ack; reads follow at 5,
  15, 30, 50 s. The controller's own automatic close is the same pulse:
  documented (no Gladys scene at the same time).
- Deadlines: sent within 3.5 s of the click or refused unsent; answered by
  4.3 s; a request that may have left is "sent, without confirmation";
  never retried. The ack never waits for a publication.
- Device key: one secret for every controller ("Ce champ est gardé par
  Gladys dans sa base, jamais réaffiché"), sent only in the `/cc` query
  string (plain HTTP on the LAN), never in a log, status, error or `/data`.
  `result` 2 = key refused: a hold of the pulses of that controller with
  that key (15 min, 1 h, 6 h, then 24 h), keyed by an HMAC of the refused key
  with a random salt of `/data`; another key is tried at once; reads (no
  key) are never held. Review 1 (M2): at any success of a key, every
  persisted hold with its fingerprint leaves `/data` (kept in memory), and a
  key that worked on a controller since the start is only ever held in
  memory: never a fingerprint of a working key in `/data`.

- Reads never sooner than the interval: one `/jc` per typed address when
  due (per-address next time); `connected`, a configuration saved again, the
  scan and the "Check" action only read due addresses; a reconnection during
  a read shares it; after a restart, if `/data` `lastTry` (written at most
  once a minute) is within interval + 1 min, a whole interval is waited;
  review 1 (I5): meanwhile the status counts an address whose last read
  kept in `/data` (`lastReads`: ok + MAC, saved with the once-a-minute write
  or at once when it changes) succeeded as answering, so a restart never
  shows the integration disconnected for a whole interval.
  Failures: 30 s, 1, 2, 5 min (never sooner than the interval); 429/5xx: a
  pause of 1 min to 6 h (Retry-After, else doubling), persisted and capped
  when read back. A change of addresses or key starts a new generation: a
  read or command of the previous one publishes nothing and sets no status.
- Identity: an answer without a readable MAC is a failed read ("not an
  OpenGarage controller" in the status), never another controller. Another
  MAC at a record's address moves the record off it (until seen elsewhere);
  the same MAC at two typed addresses: only its own address is used.
- After a restart, the controllers come from `/data`: a door can be closed
  before the first poll (the command reads `/jc` itself).
- Units: `cm` (distance-sensor), `celsius`, `percent`; none on the signal
  (0-5 scale of the core `signal` category, mapped from dBm: -50, -60, -67,
  -75, -85) nor on the binaries and buttons.
- Answers: 16 KB at most, parsed once with `JSON.parse`, own properties only
  (`Object.hasOwn`), every number bounded; texts stripped of control
  characters and cut.
- Polling 5 s to 300 s (default 10 s); the timer looks every 5 s at most
  and reads only the due addresses.
