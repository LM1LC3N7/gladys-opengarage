// -----------------------------------------------------------------------------
// Fake OpenGarage controllers behind the `request` of OpenGarageClient
// (src/opengarage/http.js replaced): /jc answers shaped like the firmware's,
// /cc click toggling the door, a log of every call, and hooks to make a
// request slow, fail or answer late. No network.
// -----------------------------------------------------------------------------

import { OpenGarageError } from '../../src/opengarage/errors.js';

export const KEY = 'secret key&1';
export const MACS = {
  a: '5ccf7f000001',
  b: '5ccf7f000002',
};
const colons = (mac) => mac.match(/../g).join(':').toUpperCase();

/** The state of each fake controller, changed by its commands. */
export function controllers() {
  const make = (mac, name, extra = {}) => ({
    jc: {
      dist: 230,
      door: 0,
      vehicle: 1,
      rcnt: 12,
      fwv: 124,
      name,
      mac: colons(mac),
      cid: 1234,
      rssi: -58,
      ...extra,
    },
    key: KEY,
  });
  return {
    '192.168.1.50': make(MACS.a, 'Garage'),
    '192.168.1.51': make(MACS.b, 'Barn', { temp: 12.5, humid: 61 }),
  };
}

/**
 * The `request` of OpenGarageClient over the fake controllers.
 * - `hold(address, prefix)`: the next request to it waits for `release()`;
 * - `freeze(address, '/jc')`: the next read answers, on release, the state
 *   it had when it left (a late answer);
 * - `fail(address, prefix, error | { status, headers, body })`: the next one fails;
 *   `{ before: true }`: before the connection (nothing sent).
 * A click toggles `door` (0 <-> 1) unless `moves` is false.
 */
export function fakeNetwork(table = controllers()) {
  const calls = [];
  const holds = [];
  const failures = [];
  const matches = (entry, address, path) =>
    entry.address === address && path.startsWith(entry.prefix) && !entry.used;
  const request = async (options) => {
    const { host, port, path, beforeSend } = options;
    const address = port === 80 ? host : `${host}:${port}`;
    const hold = holds.find((h) => matches(h, address, path));
    if (hold) {
      hold.used = true;
      if (hold.snapshot && path === '/jc') {
        // A late answer: the state when the request LEFT, delivered on release.
        const snapshot = structuredClone(table[address].jc);
        calls.push({ address, path });
        await hold.promise;
        return { status: 200, headers: {}, body: Buffer.from(JSON.stringify(snapshot)) };
      }
      await hold.promise;
    }
    const device = table[address];
    if (!device) {
      throw new OpenGarageError('unreachable');
    }
    const early = failures.find((f) => matches(f, address, path) && f.before);
    if (early) {
      early.used = true;
      throw early.error;
    }
    if (beforeSend) {
      try {
        beforeSend();
      } catch (err) {
        err.beforeSend = true;
        err.sent = false;
        throw err;
      }
    }
    calls.push({ address, path });
    const failure = failures.find((f) => matches(f, address, path) && !f.before);
    if (failure) {
      failure.used = true;
      if (failure.error) {
        throw failure.error;
      }
      return {
        status: failure.status ?? 200,
        headers: failure.headers ?? {},
        body: Buffer.from(failure.body ?? ''),
      };
    }
    const json = (value) => ({
      status: 200,
      headers: {},
      body: Buffer.from(JSON.stringify(value)),
    });
    if (path === '/jc') {
      return json(device.jc);
    }
    const url = new URL(path, 'http://x');
    if (url.pathname === '/cc') {
      if (url.searchParams.get('dkey') !== device.key) {
        return json({ result: 2 });
      }
      const toggle = () => {
        if (device.moves !== false) {
          device.jc.door = device.jc.door === 0 ? 1 : 0;
        }
      };
      if (url.searchParams.get('click') === '1') {
        toggle();
        return json({ result: 1 });
      }
      // From 1.0.7: the controller answers first, then pulses only if ITS
      // reading matches (close: open or stopped; open: closed or closing).
      const direct = device.jc.fwv >= 107;
      if (direct && url.searchParams.get('close') === '1') {
        if (device.jc.door === 1 || device.jc.door === 2) toggle();
        return json({ result: 1 });
      }
      if (direct && url.searchParams.get('open') === '1') {
        if (device.jc.door === 0 || device.jc.door === 3) toggle();
        return json({ result: 1 });
      }
      return json({ result: 16 });
    }
    return { status: 404, headers: {}, body: Buffer.from('not found') };
  };
  return {
    request,
    calls,
    table,
    hold(address, prefix) {
      let release;
      const promise = new Promise((resolve) => {
        release = resolve;
      });
      holds.push({ address, prefix, promise });
      return release;
    },
    /** The next /jc answers the state of its departure, on release. */
    freeze(address, prefix) {
      let release;
      const promise = new Promise((resolve) => {
        release = resolve;
      });
      holds.push({ address, prefix, promise, snapshot: true });
      return release;
    },
    fail(address, prefix, failure, { before = false } = {}) {
      failures.push({
        address,
        prefix,
        before,
        ...(failure instanceof Error ? { error: failure } : failure),
      });
    },
    clicks: () => calls.filter((c) => c.path.startsWith('/cc')),
    reads: () => calls.filter((c) => c.path === '/jc'),
  };
}
