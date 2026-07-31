/**
 * persist.ts — Couche de persistance transactionnelle pour PC-Tac.
 * =================================================================
 *
 * Port TypeScript de `modules/pctac/persist.js` (GStart-main, 258 LOC),
 * vérifié ligne à ligne. Module STANDALONE : aucune dépendance de projet
 * (seuls des `import type` vers les contrats), "aucun cycle possible" —
 * c'est le socle "Fondations" sur lequel PC-Tac lit/écrit localStorage de
 * façon défensive et 100% hors-ligne. Jamais posé sur `window`
 * (cf. docs/SPEC-CONTRATS.md §2.0) : uniquement consommé par `import`.
 *
 * Principes de conception (terrain : stress, gants, mobile, batterie, offline) :
 *  - Ne JAMAIS jeter sur dépassement de quota : on dégrade proprement et on
 *    prévient l'UI via un évènement window 'pctac:quota'.
 *  - Tolérer un localStorage totalement indisponible (mode privé, stockage
 *    désactivé, sandbox) : toutes les opérations dégradent sans planter.
 *  - À la lecture, si le JSON est corrompu OU si le validateur rejette la
 *    donnée, on sauvegarde la chaîne brute dans `<key>.bak` (best-effort) afin
 *    de ne jamais perdre silencieusement des données opérationnelles, puis on
 *    retourne le fallback fourni.
 */

import type {
  PctacQuotaEventDetail,
  PersistContract,
  PersistGetOptions,
  PersistWriteResult,
} from './types/contracts.js';

/** Augmente `WindowEventMap` pour typer `addEventListener('pctac:quota', …)`. */
declare global {
  interface WindowEventMap {
    'pctac:quota': CustomEvent<PctacQuotaEventDetail>;
  }
}

/* ------------------------------------------------------------------------- *
 * Accès bas niveau au localStorage, tolérant à son indisponibilité.
 * On encapsule chaque accès dans un try/catch : selon le navigateur et le
 * contexte (mode privé, quota déjà plein, stockage bloqué par politique),
 * la simple lecture de `window.localStorage` peut lever une exception.
 * ------------------------------------------------------------------------- */

/** Retourne l'objet localStorage s'il est utilisable, sinon null (persist.js:34-44). */
function getStore(): Storage | null {
  try {
    // L'accès lui-même peut jeter (SecurityError) dans certains contextes.
    const ls =
      typeof window !== 'undefined' && window.localStorage
        ? window.localStorage
        : typeof localStorage !== 'undefined'
          ? localStorage
          : null;
    return ls ?? null;
  } catch {
    return null;
  }
}

/**
 * Détection robuste d'une erreur de dépassement de quota, indépendamment du
 * navigateur (persist.js:53-61). Firefox utilise un name spécifique ;
 * certains moteurs ne renseignent que le code (22 pour la plupart, 1014 pour
 * l'ancien Firefox).
 */
function isQuotaError(e: unknown): boolean {
  if (!e || typeof e !== 'object') return false;
  const err = e as { name?: unknown; code?: unknown };
  return (
    err.name === 'QuotaExceededError' ||
    err.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
    err.code === 22 ||
    err.code === 1014
  );
}

/**
 * Tente d'obtenir une estimation de l'occupation du stockage (persist.js:70-83).
 * `navigator.storage.estimate()` est asynchrone : on l'utilise en best-effort
 * sans bloquer la signalisation du quota (le détail de l'évènement est
 * complété a posteriori si la promesse se résout à temps).
 */
function fillEstimate(detail: PctacQuotaEventDetail): void {
  try {
    if (
      typeof navigator !== 'undefined' &&
      navigator.storage &&
      typeof navigator.storage.estimate === 'function'
    ) {
      // Best-effort : on enrichit le detail si l'estimation arrive vite.
      navigator.storage
        .estimate()
        .then((est) => {
          detail.estimate = est ?? null;
        })
        .catch(() => {
          /* silencieux : non bloquant */
        });
    }
  } catch {
    /* navigator.storage indisponible : on ignore. */
  }
}

/**
 * Émet l'évènement window 'pctac:quota' pour signaler à l'UI une saturation
 * du stockage. Ne jette jamais (best-effort) — persist.js:91-105.
 */
function dispatchQuota(key: string): { ok: false; quota: true } {
  const detail: PctacQuotaEventDetail = { key, estimate: null };
  // On lance l'estimation (asynchrone) qui complètera `detail.estimate`.
  fillEstimate(detail);
  try {
    if (
      typeof window !== 'undefined' &&
      typeof window.dispatchEvent === 'function' &&
      typeof CustomEvent === 'function'
    ) {
      window.dispatchEvent(new CustomEvent<PctacQuotaEventDetail>('pctac:quota', { detail }));
    }
  } catch {
    /* dispatch impossible : on dégrade silencieusement. */
  }
  return { ok: false, quota: true };
}

/**
 * Sauvegarde best-effort d'une chaîne brute dans `<key>.bak` (persist.js:114-124).
 * Utilisé lorsqu'une donnée lue est corrompue ou rejetée par le validateur :
 * on préserve l'original avant de retourner le fallback. Ne jette jamais.
 */
function backupRaw(key: string, raw: string | null): void {
  if (raw == null) return;
  const store = getStore();
  if (!store) return;
  try {
    store.setItem(`${key}.bak`, raw);
  } catch {
    // La sauvegarde de secours est non critique (souvent un quota plein) :
    // on n'aggrave pas la situation, on ignore.
  }
}

/* ------------------------------------------------------------------------- *
 * API publique : Persist
 * ------------------------------------------------------------------------- */

export const Persist: PersistContract = {
  /**
   * Lit une valeur JSON depuis le localStorage (persist.js:147-189).
   *
   * Comportement :
   *  - getItem → JSON.parse.
   *  - Si JSON.parse jette OU si validator(parsed) === false : la chaîne
   *    brute est sauvegardée dans `<key>.bak` (best-effort) et `fallback`
   *    est retourné.
   *  - Sinon : retourne la valeur désérialisée.
   *  - Si la clé est absente (null) : retourne `fallback` sans backup.
   *  - Si localStorage est indisponible : retourne `fallback`.
   */
  get<T = unknown>(key: string, opts: PersistGetOptions<T> = {}): T {
    const validator = opts.validator ?? null;
    const fallback = (opts.fallback ?? null) as T;

    const store = getStore();
    if (!store) return fallback;

    let raw: string | null;
    try {
      raw = store.getItem(key);
    } catch {
      // Lecture impossible : on dégrade.
      return fallback;
    }

    // Clé absente : pas de corruption, simplement rien à charger.
    if (raw == null) return fallback;

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // JSON corrompu : on préserve l'original puis on dégrade.
      backupRaw(key, raw);
      return fallback;
    }

    // Validation métier optionnelle. On ne considère comme un échec que le
    // retour STRICTEMENT false (un validateur peut renvoyer undefined par
    // mégarde sans qu'on veuille jeter la donnée).
    if (typeof validator === 'function') {
      let valid: boolean;
      try {
        valid = validator(parsed);
      } catch {
        // Un validateur qui jette est traité comme un rejet.
        valid = false;
      }
      if (valid === false) {
        backupRaw(key, raw);
        return fallback;
      }
    }

    return parsed as T;
  },

  /**
   * Sérialise (JSON.stringify) puis écrit `value` sous `key` (persist.js:200-214).
   * Ne jette JAMAIS sur dépassement de quota : émet 'pctac:quota' et retourne
   * {ok:false, quota:true}.
   */
  set(key: string, value: unknown): PersistWriteResult {
    const store = getStore();
    if (!store) return { ok: false, error: new Error('localStorage indisponible') };

    let str: string;
    try {
      str = JSON.stringify(value);
    } catch (e) {
      // Valeur non sérialisable (référence circulaire, BigInt, ...).
      // Ce n'est pas un problème de quota : on remonte l'erreur.
      return { ok: false, error: e as Error };
    }

    return Persist.setRaw(key, str);
  },

  /** Lecture brute d'une chaîne. Tolérant à l'indisponibilité du stockage (persist.js:221-229). */
  getRaw(key: string): string | null {
    const store = getStore();
    if (!store) return null;
    try {
      return store.getItem(key);
    } catch {
      return null;
    }
  },

  /**
   * Écriture brute d'une chaîne (sans JSON.stringify) — persist.js:240-255.
   * Même contrat que set() vis-à-vis du quota : ne jette jamais sur quota,
   * émet 'pctac:quota' et retourne {ok:false, quota:true}.
   */
  setRaw(key: string, str: string): PersistWriteResult {
    const store = getStore();
    if (!store) return { ok: false, error: new Error('localStorage indisponible') };

    try {
      store.setItem(key, str);
      return { ok: true };
    } catch (e) {
      if (isQuotaError(e)) {
        // Saturation : on signale l'UI et on dégrade sans jeter.
        return dispatchQuota(key);
      }
      // Autre erreur d'écriture (rare) : on la remonte sans jeter.
      return { ok: false, error: e as Error };
    }
  },
};

export default Persist;
