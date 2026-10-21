// -----------------------------------------------------------------------------
// The pure parts: configuration, /jc parsing, the model, /data sanitizing.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { normalizeConfig, parseAddress, parseAddresses } from '../src/config.js';
import { buildDevice, valuesOf } from '../src/model.js';
import {
  firmwareOf,
  identityOf,
  layoutOf,
  macOf,
  mergeLayout,
  readingOf,
  signalOf,
} from '../src/opengarage/parse.js';
import { emptyData, sanitize } from '../src/store.js';

test('addresses: IPv4 or host names, a pasted URL reduced, credentials and queries refused', () => {
  assert.equal(parseAddress('192.168.1.50'), '192.168.1.50');
  assert.equal(parseAddress('http://192.168.1.50/jc'), '192.168.1.50');
  assert.equal(parseAddress('OG-Garage.local:8080'), 'og-garage.local:8080');
  assert.equal(parseAddress('192.168.1.50:80'), '192.168.1.50');
  for (const bad of ['', 'user:pw@192.168.1.50', '999.1.1.1', 'a b', '1.2.3', 'host:0']) {
    assert.equal(parseAddress(bad), undefined, bad);
  }
  const { valid, invalid } = parseAddresses('192.168.1.50, 192.168.1.50; bad@@x x:99999');
  assert.deepEqual(valid, ['192.168.1.50']);
  assert.ok(invalid.every((entry) => !entry.includes('bad@')));
});

test('a key pasted in an address is never shown in the status', () => {
  const { invalid } = parseAddresses('http://x/cc?dkey=hunter2&click=1:x');
  assert.ok(
    invalid.every((entry) => !entry.includes('hunter2')),
    JSON.stringify(invalid),
  );
});

test('configuration: opening off unless exactly true, the key checked, the interval bounded', () => {
  const base = normalizeConfig({});
  assert.equal(base.allowOpen, false);
  assert.equal(base.key, undefined);
  assert.equal(base.keyProblem, 'missing');
  assert.equal(base.pollInterval, 10);
  for (const value of ['yes', 1, 'TRUE', null]) {
    assert.equal(normalizeConfig({ allow_open: value }).allowOpen, false, String(value));
  }
  assert.equal(normalizeConfig({ allow_open: 'true' }).allowOpen, true);
  assert.equal(normalizeConfig({ device_key: 'a\nb' }).keyProblem, 'invalid');
  assert.equal(normalizeConfig({ device_key: 'opendoor' }).key, 'opendoor');
  assert.equal(normalizeConfig({ poll_interval: 1 }).pollInterval, 5);
  assert.equal(normalizeConfig({ poll_interval: '9999' }).pollInterval, 300);
  assert.equal(normalizeConfig({ poll_interval: '' }).pollInterval, 10);
  assert.equal(normalizeConfig({ __proto__: { allow_open: true } }).allowOpen, false);
});

test('/jc: the MAC identifies, an odd one is unreadable (never another controller)', () => {
  assert.equal(macOf('5C:CF:7F:01:02:03'), '5ccf7f010203');
  assert.equal(macOf('5c-cf-7f-01-02-03'), '5ccf7f010203');
  assert.equal(macOf('5ccf7f010203'), '5ccf7f010203');
  for (const bad of ['', '00:00:00:00:00:00', 'FF:FF:FF:FF:FF:FF', '5C:CF:7F', 42, null]) {
    assert.equal(macOf(bad), undefined, String(bad));
  }
  assert.equal(firmwareOf(124), '1.2.4');
  assert.equal(firmwareOf('x'), '');
  const identity = identityOf({ mac: '5C:CF:7F:01:02:03', name: 'Gar\u0000age\u0085', fwv: 111 });
  assert.deepEqual(identity, { id: '5ccf7f010203', name: 'Garage', firmware: '1.1.1' });
  assert.equal(identityOf(JSON.parse('{"__proto__": {"mac": "5C:CF:7F:01:02:03"}}')).id, undefined);
});

test('/jc: values checked, a missing one is undefined, never 0', () => {
  assert.deepEqual(
    readingOf({ door: 1, dist: 31, vehicle: 2, rssi: -70, temp: '21.5', fwv: 124 }),
    {
      door: 1,
      distance: 31,
      firmware: 124,
      vehicle: 2,
      rssi: -70,
      temperature: 21.5,
      humidity: undefined,
    },
  );
  const empty = readingOf({ door: 5, dist: -1, vehicle: 9, rssi: 12, temp: 'NaN', humid: null });
  assert.ok(
    Object.values(empty).every((v) => v === undefined),
    JSON.stringify(empty),
  );
  assert.deepEqual(readingOf('nope'), readingOf({}));
  // I3: without Security+, a distance the firmware ignores freezes `door`: unknown.
  for (const dist of [0, 501, 600, undefined, 'x']) {
    const reading = readingOf({ door: 1, ...(dist === undefined ? {} : { dist }) });
    assert.equal(reading.door, undefined, `dist ${dist}`);
    assert.equal(reading.distance, undefined, `dist ${dist}`);
  }
  assert.equal(readingOf({ door: 1, dist: 500 }).door, 1);
  assert.equal(readingOf({ door: 1, dist: 0, secv: 1 }).door, 1, 'Security+: door from the opener');
  assert.equal(readingOf({ door: 1, secv: 2 }).door, 1);
  assert.deepEqual(layoutOf({ dist: 10, vehicle: 3, rssi: -60 }), {
    distance: true,
    vehicle: false,
    signal: true,
    temperature: false,
    humidity: false,
  });
  assert.deepEqual(mergeLayout({ temperature: true }, { distance: true }), {
    distance: true,
    vehicle: false,
    signal: false,
    temperature: true,
    humidity: false,
  });
  assert.deepEqual([-40, -55, -65, -70, -80, -90, undefined].map(signalOf), [
    5,
    4,
    3,
    2,
    1,
    0,
    undefined,
  ]);
});

test('model: the door is not closed unless read closed; nothing for an unknown door', () => {
  const record = {
    id: '5ccf7f010203',
    layout: { distance: true, vehicle: true, signal: true },
  };
  const values = (reading) => Object.fromEntries(valuesOf(record, reading));
  assert.deepEqual(values({ door: 0, distance: 230.4, vehicle: 1, rssi: -58 }), {
    door: 1,
    distance: 230,
    vehicle: 1,
    signal: 4,
  });
  for (const door of [1, 2, 3, 4]) {
    assert.equal(values({ door }).door, 0, `door ${door}`);
  }
  assert.deepEqual(values({ door: undefined, vehicle: 2 }), {});
  const gladys = createFakeGladys({ selector: 'opengarage' });
  const device = buildDevice(gladys, { ...record, address: '', name: '' }, { language: 'en' });
  assert.equal(device.name, 'OpenGarage 010203');
  assert.deepEqual(
    device.params.map((p) => p.name),
    ['MAC'],
  );
});

test('/data: checked when read back, bounded, never a key', () => {
  const now = 1_000_000;
  const data = sanitize(
    {
      salt: 'not hex',
      lastTry: now + 99_999,
      devices: {
        '5ccf7f010203': { id: '5ccf7f010203', address: '192.168.1.50', layout: { distance: 1 } },
        __proto__: { id: '__proto__', address: '' },
        '5ccf7f010204': { id: 'other', address: '' },
        '5ccf7f010205': { id: '5ccf7f010205', address: 'http://x' },
      },
      blocks: {
        '192.168.1.50': { kind: 'pause', until: now + 10 ** 12, failures: 3 },
        'bad address!': { kind: 'pause', until: now + 1 },
        '192.168.1.51': { kind: 'auth', until: now + 1 },
      },
      keyBlocks: {
        '5ccf7f010203': { fingerprint: 'a'.repeat(64), until: now + 10 ** 12, failures: 1 },
        '5ccf7f010204': { fingerprint: 'opendoor', until: now + 1 },
      },
      guards: {
        '5ccf7f010203': { from: 0, expect: 1, until: now + 10 ** 12 },
        '5ccf7f010204': { from: 0, expect: 0, until: now + 1 },
      },
    },
    now,
  );
  assert.match(data.salt, /^[0-9a-f]{32}$/);
  assert.equal(data.lastTry, now);
  assert.deepEqual(Object.keys(data.devices), ['5ccf7f010203']);
  assert.equal(data.devices['5ccf7f010203'].layout.distance, true);
  assert.deepEqual(Object.keys(data.blocks), ['192.168.1.50']);
  assert.equal(data.blocks['192.168.1.50'].until, now + 6 * 60 * 60_000);
  assert.deepEqual(Object.keys(data.keyBlocks), ['5ccf7f010203']);
  assert.equal(data.keyBlocks['5ccf7f010203'].until, now + 24 * 60 * 60_000);
  assert.deepEqual(Object.keys(data.guards), ['5ccf7f010203']);
  assert.equal(data.guards['5ccf7f010203'].until, now + 45_000);
  assert.deepEqual(Object.keys(sanitize(null)), Object.keys(emptyData()));
});
