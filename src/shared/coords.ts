/**
 * coords.ts — Conversion et formatage de coordonnées (calcul PUR, sans clé API,
 * sans réseau). Port TypeScript verbatim de modules/pctac/coords.js
 * (GStart-main). Sert l'option « Copier coordonnées » des roues contextuelles
 * de PC-Tac (câblage dans src/apps/pctac).
 *
 * Formats produits :
 *   - Décimal WGS84      : "48.856614, 2.352222"  (le plus portable / SIG, hélico civil, SAMU)
 *   - DMS                : 48°51′23.8″N  2°21′07.9″E
 *   - MGRS               : 31U DQ 48251 11932     (standard interservices / gendarmerie mobile)
 *
 * Algorithme UTM : série de Snyder (USGS PP 1395), précision ~cm dans le domaine UTM,
 * ellipsoïde WGS84. MGRS : lettrage 100 km standard USNG/MGRS. Domaine couvert :
 * bandes C→X (lat −80…84) — couvre très largement la métropole et l'outre-mer.
 *
 * Vérifié : 0°,0° → "31N AA 66021 00000" (valeur canonique « null island »).
 */

import { inverse } from 'mgrs';
import { gridCellCenter } from '@shared/tactical-grid.js';

const WGS84_A = 6378137.0; // demi-grand axe (m)
const WGS84_F = 1 / 298.257223563; // aplatissement
const K0 = 0.9996; // facteur d'échelle UTM
const E2 = WGS84_F * (2 - WGS84_F); // e²
const EP2 = E2 / (1 - E2); // e'²

const DEG = Math.PI / 180;

/** Normalise une longitude dans [−180, 180) : clics sur les copies du monde
 *  (MapLibre déroule le planisphère) et cas limite lon = 180. */
function normLon(lon: number): number {
  return ((lon + 180) % 360 + 360) % 360 - 180;
}

const BAND_LETTERS = 'CDEFGHJKLMNPQRSTUVWX'; // bandes de latitude (8°, X = 72→84)
const COL_SETS = ['ABCDEFGH', 'JKLMNPQR', 'STUVWXYZ']; // colonnes 100 km selon (zone-1)%3
const ROW_ODD = 'ABCDEFGHJKLMNPQRSTUV'; // lignes 100 km, zones IMPAIRES ('A' à l'équateur)
const ROW_EVEN = 'FGHJKLMNPQRSTUVABCDE'; // lignes 100 km, zones PAIRES (décalé de 5 → 'F')

/** Numéro de fuseau UTM, avec exceptions Norvège/Svalbard (sans effet en métropole). */
function utmZone(lat: number, lon: number): number {
  let zone = Math.floor((lon + 180) / 6) + 1;
  // Exception Norvège (32V élargi)
  if (lat >= 56 && lat < 64 && lon >= 3 && lon < 12) zone = 32;
  // Exceptions Svalbard
  if (lat >= 72 && lat < 84) {
    if (lon >= 0 && lon < 9) zone = 31;
    else if (lon >= 9 && lon < 21) zone = 33;
    else if (lon >= 21 && lon < 33) zone = 35;
    else if (lon >= 33 && lon < 42) zone = 37;
  }
  return zone;
}

/** Lettre de bande de latitude MGRS (C…X). */
function latBand(lat: number): string {
  if (lat >= 72) return 'X';
  if (lat < -80) return 'C';
  const idx = Math.min(BAND_LETTERS.length - 1, Math.floor((lat + 80) / 8));
  return BAND_LETTERS[idx] as string;
}

/** Résultat de la projection UTM d'un point WGS84. */
export interface UtmCoords {
  zone: number;
  band: string;
  easting: number;
  northing: number;
  hemisphere: 'N' | 'S';
}

/**
 * WGS84 (lat,lon) → UTM. Retourne {zone, band, easting, northing, hemisphere}.
 */
export function latLngToUtm(lat: number, lon: number): UtmCoords {
  lon = normLon(lon);
  const zone = utmZone(lat, lon);
  const lonOrigin = (zone - 1) * 6 - 180 + 3; // méridien central du fuseau
  const latR = lat * DEG;
  const dLon = (lon - lonOrigin) * DEG;

  const N = WGS84_A / Math.sqrt(1 - E2 * Math.sin(latR) ** 2);
  const T = Math.tan(latR) ** 2;
  const C = EP2 * Math.cos(latR) ** 2;
  const A = Math.cos(latR) * dLon;

  const M =
    WGS84_A *
    ((1 - E2 / 4 - (3 * E2 ** 2) / 64 - (5 * E2 ** 3) / 256) * latR -
      ((3 * E2) / 8 + (3 * E2 ** 2) / 32 + (45 * E2 ** 3) / 1024) * Math.sin(2 * latR) +
      ((15 * E2 ** 2) / 256 + (45 * E2 ** 3) / 1024) * Math.sin(4 * latR) -
      ((35 * E2 ** 3) / 3072) * Math.sin(6 * latR));

  const easting =
    K0 * N * (A + ((1 - T + C) * A ** 3) / 6 + ((5 - 18 * T + T ** 2 + 72 * C - 58 * EP2) * A ** 5) / 120) +
    500000;

  let northing =
    K0 *
    (M +
      N *
        Math.tan(latR) *
        (A ** 2 / 2 +
          ((5 - T + 9 * C + 4 * C ** 2) * A ** 4) / 24 +
          ((61 - 58 * T + T ** 2 + 600 * C - 330 * EP2) * A ** 6) / 720));
  if (lat < 0) northing += 10000000; // hémisphère sud

  return { zone, band: latBand(lat), easting, northing, hemisphere: lat < 0 ? 'S' : 'N' };
}

/**
 * WGS84 (lat,lon) → chaîne MGRS. `digits` = chiffres par axe (5 → précision 1 m).
 */
export function latLngToMgrs(lat: number, lon: number, digits = 5): string {
  // Domaine MGRS/UTM : bandes C→X (lat −80…84). Hors domaine, la série de
  // Snyder diverge et produirait une chaîne FAUSSE mais plausible — on jette,
  // les appelants (formatCoordsClipboard/shortMgrs) omettent alors le MGRS.
  if (!(lat >= -80 && lat < 84)) {
    throw new RangeError('MGRS hors domaine (lat ' + lat + ')');
  }
  const { zone, band, easting, northing } = latLngToUtm(lat, lon);

  // Colonne 100 km : selon (zone-1)%3 et la centaine de km d'easting (1…8).
  const colSet = COL_SETS[(zone - 1) % 3] as string;
  const colLetter = colSet[Math.floor(easting / 100000) - 1];

  // Ligne 100 km : alphabet pair/impair, indexé sur northing modulo 2 000 km.
  const rowAlphabet = zone % 2 === 1 ? ROW_ODD : ROW_EVEN;
  const rowLetter = rowAlphabet[Math.floor((northing % 2000000) / 100000)];

  const div = Math.pow(10, 5 - digits);
  const e = String(Math.floor((easting % 100000) / div)).padStart(digits, '0');
  const n = String(Math.floor((northing % 100000) / div)).padStart(digits, '0');

  return `${zone}${band} ${colLetter}${rowLetter} ${e} ${n}`;
}

/** Une composante en degrés/minutes/secondes signée → "48°51′23.8″N". */
function toDms(value: number, isLat: boolean): string {
  const hemi = value >= 0 ? (isLat ? 'N' : 'E') : isLat ? 'S' : 'W';
  const abs = Math.abs(value);
  let d = Math.floor(abs);
  const mFull = (abs - d) * 60;
  let m = Math.floor(mFull);
  // Arrondi à 0.1″ AVANT affichage, avec retenue : sinon 48°59′59.98″
  // s'affichait « 48°59′60.0″ » (secondes = 60, invalide).
  let s = Math.round((mFull - m) * 60 * 10) / 10;
  if (s >= 60) {
    s -= 60;
    m += 1;
  }
  if (m >= 60) {
    m -= 60;
    d += 1;
  }
  return `${d}°${String(m).padStart(2, '0')}′${s.toFixed(1).padStart(4, '0')}″${hemi}`;
}

/**
 * Bloc texte multi-formats prêt pour le presse-papier (3 lignes).
 */
export function formatCoordsClipboard(lng: number, lat: number): string {
  lng = normLon(lng);
  const dec = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
  const dms = `${toDms(lat, true)}  ${toDms(lng, false)}`;
  let mgrs: string | null;
  try {
    mgrs = `MGRS ${latLngToMgrs(lat, lng)}`;
  } catch {
    mgrs = null; // hors domaine UTM (régions polaires) : on omet
  }
  return [dec, dms, mgrs].filter(Boolean).join('\n');
}

/** Version courte (1 ligne) pour les toasts/labels : "MGRS 31U DQ 48251 11932". */
export function shortMgrs(lng: number, lat: number): string {
  lng = normLon(lng);
  try {
    return latLngToMgrs(lat, lng);
  } catch {
    return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  }
}

/* =========================================================================
 * SAISIE DE COORDONNÉES (décision 35, lot C) — parseurs PURS
 *
 * La recherche du plan accepte, AVANT tout géocodage réseau : décimal
 * (« 48.85, 2.35 », virgule française comprise), DMS (« 48°51'24"N
 * 2°21'03"E », « N48°51.4' E2°21.05' », symboles ′ ″ ’ ”), MGRS (avec ou
 * sans espaces) et case du carroyage actif (« C4 »). Ces fonctions ne
 * touchent NI au DOM NI à la carte : elles sont testées à part
 * (`tests/unit/shared/coords.test.ts`).
 * ========================================================================= */

/** Spécification minimale d'un carroyage pour résoudre une case (sous-ensemble de `TacticalGridSpec`). */
export interface GridCellSpec {
    west: number;
    north: number;
    dLon: number;
    dLat: number;
    cols: number;
    rows: number;
    /** Orientation du carroyage (décision 39) ; absent = 0. */
    angle?: number | undefined;
}

/** Résultat de l'analyse d'une saisie de coordonnées. `null` = ce n'est pas une coordonnée (→ géocodage). */
export type CoordinateInput =
    | { kind: 'point'; lat: number; lng: number; format: 'decimal' | 'dms' | 'mgrs'; label: string }
    | { kind: 'cell'; cell: string; lat: number; lng: number }
    | { kind: 'cell-no-grid' }
    | { kind: 'cell-out-of-grid'; cell: string }
    | { kind: 'bad-range' };

function isLat(v: number): boolean {
    return Number.isFinite(v) && v >= -90 && v <= 90;
}
function isLon(v: number): boolean {
    return Number.isFinite(v) && v >= -180 && v <= 180;
}

/**
 * Décimal « lat, lng » (séparateur virgule, point-virgule ou espace ; virgule
 * décimale française comprise). Renvoie `null` si la forme ne correspond pas,
 * `'bad-range'` si elle correspond mais sort des bornes.
 */
export function parseDecimalCoords(str: string): { lat: number; lng: number } | 'bad-range' | null {
    const m = str.match(/^\s*(-?\d{1,3}(?:[.,]\d+)?)\s*[,;\s]\s*(-?\d{1,3}(?:[.,]\d+)?)\s*$/);
    if (!m) return null;
    const lat = parseFloat((m[1] ?? '').replace(',', '.'));
    const lng = parseFloat((m[2] ?? '').replace(',', '.'));
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    if (!isLat(lat) || !isLon(lng)) return 'bad-range';
    return { lat, lng };
}

/** Normalise les symboles de degré/minute/seconde en ASCII et supprime les degrés. */
function normalizeDms(input: string): string {
    return input
        .replace(/[°º]/g, ' ')
        .replace(/[′’']/g, "'")
        .replace(/[″”"]/g, '"');
}

/** Minutes/secondes d'une composante : 1, 2 ou 3 nombres + hémisphère éventuel. */
interface DmsComponent { value: number; hemi: string | null }
/** Composante en cours d'assemblage (nombres bruts + hémisphère éventuel). */
interface RawDmsComponent { nums: number[]; hemi: string | null }

/**
 * Découpe une saisie DMS en (au plus) deux composantes signées. `null` si la
 * forme n'est pas reconnue. Accepte les hémisphères en tête ou en queue et les
 * composantes sans symbole (nombres séparés par des espaces).
 */
function tokenizeDms(input: string): DmsComponent[] | null {
    const norm = normalizeDms(input);
    const re = /([NSEWnsew])|(\d+(?:\.\d+)?)/g;
    const comps: RawDmsComponent[] = [];
    let cur: RawDmsComponent = { nums: [], hemi: null };
    let match: RegExpExecArray | null;
    while ((match = re.exec(norm)) !== null) {
        if (match[1]) {
            const letter = match[1].toUpperCase();
            if (cur.nums.length) {
                // Hémisphère EN TÊTE déjà posé : la lettre courante ouvre la
                // composante SUIVANTE ; sinon elle ferme la composante courante.
                if (cur.hemi !== null) {
                    comps.push({ nums: cur.nums, hemi: cur.hemi });
                    cur = { nums: [], hemi: letter };
                } else {
                    comps.push({ nums: cur.nums, hemi: letter });
                    cur = { nums: [], hemi: null };
                }
            } else if (cur.hemi === null) {
                cur.hemi = letter;
            } else {
                cur = { nums: [], hemi: letter };
            }
        } else {
            cur.nums.push(parseFloat(match[2] ?? ''));
        }
    }
    if (cur.nums.length) comps.push({ nums: cur.nums, hemi: cur.hemi });

    const out: DmsComponent[] = [];
    for (const c of comps) {
        if (!c.nums.length) continue;
        if (c.nums.length > 3) return null;
        const [d = 0, m = 0, s = 0] = c.nums;
        if (m >= 60 || s >= 60) return null;
        let value = d + m / 60 + s / 3600;
        const hemi = c.hemi;
        if (hemi === 'S' || hemi === 'W') value = -value;
        out.push({ value, hemi });
    }
    if (!out.length || out.length > 2) return null;
    return out;
}

/**
 * Garde-fou anti-faux-positifs (R16) : la seule forme DMS admise ne contient
 * que des nombres, des symboles de degré/minute/seconde, des séparateurs et des
 * lettres d'hémisphère ISOLÉES (N/S/E/W). Un « mot » de deux lettres ou plus
 * trahit une adresse (« rue », « des », « Nantes », « Écoles ») : sans cette
 * garde, toute adresse contenant un n/s/e/w était prise pour du DMS et ne
 * partait jamais au géocodage.
 */
function looksLikeDms(str: string): boolean {
    // Aucune suite de 2 lettres ou plus (un hémisphère légitime est isolé).
    if (/\p{L}{2,}/u.test(str)) return false;
    // Aucune lettre en dehors des hémisphères N/S/E/W (accents compris).
    return !/\p{L}/u.test(str.replace(/[NSEWnsew]/g, ''));
}

/**
 * DMS : deux composantes (lat puis lon), dans n'importe quel ordre d'hémisphère.
 * `null` si non reconnu, `'bad-range'` si reconnu mais hors bornes.
 */
export function parseDmsCoords(str: string): { lat: number; lng: number } | 'bad-range' | null {
    // La présence d'au moins une lettre d'hémisphère est le signal DMS (sinon
    // une paire de nombres entiers serait ambiguë avec une paire décimale).
    if (!/[NSEWnsew]/.test(str)) return null;
    // Une adresse contient un n/s/e/w au milieu d'un mot : la rejeter AVANT de
    // tokeniser, pour ne pas voler la recherche d'adresse (R16).
    if (!looksLikeDms(str)) return null;
    const comps = tokenizeDms(str);
    if (!comps || comps.length !== 2) return null;
    const [a, b] = comps as [DmsComponent, DmsComponent];
    let lat: number, lng: number;
    const aIsLon = a.hemi === 'E' || a.hemi === 'W';
    const bIsLat = b.hemi === 'N' || b.hemi === 'S';
    if (aIsLon && bIsLat) { lng = a.value; lat = b.value; }
    else { lat = a.value; lng = b.value; }
    if (!isLat(lat) || !isLon(lng)) return 'bad-range';
    return { lat, lng };
}

/**
 * MGRS : via le paquet `mgrs` (`inverse` rend l'emprise [ouest, sud, est,
 * nord]). Renvoie le centre de la case. `null` si ce n'est pas du MGRS.
 */
export function parseMgrsCoords(str: string): { lat: number; lng: number } | null {
    const compact = str.replace(/\s+/g, '');
    // Forme MGRS minimale : zone (1-2 chiffres) + bande (C-X) + 2 lettres.
    if (!/^\d{1,2}[C-X][A-Z]{2}/i.test(compact)) return null;
    try {
        // Import paresseux : `mgrs` est déjà une dépendance directe (decision 13).
        const box = inverseMgrs(compact);
        if (!Array.isArray(box) || box.length < 4) return null;
        const west = box[0] as number, south = box[1] as number, east = box[2] as number, north = box[3] as number;
        if (![west, south, east, north].every(Number.isFinite)) return null;
        const lng = normLon((west + east) / 2);
        const lat = (south + north) / 2;
        if (!isLat(lat) || !isLon(lng)) return null;
        return { lat, lng };
    } catch {
        return null;
    }
}

/** Inverse MGRS branchée sur le paquet (séparée pour rester mockable/testable). */
function inverseMgrs(ref: string): number[] {
    return inverse(ref) as unknown as number[];
}

/** La saisie ressemble-t-elle à une case de carroyage ? */
export function looksLikeGridCell(str: string): boolean {
    return /^\s*[A-Za-z]{1,2}\s?\d{1,3}\s*$/.test(str);
}

/**
 * Résout une case de carroyage. `grid` absent → `'cell-no-grid'` ; case valide
 * → centre (repère TOURNÉ compris, via `gridCellCenter`) ; hors du rectangle →
 * `'cell-out-of-grid'`.
 */
export function parseGridCell(str: string, grid: GridCellSpec | null | undefined):
    | { kind: 'cell'; cell: string; lat: number; lng: number }
    | { kind: 'cell-no-grid' }
    | { kind: 'cell-out-of-grid'; cell: string }
    | null {
    const m = str.match(/^\s*([A-Za-z]{1,2})\s?(\d{1,3})\s*$/);
    if (!m) return null;
    const cell = `${(m[1] ?? '').toUpperCase()}${m[2] ?? ''}`;
    if (!grid) return { kind: 'cell-no-grid' };
    const center = gridCellCenter(grid, cell);
    if (!center) return { kind: 'cell-out-of-grid', cell };
    return { kind: 'cell', cell, lat: center[1], lng: normLon(center[0]) };
}

/**
 * Analyse une saisie AVANT géocodage, dans l'ordre : décimal, DMS, MGRS, case.
 * `null` = à traiter comme une adresse (géocodage réseau).
 */
export function parseCoordinateInput(str: string, grid?: GridCellSpec | null): CoordinateInput | null {
    const q = str.trim();
    if (!q) return null;

    const dec = parseDecimalCoords(q);
    if (dec === 'bad-range') return { kind: 'bad-range' };
    if (dec) return { kind: 'point', lat: dec.lat, lng: dec.lng, format: 'decimal', label: `${dec.lat.toFixed(5)}, ${dec.lng.toFixed(5)}` };

    const dms = parseDmsCoords(q);
    if (dms === 'bad-range') return { kind: 'bad-range' };
    if (dms) return { kind: 'point', lat: dms.lat, lng: dms.lng, format: 'dms', label: q };

    const mgrs = parseMgrsCoords(q);
    if (mgrs) return { kind: 'point', lat: mgrs.lat, lng: mgrs.lng, format: 'mgrs', label: q };

    // La case n'a de sens qu'avec un carroyage actif : sans lui, « D951 » ou
    // « A7 » sont des noms de route / d'axe, pas des cases → géocodage (R16).
    if (grid && looksLikeGridCell(q)) return parseGridCell(q, grid);
    return null;
}
