/**
 * azimuth.ts — Azimut affiché par le plan (décision 35, lot C).
 * ===========================================================================
 *
 * Trois lectures d'un même relèvement, constantes et lisibles :
 *   - nord VRAI (relèvement initial, cf. `trueBearing` de geo.ts) ;
 *   - nord MAGNÉTIQUE = vrai − déclinaison (Est positive), calculée HORS
 *     LIGNE par `geomagnetism` (modèle WMM 2025, valide jusqu'au 13/11/2029) ;
 *   - millièmes OTAN (6400 au tour), calculés depuis le relèvement vrai.
 *
 * Exemple : `123° V · 121° M · 2187 ‰`. Hors période de validité du modèle,
 * la composante magnétique affiche « M indisponible » — JAMAIS une valeur
 * fausse.
 *
 * Module PUR (hors horloge et modèle) : aucune dépendance DOM/carte.
 */

import { model } from 'geomagnetism';

/** Normalise un azimut en degrés dans [0, 360). */
export function normalizeAzimuthDeg(deg: number): number {
    const d = ((deg % 360) + 360) % 360;
    return d === 360 ? 0 : d;
}

/** Normalise un azimut en millièmes dans [0, 6400). */
export function normalizeMils(mils: number): number {
    const m = ((mils % 6400) + 6400) % 6400;
    return m === 6400 ? 0 : m;
}

/** Degrés → millièmes OTAN (6400 au tour), arrondis et normalisés. */
export function degreesToMils(deg: number): number {
    return normalizeMils(Math.round((normalizeAzimuthDeg(deg) / 360) * 6400));
}

/** Date au jour près, pour la clé de cache. */
function dayKey(date: Date): string {
    return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

const declCache = new Map<string, number | null>();

/**
 * Déclinaison magnétique (deg, Est positive) au point et à la date donnés.
 * `null` si le modèle n'est pas valide pour cette date — jamais une valeur
 * approximative. Mémoïsé par jour et par degré de position (le WMM varie
 * lentement ; recalculer à chaque rendu de mesure serait inutilement lourd).
 */
export function magneticDeclination(lat: number, lon: number, date: Date = new Date()): number | null {
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    const key = `${dayKey(date)}|${lat.toFixed(2)}|${lon.toFixed(2)}`;
    if (declCache.has(key)) return declCache.get(key) ?? null;
    let decl: number | null = null;
    try {
        const m = model(date);
        const p = m.point([lat, lon]);
        decl = Number.isFinite(p.decl) ? p.decl : null;
    } catch {
        decl = null; // hors période de validité du modèle
    }
    declCache.set(key, decl);
    return decl;
}

/** Partie magnétique affichée, ou le repli explicite. */
function magneticPart(trueDeg: number, declDeg: number | null | undefined): string {
    if (declDeg === null || declDeg === undefined || !Number.isFinite(declDeg)) return 'M indisponible';
    const mag = Math.round(normalizeAzimuthDeg(trueDeg - declDeg)) % 360;
    return `${String(mag).padStart(3, '0')}° M`;
}

/**
 * Formate un relèvement vrai en trois lectures constantes :
 * « 123° V · 121° M · 2187 ‰ ». `declDeg` absent → « M indisponible ».
 */
export function formatAzimuth(trueDeg: number, declDeg?: number | null): string {
    const trueRounded = Math.round(normalizeAzimuthDeg(trueDeg)) % 360;
    const mils = degreesToMils(trueDeg);
    return `${String(trueRounded).padStart(3, '0')}° V · ${magneticPart(trueDeg, declDeg)} · ${String(mils).padStart(4, '0')} ‰`;
}
