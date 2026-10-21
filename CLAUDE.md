# CLAUDE.md

Project rules for coding assistants (Claude Code reads this file) and for human
contributors.

## What this is

A Gladys Assistant **external integration** for OpenGarage controllers (local
HTTP API, no cloud): a Node.js service (Node 22+, ESM, no build step) that
runs in its own sandboxed Docker container and talks to Gladys through
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js),
its only runtime dependency. It started from the official JavaScript template
and the structure of LM1LC3N7/gladys-blebox, and ports open-garage (MIT). See
`TODO.md` for the status and the decisions.

## Commands

```bash
npm install
npm test                                  # node --test, the built-in runner
node --test test/app.test.js              # one file
node --test --test-name-pattern "guard"   # tests whose name matches
npm run cover                             # regenerate cover.png (800×534)
npm run lint                              # ESLint
npm run format:check                      # Prettier, as the CI runs it
npm run format                            # Prettier, fix in place
npx github:GladysAssistant/integration-store .   # store admission checks
```

The CI (`.github/workflows/ci.yml`) runs `format:check`, `lint` and `test` on
Node 22 and 24, and builds the Docker image: run the three commands before
pushing.

## Architecture

```
index.js                          SDK wiring only: src/handlers.js registered before connect()
src/handlers.js                   the SDK handlers -> OpenGarageApp (shared with the tests)
src/app.js                        OpenGarageApp: reads, identity, pauses, key holds, pulses, guard
src/opengarage/http.js            one HTTP request: deadline, size cap, sent flag, beforeSend
src/opengarage/client.js          GET /jc, GET /cc click, statuses -> error kinds
src/opengarage/parse.js           /jc -> identity, layout, reading (pure)
src/model.js                      controllers -> Gladys devices and values (pure)
src/publisher.js                  states within the rate limit (250/min), measures spaced
src/store.js                      /data/opengarage.json (controllers, pauses, guards), never a key
src/config.js                     DEFAULT_CONFIG (mirrors the manifest defaults) + normalization
src/constants.js, src/i18n.js     frozen keys, limits, timings; texts in English and French
scripts/cover.mjs                 cover.png generator (plain Node)
gladys-assistant-integration.json manifest: name, config_schema, actions, image...
docs/en.md, docs/fr.md            user documentation, re-hosted by Gladys (mandatory)
test/                             node --test, against the SDK's fake Gladys and fake controllers
.github/scripts/release.mjs       release helpers (manifest bump, changelog), tested in test/
```

## Rules

- **External ids are forever.** `gladys.externalIds('opengarage', mac)`,
  never a label nor an address. Feature keys, manifest keys and action keys
  are frozen too. A created device never loses a feature.
- **Safety.** The door is never a `switch` nor a commandable `binary`. The
  relay is a toggle: a pulse is decided on `/jc` read just now (MAC checked),
  "open" only from closed, "close" only from open, never from a moving,
  stopped or unknown door (an invalid distance without Security+ is
  unknown). Closing is the same pulse as opening: BOTH stay off by default
  (`allow_open`), checked on arrival, after the read and in `beforeSend`;
  one queue per controller, a close cancels the openings not sent yet.
  `close=1` / `open=1` from `fwv` 107, `click=1` before. A guard is set in
  `beforeSend` and lifted only by a read sent after the pulse, 15 s at
  least. Keep the tests that say so.
- **The device key** is never logged, never in a status, an error or `/data`
  (it travels in the `/cc` query string: never log a path). A `secret` field
  is kept by Gladys in its database, never shown again: never write that it
  is encrypted.
- **Reads** are never sooner than the interval (reconnection, saved config,
  scan, action, restart); a late answer of an older generation publishes
  nothing.
- **The container rootfs is read-only.** Write only under `/data`.
- **Versions belong to the Release workflow** (Actions → Release). Never edit
  `version` in `package.json`, `package-lock.json` or the manifest, nor the
  `docker_image` tag, by hand. `test/manifest.test.js` checks they agree.
- **Changelog.** Every user-visible change adds a line under `## [Unreleased]`
  in `CHANGELOG.md`. Never write a version heading.
- **Manifest.** Texts are `{ "en": ..., "fr": ... }` objects. The catalog
  `description` holds 10 to 100 characters per language.
- **Units.** Only the ones the core lists for the category
  (`DEVICE_FEATURE_UNITS_BY_CATEGORY` in `server/utils/constants.js`).
- **Style.** Prettier formats, ESLint catches mistakes. Comments explain why,
  in English. Tests never touch the network (loopback only).
- **Encoding.** Every file is UTF-8 without BOM; `test/encoding.test.js`
  refuses mojibake and control characters.
