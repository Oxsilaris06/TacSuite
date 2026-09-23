#!/usr/bin/env node
/*
 * relay.mjs — Relais OsmAnd → PC-Tac.
 * =================================================================
 *
 * L'application OsmAnd (greffon « Enregistrement de trajet » → « Suivi en
 * ligne ») appelle une URL modèle en GET, un point par requête, mais un
 * navigateur ne reçoit pas de requête HTTP entrante : il faut un relais.
 * Ce relais met les points en mémoire (jamais sur disque) et les rend à
 * PC-Tac via GET /positions.
 *
 * Contraintes structurantes :
 *  - Zéro dépendance : uniquement la bibliothèque standard de Node
 *    (node:http, node:crypto, node:fs, node:path, node:url).
 *  - Derrière Tailscale Funnel, qui RETIRE son préfixe : les chemins reçus
 *    sont donc SANS `/osmand` (/p, /positions, /health).
 *  - Données sensibles (positions de gendarmes, relais exposé sur Internet) :
 *    aucun jeton, aucune readKey, aucune coordonnée ne doit sortir dans un
 *    journal ; la readKey et les jetons sont comparés à temps constant ; le
 *    jeton d'un opérateur n'apparaît JAMAIS dans la réponse de /positions.
 *  - Redémarrer le relais efface tout : c'est un choix assumé (pas de disque).
 *
 * Hors réseau, OsmAnd tamponne les points et les renvoie un par un au retour
 * du réseau : le relais reçoit donc des rafales, des points en retard, parfois
 * dans le désordre. Le seau à jetons (120 points, recharge 2/s) TOLÈRE cette
 * vidange de tampon sans se déclencher.
 */

import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/* ─── réglages par défaut (surchargeables par options ou variables d'env) ── */

const DEFAULT_TOKENS_FILE = path.join(HERE, 'tokens.json');
const DEFAULT_BASE = 'https://nico-ai-series-1.tailed318a.ts.net/osmand';
const DEFAULT_ALLOWED_ORIGINS = [
  'https://nico-ai-series-1.tailed318a.ts.net',
  // Origine GitHub Pages du dépôt (base `/TacSuite/` ⇒ origine seule).
  'https://oxsilaris06.github.io',
];
const DEFAULT_TTL_H = 12;

/** Points conservés au plus par opérateur (les plus anciens sortent). */
const MAX_POINTS = 500;
/** Seau du tampon OsmAnd : 120 requêtes, recharge 2/s. */
const BUCKET_SIZE = 120;
const BUCKET_REFILL_PER_S = 2;
/** Sans jeton valide : 30 requêtes par minute et par IP, puis 429. */
const IP_LIMIT = 30;
const IP_WINDOW_MS = 60_000;
/** Purge des points périmés : toutes les minutes. */
const PURGE_INTERVAL_MS = 60_000;
/** Tolérance d'horodatage : +5 min dans le futur, −24 h dans le passé. */
const TS_FUTURE_MS = 5 * 60_000;
const TS_PAST_MS = 24 * 60 * 60_000;
const SECONDS_CUTOFF = 1e12; // en dessous : ts exprimé en secondes → ×1000

/* ─── utilitaires ────────────────────────────────────────────────────────── */

function parseOrigins(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  return value.split(',').map((s) => s.trim()).filter(Boolean);
}

/** Comparaison à temps constant de deux chaînes, sans fuite de longueur. */
function constantEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) {
    // Longueurs différentes : on brûle quand même un temps comparable en
    // comparant l'un des tampons à lui-même, puis on rend faux.
    crypto.timingSafeEqual(ba, ba);
    return false;
  }
  return crypto.timingSafeEqual(ba, bb);
}

/** Identifiant STABLE et non réversible d'un jeton (jamais le jeton). */
function idOf(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex').slice(0, 12);
}

function truncateToken(token) {
  const s = String(token);
  return s.length <= 6 ? s : `${s.slice(0, 6)}…`;
}

function writeTokensFile(file, tokens) {
  fs.writeFileSync(file, `${JSON.stringify(tokens, null, 2)}\n`, { mode: 0o600 });
  try { fs.chmodSync(file, 0o600); } catch { /* best-effort (FS sans chmod) */ }
}

/**
 * Charge tokens.json. Le fichier est HORS dépôt et créé à la demande :
 *  - absent → créé avec une readKey neuve ;
 *  - présent sans readKey → readKey ajoutée ;
 *  - toujours en mode 0600.
 */
function loadTokensFile(file) {
  let tokens = null;
  try {
    const raw = fs.readFileSync(file, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      tokens = {
        readKey: typeof parsed.readKey === 'string' ? parsed.readKey : '',
        operators: parsed.operators && typeof parsed.operators === 'object' ? parsed.operators : {},
      };
    }
  } catch {
    tokens = null;
  }
  let changed = false;
  if (!tokens) { tokens = { readKey: '', operators: {} }; changed = true; }
  if (!tokens.readKey || tokens.readKey.length !== 64) {
    tokens.readKey = crypto.randomBytes(32).toString('hex');
    changed = true;
  }
  if (changed || !fs.existsSync(file)) {
    try { writeTokensFile(file, tokens); } catch { /* lecture seule : on continue en mémoire */ }
  }
  return tokens;
}

function num(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/* ─── construction du relais ─────────────────────────────────────────────── */

/**
 * Crée un relais (sans le démarrer). Exposé pour les tests : ils peuvent
 * injecter l'horloge (`now`) et un fichier de jetons temporaire.
 */
export function createRelay(options = {}) {
  const tokensFile = options.tokensFile ?? process.env.TOKENS_FILE ?? DEFAULT_TOKENS_FILE;
  const ttlH = Number(options.ttlH ?? process.env.TTL_H ?? DEFAULT_TTL_H);
  const allowedOrigins = options.allowedOrigins
    ?? parseOrigins(process.env.ALLOWED_ORIGINS)
    ?? DEFAULT_ALLOWED_ORIGINS;
  const base = options.base ?? process.env.PUBLIC_BASE ?? DEFAULT_BASE;
  const now = typeof options.now === 'function' ? options.now : () => Date.now();
  const log = typeof options.log === 'function' ? options.log : (line) => process.stdout.write(`${line}\n`);

  /** État en mémoire uniquement. Jamais écrit sur disque. */
  const state = {
    tokens: loadTokensFile(tokensFile),
    points: new Map(), // jeton → [{ ts, rx, lat, lon, ... }]
  };
  const buckets = new Map(); // jeton → { tokens, last }
  const ipCounts = new Map(); // ip → { start, count }

  function reloadTokens() {
    try {
      state.tokens = loadTokensFile(tokensFile);
    } catch { /* on conserve la config courante */ }
  }

  function findOperator(token) {
    if (typeof token !== 'string' || !token) return null;
    const operators = state.tokens.operators;
    let match = null;
    for (const candidate of Object.keys(operators)) {
      if (constantEqual(token, candidate)) match = candidate;
    }
    return match;
  }

  function checkReadKey(header) {
    const raw = typeof header === 'string' ? header : '';
    const prefix = 'Bearer ';
    if (!raw.startsWith(prefix)) return false;
    return constantEqual(raw.slice(prefix.length), state.tokens.readKey);
  }

  /** Seau à jetons par opérateur : tolère la vidange du tampon OsmAnd. */
  function takeBucket(token) {
    const t = now();
    let b = buckets.get(token);
    if (!b) { b = { tokens: BUCKET_SIZE, last: t }; buckets.set(token, b); }
    const elapsed = Math.max(0, t - b.last) / 1000;
    b.tokens = Math.min(BUCKET_SIZE, b.tokens + elapsed * BUCKET_REFILL_PER_S);
    b.last = t;
    if (b.tokens < 1) return false;
    b.tokens -= 1;
    return true;
  }

  function allowIp(ip) {
    const t = now();
    let e = ipCounts.get(ip);
    if (!e || t - e.start >= IP_WINDOW_MS) { e = { start: t, count: 0 }; ipCounts.set(ip, e); }
    e.count += 1;
    return e.count <= IP_LIMIT;
  }

  /** Retire les points de plus de ttlH heures (horloge de RÉCEPTION). */
  function purge() {
    const cutoff = now() - ttlH * 3600_000;
    for (const [token, list] of state.points) {
      const kept = list.filter((p) => p.rx > cutoff);
      if (kept.length) state.points.set(token, kept);
      else state.points.delete(token);
    }
  }

  function logLine(route, status, id) {
    const stamp = new Date(now()).toISOString();
    log(`${stamp} ${route} ${status}${id ? ` ${truncateToken(id)}` : ''}`);
  }

  function applyCors(req, res) {
    const origin = req.headers.origin;
    if (typeof origin === 'string' && allowedOrigins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
    }
  }

  function send(res, status, body, headers) {
    res.writeHead(status, headers || {});
    res.end(body ?? '');
  }

  function handleP(url, req, res) {
    const tokenRaw = url.searchParams.get('t') || '';
    const operator = findOperator(tokenRaw);
    if (!operator) {
      // Pas de jeton valide : limite par IP (freine la recherche de jetons).
      const ip = req.socket.remoteAddress || '?';
      if (!allowIp(ip)) { logLine('/p', 429, null); send(res, 429); return; }
      logLine('/p', 401, null);
      send(res, 401);
      return;
    }
    const id = idOf(operator);
    if (!takeBucket(operator)) { logLine('/p', 429, id); send(res, 429); return; }

    const lat = num(url.searchParams.get('lat'));
    const lon = num(url.searchParams.get('lon'));
    let ts = num(url.searchParams.get('ts'));
    if (lat === null || lon === null || ts === null || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      logLine('/p', 400, id);
      send(res, 400);
      return;
    }
    if (ts < SECONDS_CUTOFF) ts *= 1000; // OsmAnd peut envoyer des secondes
    const t = now();
    if (ts > t + TS_FUTURE_MS || ts < t - TS_PAST_MS) { logLine('/p', 400, id); send(res, 400); return; }

    const point = { ts, rx: t, lat, lon };
    for (const field of ['hdop', 'alt', 'speed', 'bearing']) {
      const v = num(url.searchParams.get(field));
      if (v !== null) point[field] = v;
    }

    let list = state.points.get(operator);
    if (!list) { list = []; state.points.set(operator, list); }
    // Doublon (même ts) : OsmAnd peut renvoyer un point dont il n'a pas vu la
    // réponse. On répond 200 sans restocker.
    const dup = list.some((p) => p.ts === ts);
    if (!dup) {
      list.push(point);
      if (list.length > MAX_POINTS) list.splice(0, list.length - MAX_POINTS);
    }
    logLine('/p', 200, id);
    // Corps vide, réponse immédiate : tant qu'OsmAnd n'a pas reçu 200, il
    // garde le point en tampon.
    send(res, 200);
  }

  function handlePositions(url, req, res) {
    applyCors(req, res);
    if (!checkReadKey(req.headers.authorization)) { logLine('/positions', 401, null); send(res, 401); return; }
    const sinceRaw = Number(url.searchParams.get('since') ?? 0);
    const since = Number.isFinite(sinceRaw) ? sinceRaw : 0;
    const operators = [];
    for (const [token, meta] of Object.entries(state.tokens.operators)) {
      const list = state.points.get(token) || [];
      const points = list.filter((p) => p.rx > since).sort((a, b) => a.ts - b.ts);
      operators.push({
        id: idOf(token),
        nom: typeof meta?.nom === 'string' ? meta.nom : '',
        fonction: typeof meta?.fonction === 'string' ? meta.fonction : '',
        points,
      });
    }
    logLine('/positions', 200, null);
    send(res, 200, JSON.stringify({ now: now(), operators }), { 'Content-Type': 'application/json' });
  }

  const server = http.createServer((req, res) => {
    let url;
    try { url = new URL(req.url || '/', 'http://relay.local'); }
    catch { send(res, 400); return; }
    const route = url.pathname;

    if (req.method === 'OPTIONS' && route === '/positions') {
      applyCors(req, res);
      res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Authorization');
      res.setHeader('Access-Control-Max-Age', '600');
      send(res, 204);
      return;
    }
    if (route === '/health' && req.method === 'GET') { send(res, 200, 'ok', { 'Content-Type': 'text/plain' }); return; }
    if (route === '/p' && req.method === 'GET') { handleP(url, req, res); return; }
    if (route === '/positions' && req.method === 'GET') { handlePositions(url, req, res); return; }
    if ((route === '/p' || route === '/positions' || route === '/health')) {
      res.setHeader('Allow', 'GET, OPTIONS');
      logLine(route, 405, null);
      send(res, 405);
      return;
    }
    logLine(route, 404, null);
    send(res, 404);
  });

  return {
    server, state, purge, reloadTokens, tokensFile, base, allowedOrigins,
    host: options.host ?? '127.0.0.1',
    port: options.port ?? Number(process.env.PORT ?? 9690),
  };
}

/** Démarre le relais et rend la main quand il écoute. */
export async function startRelay(options = {}) {
  const relay = createRelay(options);
  await new Promise((resolve) => relay.server.listen(relay.port, relay.host, resolve));
  const addr = relay.server.address();
  if (addr && typeof addr === 'object') relay.port = addr.port;
  relay.timer = setInterval(() => relay.purge(), PURGE_INTERVAL_MS);
  relay.timer.unref?.();
  relay.reloadTokens();
  // Rechargement à chaud : SIGHUP, ou modification du fichier de jetons.
  relay.onSigHup = () => relay.reloadTokens();
  process.on('SIGHUP', relay.onSigHup);
  try {
    relay.watcher = fs.watch(relay.tokensFile, () => relay.reloadTokens());
  } catch { relay.watcher = null; }
  relay.close = async () => {
    if (relay.timer) clearInterval(relay.timer);
    if (relay.watcher) relay.watcher.close();
    process.removeListener('SIGHUP', relay.onSigHup);
    await new Promise((resolve) => relay.server.close(resolve));
  };
  return relay;
}

/* ─── CLI ────────────────────────────────────────────────────────────────── */

function osmAndUrl(base, token) {
  return `${base.replace(/\/+$/, '')}/p?t=${token}`
    + '&lat={0}&lon={1}&ts={2}&hdop={3}&alt={4}&speed={5}&bearing={6}';
}

function cli(argv) {
  const file = process.env.TOKENS_FILE || DEFAULT_TOKENS_FILE;
  const base = process.env.PUBLIC_BASE || DEFAULT_BASE;
  const cmd = argv[2];
  if (!cmd) return 'serve';

  const tokens = loadTokensFile(file);

  if (cmd === 'add') {
    const nom = argv[3] || '';
    const fonction = argv[4] || '';
    if (!nom) { process.stderr.write('usage: node relay.mjs add "<nom>" "<fonction>"\n'); return 'error'; }
    const token = crypto.randomBytes(16).toString('hex');
    tokens.operators[token] = { nom, fonction };
    writeTokensFile(file, tokens);
    process.stdout.write(`Opérateur ajouté : ${nom} (${truncateToken(token)})\n`);
    process.stdout.write(`URL OsmAnd à coller :\n${osmAndUrl(base, token)}\n`);
    return 'done';
  }
  if (cmd === 'revoke') {
    const token = argv[3];
    if (!token || !(token in tokens.operators)) { process.stderr.write('jeton inconnu\n'); return 'error'; }
    delete tokens.operators[token];
    writeTokensFile(file, tokens);
    process.stdout.write(`Jeton révoqué : ${truncateToken(token)}\n`);
    return 'done';
  }
  if (cmd === 'list') {
    process.stdout.write(`readKey : ${truncateToken(tokens.readKey)}\n`);
    const entries = Object.entries(tokens.operators);
    if (!entries.length) process.stdout.write('aucun opérateur\n');
    for (const [token, meta] of entries) {
      process.stdout.write(`- ${truncateToken(token)} : ${meta?.nom || ''} ${meta?.fonction || ''}\n`);
    }
    return 'done';
  }
  process.stderr.write(`commande inconnue : ${cmd}\n`);
  return 'error';
}

const invokedDirectly = process.argv[1]
  && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (invokedDirectly) {
  const action = cli(process.argv);
  if (action === 'serve') {
    startRelay().then((relay) => {
      relay.server.on('listening', () => {
        process.stdout.write(`Relais OsmAnd sur http://${relay.host}:${relay.port}\n`);
        process.stdout.write(`Écoute /p, /positions, /health (le Funnel retire le préfixe /osmand).\n`);
      });
    }).catch((err) => {
      process.stderr.write(`échec du démarrage : ${err?.message || err}\n`);
      process.exit(1);
    });
  } else if (action === 'error') {
    process.exit(1);
  }
}
