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
      relay (decided on a fresh read, opening off by default, guard after
      each pulse), refused key and pauses persisted, manifest, docs en/fr.
      Tested against fakes and a loopback HTTP server only. The store
      validator was not run by the development agent (it cannot): to run
      from the real terminal.
- [ ] **Milestone 2 — real hardware** (testers with a controller): record
      real `/jc` and `/cc` answers as fixtures, fix what differs. To check
      first:
  - `door` on a classic distance-sensor controller (0/1 only?) and on the
    Security+ firmware (2-5); how long the door stays read "closed" after an
    opening pulse (the guard lasts 45 s);
  - `vehicle` values (2 while the door is open, 3 when detection is off);
  - `temp`/`humid` names and unit (°C?) when a sensor is fitted;
  - the `result` codes of `/cc` (1, 2 for a wrong key, others);
  - whether `open=1` / `close=1` (firmware-side decision on its own sensor,
    no toggle race) exist on the common firmware versions: they would
    replace the click.
- [ ] **Milestone 3 — more**: Security+ light and lock (the lock release
      off by default), openings counter, per-controller keys, mDNS search if
      the firmware announces a service.
- [ ] **Milestone 4 — first release**: Docker image build check, Release
      workflow, topic, then the store validator once the image is published.

## Decisions

- Forum: no dedicated topic, no post from this module's work; one recap per
  wave in /t/10385, posted by the main session.
- Reuse: open-garage (MIT, the library of the Home Assistant integration,
  0.3.1) is Python, so its variables, door states, command and result codes
  are ported, not imported; no runtime dependency besides the SDK. Credited
  in `THIRD_PARTY_NOTICES.md` (copied into the image with `LICENSE`).
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
- Toggle relay (`/cc?dkey=…&click=1`): every pulse is decided on `/jc` read
  just now, after checking the MAC. "Open" only from `door` 0, "Close" only
  from `door` 1; already there: nothing sent (success); 2-5 or missing:
  refused. Opening needs "Allow opening" (off by default), checked on
  arrival, after the read and in `beforeSend`. Closing is always allowed
  (the pulse is only sent to a door read open, so it can only close it),
  never queued, one try during a 429/5xx pause or a refused-key hold, and
  cancels the openings not sent yet (queued ones included). `open=1` /
  `close=1` were not used: not on every firmware; to reconsider at
  milestone 2.
- Guard (lessons of wave 2 and 3): set AFTER a pulse that may have left
  (accepted, or no answer), with its start and expected state, persisted in
  `/data` at once; any pulse is refused until a read shows the expected
  state (never an unknown, moving, stopped or equal-to-start state) or 45 s.
  One pulse in flight per controller; a command arriving while another pulse
  is in flight is refused (the state read then cannot show it).
- Success of a command = the controller answered `result` 1 (the pulse was
  accepted): the door then moves for 10-30 s, longer than the 5 s ack, so it
  cannot be confirmed by a read in the ack; reads follow at 5, 15, 30, 50 s.
- Deadlines: sent within 3.5 s of the click or refused unsent; answered by
  4.3 s; a request that may have left is "sent, without confirmation";
  never retried. The ack never waits for a publication.
- Device key: one secret for every controller ("Ce champ est gardé par
  Gladys dans sa base, jamais réaffiché"), sent only in the `/cc` query
  string (plain HTTP on the LAN), never in a log, status, error or `/data`.
  `result` 2 = key refused: a hold of the openings of that controller with
  that key (15 min, 1 h, 6 h, then 24 h), keyed by an HMAC of the refused key
  with a random salt of `/data`, removed at the first success; another key
  is tried at once; reads (no key) and closing are never held.
- Reads never sooner than the interval: one `/jc` per typed address when
  due (per-address next time); `connected`, a configuration saved again, the
  scan and the "Check" action only read due addresses; a reconnection during
  a read shares it; after a restart, if `/data` `lastTry` (written at most
  once a minute) is within interval + 1 min, a whole interval is waited.
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
