# gladys-opengarage

[Gladys Assistant](https://gladysassistant.com) external integration for
**OpenGarage** controllers, on the local network: the garage door (open or
closed, with Open and Close buttons), the distance sensor, the vehicle
detection, the Wi-Fi signal, and the temperature and humidity when a sensor is
fitted, through the local HTTP API of the controller, without the OpenGarage
cloud. Unofficial, not affiliated with OpenGarage.

User documentation: [docs/en.md](docs/en.md) · [docs/fr.md](docs/fr.md).

> **Work in progress.** First milestone, tested against fakes only, never with
> a real device.

## How it works

```
Gladys ⇄ SDK ⇄ src/handlers.js ⇄ src/app.js (OpenGarageApp)
                                   ├─ src/opengarage/http.js    one HTTP request (node:http): deadline, size cap, beforeSend
                                   ├─ src/opengarage/client.js  GET /jc, GET /cc?dkey=…&click=1, statuses -> kinds
                                   ├─ src/opengarage/parse.js   /jc -> identity (MAC), layout, reading (pure)
                                   ├─ src/model.js              controllers -> Gladys devices and values (pure)
                                   ├─ src/publisher.js          states within 250/min (Gladys: 300), measures spaced
                                   └─ src/store.js              /data/opengarage.json: controllers, pauses, guards
```

- **Controllers** are added by IP address (configuration). Each read of
  `GET /jc` carries the MAC, which identifies the controller (external ids
  `opengarage:<mac>`): a new IP address changes nothing, and a controller is
  identified again at every read and before every pulse.
- **Polling** every `poll_interval` seconds, never sooner (reconnection,
  configuration saved unchanged, scan, "Check" button, restart).
- **Commands**: `GET /cc?dkey=<key>&click=1`, one pulse of a **toggle** relay.
  "Open" is sent only to a door read closed just now, "Close" only to a door
  read open; moving, stopped or unknown is refused. Opening is off by default;
  closing is always allowed, never queued, and cancels a pending opening.
  After each pulse a guard (persisted) refuses another one until the door is
  read where the pulse sent it, or 45 s. See
  [docs/en.md](docs/en.md#command-safety).
- **The device key** is never logged, nor put in a status, an error or
  `/data` (only a salted fingerprint of a key a controller refused, removed at
  the first success).

## Development

```bash
npm install
npm test                                        # node --test, no network (loopback only)
npm run lint && npm run format:check
npm run audit
npm run cover                                   # regenerates cover.png (800×534, no dependency)
npx github:GladysAssistant/integration-store .  # store admission checks
```

`test/helpers/fakeOpenGarage.js` holds controllers answering like the
firmware behind a fake `request`; the end-to-end tests run the real handlers
against the SDK's fake Gladys.

## Credits

- [`open-garage`](https://github.com/Danielhiversen/pyOpenGarage) (MIT), the
  library behind the Home Assistant OpenGarage integration: the `/jc`
  variables, the door states, the `/cc` command and its result codes are
  taken from it (ported to JavaScript, no file copied). Notice in
  [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
- `src/publisher.js` and `src/opengarage/http.js` come from
  [LM1LC3N7/gladys-blebox](https://github.com/LM1LC3N7/gladys-blebox) (same
  author, Apache-2.0).

OpenGarage is a trademark of its owner, used here only to name the compatible
products.

## Releasing

**Actions → Release → Run workflow** (patch / minor / major): bumps the
version in `package.json` and the manifest, rolls `CHANGELOG.md`, tags, builds
the multi-arch image to GHCR and publishes the GitHub Release. The
`gladys-assistant-integration` topic is added at the first real release.

## License

Apache-2.0, see [LICENSE](LICENSE). Third-party notices (open-garage, MIT):
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
