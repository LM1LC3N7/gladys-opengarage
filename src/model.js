// -----------------------------------------------------------------------------
// Known controllers -> Gladys devices and values (pure).
//
// A known controller (a record of `devices` in /data, see src/store.js)
// becomes one Gladys device whose external ids are built from its MAC:
// `gladys.externalIds('opengarage', mac)`, whatever its address. Feature
// keys are frozen:
//
//   door         opening sensor (read only)
//   open, close  BUTTONS (push), never a switch
//   distance     distance sensor, cm (read only)
//   vehicle      presence sensor, binary (read only)
//   signal       Wi-Fi signal, 0-5 (read only)
//   temperature, humidity   when the controller has the sensor
//
// The door is never a switch nor a commandable binary: a "turn everything
// off/on" (voice assistants, HomeKit, scenes on switches) must never reach a
// garage door.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as C,
  DEVICE_FEATURE_TYPES as T,
  DEVICE_FEATURE_UNITS as U,
} from '@gladysassistant/integration-sdk';
import { DOOR, EXTERNAL_ID_TYPE, OPENING_SENSOR_STATE, VEHICLE } from './constants.js';
import { FEATURE_NAMES, word } from './i18n.js';
import { signalOf } from './opengarage/parse.js';

const sensor = (category, type, min, max, unit, extra = {}) => ({
  category,
  type,
  min,
  max,
  ...(unit ? { unit } : {}),
  read_only: true,
  has_feedback: false,
  keep_history: true,
  measure: true,
  ...extra,
});
const binarySensor = (category) => ({ ...sensor(category, T.SENSOR.BINARY, 0, 1), measure: false });
const button = () => ({
  category: C.BUTTON,
  type: T.BUTTON.PUSH,
  min: 0,
  max: 1,
  read_only: false,
  has_feedback: false,
  keep_history: false,
  command: true,
});

/** The features of a known controller: `[{ key, spec, name }]`, in a stable order. */
export function featuresOf(record) {
  const layout = record.layout ?? {};
  const out = [];
  const add = (key, spec, name) => out.push({ key, spec, name });
  add('door', binarySensor(C.OPENING_SENSOR), FEATURE_NAMES.door);
  add('open', button(), FEATURE_NAMES.open);
  add('close', button(), FEATURE_NAMES.close);
  if (layout.distance) {
    add(
      'distance',
      sensor(C.DISTANCE_SENSOR, T.SENSOR.INTEGER, 0, 2000, U.CM),
      FEATURE_NAMES.distance,
    );
  }
  if (layout.vehicle) {
    add('vehicle', binarySensor(C.PRESENCE_SENSOR), FEATURE_NAMES.vehicle);
  }
  if (layout.signal) {
    add('signal', sensor(C.SIGNAL, T.SIGNAL.QUALITY, 0, 5), FEATURE_NAMES.signal);
  }
  if (layout.temperature) {
    add(
      'temperature',
      sensor(C.TEMPERATURE_SENSOR, T.SENSOR.DECIMAL, -40, 85, U.CELSIUS),
      FEATURE_NAMES.temperature,
    );
  }
  if (layout.humidity) {
    add(
      'humidity',
      sensor(C.HUMIDITY_SENSOR, T.SENSOR.DECIMAL, 0, 100, U.PERCENT),
      FEATURE_NAMES.humidity,
    );
  }
  return out;
}

export function deviceName(record) {
  return (record.name || `OpenGarage ${record.id.slice(-6)}`).slice(0, 100);
}

/** The Gladys device of a known controller. */
export function buildDevice(gladys, record, { language }) {
  const ids = gladys.externalIds(EXTERNAL_ID_TYPE, record.id);
  const features = featuresOf(record).map(({ key, spec, name }) => {
    const feature = {
      name: word(name, language).slice(0, 100),
      external_id: ids.feature(key),
      category: spec.category,
      type: spec.type,
      min: spec.min,
      max: spec.max,
      read_only: spec.read_only,
      has_feedback: spec.has_feedback,
      keep_history: spec.keep_history,
    };
    if (spec.unit) {
      feature.unit = spec.unit;
    }
    return feature;
  });
  const params = [
    { name: 'IP_ADDRESS', value: record.address ?? '' },
    { name: 'MAC', value: record.id },
    { name: 'FIRMWARE', value: record.firmware ?? '' },
  ].filter((param) => param.value !== '');
  return {
    name: deviceName(record),
    external_id: ids.device,
    features,
    params,
    should_poll: false,
  };
}

/**
 * featureKey -> value from a reading (readingOf), only for the features the
 * controller has; a missing value is skipped, never 0, never NaN.
 */
export function valuesOf(record, reading) {
  const values = new Map();
  const keys = new Set(featuresOf(record).map((f) => f.key));
  const set = (key, value) => {
    if (typeof value === 'number' && Number.isFinite(value) && keys.has(key)) {
      values.set(key, value);
    }
  };
  if (reading.door === DOOR.CLOSED) {
    set('door', OPENING_SENSOR_STATE.CLOSE);
  } else if (reading.door !== undefined) {
    // Open, stopped part way, opening or closing: not closed.
    set('door', OPENING_SENSOR_STATE.OPEN);
  }
  set('distance', reading.distance === undefined ? undefined : Math.round(reading.distance));
  if (reading.vehicle === VEHICLE.ABSENT || reading.vehicle === VEHICLE.PRESENT) {
    set('vehicle', reading.vehicle);
  }
  set('signal', signalOf(reading.rssi));
  set(
    'temperature',
    reading.temperature === undefined ? undefined : Math.round(reading.temperature * 10) / 10,
  );
  set('humidity', reading.humidity === undefined ? undefined : Math.round(reading.humidity));
  return values;
}
