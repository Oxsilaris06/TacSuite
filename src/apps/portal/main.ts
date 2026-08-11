/**
 * src/apps/portal/main.ts — page de garde TacSuite (portail).
 *
 * Trois comportements, volontairement minimalistes (c'est un portail, pas une
 * application) :
 *   1. bascule de thème clair/sombre, persistée sous une clé PROPRE au portail ;
 *   2. détection LECTURE SEULE de données locales PC-Tac / OI ;
 *   3. indicateur de connectivité (navigator.onLine + événements online/offline).
 *
 * INVARIANT : ce module n'écrit JAMAIS dans les clés des applications. Les seules
 * écritures autorisées visent `tacsuite.portal.theme`. En particulier la clé
 * `theme` (utilisée par PC-Tac et l'OI) n'est ni lue ni écrite ici, pour ne pas
 * télécommander le thème des applications depuis le portail.
 */

// Polices auto-hébergées (zéro CDN), sous-ensemble strict des besoins du portail :
// Oswald pour les titres, Inter pour l'UI. Pas de Material Symbols ici : les
// icônes du portail sont des SVG inline.
import '@fontsource/oswald/600.css';
import '@fontsource/oswald/700.css';
import '@fontsource/inter/400.css';
import '@fontsource/inter/600.css';

// Service Worker (PWA, offline-fallback) — même traitement que pctac/oi
// (P4.B), cf. src/shared/register-sw.ts.
import { registerServiceWorker } from '@shared/register-sw.js';

type Theme = 'light' | 'dark';

/** Clé de persistance du portail — distincte de la clé `theme` des applications. */
const THEME_KEY = 'tacsuite.portal.theme';

/** Clés inspectées en LECTURE SEULE pour le badge « données locales présentes ». */
const PCTAC_KEYS = ['pcTacLogData', 'pcTacPhotos', 'pcTacPlanShapes', 'pcTacDashboard'] as const;
const OI_KEYS = ['tactical_oi_data', 'oiFormDataLite', 'oiWizardStep'] as const;

/** Couleur de la barre système, alignée sur le fond du thème actif. */
const THEME_COLOR: Record<Theme, string> = { dark: '#0a0a0b', light: '#f7f8fa' };

const root = document.documentElement;

/* ── Stockage tolérant aux pannes (mode privé, quota, stockage désactivé) ──── */

function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/* ── 1. Thème ──────────────────────────────────────────────────────────────── */

function storedTheme(): Theme | null {
  const value = readStored(THEME_KEY);
  return value === 'light' || value === 'dark' ? value : null;
}

/** Thème réellement rendu : choix explicite, sinon préférence du système. */
function effectiveTheme(): Theme {
  const explicit = root.getAttribute('data-theme');
  if (explicit === 'light' || explicit === 'dark') return explicit;
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

function applyTheme(theme: Theme, persist: boolean): void {
  root.setAttribute('data-theme', theme);
  if (persist) {
    try {
      localStorage.setItem(THEME_KEY, theme);
      // U20 — pont de continuité : les apps (OI/PC-Tac) lisent la clé `theme`.
      localStorage.setItem('theme', theme);
    } catch {
      // Stockage indisponible : la bascule reste valable pour la session.
    }
  }
  syncThemeUi(theme);
}

function syncThemeUi(theme: Theme): void {
  const button = document.getElementById('theme-toggle');
  const label = document.getElementById('theme-toggle-label');
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');

  if (label) label.textContent = theme === 'dark' ? 'Sombre' : 'Clair';
  if (button) {
    // aria-pressed = « thème clair activé ? » ; le libellé accessible reste explicite.
    button.setAttribute('aria-pressed', String(theme === 'light'));
    button.setAttribute(
      'aria-label',
      theme === 'dark' ? 'Thème sombre actif — passer au thème clair' : 'Thème clair actif — passer au thème sombre',
    );
  }
  if (meta) meta.content = THEME_COLOR[theme];
}

function initTheme(): void {
  const stored = storedTheme();
  // Sans choix mémorisé on NE pose PAS data-theme : le CSS suit alors
  // prefers-color-scheme, et suivra aussi ses changements à chaud.
  syncThemeUi(stored ?? effectiveTheme());

  const button = document.getElementById('theme-toggle');
  button?.addEventListener('click', () => {
    applyTheme(effectiveTheme() === 'dark' ? 'light' : 'dark', true);
  });

  // Tant que l'utilisateur n'a rien choisi, on reflète les bascules système.
  window
    .matchMedia('(prefers-color-scheme: light)')
    .addEventListener('change', () => {
      if (!storedTheme()) syncThemeUi(effectiveTheme());
    });
}

/* ── 2. Détection de données locales (lecture seule) ───────────────────────── */

/** Vrai si au moins une clé porte un contenu non vide (`[]`/`{}` = vide). */
function hasLocalData(keys: readonly string[]): boolean {
  return keys.some((key) => {
    const raw = readStored(key);
    if (raw === null) return false;
    const trimmed = raw.trim();
    return trimmed !== '' && trimmed !== '[]' && trimmed !== '{}' && trimmed !== 'null';
  });
}

function initDataBadges(): void {
  const badges: ReadonlyArray<readonly [string, readonly string[]]> = [
    ['badge-pctac', PCTAC_KEYS],
    ['badge-oi', OI_KEYS],
  ];

  for (const [id, keys] of badges) {
    const el = document.getElementById(id);
    if (!el) continue;
    const present = hasLocalData(keys);
    el.dataset.present = String(present);
    if (present) el.title = 'Une session enregistrée sur cet appareil sera rouverte par l’application.';
  }
}

/* ── 3. Connectivité ───────────────────────────────────────────────────────── */

function initNetworkStatus(): void {
  const wrapper = document.getElementById('net-status');
  const label = document.getElementById('net-status-label');
  if (!wrapper || !label) return;

  const render = (): void => {
    const online = navigator.onLine;
    wrapper.dataset.online = String(online);
    label.textContent = online ? 'En ligne' : 'Hors ligne';
    wrapper.title = online
      ? 'Connexion réseau détectée.'
      : 'Aucune connexion : les applications restent utilisables, les fonds de carte non mis en cache seront absents.';
  };

  render();
  window.addEventListener('online', render);
  window.addEventListener('offline', render);
}

/* ── Amorçage ──────────────────────────────────────────────────────────────── */

initTheme();
initDataBadges();
initNetworkStatus();
registerServiceWorker('portal');
