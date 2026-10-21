// -----------------------------------------------------------------------------
// The local HTTP API of an OpenGarage controller (plain HTTP, no cloud), after
// the firmware API documentation and open-garage (MIT, the library of the
// Home Assistant integration):
//   GET /jc                        the controller variables (no key needed)
//   GET /cc?dkey=<key>&click=1     one pulse of the door relay, a TOGGLE:
//                                  it opens a closed door, closes an open one,
//                                  and stops or reverses a moving one
//   GET /cc?dkey=<key>&close=1     from firmware 1.0.7: a pulse only if the
//   GET /cc?dkey=<key>&open=1      controller itself reads the door open
//                                  (or stopped) / closed (or closing)
// answered with JSON ({"result":1} for a command accepted). Every answer is
// size-capped and parsed once. The device key travels in the query string:
// the path is never logged nor put in an error.
// -----------------------------------------------------------------------------

import { LIMITS, TIMINGS } from '../constants.js';
import { splitAddress } from '../config.js';
import { OpenGarageError } from './errors.js';
import { httpRequest } from './http.js';

/** Retry-After in ms (seconds or an HTTP date), or undefined. */
export function retryAfterOf(header, now = Date.now()) {
  const value = Array.isArray(header) ? header[0] : header;
  if (typeof value !== 'string' || value.length > 64) {
    return undefined;
  }
  if (/^\s*\d{1,9}\s*$/.test(value)) {
    return Number(value) * 1000;
  }
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - now) : undefined;
}

const COMMANDS = new Set(['click', 'open', 'close']);

/** The path of one command (`click`, `open`, `close`), the key encoded (never logged). */
export function commandPath(key, command = 'click') {
  if (!COMMANDS.has(command)) {
    throw new OpenGarageError('invalid');
  }
  return `/cc?dkey=${encodeURIComponent(key)}&${command}=1`;
}

export const clickPath = (key) => commandPath(key, 'click');

export class OpenGarageClient {
  constructor({ request = httpRequest, timeout = TIMINGS.requestTimeout, now = Date.now } = {}) {
    this.request = request;
    this.timeout = timeout;
    this.now = now;
  }

  /**
   * One exchange. `address` is host[:port].
   * @param {object} [options]
   * @param {number} [options.timeout] ms for the whole exchange
   * @param {number} [options.sendWithin] ms to start, else not sent ('late')
   * @param {() => void} [options.beforeSend]
   * @returns {Promise<object>} the JSON object answered
   */
  async get(address, path, { timeout, sendWithin, beforeSend } = {}) {
    const { host, port } = splitAddress(address);
    const answer = await this.request({
      host,
      port,
      path,
      timeout: timeout ?? this.timeout,
      sendWithin,
      maxBytes: LIMITS.responseBytes,
      beforeSend,
    });
    const { status } = answer;
    if (status === 429 || (status >= 500 && status <= 599)) {
      throw new OpenGarageError('busy', {
        status,
        sent: true,
        retryAfter: retryAfterOf(answer.headers?.['retry-after'], this.now()),
      });
    }
    if (status < 200 || status > 299) {
      throw new OpenGarageError('http', { status, sent: true });
    }
    let parsed;
    try {
      parsed = JSON.parse(answer.body.toString('utf8'));
    } catch {
      throw new OpenGarageError('invalid', { sent: true });
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new OpenGarageError('invalid', { sent: true });
    }
    return parsed;
  }

  /** The controller variables. */
  variables(address, options) {
    return this.get(address, '/jc', options);
  }

  /**
   * One command (`click`, `open`, `close`). Resolves the `result` code of
   * the controller (1: received, it answers BEFORE acting; 2: device key
   * refused...); rejects 'invalid' (sent) when it gives none.
   */
  async command(address, key, command, options) {
    const answer = await this.get(address, commandPath(key, command), options);
    const result = Object.hasOwn(answer, 'result') ? answer.result : undefined;
    if (!Number.isInteger(result)) {
      throw new OpenGarageError('invalid', { sent: true });
    }
    return result;
  }

  /** One toggle pulse. */
  click(address, key, options) {
    return this.command(address, key, 'click', options);
  }
}
