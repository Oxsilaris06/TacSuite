/**
 * osmand-relay.test.ts — Tests du relais OsmAnd (§A du LOT E).
 *
 * Le relais est un module Node `.mjs` (node:http + node:crypto + node:fs,
 * aucune dépendance). Chaque test démarre un serveur sur un port éphémère
 * (`port: 0`) avec un `tokens.json` temporaire hors dépôt, puis l'arrête.
 *
 * L'horloge est injectable (`now`) : indispensable pour tester la purge TTL et
 * le seau à jetons sans attendre en temps réel.
 */

import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';

import { startRelay, clientIp, type Relay } from '../../tools/osmand-relay/relay.mjs';

const READ_KEY = 'a'.repeat(64);
const OP_TOKEN = 'b'.repeat(32);
const RELAY_PATH = path.resolve(process.cwd(), 'tools/osmand-relay/relay.mjs');

const open: Relay[] = [];

afterEach(async () => {
  while (open.length) {
    const relay = open.pop();
    if (relay) await relay.close();
  }
});

interface TokensFile { dir: string; file: string }

function makeTokensFile(operators: Record<string, { nom: string; fonction: string }> = {}): TokensFile {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'osmand-relay-'));
  const file = path.join(dir, 'tokens.json');
  fs.writeFileSync(file, JSON.stringify({ readKey: READ_KEY, operators }));
  return { dir, file };
}

async function start(tokensFile: string, options: { now?: () => number; ttlH?: number } = {}): Promise<Relay> {
  const relay = await startRelay({
    tokensFile,
    port: 0,
    log: () => { /* silencieux */ },
    ...(options.now ? { now: options.now } : {}),
    ...(options.ttlH !== undefined ? { ttlH: options.ttlH } : {}),
  });
  open.push(relay);
  return relay;
}

function urlOf(relay: Relay, route: string): string {
  return `http://127.0.0.1:${relay.port}${route}`;
}

async function sendPoint(relay: Relay, token: string, params: Record<string, string | number>): Promise<Response> {
  const qs = new URLSearchParams({ t: token, ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])) });
  return fetch(urlOf(relay, `/p?${qs.toString()}`));
}

async function positions(relay: Relay, key: string, since = 0): Promise<Response> {
  return fetch(urlOf(relay, `/positions?since=${since}`), { headers: { Authorization: `Bearer ${key}` } });
}

interface RawResult { status: number; headers: http.IncomingHttpHeaders; body: string }

/** Requête HTTP brute (fetch interdit d'écrire `Origin` : en-tête protégé). */
function raw(port: number, method: string, requestPath: string, headers: Record<string, string> = {}): Promise<RawResult> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: requestPath, method, headers }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

describe('Relais OsmAnd — réception /p', () => {
  it('accepte un jeton valide (200) et le point est relu par /positions', async () => {
    const { file } = makeTokensFile({ [OP_TOKEN]: { nom: 'Dupont', fonction: 'Inter' } });
    const relay = await start(file);
    const now = Date.now();

    const res = await sendPoint(relay, OP_TOKEN, { lat: 48.8566, lon: 2.3522, ts: now });
    expect(res.status).toBe(200);

    const body = (await (await positions(relay, READ_KEY)).json()) as {
      now: number;
      operators: Array<{ id: string; nom: string; fonction: string; points: Array<{ lat: number; lon: number; ts: number; rx: number }> }>;
    };
    expect(body.operators).toHaveLength(1);
    const op = body.operators[0];
    expect(op?.nom).toBe('Dupont');
    expect(op?.fonction).toBe('Inter');
    expect(op?.points).toHaveLength(1);
    expect(op?.points[0]?.lat).toBeCloseTo(48.8566, 5);
    expect(op?.points[0]?.lon).toBeCloseTo(2.3522, 5);
    expect(op?.points[0]?.rx).toBeGreaterThan(0);
  });

  it('rejette un jeton inconnu (401) sans rien stocker', async () => {
    const { file } = makeTokensFile({ [OP_TOKEN]: { nom: 'Dupont', fonction: 'Inter' } });
    const relay = await start(file);

    const res = await sendPoint(relay, 'c'.repeat(32), { lat: 48.8, lon: 2.3, ts: Date.now() });
    expect(res.status).toBe(401);

    const body = (await (await positions(relay, READ_KEY)).json()) as { operators: Array<{ points: unknown[] }> };
    expect(body.operators[0]?.points).toHaveLength(0);
  });

  it('rejette des coordonnées hors bornes (400)', async () => {
    const { file } = makeTokensFile({ [OP_TOKEN]: { nom: 'Dupont', fonction: 'Inter' } });
    const relay = await start(file);
    const now = Date.now();

    expect((await sendPoint(relay, OP_TOKEN, { lat: 91, lon: 2, ts: now })).status).toBe(400);
    expect((await sendPoint(relay, OP_TOKEN, { lat: 48, lon: 181, ts: now })).status).toBe(400);
    expect((await sendPoint(relay, OP_TOKEN, { lat: NaN, lon: 2, ts: now })).status).toBe(400);
  });

  it('convertit un ts en secondes (< 1e12) en millisecondes', async () => {
    const { file } = makeTokensFile({ [OP_TOKEN]: { nom: 'Dupont', fonction: 'Inter' } });
    const clock = Date.now();
    const relay = await start(file, { now: () => clock });
    const seconds = Math.floor(clock / 1000);

    expect((await sendPoint(relay, OP_TOKEN, { lat: 48, lon: 2, ts: seconds })).status).toBe(200);
    const body = (await (await positions(relay, READ_KEY)).json()) as { operators: Array<{ points: Array<{ ts: number }> }> };
    expect(body.operators[0]?.points[0]?.ts).toBe(seconds * 1000);
  });

  it('ne restocke pas un doublon (même jeton, même ts)', async () => {
    const { file } = makeTokensFile({ [OP_TOKEN]: { nom: 'Dupont', fonction: 'Inter' } });
    const relay = await start(file);
    const now = Date.now();

    expect((await sendPoint(relay, OP_TOKEN, { lat: 48, lon: 2, ts: now })).status).toBe(200);
    expect((await sendPoint(relay, OP_TOKEN, { lat: 48.1, lon: 2.1, ts: now })).status).toBe(200);

    const body = (await (await positions(relay, READ_KEY)).json()) as { operators: Array<{ points: unknown[] }> };
    expect(body.operators[0]?.points).toHaveLength(1);
  });

  it('rend les points triés par ts croissant même reçus dans le désordre', async () => {
    const { file } = makeTokensFile({ [OP_TOKEN]: { nom: 'Dupont', fonction: 'Inter' } });
    const clock = Date.now();
    const relay = await start(file, { now: () => clock });

    await sendPoint(relay, OP_TOKEN, { lat: 48, lon: 2, ts: clock - 3000 });
    await sendPoint(relay, OP_TOKEN, { lat: 48.3, lon: 2.3, ts: clock - 1000 });
    await sendPoint(relay, OP_TOKEN, { lat: 48.1, lon: 2.1, ts: clock - 2000 });

    const body = (await (await positions(relay, READ_KEY)).json()) as { operators: Array<{ points: Array<{ ts: number }> }> };
    const tsList = body.operators[0]?.points.map((p) => p.ts) ?? [];
    expect(tsList).toEqual([...tsList].sort((a, b) => a - b));
    expect(tsList).toHaveLength(3);
  });
});

describe('Relais OsmAnd — limite de débit', () => {
  it('tolère 120 points tamponnés puis renvoie 429 au 121e (horloge gelée)', async () => {
    const { file } = makeTokensFile({ [OP_TOKEN]: { nom: 'Dupont', fonction: 'Inter' } });
    const frozen = Date.now();
    const relay = await start(file, { now: () => frozen });

    let last = 200;
    for (let i = 0; i < 121; i++) {
      // ts distinct pour que chaque point soit un vrai point (pas un doublon).
      const res = await sendPoint(relay, OP_TOKEN, { lat: 48, lon: 2, ts: frozen - 121 + i });
      last = res.status;
      if (i < 120) expect(res.status).toBe(200);
    }
    expect(last).toBe(429);
  });
});

describe('Relais OsmAnd — lecture /positions', () => {
  it('exige la readKey (401 sans clé)', async () => {
    const { file } = makeTokensFile({ [OP_TOKEN]: { nom: 'Dupont', fonction: 'Inter' } });
    const relay = await start(file);
    expect((await fetch(urlOf(relay, '/positions?since=0'))).status).toBe(401);
    expect((await positions(relay, 'mauvaise')).status).toBe(401);
  });

  it("n'expose jamais le jeton brut dans la réponse", async () => {
    const { file } = makeTokensFile({ [OP_TOKEN]: { nom: 'Dupont', fonction: 'Inter' } });
    const relay = await start(file);
    await sendPoint(relay, OP_TOKEN, { lat: 48, lon: 2, ts: Date.now() });

    const text = await (await positions(relay, READ_KEY)).text();
    expect(text).not.toContain(OP_TOKEN);
    expect(text).not.toContain(READ_KEY);
    const parsed = JSON.parse(text) as { operators: Array<{ id: string }> };
    expect(parsed.operators[0]?.id).toHaveLength(12);
  });

  it('ne rend que les points reçus depuis `since`, borne incluse (D-6)', async () => {
    const { file } = makeTokensFile({ [OP_TOKEN]: { nom: 'Dupont', fonction: 'Inter' } });
    let clock = Date.now();
    const relay = await start(file, { now: () => clock });

    await sendPoint(relay, OP_TOKEN, { lat: 48, lon: 2, ts: clock - 1000 });
    const first = (await (await positions(relay, READ_KEY)).json()) as { now: number };
    clock += 50;
    await sendPoint(relay, OP_TOKEN, { lat: 48.1, lon: 2.1, ts: clock - 1000 });

    // Depuis `first.now` : le premier point a rx == since, il est rendu — c'est
    // tout le correctif D-6 (le `>` strict le sautait).
    const after = (await (await positions(relay, READ_KEY, first.now)).json()) as { operators: Array<{ points: unknown[] }> };
    expect(after.operators[0]?.points).toHaveLength(2);

    // Strictement après : seul le second point reste (le filtre existe encore).
    const strict = (await (await positions(relay, READ_KEY, first.now + 1)).json()) as { operators: Array<{ points: unknown[] }> };
    expect(strict.operators[0]?.points).toHaveLength(1);
  });
});

describe('clientIp — choix de l’IP de limite (D-4)', () => {
  it('boucle locale : première valeur de X-Forwarded-For, espaces retirés, bornée à 64', () => {
    expect(clientIp('127.0.0.1', '6.6.6.6')).toBe('6.6.6.6');
    expect(clientIp('::1', ' 1.1.1.1 , 2.2.2.2')).toBe('1.1.1.1');
    expect(clientIp('::ffff:127.0.0.1', 'a'.repeat(100))).toBe('a'.repeat(64));
  });

  it('boucle locale sans en-tête exploitable : adresse du socket', () => {
    expect(clientIp('127.0.0.1', undefined)).toBe('127.0.0.1');
    expect(clientIp('::1', '')).toBe('::1');
    expect(clientIp('127.0.0.1', '   ')).toBe('127.0.0.1');
  });

  it("hors boucle locale : l'en-tête est ignoré, l'adresse du socket prime", () => {
    expect(clientIp('203.0.113.9', '6.6.6.6')).toBe('203.0.113.9');
  });
});

describe('Relais OsmAnd — limite par IP derrière le Funnel (D-4)', () => {
  it('suit la première IP de X-Forwarded-For quand le socket est en boucle locale', async () => {
    const { file } = makeTokensFile({ [OP_TOKEN]: { nom: 'Dupont', fonction: 'Inter' } });
    const relay = await start(file);
    const bad = 'z'.repeat(32);

    // 30 requêtes pour 1.1.1.1 : sous le quota, chacune répond 401.
    for (let i = 0; i < 30; i++) {
      const r = await raw(relay.port, 'GET', `/p?t=${bad}`, { 'X-Forwarded-For': '1.1.1.1' });
      expect(r.status).toBe(401);
    }
    // 31e de la même IP : quota épuisé.
    expect((await raw(relay.port, 'GET', `/p?t=${bad}`, { 'X-Forwarded-For': '1.1.1.1' })).status).toBe(429);
    // Une AUTRE IP a son propre quota : elle passe encore.
    expect((await raw(relay.port, 'GET', `/p?t=${bad}`, { 'X-Forwarded-For': '2.2.2.2' })).status).toBe(401);

    expect(relay.ipCounts.has('1.1.1.1')).toBe(true);
    expect(relay.ipCounts.has('2.2.2.2')).toBe(true);
    expect(relay.ipCounts.has('127.0.0.1')).toBe(false);
  });

  it("sans X-Forwarded-For, la limite retombe sur l'adresse du socket", async () => {
    const { file } = makeTokensFile();
    const relay = await start(file);
    const bad = 'z'.repeat(32);
    expect((await raw(relay.port, 'GET', `/p?t=${bad}`)).status).toBe(401);
    expect(relay.ipCounts.has('127.0.0.1')).toBe(true);
  });
});

describe('Relais OsmAnd — purge TTL', () => {
  it('purge les points reçus depuis plus de TTL_H heures (horloge injectable)', async () => {
    const { file } = makeTokensFile({ [OP_TOKEN]: { nom: 'Dupont', fonction: 'Inter' } });
    let clock = Date.now();
    const relay = await start(file, { now: () => clock, ttlH: 12 });

    await sendPoint(relay, OP_TOKEN, { lat: 48, lon: 2, ts: clock });

    clock += 11 * 3600_000;
    relay.purge();
    let body = (await (await positions(relay, READ_KEY)).json()) as { operators: Array<{ points: unknown[] }> };
    expect(body.operators[0]?.points).toHaveLength(1);

    clock += 2 * 3600_000;
    relay.purge();
    body = (await (await positions(relay, READ_KEY)).json()) as { operators: Array<{ points: unknown[] }> };
    expect(body.operators[0]?.points).toHaveLength(0);
  });
});

describe('Relais OsmAnd — CORS', () => {
  it("reflète une origine autorisée et n'émet aucun en-tête pour une autre", async () => {
    const { file } = makeTokensFile({ [OP_TOKEN]: { nom: 'Dupont', fonction: 'Inter' } });
    const relay = await startRelay({
      tokensFile: file, port: 0, log: () => { },
      allowedOrigins: ['https://autorisee.example'],
    });
    open.push(relay);

    const ok = await raw(relay.port, 'GET', '/positions?since=0', {
      Authorization: `Bearer ${READ_KEY}`, Origin: 'https://autorisee.example',
    });
    expect(ok.status).toBe(200);
    expect(ok.headers['access-control-allow-origin']).toBe('https://autorisee.example');
    expect(ok.headers['vary']).toContain('Origin');

    const ko = await raw(relay.port, 'GET', '/positions?since=0', {
      Authorization: `Bearer ${READ_KEY}`, Origin: 'https://inconnue.example',
    });
    expect(ko.status).toBe(200);
    expect(ko.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('répond au préflight OPTIONS avec Authorization autorisé', async () => {
    const { file } = makeTokensFile();
    const relay = await startRelay({
      tokensFile: file, port: 0, log: () => { },
      allowedOrigins: ['https://autorisee.example'],
    });
    open.push(relay);

    const res = await raw(relay.port, 'OPTIONS', '/positions', {
      Origin: 'https://autorisee.example',
      'Access-Control-Request-Method': 'GET',
      'Access-Control-Request-Headers': 'authorization',
    });
    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe('https://autorisee.example');
    expect(String(res.headers['access-control-allow-headers']).toLowerCase()).toContain('authorization');
  });
});

describe('Relais OsmAnd — divers', () => {
  it('sert /health (200 ok) et 404 sur un chemin inconnu, 405 sur mauvaise méthode', async () => {
    const { file } = makeTokensFile();
    const relay = await start(file);
    const health = await fetch(urlOf(relay, '/health'));
    expect(health.status).toBe(200);
    expect(await health.text()).toBe('ok');
    expect((await fetch(urlOf(relay, '/inconnu'))).status).toBe(404);
    expect((await raw(relay.port, 'POST', '/p', {})).status).toBe(405);
  });

  it('CLI add/list/revoke écrit le fichier de jetons', () => {
    const { file } = makeTokensFile();
    const out = execFileSync(process.execPath, [RELAY_PATH, 'add', 'Martin', 'Medic'], {
      env: { ...process.env, TOKENS_FILE: file }, encoding: 'utf8',
    });
    expect(out).toContain('Martin');
    expect(out).toContain('/p?t=');

    let tokens = JSON.parse(fs.readFileSync(file, 'utf8')) as { operators: Record<string, { nom: string }> };
    const token = Object.keys(tokens.operators)[0];
    expect(token).toBeDefined();
    expect(token).toHaveLength(32);

    const list = execFileSync(process.execPath, [RELAY_PATH, 'list'], {
      env: { ...process.env, TOKENS_FILE: file }, encoding: 'utf8',
    });
    expect(list).toContain('Martin');
    expect(list).not.toContain(token); // tronqué à 6 caractères

    execFileSync(process.execPath, [RELAY_PATH, 'revoke', token as string], {
      env: { ...process.env, TOKENS_FILE: file }, encoding: 'utf8',
    });
    tokens = JSON.parse(fs.readFileSync(file, 'utf8')) as { operators: Record<string, { nom: string }> };
    expect(Object.keys(tokens.operators)).toHaveLength(0);
  });
});

describe('Relais OsmAnd — renouvellement après fuite (revue dev D-13)', () => {
  it('rotate-key remplace la readKey ; rotate remplace le jeton d’un opérateur en gardant son nom', () => {
    const { file } = makeTokensFile();
    const env = { ...process.env, TOKENS_FILE: file };
    execFileSync(process.execPath, [RELAY_PATH, 'add', 'Martin', 'Medic'], { env, encoding: 'utf8' });
    const before = JSON.parse(fs.readFileSync(file, 'utf8')) as { readKey: string; operators: Record<string, { nom: string }> };
    const oldToken = Object.keys(before.operators)[0] as string;

    const outKey = execFileSync(process.execPath, [RELAY_PATH, 'rotate-key'], { env, encoding: 'utf8' });
    const afterKey = JSON.parse(fs.readFileSync(file, 'utf8')) as { readKey: string };
    expect(afterKey.readKey).toHaveLength(64);
    expect(afterKey.readKey).not.toBe(before.readKey);
    expect(outKey).toContain(afterKey.readKey);

    const outTok = execFileSync(process.execPath, [RELAY_PATH, 'rotate', oldToken], { env, encoding: 'utf8' });
    const after = JSON.parse(fs.readFileSync(file, 'utf8')) as { operators: Record<string, { nom: string }> };
    const tokens = Object.keys(after.operators);
    expect(tokens).toHaveLength(1);
    expect(tokens[0]).not.toBe(oldToken);
    expect(after.operators[tokens[0] as string]?.nom).toBe('Martin');
    expect(outTok).toContain(`/p?t=${tokens[0]}`);
  });
});

describe('Relais OsmAnd — mémoire bornée des compteurs', () => {
  it('purge les entrées de limite par IP expirées (aucune fuite)', async () => {
    const { file } = makeTokensFile({ [OP_TOKEN]: { nom: 'Dupont', fonction: 'Inter' } });
    let clock = Date.now();
    const relay = await start(file, { now: () => clock });

    // Jeton invalide : une entrée par IP est créée pour freiner la recherche.
    await sendPoint(relay, 'f'.repeat(32), { lat: 48, lon: 2, ts: clock });
    expect(relay.ipCounts.size).toBe(1);

    // Une fois la fenêtre écoulée, la purge doit évincer l'entrée : sinon la
    // table grossit à chaque IP vue une seule fois (fuite mémoire).
    clock += 60_001;
    relay.purge();
    expect(relay.ipCounts.size).toBe(0);
  });

  it("purge le seau d'un jeton qui n'est plus un opérateur (révoqué)", async () => {
    const { file } = makeTokensFile({ [OP_TOKEN]: { nom: 'Dupont', fonction: 'Inter' } });
    const relay = await start(file);

    await sendPoint(relay, OP_TOKEN, { lat: 48, lon: 2, ts: Date.now() });
    expect(relay.buckets.size).toBe(1);

    fs.writeFileSync(file, JSON.stringify({ readKey: READ_KEY, operators: {} }));
    relay.reloadTokens();
    relay.purge();
    expect(relay.buckets.size).toBe(0);
  });
});
