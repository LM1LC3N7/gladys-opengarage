// -----------------------------------------------------------------------------
// OpenGarageApp with the SDK's fake Gladys, the exact handlers of the
// container (src/handlers.js), fake controllers behind the client's
// `request`, a memory store and a hand-driven clock. No network, no timers
// running.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { OpenGarageApp } from '../src/app.js';
import { OpenGarageClient } from '../src/opengarage/client.js';
import { OpenGarageError } from '../src/opengarage/errors.js';
import { registerHandlers } from '../src/handlers.js';
import { MemoryStore, emptyData } from '../src/store.js';
import { KEY, MACS, fakeNetwork } from './helpers/fakeOpenGarage.js';

const SELECTOR = 'opengarage';
const A = '192.168.1.50';
const B = '192.168.1.51';
const id = (mac, key) => `ext:${SELECTOR}:opengarage:${mac}${key ? `:${key}` : ''}`;

/** Timers that never fire: the tests drive the polling and the flushes. */
const timers = {
  setInterval: () => 1,
  clearInterval: () => {},
  setTimeout: () => 1,
  clearTimeout: () => {},
};

function clock(start = 1_800_000_000_000) {
  let current = start;
  const now = () => current;
  now.advance = (ms) => {
    current += ms;
  };
  return now;
}

async function setup(
  t,
  {
    config = {},
    net = fakeNetwork(),
    store = new MemoryStore(),
    devices = [],
    now = clock(),
    appTimers = timers,
  } = {},
) {
  const fullConfig = { addresses: `${A}, ${B}`, device_key: KEY, ...config };
  const gladys = createFakeGladys({ selector: SELECTOR, config: fullConfig, devices });
  const logs = [];
  const logger = Object.fromEntries(
    ['debug', 'info', 'warn', 'error'].map((level) => [
      level,
      (...args) => logs.push(`${level} ${args.map((a) => a?.message ?? a).join(' ')}`),
    ]),
  );
  const app = new OpenGarageApp({
    gladys,
    logger,
    client: new OpenGarageClient({ request: net.request, now }),
    store,
    timers: appTimers,
    now,
  });
  registerHandlers(gladys, app, logger);
  await gladys.connect();
  t.after(() => app.stop());
  return { gladys, app, net, logs, store, now, config: fullConfig };
}

async function createAll(gladys) {
  for (const device of gladys.fake.discoveredDevices) {
    await gladys.fake.deviceCreated(device);
  }
}

const deviceOf = (gladys, mac) =>
  gladys.fake.discoveredDevices.find((d) => d.external_id === id(mac));
const featureOf = (device, key) => device.features.find((f) => f.external_id.endsWith(`:${key}`));

async function press(gladys, mac, key, value = 1) {
  const device = deviceOf(gladys, mac);
  return gladys.fake.setValue(device, featureOf(device, key), value);
}

const tick = (ms = 10) => new Promise((resolve) => setTimeout(resolve, ms));

test('the typed addresses become the devices of the Discovery tab, by MAC', async (t) => {
  const { gladys } = await setup(t);
  const devices = gladys.fake.discoveredDevices;
  assert.deepEqual(devices.map((d) => d.name).sort(), ['Barn', 'Garage']);
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.match(gladys.fake.connectionStatus.message.en, /2 of 2 OpenGarage controller/);
  assert.match(gladys.fake.connectionStatus.message.fr, /2 contrôleur\(s\) OpenGarage sur 2/);
  const barn = deviceOf(gladys, MACS.b);
  assert.deepEqual(
    barn.features.map((f) => [f.external_id.split(':').at(-1), f.category, f.type, f.unit]),
    [
      ['door', 'opening-sensor', 'binary', undefined],
      ['open', 'button', 'push', undefined],
      ['close', 'button', 'push', undefined],
      ['distance', 'distance-sensor', 'integer', 'cm'],
      ['vehicle', 'presence-sensor', 'binary', undefined],
      ['signal', 'signal', 'integer', undefined],
      ['temperature', 'temperature-sensor', 'decimal', 'celsius'],
      ['humidity', 'humidity-sensor', 'decimal', 'percent'],
    ],
  );
  assert.deepEqual(barn.params.find((p) => p.name === 'MAC').value, MACS.b);
});

test('a garage door is never a switch nor a commandable binary', async (t) => {
  const { gladys } = await setup(t);
  for (const device of gladys.fake.discoveredDevices) {
    for (const feature of device.features) {
      assert.notEqual(feature.category, 'switch', feature.external_id);
      assert.ok(feature.read_only || feature.type === 'push', feature.external_id);
    }
  }
});

test('states: only for the created devices, the last values when created', async (t) => {
  const { gladys, app } = await setup(t);
  await app.publisher.flush();
  assert.equal(gladys.fake.states.length, 0);
  await createAll(gladys);
  await app.publisher.flush();
  const last = (mac, key) => gladys.fake.lastState(id(mac, key));
  assert.equal(last(MACS.a, 'door'), 1, 'closed');
  assert.equal(last(MACS.a, 'distance'), 230);
  assert.equal(last(MACS.a, 'vehicle'), 1);
  assert.equal(last(MACS.a, 'signal'), 4);
  assert.equal(last(MACS.b, 'temperature'), 12.5);
  assert.equal(last(MACS.b, 'humidity'), 61);
});

test('I1/H1: open AND close are refused by default, nothing read nor sent', async (t) => {
  const { gladys, net } = await setup(t);
  assert.match(gladys.fake.connectionStatus.message.fr, /Impulsions désactivées/);
  net.table[A].jc.door = 1;
  const before = net.calls.length;
  const open = await press(gladys, MACS.a, 'open');
  assert.equal(open.success, false);
  assert.match(open.error, /désactivées dans la configuration/);
  const close = await press(gladys, MACS.a, 'close');
  assert.equal(close.success, false);
  assert.match(close.error, /Fermer envoie la même impulsion qu'ouvrir/);
  assert.equal(net.calls.length, before);
});

test('I1: the option turned off during the read, or right before sending: nothing leaves', async (t) => {
  const { gladys, net, app } = await setup(t, { config: { allow_open: true } });
  net.table[A].jc.door = 1;
  const release = net.hold(A, '/jc');
  const pending = press(gladys, MACS.a, 'close');
  await tick();
  app.config.allowOpen = false;
  release();
  const during = await pending;
  assert.match(during.error, /Fermer envoie la même impulsion/);
  app.config.allowOpen = true;
  // Off between the connection and the first byte (beforeSend).
  const request = app.client.request;
  app.client.request = (options) => {
    if (options.path.startsWith('/cc')) app.config.allowOpen = false;
    return request(options);
  };
  const late = await press(gladys, MACS.a, 'close');
  assert.match(late.error, /Fermer envoie la même impulsion/);
  assert.equal(net.clicks().length, 0);
  assert.equal(app.data.guards[MACS.a], undefined);
});

test('I2: close=1 / open=1 from firmware 1.0.7, click=1 before', async (t) => {
  const { gladys, net, now } = await setup(t, { config: { allow_open: true } });
  const path = () =>
    net
      .clicks()
      .at(-1)
      .path.replace(/dkey=[^&]*/, 'dkey=*');
  const before = net.calls.length;
  assert.equal((await press(gladys, MACS.a, 'open')).success, true);
  assert.deepEqual(
    net.calls.slice(before).map((c) => c.path.replace(/dkey=[^&]*/, 'dkey=*')),
    ['/jc', '/cc?dkey=*&open=1'],
  );
  now.advance(16_000);
  assert.equal((await press(gladys, MACS.a, 'close')).success, true);
  assert.equal(path(), '/cc?dkey=*&close=1');
  // An older firmware: the toggle, same rules.
  net.table[B].jc.fwv = 100;
  assert.equal((await press(gladys, MACS.b, 'open')).success, true);
  assert.equal(path(), '/cc?dkey=*&click=1');
  net.table[B].jc.fwv = 'x';
  now.advance(16_000);
  assert.equal((await press(gladys, MACS.b, 'close')).success, true);
  assert.equal(path(), '/cc?dkey=*&click=1');
});

test('I2/H2: a door closed by the remote during a 3.2 s read is not opened by "close"', async (t) => {
  const { gladys, net, now } = await setup(t, { config: { allow_open: true } });
  net.table[A].jc.door = 1;
  // The answer is the state when the request left ("open"), delivered late.
  const release = net.freeze(A, '/jc');
  const pending = press(gladys, MACS.a, 'close');
  await tick();
  net.table[A].jc.door = 0;
  now.advance(3200);
  release();
  const ack = await pending;
  assert.equal(ack.success, true, ack.error);
  assert.ok(net.clicks().at(-1).path.endsWith('&close=1'), 'close=1, not the toggle');
  assert.equal(net.table[A].jc.door, 0, 'the controller read it closed: no pulse, still closed');
});

test('open: decided on /jc read just now, one pulse, then guarded', async (t) => {
  const { gladys, net, now } = await setup(t, { config: { allow_open: true } });
  net.table[A].moves = false;
  const ack = await press(gladys, MACS.a, 'open');
  assert.equal(ack.success, true, ack.error);
  // The door is still read closed (it has not moved yet): a second pulse
  // would stop it, whatever the button.
  for (const key of ['open', 'close']) {
    const again = await press(gladys, MACS.a, key);
    assert.equal(again.success, false, key);
    assert.match(again.error, /vient d'être commandée/);
  }
  assert.equal(net.clicks().length, 1);
  now.advance(46_000);
  const later = await press(gladys, MACS.a, 'open');
  assert.equal(later.success, true, later.error);
  assert.equal(net.clicks().length, 2);
});

test('the guard is lifted only by the state aimed at, at least 15 s after the pulse', async (t) => {
  const { gladys, net, app, now } = await setup(t, { config: { allow_open: true } });
  net.table[A].moves = false;
  assert.equal((await press(gladys, MACS.a, 'open')).success, true);
  // Moving or unknown: not lifted.
  for (const door of [4, 2, 5, 0]) {
    net.table[A].jc.door = door;
    const ack = await press(gladys, MACS.a, 'close');
    assert.equal(ack.success, false, `door ${door}`);
  }
  assert.ok(app.data.guards[MACS.a]);
  // Open, as the pulse aimed, but too soon (the panel reaches the sensor
  // before the end of travel): kept.
  net.table[A].jc.door = 1;
  now.advance(10_000);
  assert.equal((await press(gladys, MACS.a, 'close')).success, false);
  now.advance(5000);
  const ack = await press(gladys, MACS.a, 'close');
  assert.equal(ack.success, true, ack.error);
  assert.equal(net.clicks().length, 2);
  assert.deepEqual(app.data.guards[MACS.a].expect, 0);
});

test('I4/H4a-b: an answer generated before the pulse never lifts its guard', async (t) => {
  for (const [start, key] of [
    [1, 'close'],
    [0, 'open'],
  ]) {
    const { gladys, net, app, now } = await setup(t, { config: { allow_open: true } });
    net.table[A].moves = false;
    net.table[A].jc.door = 1 - start;
    now.advance(11_000);
    // A poll leaves while the door is still in the state the pulse will aim at.
    const release = net.freeze(A, '/jc');
    const polling = app.tick();
    await tick();
    // The remote moves it; the pulse leaves (it stops the moving door).
    net.table[A].jc.door = start;
    const first = await press(gladys, MACS.a, key);
    assert.equal(first.success, true, `${key}: ${first.error}`);
    // The late answer says the expected state, long after the pulse.
    now.advance(20_000);
    release();
    await polling;
    assert.ok(app.data.guards[MACS.a], `${key}: the guard is kept`);
    const second = await press(gladys, MACS.a, key);
    assert.equal(second.success, false, `${key}: no second pulse`);
    assert.equal(net.clicks().length, 1);
  }
});

test('close: only to a door read open; already closed sends nothing', async (t) => {
  const { gladys, net } = await setup(t, { config: { allow_open: true } });
  const closed = await press(gladys, MACS.a, 'close');
  assert.equal(closed.success, true, closed.error);
  assert.equal(net.clicks().length, 0);
  net.table[A].jc.door = 1;
  const ack = await press(gladys, MACS.a, 'close');
  assert.equal(ack.success, true, ack.error);
  assert.equal(net.clicks().length, 1);
  assert.equal(net.table[A].jc.door, 0);
});

test('I3/H3: a distance the controller rejects (0, > 500, missing) makes the door unknown', async (t) => {
  const { gladys, net, app } = await setup(t, { config: { allow_open: true } });
  await createAll(gladys);
  for (const [door, dist] of [
    [1, 0],
    [0, 600],
    [1, 501],
    [0, undefined],
  ]) {
    net.table[A].jc.door = door;
    if (dist === undefined) delete net.table[A].jc.dist;
    else net.table[A].jc.dist = dist;
    for (const key of ['open', 'close']) {
      const ack = await press(gladys, MACS.a, key);
      assert.equal(ack.success, false, `${key} door ${door} dist ${dist}`);
      assert.match(ack.error, /n'est pas lue/);
    }
  }
  assert.equal(net.clicks().length, 0);
  // With Security+ the door does not come from the distance.
  net.table[A].jc.secv = 1;
  net.table[A].jc.door = 1;
  assert.equal((await press(gladys, MACS.a, 'close')).success, true);
  assert.ok(app);
});

test('a moving, stopped or unknown door is never pulsed', async (t) => {
  const { gladys, net } = await setup(t, { config: { allow_open: true } });
  for (const door of [2, 3, 4, 5, undefined, 'x']) {
    net.table[A].jc.door = door;
    const open = await press(gladys, MACS.a, 'open');
    const close = await press(gladys, MACS.a, 'close');
    assert.equal(open.success, false, `open ${door}`);
    assert.equal(close.success, false, `close ${door}`);
  }
  assert.equal(net.clicks().length, 0);
});

test('a button value other than 1 is refused; read-only features too', async (t) => {
  const { gladys, net } = await setup(t, { config: { allow_open: true } });
  for (const value of [0, '', null, true, 2]) {
    const ack = await press(gladys, MACS.a, 'open', value);
    assert.equal(ack.success, false, String(value));
  }
  const device = deviceOf(gladys, MACS.a);
  const ack = await gladys.fake.setValue(device, featureOf(device, 'door'), 1);
  assert.equal(ack.success, false);
  assert.equal(net.clicks().length, 0);
});

test('without a device key the doors are only read', async (t) => {
  const { gladys, net } = await setup(t, { config: { device_key: '', allow_open: true } });
  assert.match(gladys.fake.connectionStatus.message.fr, /Pas de clé de l'appareil/);
  net.table[A].jc.door = 1;
  const ack = await press(gladys, MACS.a, 'close');
  assert.equal(ack.success, false);
  assert.equal(net.clicks().length, 0);
});

test('a refused key: pulses held, never the reads; another key at once', async (t) => {
  const { gladys, net, app, store, config, now } = await setup(t, {
    config: { device_key: 'wrong', allow_open: true },
  });
  const first = await press(gladys, MACS.a, 'open');
  assert.equal(first.success, false);
  assert.match(first.error, /refusé la clé/);
  assert.equal(net.clicks().length, 1);
  assert.equal(app.data.guards[MACS.a], undefined, 'refused: the controller did nothing');
  const again = await press(gladys, MACS.a, 'open');
  assert.equal(again.success, false);
  net.table[A].jc.door = 1;
  const close = await press(gladys, MACS.a, 'close');
  assert.equal(close.success, false);
  assert.equal(net.clicks().length, 1, 'never replayed');
  // The reads go on.
  now.advance(11_000);
  const reads = net.reads().length;
  await app.tick();
  assert.ok(net.reads().length > reads);
  await app.stop();
  const saved = JSON.stringify(store.data);
  assert.ok(!saved.includes('wrong'));
  assert.match(saved, /"fingerprint":"[0-9a-f]{64}"/);
  // Another key: tried at once, and the fingerprint is gone at the first success.
  net.table[A].jc.door = 0;
  await gladys.fake.configUpdated({ ...config, device_key: KEY, allow_open: true });
  const ok = await press(gladys, MACS.a, 'open');
  assert.equal(ok.success, true, ok.error);
  assert.equal(app.data.keyBlocks[MACS.a], undefined);
});

test('M2/H6: no fingerprint of a key that works on another controller', async (t) => {
  const { gladys, net, app, store } = await setup(t, { config: { allow_open: true } });
  net.table[A].key = 'other';
  assert.equal((await press(gladys, MACS.a, 'open')).success, false);
  assert.ok(store.data.keyBlocks?.[MACS.a] || app.data.keyBlocks[MACS.a]);
  assert.equal((await press(gladys, MACS.b, 'open')).success, true);
  await app.stop();
  assert.deepEqual(store.data.keyBlocks, {});
  // A refuses it still: held in memory, never written.
  assert.equal((await press(gladys, MACS.a, 'open')).success, false);
  assert.equal(net.clicks().filter((c) => c.address === A).length, 1);
  // Refused again after its hold: still never written.
  app.memoryKeyBlocks.clear();
  assert.equal((await press(gladys, MACS.a, 'open')).success, false);
  assert.equal(net.clicks().filter((c) => c.address === A).length, 2);
  await app.stop();
  assert.deepEqual(store.data.keyBlocks, {}, 'a key known to work is never fingerprinted');
});

test('I1/H7: a close cancels the openings still waiting to leave, then goes in the queue', async (t) => {
  const { gladys, net } = await setup(t, { config: { allow_open: true } });
  const release = net.hold(A, '/jc');
  const first = press(gladys, MACS.a, 'open');
  await tick();
  const second = press(gladys, MACS.a, 'open');
  await tick();
  net.table[A].jc.door = 1;
  const close = press(gladys, MACS.a, 'close');
  await tick();
  release();
  const [a, b, c] = await Promise.all([first, second, close]);
  assert.match(a.error, /Annulée/);
  assert.match(b.error, /Annulée/);
  assert.equal(c.success, true, c.error);
  assert.deepEqual(
    net.clicks().map((x) => x.path.replace(/dkey=[^&]*/, 'dkey=*')),
    ['/cc?dkey=*&close=1'],
  );
});

test('a 429/5xx pause holds every pulse, close included', async (t) => {
  const { gladys, net } = await setup(t, { config: { allow_open: true } });
  net.fail(A, '/jc', { status: 503 });
  const open = await press(gladys, MACS.a, 'open');
  assert.equal(open.success, false);
  assert.match(open.error, /demandé d'attendre/);
  net.table[A].jc.door = 1;
  const close = await press(gladys, MACS.a, 'close');
  assert.match(close.error, /demandé d'attendre/);
  assert.equal(net.clicks().length, 0);
  assert.match(gladys.fake.connectionStatus.message.fr, /Demande d'attendre/);
});

test('the device key is never in a log, a status, an error nor /data', async (t) => {
  const { gladys, net, app, logs, store } = await setup(t, { config: { allow_open: true } });
  net.fail(A, '/cc', new OpenGarageError('timeout', { sent: true }));
  const errors = [];
  errors.push((await press(gladys, MACS.a, 'open')).error);
  net.fail(B, '/cc', new OpenGarageError('unreachable'), { before: true });
  errors.push((await press(gladys, MACS.b, 'open')).error);
  net.table[A].key = 'other';
  net.table[A].jc.door = 1;
  app.data.guards = {};
  errors.push((await press(gladys, MACS.a, 'close')).error);
  await app.stop();
  const all = JSON.stringify([logs, errors, store.data, gladys.fake.connectionStatus]);
  for (const secret of [KEY, encodeURIComponent(KEY), 'dkey']) {
    assert.ok(!all.includes(secret), secret);
  }
  assert.match(errors[0], /envoyée, sans confirmation/);
  assert.match(errors[1], /non envoyée/);
});

test('a pulse that may have left is guarded; one that never left is not', async (t) => {
  const { gladys, net, app } = await setup(t, { config: { allow_open: true } });
  net.fail(A, '/cc', new OpenGarageError('unreachable'), { before: true });
  assert.equal((await press(gladys, MACS.a, 'open')).success, false);
  assert.equal(app.data.guards[MACS.a], undefined);
  net.fail(A, '/cc', { status: 200, body: 'not json' });
  const ack = await press(gladys, MACS.a, 'open');
  assert.match(ack.error, /sans confirmation/);
  assert.deepEqual(
    { from: app.data.guards[MACS.a].from, expect: app.data.guards[MACS.a].expect },
    { from: 0, expect: 1 },
  );
});

test('a command that cannot leave within 3.5 s is refused unsent', async (t) => {
  const { gladys, net, now } = await setup(t, { config: { allow_open: true } });
  const release = net.hold(A, '/jc');
  const pending = press(gladys, MACS.a, 'open');
  await tick();
  now.advance(4000);
  release();
  const ack = await pending;
  assert.equal(ack.success, false);
  assert.match(ack.error, /rien n'a été envoyé/);
  assert.equal(net.clicks().length, 0);
});

test('the controller is identified before every pulse (DHCP swap)', async (t) => {
  const { gladys, net, app } = await setup(t, { config: { allow_open: true } });
  // Unreadable: refused, never "another controller".
  net.table[A].jc.mac = 'garbage';
  const unreadable = await press(gladys, MACS.a, 'open');
  assert.match(unreadable.error, /pas pu être lu/);
  assert.equal(app.data.devices[MACS.a].address, A);
  // Another controller at the address: refused, the record loses it.
  net.table[A].jc.mac = '5C:CF:7F:00:00:99';
  const other = await press(gladys, MACS.a, 'open');
  assert.match(other.error, /plus à son adresse/);
  assert.equal(app.data.devices[MACS.a].address, '');
  assert.equal(net.clicks().length, 0);
});

test('a controller that moved to another typed address keeps its device', async (t) => {
  const net = fakeNetwork();
  const { gladys, app, now } = await setup(t, { net });
  // The two swap their addresses: settled within two reads.
  [net.table[A], net.table[B]] = [net.table[B], net.table[A]];
  for (let i = 0; i < 2; i += 1) {
    now.advance(11_000);
    await app.tick();
  }
  assert.equal(app.data.devices[MACS.a].address, B);
  assert.equal(app.data.devices[MACS.b].address, A);
  assert.equal(gladys.fake.discoveredDevices.length, 2);
});

test('never read sooner than the interval: reconnection, same config, scan, check', async (t) => {
  const { gladys, app, net, now, config } = await setup(t);
  const reads = () => net.reads().length;
  const before = reads();
  assert.equal(before, 2);
  await app.start(await gladys.getConfig());
  await gladys.fake.configUpdated(config);
  await gladys.fake.scanRequest();
  const check = await gladys.fake.action('check_controllers');
  assert.equal(check.success, true, check.error);
  assert.equal(reads(), before);
  now.advance(9000);
  await app.tick();
  assert.equal(reads(), before);
  now.advance(1000);
  await app.tick();
  assert.equal(reads(), before + 2);
});

test('the status and the Discovery tab are published again at every connection', async (t) => {
  const { gladys, app } = await setup(t);
  const status = gladys.fake.connectionStatus;
  gladys.fake.discoveredDevices.length = 0;
  await app.start(await gladys.getConfig());
  assert.equal(gladys.fake.discoveredDevices.length, 2);
  assert.deepEqual(gladys.fake.connectionStatus, status);
});

test('a restart soon after a read waits a whole interval', async (t) => {
  const now = clock();
  const data = emptyData();
  data.lastTry = now() - 2000;
  const net = fakeNetwork();
  const { app, gladys } = await setup(t, { store: new MemoryStore(data, now), net, now });
  assert.equal(net.reads().length, 0);
  assert.match(gladys.fake.connectionStatus.message.en, /Waiting for the first read/);
  now.advance(9000);
  await app.tick();
  assert.equal(net.reads().length, 0);
  now.advance(1000);
  await app.tick();
  assert.equal(net.reads().length, 2);
});

test('after a restart a door can be closed before the first read; the guard is kept', async (t) => {
  const now = clock();
  const store = new MemoryStore(emptyData(), now);
  const net = fakeNetwork();
  const first = await setup(t, { store, net, now, config: { allow_open: true } });
  net.table[A].moves = false;
  assert.equal((await press(first.gladys, MACS.a, 'open')).success, true);
  await first.app.stop();
  now.advance(2000);
  // Restart: the devices come from /data, no read yet.
  const second = await setup(t, {
    store,
    net,
    now,
    config: { allow_open: true },
    devices: first.gladys.fake.discoveredDevices,
  });
  const reads = net.reads().length;
  const refused = await press(second.gladys, MACS.a, 'open');
  assert.match(refused.error, /vient d'être commandée/);
  net.table[A].jc.door = 1;
  now.advance(14_000);
  const close = await press(second.gladys, MACS.a, 'close');
  assert.equal(close.success, true, close.error);
  // The young guard refused the opening at once (no read); the close read once.
  assert.equal(net.reads().length, reads + 1, 'only the read of the close');
});

test('M1/H5: a restart while a pulse is out keeps its guard (set in beforeSend)', async (t) => {
  const now = clock();
  const store = new MemoryStore(emptyData(), now);
  const net = fakeNetwork();
  const first = await setup(t, { store, net, now, config: { allow_open: true } });
  net.table[A].moves = false;
  // The pulse leaves, its answer never comes (the container is killed).
  const request = first.app.client.request;
  first.app.client.request = (options) => {
    if (options.path.startsWith('/cc')) {
      options.beforeSend?.();
      return new Promise(() => {});
    }
    return request(options);
  };
  void press(first.gladys, MACS.a, 'open');
  await tick();
  await first.app.saving;
  assert.ok(store.data.guards[MACS.a], 'saved before the first byte');
  now.advance(1500);
  const second = await setup(t, {
    store,
    net,
    now,
    config: { allow_open: true },
    devices: first.gladys.fake.discoveredDevices,
  });
  const again = await press(second.gladys, MACS.a, 'open');
  assert.match(again.error, /vient d'être commandée/);
  assert.equal(net.clicks().length, 0);
});

test('I5/H8: a restart soon after a successful read stays connected', async (t) => {
  const now = clock();
  const first = await setup(t, { now, config: { poll_interval: 300 } });
  assert.equal(first.gladys.fake.connectionStatus.connected, true);
  await first.app.stop();
  const data = structuredClone(first.store.data);
  assert.equal(data.lastReads[A].ok, true);
  now.advance(2000);
  const second = await setup(t, {
    now,
    store: new MemoryStore(data, now),
    config: { poll_interval: 300 },
    devices: first.gladys.fake.discoveredDevices,
  });
  assert.equal(second.gladys.fake.connectionStatus.connected, true);
  assert.match(second.gladys.fake.connectionStatus.message.en, /2 of 2 .* last read before/);
  assert.equal(second.net.reads().length, 0);
});

test('a late read of an older configuration publishes nothing', async (t) => {
  const { gladys, app, net, now, config } = await setup(t);
  await createAll(gladys);
  await app.publisher.flush();
  const states = gladys.fake.states.length;
  now.advance(11_000);
  const release = net.hold(A, '/jc');
  const polling = app.tick();
  await tick();
  // A reconnection or a new configuration during a read shares it.
  const updating = gladys.fake.configUpdated({ ...config, addresses: B });
  await tick();
  net.table[A].jc.door = 1;
  release();
  await polling;
  await updating;
  await app.publisher.flush();
  const doorStates = gladys.fake.states
    .slice(states)
    .filter((s) => s.device_feature_external_id === id(MACS.a, 'door'));
  assert.deepEqual(doorStates, []);
  assert.match(gladys.fake.connectionStatus.message.en, /1 of 1/);
});

test('failures: spaced reads, never faster than the interval', async (t) => {
  const { app, net, now } = await setup(t);
  now.advance(11_000);
  net.fail(A, '/jc', new OpenGarageError('timeout', { sent: true }));
  await app.tick();
  const reads = net.reads().length;
  now.advance(11_000);
  await app.tick();
  assert.equal(net.reads().filter((c) => c.address === A).length, 2, 'A waits 30 s');
  now.advance(20_000);
  await app.tick();
  assert.ok(net.reads().length > reads);
});

test('a created device never loses a feature', async (t) => {
  const net = fakeNetwork();
  const kept = {
    name: 'Temperature',
    external_id: id(MACS.a, 'temperature'),
    category: 'temperature-sensor',
    type: 'decimal',
    min: -40,
    max: 85,
    unit: 'celsius',
    read_only: true,
    has_feedback: false,
    keep_history: true,
  };
  const devices = [{ external_id: id(MACS.a), name: 'Garage', features: [kept] }];
  const { gladys } = await setup(t, { net, devices });
  const garage = deviceOf(gladys, MACS.a);
  assert.ok(featureOf(garage, 'temperature'));
  assert.ok(featureOf(garage, 'door'));
});

test('a controller without a MAC is said in the status, never added', async (t) => {
  const net = fakeNetwork();
  delete net.table[B].jc.mac;
  const { gladys } = await setup(t, { net });
  assert.equal(gladys.fake.discoveredDevices.length, 1);
  assert.match(gladys.fake.connectionStatus.message.en, /Not an OpenGarage controller/);
});

test('r1/N1: a close behind a pulse that LEFT is refused at once, "just commanded"', async (t) => {
  const { gladys, net, app } = await setup(t, { config: { allow_open: true } });
  // The opening leaves (beforeSend) and its answer never comes.
  const request = app.client.request;
  app.client.request = (options) => {
    if (options.path.startsWith('/cc')) {
      options.beforeSend?.();
      return new Promise(() => {});
    }
    return request(options);
  };
  void press(gladys, MACS.a, 'open');
  await tick();
  net.table[A].jc.door = 1;
  const started = Date.now();
  const close = await press(gladys, MACS.a, 'close');
  assert.ok(Date.now() - started < 3500, `${Date.now() - started} ms`);
  assert.equal(close.success, false);
  assert.match(close.error, /vient d'être commandée/);
});

test('r1: the wait in the queue ends by 3.3 s (real timer), with its reason', async (t) => {
  const realTimers = {
    ...timers,
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (handle) => clearTimeout(handle),
  };
  const { gladys, net } = await setup(t, {
    config: { allow_open: true },
    appTimers: realTimers,
  });
  // The first opening is stuck in its read (not sent): the second one waits.
  const release = net.hold(A, '/jc');
  const first = press(gladys, MACS.a, 'open');
  await tick();
  const started = Date.now();
  const second = await press(gladys, MACS.a, 'open');
  const waited = Date.now() - started;
  assert.ok(waited >= 3000 && waited < 3500, `${waited} ms`);
  assert.match(second.error, /pas répondu à temps/);
  release();
  await first;
  assert.equal(net.clicks().length, 1, 'only the first one left');
});

test('r2/N2: a cancelled opening drops its connection attempt at once', async (t) => {
  const { gladys, net } = await setup(t, { config: { allow_open: true } });
  // The connection of the opening's pulse does not come up.
  net.hold(A, '/cc');
  const open = press(gladys, MACS.a, 'open');
  await tick();
  const started = Date.now();
  const close = await press(gladys, MACS.a, 'close');
  const opened = await open;
  assert.ok(Date.now() - started < 1000, `${Date.now() - started} ms`);
  assert.match(opened.error, /Annulée/);
  assert.equal(close.success, true, close.error);
  assert.equal(net.clicks().length, 0, 'door read closed: nothing to send');
});
