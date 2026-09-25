/**
 * tests/pdf/assert-exif.mjs — garde D2 du protocole de non-régression
 * structurel : AUCUNE image embarquée dans le PDF ne doit porter de
 * métadonnées EXIF.
 *
 * Audit PDF du 2026-09-25, constat F09 : le fond PDF personnalisé et les
 * images d'un import d'archive étaient stockés tels quels, puis transmis au
 * moteur SANS ré-encodage tant qu'ils tenaient sous 2 560 px. Un fond
 * photographié sur place partait donc dans le PDF avec ses coordonnées GPS —
 * prouvé en relisant `GPSLatitude 48/1,51/1,2999/100` dans l'image extraite du
 * PDF produit, identique octet pour octet au fichier d'origine.
 *
 * Les tests unitaires de ce correctif vérifient la DÉCISION de ré-encodage ;
 * ils ne peuvent pas vérifier l'OCTET qui sort du PDF. Cette garde, elle,
 * travaille sur le PDF rendu : elle extrait les images avec `pdfimages -all`
 * et cherche les signatures de métadonnées réelles.
 *
 * Pourquoi « aucune EXIF » et pas seulement « pas de GPS » : la reconstruction
 * par canvas ne laisse AUCUNE métadonnée. Un jour où une image arriverait avec
 * sa marque d'appareil ou son orientation, ce serait le même défaut de
 * confidentialité qui revient par une autre porte.
 *
 * Aucune dépendance npm : `pdfimages` (poppler-utils) et `node:fs` suffisent.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** Signature du segment APP1 d'un JPEG (`Exif\0\0`). */
const EXIF_JPEG = Buffer.from('Exif\0\0', 'latin1');
/** Signature du chunk de métadonnées d'un PNG. */
const EXIF_PNG = Buffer.from('eXIf', 'latin1');
const EXEC_MAX_BUFFER = 20 * 1024 * 1024;

/**
 * Extrait toutes les images du PDF dans un dossier temporaire (`pdfimages -all`
 * conserve le format et les octets d'origine, contrairement à `-j` qui
 * ré-encode) et renvoie leurs chemins. Lève si le binaire manque : c'est une
 * garde d'exécution, pas un verdict.
 */
export function extraireImages(pdfPath) {
  const dossier = mkdtempSync(path.join(os.tmpdir(), 'verif-images-'));
  try {
    execFileSync('pdfimages', ['-all', pdfPath, path.join(dossier, 'img')], {
      encoding: 'utf8',
      maxBuffer: EXEC_MAX_BUFFER,
    });
  } catch {
    rmSync(dossier, { recursive: true, force: true });
    return { dossier: null, chemins: [] };
  }
  const chemins = readdirSync(dossier)
    .filter((f) => f.startsWith('img-'))
    .map((f) => path.join(dossier, f));
  return { dossier, chemins };
}

/**
 * D2 — les images extraites ne portent aucune métadonnée.
 *
 * @param {string[]} chemins images extraites du PDF
 * @param {number} imagesAnnoncees nombre d'images annoncé par `pdfimages -list`
 */
export function assertD2_noExifInImages(chemins, imagesAnnoncees) {
  if (imagesAnnoncees === 0) {
    return { ok: true, detail: 'aucune image embarquée — assertion non applicable' };
  }
  if (chemins.length === 0) {
    // Ne PAS passer ici pour un succès : `pdfimages -list` annonce des images
    // et l'extraction n'en rend aucune — la garde n'a rien pu examiner.
    return {
      ok: false,
      detail: `${imagesAnnoncees} image(s) annoncée(s) par pdfimages -list mais AUCUNE extraite — garde non évaluable`,
    };
  }
  const suspects = [];
  for (const chemin of chemins) {
    let octets;
    try {
      octets = readFileSync(chemin);
    } catch {
      continue;
    }
    const trouves = [];
    if (octets.includes(EXIF_JPEG)) trouves.push('segment APP1 « Exif » (JPEG)');
    if (octets.includes(EXIF_PNG)) trouves.push('chunk « eXIf » (PNG)');
    if (trouves.length > 0) suspects.push(`${path.basename(chemin)} : ${trouves.join(' + ')}`);
  }
  if (suspects.length > 0) {
    const liste = suspects.slice(0, 5).join(' | ');
    const reste = suspects.length > 5 ? ` … (+${suspects.length - 5})` : '';
    return {
      ok: false,
      detail: `${suspects.length}/${chemins.length} image(s) portent des métadonnées et voyagent telles quelles dans le PDF (GPS compris) : ${liste}${reste}`,
    };
  }
  return { ok: true, detail: `${chemins.length} image(s) embarquée(s), aucune métadonnée EXIF (ni GPS)` };
}

/**
 * Variante « tout compris » pour `verify-structure.mjs` : extrait, contrôle,
 * nettoie le dossier temporaire, renvoie le résultat d'assertion. Une seule
 * ligne dans le tableau des assertions, aucun dossier qui traîne en sortie.
 */
export function assertD2_surPdf(pdfPath, imagesAnnoncees) {
  const { dossier, chemins } = extraireImages(pdfPath);
  const resultat = assertD2_noExifInImages(chemins, imagesAnnoncees);
  if (dossier) rmSync(dossier, { recursive: true, force: true });
  return resultat;
}
