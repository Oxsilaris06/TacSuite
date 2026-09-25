/**
 * osmand-live.ts — Seconde source de géoloc d'équipe : relais OsmAnd.
 * =================================================================
 *
 * L'application OsmAnd pousse ses points vers un relais (tools/osmand-relay),
 * qui les garde en mémoire. Ce module interroge ce relais toutes les 5 s et
 * pousse chaque point dans le MÊME entonnoir que Tchap :
 *
 *     upsert(`osmand:<id>`, lat, lon, ts)
 *
 * Le nom et la fonction de l'opérateur sont injectés là où Tchap range les
 * siens (`registerRemoteOperator` → `names` + `cfg.assign`), donc l'icône de
 * fonction, la couleur d'état et le libellé « [FONCTION] Nom » fonctionnent
 * sans aucun code d'affichage nouveau. Les deux sources peuvent tourner en
 * même temps.
 *
 * Données sensibles : la clé de lecture et les coordonnées ne doivent JAMAIS
 * finir dans un `console.*`. Les réglages vivent sous la clé COMMUNE
 * `pcTacOsmandRelay` (cf. SHARED_KEYS) et ne partent jamais dans une archive.
 */

import { Persist } from '@shared/persist.js';

import { acquireScreenWakeLock, registerRemoteOperator, releaseScreenWakeLock, upsert } from '@pctac/tchap-live.js';

const LS_KEY = 'pcTacOsmandRelay';
const DEFAULT_URL = 'https://nico-ai-series-1.tailed318a.ts.net/osmand';
/** Cadence nominale de sondage. */
const POLL_MS = 5000;
/** Recul en cas d'échec réseau : 5 s, 10 s, 20 s, 40 s, puis plafond 60 s. */
const BACKOFF_MS = [5000, 10000, 20000, 40000, 60000];
/** Bornes des `ts` mémorisés par opérateur (dédoublonnage D-6). */
const SEEN_MAX = 1000;

interface OsmandCfg {
  url?: string | undefined;
  key?: string | undefined;
}

interface RelayPoint {
  ts: number;
  rx: number;
  lat: number;
  lon: number;
}

interface RelayOperator {
  id: string;
  nom?: string | undefined;
  fonction?: string | undefined;
  points?: RelayPoint[] | undefined;
}

interface RelayResponse {
  now?: number | undefined;
  operators?: RelayOperator[] | undefined;
}

/* ─── état module ───────────────────────────────────────────────────────── */

const $ = (id: string): HTMLElement | null => document.getElementById(id);
function isCfg(v: unknown): v is OsmandCfg { return !!v && typeof v === 'object'; }

const cfg: OsmandCfg = Persist.get<OsmandCfg>(LS_KEY, { validator: isCfg, fallback: {} }) || {};
let running = false;
let aborter: AbortController | null = null;
let since = 0;
let backoffIdx = 0;
const known = new Set<string>();
/** `ts` déjà traités par opérateur : le `rx >= since` du relais (D-6) rejoue
 *  le point de bordure à chaque sondage, on l'ignore pour ne pas doubler la
 *  trace. Borné par opérateur. */
const seenTs = new Map<string, Set<number>>();

function saveCfg(): void { Persist.set(LS_KEY, cfg); }

function normalizeUrl(u: string): string { return u.replace(/\/+$/, ''); }

function setStatus(msg: string, kind: 'muted' | 'error' | 'ok' = 'muted'): void {
  const el = $('osm_status');
  if (!el) return;
  el.textContent = msg;
  el.style.color = kind === 'error'
    ? 'var(--danger-red, #f0556a)'
    : kind === 'ok'
      ? 'var(--ao-green, #2ecf91)'
      : 'var(--text-muted)';
}

function setButtons(): void {
  const s = $('osm_start'), t = $('osm_stop');
  if (s instanceof HTMLButtonElement) s.disabled = running;
  if (t instanceof HTMLButtonElement) t.disabled = !running;
}

/** Attend `ms`, mais se réveille à l'abandon (stop) ou au retour de l'onglet. */
function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const sig = aborter?.signal;
    const finish = (): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVis);
      sig?.removeEventListener('abort', onAbort);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    const onVis = (): void => { if (!document.hidden) finish(); };
    const onAbort = (): void => finish();
    document.addEventListener('visibilitychange', onVis);
    sig?.addEventListener('abort', onAbort, { once: true });
  });
}

/** Onglet caché : on ne sonde pas ; le retour rend la main immédiatement. */
async function waitVisible(): Promise<void> {
  while (running && document.hidden) await wait(POLL_MS);
}

function halt(): void {
  const wasRunning = running;
  running = false;
  aborter?.abort();
  aborter = null;
  // Ne relâche un verrou d'écran QUE si cette session OsmAnd en avait pris un :
  // un `halt()` de réinitialisation avant démarrage ne doit pas couper le verrou
  // d'un suivi Tchap simultané (même compteur partagé).
  if (wasRunning) releaseScreenWakeLock();
  setButtons();
}

function applyResponse(data: RelayResponse): void {
  const ops = Array.isArray(data.operators) ? data.operators : [];
  for (const op of ops) {
    if (!op || typeof op.id !== 'string') continue;
    const sender = `osmand:${op.id}`;
    registerRemoteOperator(sender, op.nom ?? null, op.fonction ?? null);
    known.add(op.id);
    const points = Array.isArray(op.points) ? op.points : [];
    let seen = seenTs.get(sender);
    if (!seen) { seen = new Set<number>(); seenTs.set(sender, seen); }
    // Le relais trie déjà par ts ; l'upsert gère en plus un point en retard
    // (tampon écoulé entre deux sondages) sans déplacer le marqueur.
    for (const p of points) {
      if (!p || !Number.isFinite(p.lat) || !Number.isFinite(p.lon) || !Number.isFinite(p.ts)) continue;
      // Point déjà vu (même opérateur, même `ts`) : le `rx >= since` du relais
      // le rejoue au sondage suivant. On l'ignore pour ne pas doubler la trace.
      if (seen.has(p.ts)) continue;
      seen.add(p.ts);
      if (seen.size > SEEN_MAX) {
        const oldest = seen.values().next().value;
        if (oldest !== undefined) seen.delete(oldest);
      }
      upsert(sender, p.lat, p.lon, p.ts);
    }
  }
}

async function loop(): Promise<void> {
  while (running) {
    await waitVisible();
    if (!running) return;
    try {
      const url = `${cfg.url ?? ''}/positions?since=${since}`;
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${cfg.key ?? ''}` },
        ...(aborter ? { signal: aborter.signal } : {}),
      });
      if (res.status === 401) {
        halt();
        setStatus('Clé de lecture refusée par le relais.', 'error');
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as RelayResponse;
      if (!running) return;
      if (typeof data.now === 'number' && Number.isFinite(data.now)) since = data.now;
      applyResponse(data);
      backoffIdx = 0;
      setStatus(`Suivi actif — ${known.size} opérateur(s) · reçu ${new Date().toLocaleTimeString()}.`, 'ok');
      await wait(POLL_MS);
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') return;
      if (!running) return;
      const delay = BACKOFF_MS[backoffIdx] ?? POLL_MS;
      backoffIdx = Math.min(backoffIdx + 1, BACKOFF_MS.length - 1);
      setStatus(`Relais injoignable — nouvel essai dans ${Math.round(delay / 1000)}s.`, 'error');
      await wait(delay);
    }
  }
}

export function start(): void {
  const urlEl = $('osm_url'), keyEl = $('osm_key');
  const rawUrl = (urlEl instanceof HTMLInputElement ? urlEl.value : '') || cfg.url || '';
  const rawKey = (keyEl instanceof HTMLInputElement ? keyEl.value : '') || cfg.key || '';
  const url = normalizeUrl(rawUrl.trim());
  const key = rawKey.trim();
  if (!url) { setStatus('URL du relais manquante.', 'error'); return; }
  if (!key) { setStatus('Clé de lecture manquante.', 'error'); return; }

  cfg.url = url; cfg.key = key; saveCfg();
  if (urlEl instanceof HTMLInputElement) urlEl.value = url;

  halt();
  running = true; since = 0; backoffIdx = 0; known.clear(); seenTs.clear();
  aborter = new AbortController();
  acquireScreenWakeLock();
  setButtons();
  setStatus('Connexion au relais…');
  void loop();
}

export function stop(): void {
  halt();
  setStatus('Arrêté.');
}

function persistFromInputs(): void {
  const urlEl = $('osm_url'), keyEl = $('osm_key');
  if (urlEl instanceof HTMLInputElement) cfg.url = normalizeUrl(urlEl.value.trim());
  if (keyEl instanceof HTMLInputElement) cfg.key = keyEl.value;
  saveCfg();
}

function wireUI(): void {
  if (!$('osm_url')) return;
  const urlEl = $('osm_url'); if (urlEl instanceof HTMLInputElement) urlEl.value = cfg.url || DEFAULT_URL;
  const keyEl = $('osm_key'); if (keyEl instanceof HTMLInputElement) keyEl.value = cfg.key || '';
  $('osm_start')?.addEventListener('click', start);
  $('osm_stop')?.addEventListener('click', stop);
  for (const id of ['osm_url', 'osm_key']) { const el = $(id); if (el) el.addEventListener('change', persistFromInputs); }
  setButtons();
  setStatus('Prêt.');
}

export const OsmandLive = { start, stop, wireUI };

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wireUI);
else wireUI();
