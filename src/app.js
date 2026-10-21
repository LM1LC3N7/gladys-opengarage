// -----------------------------------------------------------------------------
// The integration: the OpenGarage controllers at the typed addresses, polled
// over their local HTTP API (/jc), the Gladys devices built from them, and
// the door pulses sent back (/cc click). index.js only wires the SDK handlers
// to it (src/handlers.js).
//
// Reads:
//   - one GET /jc per typed address and interval; its MAC says which
//     controller answers, so the identity is checked at every read (a new
//     DHCP lease moves a controller, never its device); an answer without a
//     readable MAC is a failed read, never "another controller";
//   - never sooner than the interval: not on a reconnection to Gladys, a
//     configuration saved unchanged, the Discovery scan or the "Check" button,
//     nor after a restart (the time of the last read is kept in /data); a
//     reconnection during a read shares it;
//   - failures: 30 s, 1, 2, 5 min, never sooner than the interval; HTTP 429
//     or 5xx: a pause of 1 min to 6 h persisted in /data;
//   - a read of an older configuration that ends late publishes nothing and
//     sets no status (the generation is checked after every await).
//
// Commands (open, close: buttons, never a switch). The relay of an
// OpenGarage is a TOGGLE: one pulse opens a closed door, closes an open one,
// and stops or reverses a moving one. From firmware 1.0.7 (fwv >= 107) the
// controller also takes `close=1` / `open=1` and decides on its own sensor
// when the request arrives; older ones get `click=1`. So:
//   - every pulse is decided on /jc read just now, after checking the MAC:
//     "open" is only sent to a door read closed, "close" only to a door read
//     open; already there: nothing sent; moving, stopped, unknown, or a
//     distance the controller itself rejects (0 or > 500 cm, which freezes
//     its `door`): refused;
//   - BOTH need "Allow the garage door pulses" (allow_open, off by default):
//     a close is the same pulse as an open on a door that changed meanwhile
//     (as the step-by-step gateBox of gladys-blebox). Checked on arrival,
//     after the fresh read and right before the request leaves (beforeSend);
//   - one queue per controller; a close cancels, on arrival, the openings
//     not sent yet (queued ones included); a 429/5xx pause or a refused key
//     holds both;
//   - a guard is set in beforeSend (persisted at once, with the time the
//     pulse left) and refuses any other pulse until a read STARTED after the
//     pulse shows the door where it was sent, at least 15 s after the pulse,
//     or 45 s; never lifted on an unknown, moving or unchanged state;
//     removed only when the controller surely did nothing (result != 1, 4xx);
//   - sent within 3.5 s of the click or refused unsent; answered by 4.3 s; a
//     request that may have reached the controller is never answered "not
//     sent": "sent, without confirmation", then reads; never retried;
//   - a device key refused (result 2) holds the pulses of that controller
//     with that key (15 min, 1 h, 6 h, then every 24 h; another key at once),
//     never the reads; a key that works on any controller is never
//     fingerprinted in /data;
//   - the ack never waits for a publication to Gladys; the key is never in a
//     log line, a status, an error or /data.
// -----------------------------------------------------------------------------

import { createHmac } from 'node:crypto';
import { DEVICE_TRANSPORTS, createLogger } from '@gladysassistant/integration-sdk';
import { generationKey, normalizeConfig, numberOf } from './config.js';
import {
  BUTTON_PUSH,
  DOOR,
  EXTERNAL_ID_TYPE,
  LIMITS,
  RESULT,
  TIMINGS,
  TOGGLE_FREE_FIRMWARE,
} from './constants.js';
import { ERRORS, T, join, word } from './i18n.js';
import { buildDevice, featuresOf, valuesOf } from './model.js';
import { StatePublisher } from './publisher.js';
import { FileStore, emptyData } from './store.js';
import { OpenGarageClient } from './opengarage/client.js';
import { OpenGarageError, reasonOf } from './opengarage/errors.js';
import { identityOf, layoutOf, mergeLayout, readingOf } from './opengarage/parse.js';

/** Runs `task` over `items`, `limit` at a time. */
async function mapLimit(items, limit, task) {
  const results = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await task(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/** A command value, strictly: a finite number or its exact text ('' and null are not 0). */
const strictNumber = (value) => (typeof value === 'boolean' ? undefined : numberOf(value));

export class OpenGarageApp {
  constructor({
    gladys,
    logger = createLogger({ name: 'opengarage' }),
    client = new OpenGarageClient(),
    store = new FileStore(),
    now = Date.now,
    timers = globalThis,
  }) {
    this.gladys = gladys;
    this.logger = logger;
    this.client = client;
    this.store = store;
    this.now = now;
    this.timers = timers;
    this.config = undefined;
    this.data = undefined;
    /** Bumped when the addresses or the key change: a late answer of before is dropped. */
    this.generation = 0;
    this.generationKey = undefined;
    this.publisher = new StatePublisher({
      gladys,
      logger,
      now,
      timers,
      interval: TIMINGS.measureInterval,
    });
    /** address -> { lastTry, next, failures, id?, error? } */
    this.addresses = new Map();
    /** No read before this time (a restart soon after the last read). */
    this.notBefore = 0;
    this.lastTrySaved = -Infinity;
    /** id -> reachable */
    this.reachable = new Map();
    /** address -> [previous id, new id] */
    this.moved = new Map();
    /** id -> addresses answering with it, besides its own */
    this.duplicates = new Map();
    /** deviceId -> transport badge last published */
    this.transports = new Map();
    /** featureId -> last value read, sent when the user creates the device */
    this.lastValues = new Map();
    this.created = new Set();
    /** featureId -> { id, key } of the published devices */
    this.features = new Map();
    /** id -> tail of its command queue */
    this.queues = new Map();
    /** id -> tickets of the openings not sent yet */
    this.tickets = new Map();
    /** id -> the pulse between its plan and its answer */
    this.flights = new Map();
    /** id -> handles of the reads after its last command */
    this.followUps = new Map();
    /** address -> the read in progress (a poll and a follow-up share it) */
    this.reads = new Map();
    this.polling = undefined;
    this.pollTimer = undefined;
    this.persistTimer = undefined;
    this.saving = Promise.resolve();
    this.lastStatus = undefined;
    this.warned = new Set();
    /** Fingerprints (memory only) of the keys a controller accepted. */
    this.goodKeys = new Set();
    /** id -> hold of a refused key that works elsewhere (never in /data) */
    this.memoryKeyBlocks = new Map();
    /** Every request gets a number: a guard is lifted only by a read sent after its pulse. */
    this.sequence = 0;
  }

  // --- Lifecycle -------------------------------------------------------------

  get interval() {
    return this.config.pollInterval * 1000;
  }

  async start(raw = {}) {
    const first = !this.data;
    if (first) {
      this.data = await this.store.load().catch(() => emptyData());
      this.data.lastReads ??= {};
    }
    this.config = normalizeConfig(raw);
    if (first && this.data.lastTry !== undefined) {
      // The last read may be later than the one written (once a minute): a
      // whole interval from now is never sooner than the interval.
      if (this.now() - this.data.lastTry < this.interval + TIMINGS.lastTrySave) {
        this.notBefore = this.now() + this.interval;
      }
    }
    const key = generationKey(this.config);
    if (key !== this.generationKey) {
      this.generationKey = key;
      this.generation += 1;
      // The addresses no longer typed are forgotten; the others keep their
      // last try (a configuration saved again never reads sooner).
      for (const address of this.addresses.keys()) {
        if (!this.config.addresses.includes(address)) {
          this.addresses.delete(address);
        }
      }
      // The outcome of the last read is only kept for the typed addresses.
      for (const address of Object.keys(this.data.lastReads)) {
        if (!this.config.addresses.includes(address)) {
          delete this.data.lastReads[address];
          this.persist();
        }
      }
      this.reads.clear();
    }
    // Gladys keeps the status and the Discovery tab in memory: sent again at every start.
    this.lastStatus = undefined;
    this.transports.clear();
    this.refreshCreated();
    this.publisher.start();
    await this.publishDevices();
    await this.publishAllTransports();
    this.schedule();
    this.updateStatus();
    const changed = await this.poll();
    if (changed) {
      await this.publishDevices();
    }
    this.updateStatus();
  }

  stop() {
    this.publisher.stop();
    this.timers.clearInterval(this.pollTimer);
    this.pollTimer = undefined;
    for (const handles of this.followUps.values()) {
      for (const handle of handles) {
        this.timers.clearTimeout(handle);
      }
    }
    this.followUps.clear();
    if (this.persistTimer) {
      this.timers.clearTimeout(this.persistTimer);
      this.persistTimer = undefined;
      return this.save();
    }
    return this.saving;
  }

  schedule() {
    this.timers.clearInterval(this.pollTimer);
    // The timer only looks: each address is read when due.
    this.pollTimer = this.timers.setInterval(() => this.tick(), Math.min(this.interval, 5000));
  }

  tick() {
    return this.poll()
      .then((changed) => (changed ? this.publishDevices() : undefined))
      .then(() => this.updateStatus())
      .catch((err) => this.logger.warn(`Polling failed: ${reasonOf(err)}`));
  }

  /** Saves /data now, one write at a time. */
  save() {
    this.saving = this.saving
      .then(() => this.store.save(this.data))
      .catch(() => this.logger.warn('Could not save /data'));
    return this.saving;
  }

  persist() {
    if (this.persistTimer) {
      return;
    }
    this.persistTimer = this.timers.setTimeout(() => {
      this.persistTimer = undefined;
      this.save();
    }, TIMINGS.persistDelay);
  }

  warnOnce(key, message) {
    if (!this.warned.has(key)) {
      this.warned.add(key);
      this.logger.warn(message);
    }
  }

  get records() {
    return Object.values(this.data?.devices ?? {});
  }

  // --- Pauses (429, 5xx) and refused keys -----------------------------------

  blockOf(address) {
    const block = this.data.blocks[address];
    return block && block.until > this.now() ? block : undefined;
  }

  /** A failure of an address: a pause asked by the controller is persisted. */
  onFailure(address, err) {
    if (!(err instanceof OpenGarageError) || err.kind !== 'busy' || !address) {
      return;
    }
    const previous = this.data.blocks[address];
    const failures = previous ? previous.failures + 1 : 1;
    const asked = err.retryAfter ?? TIMINGS.pauseMin * 2 ** Math.min(failures - 1, 10);
    const wait = Math.min(TIMINGS.pauseMax, Math.max(TIMINGS.pauseMin, asked));
    this.logger.warn(`${address}: ${err.message}, paused for ${Math.round(wait / 1000)} s`);
    this.data.blocks[address] = { kind: 'pause', failures, until: this.now() + wait };
    this.persist();
    this.updateStatus();
  }

  onSuccess(address) {
    if (this.data.blocks[address]) {
      delete this.data.blocks[address];
      this.persist();
    }
  }

  /** A salted fingerprint of a key, only ever kept for a key the controller refused. */
  fingerprint(key) {
    return createHmac('sha256', this.data.salt).update(key).digest('hex');
  }

  /** The block of the current key on a controller, if it refused it lately. */
  keyBlockOf(record) {
    const block = this.data.keyBlocks[record.id] ?? this.memoryKeyBlocks.get(record.id);
    if (!block || !this.config.key || block.until <= this.now()) {
      return undefined;
    }
    return block.fingerprint === this.fingerprint(this.config.key) ? block : undefined;
  }

  onKeyRefused(record, key) {
    const fingerprint = this.fingerprint(key);
    const previous = this.data.keyBlocks[record.id] ?? this.memoryKeyBlocks.get(record.id);
    const failures = previous?.fingerprint === fingerprint ? previous.failures + 1 : 1;
    const wait = TIMINGS.keyRetries[Math.min(failures, TIMINGS.keyRetries.length) - 1];
    const block = { fingerprint, failures, until: this.now() + wait };
    if (this.goodKeys.has(fingerprint)) {
      // The same key works on another controller (one key for all): its
      // fingerprint never goes to /data, the hold stays in memory.
      delete this.data.keyBlocks[record.id];
      this.memoryKeyBlocks.set(record.id, block);
    } else {
      this.data.keyBlocks[record.id] = block;
    }
    this.warnOnce(`key:${record.id}:${failures}`, `OpenGarage ${record.id}: device key refused`);
    this.save();
    this.updateStatus();
  }

  /** A key accepted by any controller: no fingerprint of it is kept in /data. */
  onKeyAccepted(record, key) {
    const fingerprint = this.fingerprint(key);
    this.goodKeys.add(fingerprint);
    this.memoryKeyBlocks.delete(record.id);
    let changed = false;
    for (const [id, block] of Object.entries(this.data.keyBlocks)) {
      if (id === record.id || block.fingerprint === fingerprint) {
        delete this.data.keyBlocks[id];
        if (id !== record.id) {
          this.memoryKeyBlocks.set(id, block);
        }
        changed = true;
      }
    }
    if (changed) {
      this.save();
    }
  }

  // --- Reads -----------------------------------------------------------------

  statusOf(address) {
    let status = this.addresses.get(address);
    if (!status) {
      status = { lastTry: undefined, next: 0, failures: 0 };
      this.addresses.set(address, status);
    }
    return status;
  }

  isDue(address) {
    if (this.now() < this.notBefore || this.blockOf(address)) {
      return false;
    }
    const status = this.addresses.get(address);
    return !status || status.lastTry === undefined || this.now() >= status.next;
  }

  /** The time of the last read, written to /data at most once a minute. */
  markTry() {
    this.data.lastTry = this.now();
    if (this.now() - this.lastTrySaved >= TIMINGS.lastTrySave) {
      this.lastTrySaved = this.now();
      this.persist();
    }
  }

  /** One polling round: the typed addresses that are due. */
  poll() {
    if (!this.polling) {
      this.polling = this.doPoll().finally(() => {
        this.polling = undefined;
      });
    }
    return this.polling;
  }

  async doPoll() {
    const generation = this.generation;
    const due = this.config.addresses.filter((address) => this.isDue(address));
    const results = await mapLimit(due, 4, (address) => this.read(address, generation));
    if (generation !== this.generation) {
      return false;
    }
    // A controller known at an address no longer typed is not read any more.
    for (const record of this.records) {
      if (!record.address || !this.config.addresses.includes(record.address)) {
        this.setReachable(record, false);
      }
    }
    return results.some(Boolean);
  }

  /**
   * Reads one address and records what answers there; true when a Gladys
   * device changes. A read already running for the address is shared.
   */
  read(address, generation = this.generation) {
    const running = this.reads.get(address);
    if (running) {
      return running;
    }
    const promise = this.doRead(address, generation).finally(() => {
      if (this.reads.get(address) === promise) {
        this.reads.delete(address);
      }
    });
    this.reads.set(address, promise);
    return promise;
  }

  async doRead(address, generation) {
    const status = this.statusOf(address);
    status.lastTry = this.now();
    this.markTry();
    // When this request left: it can only lift a guard of a pulse sent before it.
    const origin = { seq: this.nextSequence(), at: this.now() };
    let data;
    try {
      data = await this.client.variables(address);
    } catch (err) {
      if (generation !== this.generation) {
        return false;
      }
      this.onFailure(address, err);
      this.failed(address, status, err.kind ?? 'error');
      this.logger.debug(`${address}: ${reasonOf(err)}`);
      return false;
    }
    // A late answer of an older configuration: nothing published, no status.
    if (generation !== this.generation) {
      return false;
    }
    this.onSuccess(address);
    const identity = identityOf(data);
    if (!identity.id) {
      // Unreadable: a failed read, never "another controller".
      this.failed(address, status, 'notController');
      this.warnOnce(`notController:${address}`, `${address}: no MAC address in /jc`);
      return false;
    }
    status.failures = 0;
    status.next = status.lastTry + this.interval;
    status.error = undefined;
    status.id = identity.id;
    this.rememberRead(address, { ok: true, id: identity.id, at: status.lastTry });
    const changed = this.remember(identity, address, layoutOf(data));
    const record = this.data.devices[identity.id];
    if (record?.address !== address) {
      // The same controller at another typed address: only its own is used.
      return changed;
    }
    const reading = readingOf(data);
    this.liftGuard(record, reading, origin);
    this.recordValues(record, reading);
    this.setReachable(record, true);
    return changed;
  }

  /**
   * The outcome of the last read of an address, kept in /data with lastTry
   * (the status after a restart, before the first read): written with the
   * once-a-minute save, or at once when it changes.
   */
  rememberRead(address, outcome) {
    const previous = this.data.lastReads[address];
    this.data.lastReads[address] = outcome;
    if (previous?.ok !== outcome.ok || previous?.id !== outcome.id) {
      this.persist();
    }
  }

  failed(address, status, error) {
    status.failures += 1;
    status.error = error;
    status.id = undefined;
    this.rememberRead(address, { ok: false, at: status.lastTry });
    const wait = TIMINGS.backoff[Math.min(status.failures, TIMINGS.backoff.length) - 1];
    status.next = status.lastTry + Math.max(wait, this.interval);
    for (const record of this.records) {
      if (record.address === address) {
        this.setReachable(record, false);
      }
    }
  }

  /** Adds or updates a known controller; true when its Gladys device changes. */
  remember(identity, address, layout) {
    const devices = this.data.devices;
    const existing = devices[identity.id];
    if (!existing && Object.keys(devices).length >= LIMITS.addresses * 2) {
      this.warnOnce('devices', 'Too many controllers: the next ones are ignored');
      return false;
    }
    if (
      existing?.address &&
      existing.address !== address &&
      this.config.addresses.includes(existing.address) &&
      this.addresses.get(existing.address)?.id === identity.id
    ) {
      // Still answering at its own address: this one is a second way to it.
      const others = this.duplicates.get(identity.id) ?? new Set();
      others.add(address);
      this.duplicates.set(identity.id, others);
      return false;
    }
    this.duplicates.delete(identity.id);
    let changed = false;
    // One address, one controller: another one known at this address has moved.
    for (const other of this.records) {
      if (other.id !== identity.id && other.address === address) {
        this.logger.warn(`${address}: ${other.id} was known there, ${identity.id} answers now`);
        this.moved.set(address, [other.id, identity.id]);
        other.address = '';
        this.setReachable(other, false);
        changed = true;
      }
    }
    for (const [at, ids] of this.moved) {
      if (ids[0] === identity.id) {
        this.moved.delete(at);
      }
    }
    const record = {
      id: identity.id,
      address,
      name: identity.name || existing?.name || '',
      firmware: identity.firmware || existing?.firmware || '',
      layout: mergeLayout(existing?.layout, layout),
    };
    if (JSON.stringify(existing) !== JSON.stringify(record)) {
      if (existing && existing.address !== address) {
        this.logger.info(`OpenGarage ${record.id} is now at ${address}`);
      }
      if (existing) {
        // The same object: a command running for it sees the change.
        Object.assign(existing, record);
      } else {
        devices[identity.id] = record;
      }
      changed = true;
      this.persist();
    }
    return changed;
  }

  recordValues(record, reading) {
    const ids = this.gladys.externalIds(EXTERNAL_ID_TYPE, record.id);
    for (const [key, value] of valuesOf(record, reading)) {
      const featureId = ids.feature(key);
      const entry = { state: value };
      this.lastValues.set(featureId, entry);
      if (this.created.has(featureId)) {
        this.publisher.push(featureId, entry);
      }
    }
  }

  setReachable(record, reachable) {
    const previous = this.reachable.get(record.id);
    this.reachable.set(record.id, reachable);
    if (previous !== reachable) {
      this.publishTransport(this.gladys.externalIds(EXTERNAL_ID_TYPE, record.id).device).catch(
        (err) => this.logger.warn(`Transport badge failed: ${reasonOf(err)}`),
      );
    }
  }

  // --- Gladys devices ----------------------------------------------------------

  /**
   * The Discovery tab. A created device never loses a feature: the features
   * it has that the controller no longer gives are published as they are
   * (Gladys would otherwise mark it changed, and "Update" would drop their
   * history).
   */
  async publishDevices() {
    const devices = [];
    const measures = new Set();
    this.features.clear();
    const created = new Map((this.gladys.devices ?? []).map((d) => [d.external_id, d]));
    for (const record of this.records) {
      const device = buildDevice(this.gladys, record, { language: this.config.language });
      const ids = this.gladys.externalIds(EXTERNAL_ID_TYPE, record.id);
      for (const { key, spec } of featuresOf(record)) {
        const featureId = ids.feature(key);
        this.features.set(featureId, { id: record.id, key });
        if (spec.measure) {
          measures.add(featureId);
        }
      }
      const published = new Set(device.features.map((f) => f.external_id));
      for (const feature of created.get(device.external_id)?.features ?? []) {
        if (!published.has(feature.external_id)) {
          const kept = {};
          for (const field of [
            'name',
            'external_id',
            'category',
            'type',
            'min',
            'max',
            'unit',
            'read_only',
            'has_feedback',
            'keep_history',
          ]) {
            if (feature[field] !== undefined && feature[field] !== null) {
              kept[field] = feature[field];
            }
          }
          device.features.push(kept);
          const key = feature.external_id.slice(ids.device.length + 1);
          this.features.set(feature.external_id, { id: record.id, key });
        }
      }
      devices.push(device);
    }
    this.publisher.configure({ throttled: measures, events: new Set() });
    await this.gladys
      .publishDiscoveredDevices(devices)
      .catch((err) =>
        this.logger.warn(`Publishing the discovered devices failed: ${reasonOf(err)}`),
      );
  }

  refreshCreated() {
    this.created = new Set(
      (this.gladys.devices ?? []).flatMap((d) => (d.features ?? []).map((f) => f.external_id)),
    );
  }

  createdDevices() {
    return new Set((this.gladys.devices ?? []).map((d) => d.external_id));
  }

  async deviceCreated(device) {
    this.refreshCreated();
    this.transports.delete(device?.external_id);
    for (const feature of device?.features ?? []) {
      const value = this.lastValues.get(feature.external_id);
      if (value) {
        this.publisher.push(feature.external_id, value);
      }
    }
    if (device?.external_id) {
      await this.publishTransport(device.external_id).catch(() => {});
    }
  }

  async deviceDeleted(device) {
    this.refreshCreated();
    if (device?.external_id) {
      this.transports.delete(device.external_id);
      this.publisher.forget(device.external_id);
    }
  }

  recordOf(deviceId) {
    return this.records.find(
      (record) => this.gladys.externalIds(EXTERNAL_ID_TYPE, record.id).device === deviceId,
    );
  }

  transportOf(record) {
    return this.reachable.get(record.id) === false
      ? DEVICE_TRANSPORTS.UNREACHABLE
      : DEVICE_TRANSPORTS.LOCAL;
  }

  async publishTransport(deviceId) {
    const record = this.recordOf(deviceId);
    if (!record || !this.reachable.has(record.id) || !this.createdDevices().has(deviceId)) {
      return;
    }
    const transport = this.transportOf(record);
    if (this.transports.get(deviceId) === transport) {
      return;
    }
    this.transports.set(deviceId, transport);
    await this.gladys.publishTransports([{ external_id: deviceId, transport }]);
  }

  async publishAllTransports() {
    const created = this.createdDevices();
    const entries = [];
    for (const record of this.records) {
      const deviceId = this.gladys.externalIds(EXTERNAL_ID_TYPE, record.id).device;
      if (!this.reachable.has(record.id) || !created.has(deviceId)) {
        continue;
      }
      const transport = this.transportOf(record);
      if (this.transports.get(deviceId) !== transport) {
        this.transports.set(deviceId, transport);
        entries.push({ external_id: deviceId, transport });
      }
    }
    if (entries.length > 0) {
      await this.gladys
        .publishTransports(entries)
        .catch((err) => this.logger.warn(`Transport badges failed: ${reasonOf(err)}`));
    }
  }

  updateStatus() {
    const typed = this.config.addresses;
    const parts = [];
    let connected = false;
    if (typed.length === 0) {
      parts.push(T.noAddress);
    } else {
      const answering = typed.filter((a) => this.addresses.get(a)?.id).length;
      const tried = typed.filter((a) => this.addresses.get(a)?.lastTry !== undefined).length;
      if (tried > 0) {
        connected = answering > 0;
        parts.push(T.status(answering, typed.length));
      } else {
        // After a restart, before the first read (never sooner than the
        // interval): the outcome of the last read kept in /data.
        const restored = typed.filter((a) => this.data.lastReads[a]?.ok).length;
        connected = restored > 0;
        parts.push(
          restored > 0 ? T.restored(restored, typed.length, this.config.pollInterval) : T.waiting,
        );
      }
      if (!this.config.allowOpen) {
        parts.push(T.pulsesOff);
      }
    }
    const { invalidAddresses, keyProblem } = this.config;
    if (invalidAddresses.length > 0) {
      parts.push(T.invalidAddresses(invalidAddresses));
    }
    if (keyProblem) {
      parts.push(T.key[keyProblem]);
    }
    const refused = this.records.filter((r) => this.keyBlockOf(r)).map((r) => r.address || r.id);
    if (refused.length > 0) {
      parts.push(T.keyRefused(refused));
    }
    const paused = typed.filter((a) => this.blockOf(a));
    if (paused.length > 0) {
      parts.push(T.paused(paused));
    }
    const odd = typed.filter((a) => this.addresses.get(a)?.error === 'notController');
    if (odd.length > 0) {
      parts.push(T.notController(odd));
    }
    for (const [id, others] of this.duplicates) {
      const own = this.data.devices[id]?.address;
      if (own) {
        parts.push(T.sameController(id, [own, ...others]));
      }
    }
    for (const [address, [previous, next]] of this.moved) {
      parts.push(T.moved(address, previous, next));
    }
    const message = join(parts);
    const key = JSON.stringify([connected, message]);
    if (key === this.lastStatus) {
      return;
    }
    this.lastStatus = key;
    this.gladys
      .setConnectionStatus(connected, message)
      .catch((err) => this.logger.warn(`setConnectionStatus failed: ${reasonOf(err)}`));
  }

  /** The Discovery tab scan: the due addresses only, then the devices. */
  async scan() {
    await this.poll();
    await this.publishDevices();
    this.updateStatus();
  }

  /** "Check the controllers": what each address answered, read again only when due. */
  async checkControllers() {
    const typed = this.config.addresses;
    if (typed.length === 0) {
      return T.check.none;
    }
    if (await this.poll()) {
      await this.publishDevices();
    }
    this.updateStatus();
    const age = (status) => Math.max(0, Math.round((this.now() - status.lastTry) / 1000));
    const lines = typed.map((address) => {
      const status = this.addresses.get(address);
      if (!status || status.lastTry === undefined) {
        return T.check.pending(address);
      }
      if (status.id) {
        return T.check.ok(address, status.id, this.data.devices[status.id]?.name, age(status));
      }
      return T.check.failed(address, status.error ?? 'error', age(status));
    });
    lines.push(T.check.interval(this.config.pollInterval));
    return T.check.result(lines);
  }

  // --- Commands --------------------------------------------------------------

  refusal(text) {
    const error = new Error(word(text, this.config?.language ?? 'fr'));
    error.refusal = true;
    return error;
  }

  async setValue(_device, feature, value) {
    // The deadlines count from the arrival of the command, before any wait.
    const received = this.now();
    // Before the first start, or a feature not published: a refusal, never a
    // publication awaited by the ack.
    const target = this.data && this.config && this.features.get(feature?.external_id);
    const record = target && this.data.devices[target.id];
    if (!record) {
      throw this.refusal(ERRORS.unknownDevice);
    }
    if (target.key !== 'open' && target.key !== 'close') {
      throw this.refusal(ERRORS.readOnly);
    }
    if (strictNumber(value) !== BUTTON_PUSH.PRESSED) {
      throw this.refusal(ERRORS.badValue);
    }
    const action = target.key === 'open' ? this.openAction(record) : this.closeAction(record);
    this.checkOption(action);
    const ticket = {
      action,
      cancelled: false,
      sent: false,
      generation: this.generation,
      abort: new AbortController(),
    };
    if (action.cancelsOpening) {
      // The openings still waiting to leave are cancelled on arrival, before
      // any queue, queued ones included. Cancelling never sends anything.
      for (const pending of this.tickets.get(record.id) ?? []) {
        if (!pending.sent) {
          pending.cancelled = true;
          // Its connection attempt, if any, is dropped at once: the queue is free.
          pending.abort.abort();
        }
      }
    }
    // A pulse that cannot leave is refused at once, with its real reason:
    // one already left (a second would stop or reverse the door), or a guard
    // younger than its minimum (no read can lift it yet).
    this.checkJustCommanded(record);
    if (!action.cancelsOpening) {
      if (!this.tickets.has(record.id)) {
        this.tickets.set(record.id, new Set());
      }
      this.tickets.get(record.id).add(ticket);
    }
    // One queue per controller: a close waits behind a pulse in progress
    // (which it has cancelled if it had not left), never beside it. The wait
    // ends by sendBy - 200 ms: the answer always comes within 3.5 s.
    const previous = this.queues.get(record.id) ?? Promise.resolve();
    let timer;
    const turn = new Promise((resolve, reject) => {
      previous.then(resolve, resolve);
      timer = this.timers.setTimeout(
        () => {
          const flying = this.flights.get(record.id);
          reject(this.refusal(flying?.sent ? ERRORS.justCommanded : ERRORS.tooSlow));
        },
        Math.max(0, received + TIMINGS.commandSendBy - 200 - this.now()),
      );
    }).finally(() => this.timers.clearTimeout(timer));
    const run = turn.then(() => this.run(record, action, received, ticket));
    // The next command waits for this one AND everything before it.
    const tail = Promise.allSettled([previous, run]).then(() => {});
    this.queues.set(record.id, tail);
    try {
      return await run;
    } finally {
      this.tickets.get(record.id)?.delete(ticket);
      if (this.queues.get(record.id) === tail) {
        this.queues.delete(record.id);
      }
    }
  }

  /** Refuses at once a pulse while another one has left or a young guard holds. */
  checkJustCommanded(record) {
    if (this.flights.get(record.id)?.sent) {
      throw this.refusal(ERRORS.justCommanded);
    }
    const guard = this.data.guards[record.id];
    if (guard && this.now() < guard.until && this.now() - guard.at < TIMINGS.doorGuardMin) {
      throw this.refusal(ERRORS.justCommanded);
    }
  }

  /** The permission of a command, read now from the current configuration. */
  checkOption(action) {
    if (!this.config.allowOpen) {
      // Closing is the same pulse as opening (a door that changed since it
      // was read): both need the permission.
      throw this.refusal(action.key === 'open' ? ERRORS.openDisabled : ERRORS.closeDisabled);
    }
    if (!this.config.key) {
      throw this.refusal(ERRORS.noKey);
    }
  }

  /** Open: a pulse only to a door read closed. */
  openAction(record) {
    return {
      key: 'open',
      name: 'open (pulse)',
      plan: (reading, origin) => {
        this.checkGuard(record, reading, origin);
        if (reading.door === DOOR.OPEN) return { unchanged: true };
        if (reading.door !== DOOR.CLOSED) throw this.refusal(ERRORS.notClosed);
        return { from: DOOR.CLOSED, expect: DOOR.OPEN, command: 'open' };
      },
    };
  }

  /** Close: a pulse only to a door read open; it cancels the pending openings. */
  closeAction(record) {
    return {
      key: 'close',
      name: 'close (pulse)',
      cancelsOpening: true,
      plan: (reading, origin) => {
        this.checkGuard(record, reading, origin);
        if (reading.door === DOOR.CLOSED) return { unchanged: true };
        if (reading.door !== DOOR.OPEN) throw this.refusal(ERRORS.notOpen);
        return { from: DOOR.OPEN, expect: DOOR.CLOSED, command: 'close' };
      },
    };
  }

  nextSequence() {
    this.sequence += 1;
    return this.sequence;
  }

  /**
   * Whether a read lifts the guard: it shows the door where the pulse sent
   * it, it LEFT after the pulse (an answer generated before it says nothing
   * of it), and the door had the time to move away from its sensor reading
   * (a distance sensor sees the expected state before the end of travel).
   * The guard also ends 45 s after the pulse.
   */
  guardLifted(guard, reading, origin) {
    if (this.now() >= guard.until) {
      return true;
    }
    // In memory, the request numbers; after a restart (no number), the times.
    const after = guard.seq === undefined ? origin.at > guard.at : origin.seq > guard.seq;
    return after && reading.door === guard.expect && this.now() - guard.at >= TIMINGS.doorGuardMin;
  }

  /** Before a pulse: refused while the guard of the previous one holds. */
  checkGuard(record, reading, origin) {
    const guard = this.data.guards[record.id];
    if (!guard) {
      return;
    }
    if (this.guardLifted(guard, reading, origin)) {
      delete this.data.guards[record.id];
      this.persist();
      return;
    }
    throw this.refusal(ERRORS.justCommanded);
  }

  /** A read (polling, follow-up) may lift the guard, by the same rule. */
  liftGuard(record, reading, origin) {
    const guard = this.data.guards[record.id];
    if (guard && this.guardLifted(guard, reading, origin)) {
      delete this.data.guards[record.id];
      this.persist();
    }
  }

  /**
   * The guard of a pulse, set right before it leaves (beforeSend) and saved
   * at once: a restart while the pulse is out keeps it.
   */
  guardDoor(record, plan) {
    const guard = {
      from: plan.from,
      expect: plan.expect,
      at: this.now(),
      seq: this.nextSequence(),
      until: this.now() + TIMINGS.doorGuard,
    };
    this.data.guards[record.id] = guard;
    this.save();
    return guard;
  }

  /** The controller surely did nothing (a refusal): the guard of this pulse goes. */
  unguardDoor(record, guard) {
    if (guard && this.data.guards[record.id] === guard) {
      delete this.data.guards[record.id];
      this.save();
    }
  }

  /** One command: the fresh read with the identity, the plan, the pulse. */
  async run(record, action, received, ticket) {
    try {
      return await this.runCommand(record, action, received, ticket);
    } finally {
      if (this.flights.get(record.id) === ticket) {
        this.flights.delete(record.id);
      }
    }
  }

  async runCommand(record, action, received, ticket) {
    const sendBy = received + TIMINGS.commandSendBy;
    const answerBy = received + TIMINGS.commandAnswerBy;
    const check = () => {
      if (ticket.cancelled) throw this.refusal(ERRORS.cancelled);
      if (ticket.generation !== this.generation) throw this.refusal(ERRORS.configChanged);
      this.checkOption(action);
      if (!record.address || this.data.devices[record.id] !== record) {
        throw this.refusal(ERRORS.unknownDevice);
      }
      // A pause asked by the controller (429, 5xx) and a refused key hold
      // every pulse (a close is a pulse too).
      if (this.blockOf(record.address)) throw this.refusal(ERRORS.blocked);
      if (this.keyBlockOf(record)) throw this.refusal(ERRORS.keyRefused);
      if (this.now() > sendBy) throw this.refusal(ERRORS.tooSlow);
    };
    check();
    const address = record.address;
    const left = () => sendBy - this.now() - 200;
    let data;
    const origin = { seq: this.nextSequence(), at: this.now() };
    try {
      if (left() <= 0) throw this.refusal(ERRORS.tooSlow);
      data = await this.client.variables(address, {
        timeout: left(),
        signal: ticket.abort?.signal,
      });
    } catch (err) {
      if (err.refusal) throw err;
      if (err.kind === 'cancelled' || ticket.cancelled) throw this.refusal(ERRORS.cancelled);
      this.onFailure(address, err);
      if (err.kind === 'busy') throw this.refusal(ERRORS.blocked);
      throw this.refusal(
        err.kind === 'timeout' && left() <= 0 ? ERRORS.tooSlow : ERRORS.unknownState,
      );
    }
    // The controller at the address is this one (a DHCP lease may have
    // given the address to another one); an unreadable MAC is not "another".
    const identity = identityOf(data);
    if (!identity.id) {
      throw this.refusal(ERRORS.unknownState);
    }
    if (identity.id !== record.id) {
      if (ticket.generation === this.generation && record.address === address) {
        this.logger.warn(`${address} no longer answers as ${record.id}`);
        this.moved.set(address, [record.id, identity.id]);
        record.address = '';
        this.setReachable(record, false);
        this.persist();
      }
      throw this.refusal(ERRORS.unknownDevice);
    }
    const reading = readingOf(data);
    if (ticket.generation === this.generation) {
      // Shown in the background: the ack never waits for Gladys.
      this.recordValues(record, reading);
    }
    // Cancelled or no longer allowed while it read: said so before any other reason.
    check();
    // One pulse at a time: a second one would stop or reverse the door, and
    // the state just read does not show a pulse still in flight.
    const flying = this.flights.get(record.id);
    if (flying && flying !== ticket) {
      throw this.refusal(ERRORS.justCommanded);
    }
    const plan = action.plan(reading, origin);
    if (plan.unchanged) {
      // Already there: nothing sent.
      return;
    }
    this.flights.set(record.id, ticket);
    check();
    // Taken now: a key changed later starts a new generation, refused in beforeSend.
    const key = this.config.key;
    // From firmware 1.0.7, `close=1` / `open=1`: the controller checks the
    // door again on its own sensor when the request arrives; else the toggle.
    const command = reading.firmware >= TOGGLE_FREE_FIRMWARE ? plan.command : 'click';
    this.logger.info(`OpenGarage ${record.id}: ${action.name} (${command})`);
    let guard;
    let result;
    try {
      result = await this.client.command(address, key, command, {
        timeout: Math.max(100, answerBy - this.now()),
        signal: ticket.abort?.signal,
        sendWithin: sendBy - this.now(),
        // The very last check, right before the request leaves; the guard
        // is set (and saved) before the first byte.
        beforeSend: () => {
          check();
          ticket.sent = true;
          guard = this.guardDoor(record, plan);
        },
      });
    } catch (err) {
      if (err.beforeSend) {
        throw err;
      }
      const reason = reasonOf(err);
      if (!err.sent) {
        this.unguardDoor(record, guard);
        this.logger.warn(`OpenGarage ${record.id}: ${action.name} NOT sent (${reason})`);
        if (err.kind === 'cancelled' || ticket.cancelled) throw this.refusal(ERRORS.cancelled);
        throw this.refusal(err.kind === 'late' ? ERRORS.tooSlow : ERRORS.notSent(reason));
      }
      this.onFailure(address, err);
      this.followUp(record);
      if (err.kind === 'http' && err.status >= 400 && err.status <= 499) {
        this.unguardDoor(record, guard);
        this.logger.warn(`OpenGarage ${record.id}: ${action.name} refused (${reason})`);
        throw this.refusal(ERRORS.refusedHttp(reason));
      }
      // A silence, a dropped connection, a 5xx, an answer without a result:
      // the pulse may have reached the controller, the guard stays.
      this.logger.warn(`OpenGarage ${record.id}: ${action.name} sent, NOT confirmed (${reason})`);
      throw this.refusal(ERRORS.sentUnconfirmed(reason));
    }
    if (result === RESULT.UNAUTHORIZED) {
      this.unguardDoor(record, guard);
      this.onKeyRefused(record, key);
      throw this.refusal(ERRORS.keyRefusedNow);
    }
    if (result !== RESULT.SUCCESS) {
      this.unguardDoor(record, guard);
      this.logger.warn(`OpenGarage ${record.id}: ${action.name} refused (code ${result})`);
      throw this.refusal(ERRORS.refused(result));
    }
    this.onKeyAccepted(record, key);
    this.followUp(record);
  }

  /**
   * Reads after a command, spaced: a garage door moves for a while. One
   * series per controller: a new command replaces the reads of the previous
   * one, and a read shares the one of the polling if it runs. Never during a
   * pause nor sooner than a backoff.
   */
  followUp(record) {
    for (const handle of this.followUps.get(record.id) ?? []) {
      this.timers.clearTimeout(handle);
    }
    const handles = TIMINGS.followUps.map((delay) =>
      this.timers.setTimeout(() => {
        const address = record.address;
        const status = this.addresses.get(address);
        if (
          this.data.devices[record.id] !== record ||
          !address ||
          !this.config.addresses.includes(address) ||
          this.blockOf(address) ||
          (status?.failures > 0 && this.now() < status.next)
        ) {
          return;
        }
        this.read(address)
          .then((changed) => (changed ? this.publishDevices() : undefined))
          .then(() => this.updateStatus())
          .catch(() => this.logger.warn('Read after a command failed'));
      }, delay),
    );
    this.followUps.set(record.id, handles);
  }
}
