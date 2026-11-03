const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const Module = require('node:module');
const ts = require('typescript');
const { WebSocket } = require('ws');
const filename = path.resolve(__dirname, '../src/plugin/squadWatcher.ts');
const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText;
const loaded = new Module(filename, module);
loaded.filename = filename;
loaded.paths = Module._nodeModulePaths(path.dirname(filename));
loaded._compile(compiled, filename);

test('dashboard authenticates HTTP and WebSocket; rejects foreign origin, host and missing token', { timeout: 10000 }, async t => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'opensquad-dashboard-'));
  let middleware;
  const token = 'test-session-token';
  const server = http.createServer((req, res) => middleware(req, res, () => res.end('index')));
  const plugin = loaded.exports.squadWatcherPlugin({ squadsDir: dir, token });
  assert.equal(plugin.transformIndexHtml()[0].attrs.content, token);
  plugin.configureServer({ httpServer: server, config: { server: {}, logger: { info() {}, warn() {}, error() {} } },
    middlewares: { use(fn) { middleware = fn; } } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await fsp.rm(dir, { recursive: true, force: true });
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(origin + '/api/snapshot')).status, 403);
  assert.equal((await fetch(origin + '/api/snapshot', { headers: { 'X-Opensquad-Token': token } })).status, 200);
  assert.equal((await fetch(origin + '/api/snapshot', { headers: { 'X-Opensquad-Token': token, Origin: 'https://evil.example' } })).status, 403);
  const badHostStatus = await new Promise(resolve => {
    http.get(origin, { headers: { Host: 'evil.example' } }, response => {
      response.resume();
      resolve(response.statusCode);
    });
  });
  assert.equal(badHostStatus, 403);
  async function connect(originHeader, auth) {
    const ws = new WebSocket(origin.replace('http:', 'ws:') + '/__squads_ws' + (auth ? `?token=${auth}` : ''), { origin: originHeader });
    return new Promise((resolve, reject) => {
      ws.on('unexpected-response', (_, response) => { response.resume(); ws.terminate(); resolve(response.statusCode); });
      ws.on('message', data => { ws.close(); resolve(JSON.parse(data).type); });
      ws.on('error', error => { if (!error.message.includes('closed before')) reject(error); });
    });
  }
  assert.equal(await connect('https://evil.example', token), 403);
  assert.equal(await connect(origin, null), 403);
  assert.equal(await connect(origin, 'wrong'), 403);
  assert.equal(await connect(origin, token), 'SNAPSHOT');
});
