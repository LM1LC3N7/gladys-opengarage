// -----------------------------------------------------------------------------
// Fixed values: manifest keys (frozen: users store them in their scenes and
// configuration), the Gladys core value enums the SDK does not export, limits
// and timings.
// -----------------------------------------------------------------------------

/** The external id type: `gladys.externalIds('opengarage', <MAC>)`. Frozen. */
export const EXTERNAL_ID_TYPE = 'opengarage';

/** Manifest `actions` keys. */
export const ACTIONS = {
  CHECK: 'check_controllers',
};

// Gladys core enums (server/utils/constants.js), not exported by the SDK.
export const OPENING_SENSOR_STATE = { OPEN: 0, CLOSE: 1 };
export const BUTTON_PUSH = { PRESSED: 1 };

/**
 * `door` of /jc (OpenGarage firmware; the intermediate values come with the
 * Security+ firmware 1.2.x, as open-garage normalizes them).
 */
export const DOOR = { CLOSED: 0, OPEN: 1, STOPPED: 2, CLOSING: 3, OPENING: 4, UNKNOWN: 5 };

/** `vehicle` of /jc: 0 absent, 1 present, 2 unknown (door open), 3 detection disabled. */
export const VEHICLE = { ABSENT: 0, PRESENT: 1, UNKNOWN: 2, DISABLED: 3 };

/**
 * From this firmware (`fwv` 107 = 1.0.7, release notes: "explicit open and
 * close options") /cc takes `close=1` and `open=1`: the controller only
 * pulses when its own sensor reads the door in the matching state (and on
 * Security+ 2.0 they are directional). Older ones only have `click=1`.
 */
export const TOGGLE_FREE_FIRMWARE = 107;

/**
 * Without Security+, the controller ignores a distance of 0 or above this
 * (cm) and keeps its last `door`: the door is then unknown.
 */
export const DISTANCE_VALID_MAX = 500;

/** `result` of /cc (OpenGarage firmware HTML_* codes). */
export const RESULT = { SUCCESS: 1, UNAUTHORIZED: 2, MISMATCH: 3 };

export const LIMITS = {
  /** Gladys accepts 300 states per minute: keep a margin. */
  statesPerMinute: 250,
  /** Controllers handled (each one is polled over HTTP). */
  addresses: 20,
  /** Body of a controller answer (/jc is a few hundred bytes). */
  responseBytes: 16 * 1024,
};

export const TIMINGS = {
  /** One HTTP request of the polling. */
  requestTimeout: 5000,
  /** The pending states are sent at this pace. */
  flushInterval: 1000,
  /** Measurements (distance, signal, temperature) of a feature are spaced by this much. */
  measureInterval: 60_000,
  /** An unchanged value is re-sent this often, so it stays recently dated in Gladys. */
  stateHeartbeat: 30 * 60_000,
  /** Saving /data waits this long for more changes. */
  persistDelay: 1000,
  /** The time of the last read is written to /data at most this often. */
  lastTrySave: 60_000,
  /**
   * A command leaves within this many ms of its arrival, or is refused
   * unsent: Gladys gives up waiting for the ack after 5 s.
   */
  commandSendBy: 3500,
  /** The ack is given by then: past it, "sent, without confirmation". */
  commandAnswerBy: 4300,
  /** Reads after a command (a garage door moves for 10 to 30 s). */
  followUps: [5000, 15_000, 30_000, 50_000],
  /**
   * After a pulse that may have left, no other pulse until the door is read
   * in the state the pulse aimed at, or this long after it: a second pulse
   * would stop or reverse a moving door.
   */
  doorGuard: 45_000,
  /**
   * The expected state lifts the guard only this long after the pulse: a
   * distance sensor sees it before the end of travel (the panel leaves the
   * sensor half way down, reaches it before the top stop), and the
   * controller's own alarm may delay the relay by 5 to 10 s.
   */
  doorGuardMin: 15_000,
  /** Transient failures: the next reads, never sooner than the interval. */
  backoff: [30_000, 60_000, 120_000, 300_000],
  /** Device key refused: the next openings allowed after these, then every 24 h. */
  keyRetries: [15 * 60_000, 60 * 60_000, 6 * 60 * 60_000, 24 * 60 * 60_000],
  /** HTTP 429 or 5xx: a pause within these bounds. */
  pauseMin: 60_000,
  pauseMax: 6 * 60 * 60_000,
};

/** Configuration bounds (mirrored by the manifest). */
export const POLL_INTERVAL = { default: 10, min: 5, max: 300 };
