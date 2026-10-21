// -----------------------------------------------------------------------------
// /jc answers -> identity, layout and reading (pure). After open-garage
// (state.py) and the firmware: `mac` identifies the controller, `door` is
// 0 closed / 1 open (2 stopped, 3 closing, 4 opening, 5 unknown with the
// Security+ firmware), `dist` the distance sensor in cm, `vehicle` 0 absent /
// 1 present / 2 unknown / 3 disabled, `rssi` the Wi-Fi signal in dBm, `temp`
// and `humid` when a sensor is fitted. Own properties only, every number
// checked: a missing or odd value is undefined, never 0.
// -----------------------------------------------------------------------------

import { cleanText } from '../config.js';
import { DISTANCE_VALID_MAX, DOOR, VEHICLE } from '../constants.js';

const own = (data, key) =>
  data !== null && typeof data === 'object' && Object.hasOwn(data, key) ? data[key] : undefined;

/** A finite number (or its exact text) within bounds, else undefined. */
export function boundedNumber(value, min, max) {
  let number;
  if (typeof value === 'number') {
    number = value;
  } else if (typeof value === 'string' && /^\s*-?\d{1,6}(\.\d{1,6})?\s*$/.test(value)) {
    number = Number(value);
  } else {
    return undefined;
  }
  return Number.isFinite(number) && number >= min && number <= max ? number : undefined;
}

const integer = (value, min, max) => {
  const number = boundedNumber(value, min, max);
  return Number.isInteger(number) ? number : undefined;
};

/** "5C:CF:7F:01:02:03" -> "5ccf7f010203"; anything else undefined. */
export function macOf(value) {
  if (typeof value !== 'string' || value.length > 32) {
    return undefined;
  }
  const match =
    /^([0-9a-f]{2})[:-]?([0-9a-f]{2})[:-]?([0-9a-f]{2})[:-]?([0-9a-f]{2})[:-]?([0-9a-f]{2})[:-]?([0-9a-f]{2})$/i.exec(
      value.trim(),
    );
  if (!match) {
    return undefined;
  }
  const mac = match.slice(1).join('').toLowerCase();
  // An unset or broadcast address identifies nothing.
  return mac === '000000000000' || mac === 'ffffffffffff' ? undefined : mac;
}

/** The firmware version: 124 -> "1.2.4". */
export function firmwareOf(value) {
  const number = integer(value, 1, 9999);
  if (number === undefined) {
    return '';
  }
  const text = String(number);
  return text.length >= 3 ? text.split('').join('.') : text;
}

/**
 * The identity of a controller: `{ id, name, firmware }`, `id` undefined
 * when the answer does not say it (unreadable: never "another controller").
 */
export function identityOf(data) {
  return {
    id: macOf(own(data, 'mac')),
    name: cleanText(own(data, 'name'), 64),
    firmware: firmwareOf(own(data, 'fwv')),
  };
}

/** The optional features a controller has (a created feature is kept by the app). */
export function layoutOf(data) {
  const vehicle = integer(own(data, 'vehicle'), 0, 3);
  return {
    distance: boundedNumber(own(data, 'dist'), 0, 2000) !== undefined,
    vehicle: vehicle !== undefined && vehicle !== VEHICLE.DISABLED,
    signal: integer(own(data, 'rssi'), -127, 0) !== undefined,
    temperature: boundedNumber(own(data, 'temp'), -40, 85) !== undefined,
    humidity: boundedNumber(own(data, 'humid'), 0, 100) !== undefined,
  };
}

/** A layout never loses a feature: once seen, kept. */
export function mergeLayout(previous = {}, next = {}) {
  const out = {};
  for (const key of ['distance', 'vehicle', 'signal', 'temperature', 'humidity']) {
    out[key] = Boolean(previous[key] || next[key]);
  }
  return out;
}

/**
 * The values of an answer: `{ door, distance, vehicle, rssi, temperature,
 * humidity, firmware }`, each undefined when missing or out of range.
 *
 * Without Security+ (`secv` missing or 0), the door comes from the distance
 * sensor, and the firmware (check_status) leaves `door` at its last value
 * when the distance is invalid (0, a sensor timeout, or above 500 cm) while
 * `/jc` still gives that `dist`: the door is then unknown (never published,
 * every pulse refused). A missing `dist` says nothing of the door either.
 */
export function readingOf(data) {
  const raw = integer(own(data, 'door'), 0, 5);
  const security = integer(own(data, 'secv'), 0, 255);
  const dist = boundedNumber(own(data, 'dist'), 0, 2000);
  const validDistance = dist !== undefined && dist > 0 && dist <= DISTANCE_VALID_MAX;
  let door = raw === undefined || raw === DOOR.UNKNOWN ? undefined : raw;
  if (!(security >= 1) && !validDistance) {
    door = undefined;
  }
  return {
    door,
    distance: validDistance ? dist : undefined,
    firmware: integer(own(data, 'fwv'), 1, 9999),
    vehicle: integer(own(data, 'vehicle'), 0, 3),
    rssi: integer(own(data, 'rssi'), -127, 0),
    temperature: boundedNumber(own(data, 'temp'), -40, 85),
    humidity: boundedNumber(own(data, 'humid'), 0, 100),
  };
}

/** dBm -> the 0-5 scale of the Gladys `signal` category. */
export function signalOf(rssi) {
  if (rssi === undefined) {
    return undefined;
  }
  if (rssi >= -50) return 5;
  if (rssi >= -60) return 4;
  if (rssi >= -67) return 3;
  if (rssi >= -75) return 2;
  if (rssi >= -85) return 1;
  return 0;
}
