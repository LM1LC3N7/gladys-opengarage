// -----------------------------------------------------------------------------
// The HTTP client against a real server on the loopback: the statuses, the
// size cap, the deadline, `sendWithin` and `beforeSend` (nothing written when
// they refuse), and the key in the query string, encoded, never in an error.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {
  OpenGarageClient,
  clickPath,
  commandPath,
  retryAfterOf,
} from '../src/opengarage/client.js';

async function server(t, handler) {
  const received = [];
  const srv = http.createServer((req, res) => {
    received.push(req.url);
    handler(req, res);
  });
  await new Promise((resolve) => srv.listen(0, '127.0.0.1', resolve));
  t.after(() => {
    srv.closeAllConnections();
    srv.close();
  });
  return { address: `127.0.0.1:${srv.address().port}`, received };
}

const json = (res, value, status = 200, headers = {}) => {
  res.writeHead(status, { 'content-type': 'application/json', ...headers });
  res.end(typeof value === 'string' ? value : JSON.stringify(value));
};

test('the key is encoded in the query string', () => {
  assert.equal(clickPath('a b&c=d'), '/cc?dkey=a%20b%26c%3Dd&click=1');
  assert.equal(commandPath('k', 'close'), '/cc?dkey=k&close=1');
  assert.equal(commandPath('k', 'open'), '/cc?dkey=k&open=1');
  assert.throws(() => commandPath('k', 'reboot'), { kind: 'invalid' });
});

test('/jc and a click, the result code given back', async (t) => {
  const { address, received } = await server(t, (req, res) =>
    req.url === '/jc' ? json(res, { door: 0, mac: '5C:CF:7F:01:02:03' }) : json(res, { result: 2 }),
  );
  const client = new OpenGarageClient();
  assert.equal((await client.variables(address)).door, 0);
  assert.equal(await client.click(address, 'k&1'), 2);
  assert.deepEqual(received, ['/jc', '/cc?dkey=k%261&click=1']);
});

test('statuses: 503 is a pause with Retry-After, 404 an HTTP refusal, never the path', async (t) => {
  let answer = 0;
  const { address } = await server(t, (req, res) => {
    answer += 1;
    if (answer === 1) json(res, 'busy', 503, { 'retry-after': '120' });
    else if (answer === 2) json(res, 'no', 404);
    else json(res, '[1,2]');
  });
  const client = new OpenGarageClient();
  await assert.rejects(client.click(address, 'secretkey'), (err) => {
    assert.equal(err.kind, 'busy');
    assert.equal(err.retryAfter, 120_000);
    assert.ok(err.sent);
    assert.ok(!JSON.stringify({ ...err, m: err.message }).includes('secretkey'));
    return true;
  });
  await assert.rejects(client.click(address, 'secretkey'), { kind: 'http', status: 404 });
  await assert.rejects(client.variables(address), { kind: 'invalid' });
});

test('an answer too large or too slow fails; a click without result is unconfirmed', async (t) => {
  const { address } = await server(t, (req, res) => {
    if (req.url === '/jc') {
      res.writeHead(200);
      res.end('x'.repeat(64 * 1024));
    } else if (req.url.startsWith('/cc')) {
      json(res, { result: 'ok' });
    }
  });
  const client = new OpenGarageClient();
  await assert.rejects(client.variables(address), { kind: 'tooLarge' });
  await assert.rejects(client.click(address, 'k'), { kind: 'invalid', sent: true });
  const silent = await server(t, () => {});
  await assert.rejects(client.variables(silent.address, { timeout: 200 }), {
    kind: 'timeout',
    sent: true,
  });
});

test('beforeSend refusing: nothing written; a closed port: unreachable, not sent', async (t) => {
  const { address, received } = await server(t, (req, res) => json(res, { result: 1 }));
  const client = new OpenGarageClient();
  const refusal = new Error('refused');
  await assert.rejects(
    client.click(address, 'k', {
      beforeSend: () => {
        throw refusal;
      },
    }),
    (err) => err === refusal && err.beforeSend === true && err.sent === false,
  );
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.deepEqual(received, []);
  await assert.rejects(client.variables('127.0.0.1:1', { timeout: 2000 }), {
    kind: 'unreachable',
    sent: false,
  });
});

test('Retry-After: seconds or a date, bounded input', () => {
  assert.equal(retryAfterOf('30'), 30_000);
  assert.equal(
    retryAfterOf('Thu, 01 Jan 2099 00:00:10 GMT', Date.parse('2099-01-01T00:00:00Z')),
    10_000,
  );
  assert.equal(retryAfterOf('x'.repeat(100)), undefined);
  assert.equal(retryAfterOf(undefined), undefined);
});
