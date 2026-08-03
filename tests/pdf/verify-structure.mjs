#!/usr/bin/env node
/**
 * tests/pdf/verify-structure.mjs — protocole de non-régression STRUCTUREL du
 * PDF de l'OI (voie A pdfmake, SPEC-PDF-V3.md §7).
 *
 * POURQUOI un protocole structurel et non un diff pixel : l'ancien moteur
 * (`pdf-engine-v2.ts`, html2canvas+jsPDF) produisait un PDF 100% rastérisé —
 * une seule image JPEG par page, aucun calque texte (constat n°1 de
 * `../../.tacsuite-prep/oi-reference/fingerprint.md`). La voie A produit un
 * PDF **vectoriel** : le rendu pixel change de nature (c'est l'OBJET du
 * chantier, pas un bug), donc un diff pixel/perceptuel de l'étalon
 * `oi-reference/reference.pdf` est structurellement inopérant pour la voie A
 * (cf. `fingerprint.md`, note « ces hashes ne seront quasi certainement pas
 * reproductibles » — écrite pour un contexte html2canvas, a fortiori fausse
 * face à un moteur différent). Ce script vérifie à la place des INVARIANTS
 * structurels indépendants du rendu pixel : nombre/dimensions de pages,
 * volume de texte réel, ordre des sections, polices embarquées, absence de
 * rastérisation de page entière, poids du fichier, présence des données
 * saisies. Aucune dépendance npm : appelle directement les binaires
 * `poppler-utils` du système (`pdfinfo`, `pdftotext`, `pdffonts`,
 * `pdfimages`), déjà validés sur cette machine.
 *
 * Usage :
 *   node tests/pdf/verify-structure.mjs <fichier.pdf> [--format=a4|16:9]
 *       [--photos=N] [--sample=<fichier.json>] [--json] [--lenient]
 *
 * Défauts : --format=a4, --photos=0, mode strict (pas de --lenient).
 * Sortie : une ligne `PASS <code> — <libellé>` ou `FAIL <code> — <constat
 * mesuré>` par assertion (A1..A8 historiques + B1..B6 guardrail pagination,
 * missions PG.GUARD puis PG.REFIX), puis un résumé `N/14 assertions`. Avec
 * `--json`, émet EN PLUS (pas à la place — les lignes lisibles restent
 * imprimées) un objet `{ ok, file, assertions: [{ code, ok, detail }] }` sur
 * stdout, en dernière ligne.
 * Code de sortie : 0 si les 14 assertions passent, 1 sinon, 2 en cas de garde
 * d'exécution (binaire poppler absent, fichier PDF introuvable, arguments
 * invalides — l'outil n'a alors PU faire tourner aucune assertion).
 *
 * Détail des 8 assertions A1-A8 et de leurs seuils : voir
 * `tests/pdf/README.md` et `docs/SPEC-PDF-V3.md` §7 (tableau « Assertions
 * exactes »). B1..B6 (guardrail pagination, non couvertes par la SPEC
 * d'origine — B1-B3 mission PG.GUARD, B4-B6 mission PG.REFIX round 1, ce
 * dernier round motivé par 3 défauts que B1-B3 laissaient passer) sont
 * documentées en JSDoc à leur point de définition ci-dessous et TOUJOURS
 * évaluées, indépendamment de `--lenient` (qui ne régit que les marqueurs
 * conditionnels de A3).
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';

// ===========================================================================
// Les 15 marqueurs (ordre imposé, verbatim) — SPEC-PDF-V3.md §7, recopiés
// caractère pour caractère depuis le bloc de code numéroté 1..15 de cette
// section. Même liste, même esprit que :
//   - `../../.tacsuite-prep/oi-reference/fingerprint.md` § « Ordre des
//     sections » (empreinte OCR de l'étalon raster, 14 pages) ;
//   - `tests/unit/oi/oi-pdf-engine-v2.test.ts:343-359` (assertion HTML
//     équivalente sur `PDFEngineV2.generateHTML()` — CE script est
//     l'équivalent PDF-vectoriel-réel du même invariant : la structure du
//     document ne doit pas bouger, seul le moteur de rendu change).
// `conditional: true` ⇒ index listés en SPEC §7 comme conditionnés par les
// données saisies (4, 8, 10, 11, 12, 13 en numérotation 1-based) : en mode
// `--lenient`, un marqueur conditionnel absent est signalé SKIP au lieu de
// faire échouer A3 — mais l'ordre des marqueurs PRÉSENTS reste asserté.
// ===========================================================================
export const MARKERS = [
  { n: 1, text: 'ORDRE INITIAL', conditional: false },
  { n: 2, text: '1. SITUATION GLOBALE', conditional: false },
  { n: 3, text: 'CIBLES(S)', conditional: false },
  { n: 4, text: '2.1 FICHE ADVERSAIRE', conditional: true },
  { n: 5, text: '3. ENVIRONNEMENT ET AMIS', conditional: false },
  { n: 6, text: "4. MISSION DE L'UNITÉ", conditional: false },
  { n: 7, text: '5. EXÉCUTION', conditional: false },
  { n: 8, text: '6. LOGISTIQUE & TRANSPORTS', conditional: true },
  { n: 9, text: '7. ARTICULATION & ORDRES DE MOUVEMENT', conditional: false },
  // PDF.INTEG (mission d'intégration, vérifiée contre un PDF réel généré par
  // downloadOiPdfV3()) — CORRECTIF de casse par rapport à SPEC-PDF-V3.md §7
  // (qui recopiait la casse SOURCE du gabarit `pdf-engine-v2.ts`, où
  // `<h2>Articulation : ZMSPCP - …</h2>` n'était mis en capitales que par la
  // CSS `text-transform: uppercase` de l'ancien moteur — un effet purement
  // visuel, sans incidence sur le calque texte puisque ce moteur rastérisait
  // de toute façon). `blocks.h2()` (voie A, pdfmake) n'a pas de CSS : elle
  // reproduit ce même rendu visuel en appliquant `.toUpperCase()` en JS
  // (`src/apps/oi/pdf/blocks.ts:132`) — cette fois le calque texte RÉEL du
  // PDF vectoriel est donc en capitales, comme les 8 autres marqueurs h2 de
  // cette liste (déjà tous en capitales à la SOURCE de `pdf-engine-v2.ts`,
  // ex. « 3. ENVIRONNEMENT ET AMIS »). Constaté par `pdftotext -layout` sur
  // un PDF réel (recette `.tacsuite-prep/oi-reference/recipe.md`) :
  // « ARTICULATION : ZMSPCP - … ». Les 3 marqueurs ci-dessous sont donc
  // alignés sur le texte RÉELLEMENT extractible, pas sur la casse source du
  // gabarit HTML (qui ne correspond plus à aucun texte réel depuis que la
  // voie A a un vrai calque texte).
  { n: 10, text: 'ARTICULATION : ZMSPCP', conditional: true },
  { n: 11, text: 'ARTICULATION : MOICP', conditional: true },
  { n: 12, text: 'ARTICULATION : EFFRACTION', conditional: true },
  { n: 13, text: '8. CONDUITES À TENIR GÉNÉRALES', conditional: true },
  { n: 14, text: '7. RÉCAPITULATIF PATRACDVR', conditional: false },
  { n: 15, text: 'AVEZ-VOUS DES QUESTIONS ?', conditional: false },
];

const REQUIRED_BINARIES = ['pdfinfo', 'pdftotext', 'pdffonts', 'pdfimages'];
const POPPLER_PACKAGE_HINT = 'poppler-utils';

export const PAGE_DIMENSIONS_PT = {
  a4: { w: 841.89, h: 595.28 },
  '16:9': { w: 958.11, h: 539.01 },
};
const PAGE_SIZE_TOLERANCE_PT = 0.5;
const MIN_PAGES = 12;
const MIN_NON_BLANK_CHARS = 1500;
const MAX_BYTES_WHEN_NO_PHOTOS = 1_048_576; // 1 Mio
const FULL_PAGE_COVERAGE_RATIO = 0.8;
const EXEC_MAX_BUFFER = 20 * 1024 * 1024;

// ===========================================================================
// Normalisation avant recherche de marqueur/chaîne (SPEC §7 « A3 ») :
// - NFC : `pdftotext` peut renvoyer des accents pré/post-composés selon la
//   police source (glyphes CID vs décomposition Unicode) — sans normalisation
//   un marqueur en forme NFC pourrait ne jamais matcher un texte en NFD.
// - espaces consécutifs (y compris retours à la ligne dus au retour à la
//   ligne `-layout`) réduits à un seul espace : un `labelValue`/`card` dont
//   le texte est plus large que sa colonne PDF est réparti par pdfmake sur
//   plusieurs lignes visuelles ; `pdftotext -layout` restitue alors un saut
//   de ligne là où il n'y avait qu'un espace conceptuel dans le document
//   source. Sans ce collapse, une recherche de sous-chaîne échouerait dès
//   qu'un marqueur (ou, pour A8, une chaîne saisie) chevauche un tel wrap.
// - apostrophes typographiques `’` → `'` : les marqueurs de la SPEC utilisent
//   l'apostrophe droite (`L'UNITÉ`) mais certains moteurs de police/rendu
//   substituent l'apostrophe courbe — normalisée des DEUX côtés (texte ET
//   marqueur) pour ne pas dépendre du choix de rendu.
// - tirets `–`/`—` CONSERVÉS tels quels (ni transformés en `-`, ni entre
//   eux) : la SPEC ne demande explicitement AUCUNE substitution ici, listée
//   uniquement pour clarifier qu'ils ne sont PAS concernés par ce collapse.
// Appliquée aux DEUX côtés (texte extrait ET marqueur/chaîne recherchée) —
// réutilisée telle quelle pour A4 et A8, pas seulement A3, par cohérence et
// pour la même raison anti-wrap (cf. commentaire sur `assertA8`).
// ===========================================================================
export function normalize(text) {
  return text
    .normalize('NFC')
    .replace(/[’]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

// ===========================================================================
// Exécution des binaires poppler
// ===========================================================================

/** @returns {string[]} noms des binaires REQUIRED_BINARIES absents du PATH */
function findMissingBinaries() {
  const missing = [];
  for (const bin of REQUIRED_BINARIES) {
    try {
      execFileSync(bin, ['-v'], { stdio: 'ignore' });
    } catch {
      // ENOENT = binaire introuvable dans le PATH. Toute autre erreur
      // (permission, signal...) est traitée de la même façon : dans les
      // deux cas l'outil n'est pas exploitable, et masquer la distinction
      // n'aiderait pas l'utilisateur — le message final nomme le paquet
      // système à installer, pas la cause exacte de l'échec de `-v`.
      missing.push(bin);
    }
  }
  return missing;
}

function runPoppler(bin, args) {
  return execFileSync(bin, args, { encoding: 'utf8', maxBuffer: EXEC_MAX_BUFFER });
}

// ===========================================================================
// Collecte des données brutes (une seule invocation par binaire)
// ===========================================================================

function collectPdfInfo(file) {
  const base = runPoppler('pdfinfo', [file]);
  const pagesMatch = base.match(/^Pages:\s+(\d+)/m);
  const pageCount = pagesMatch ? Number(pagesMatch[1]) : 0;

  // Une seconde invocation ciblée `-f 1 -l <N>` est nécessaire : `pdfinfo`
  // sans bornes ne rapporte la taille QUE de la première page (`Page size:`),
  // pas une taille par page — insuffisant pour vérifier l'homogénéité
  // exigée par A1 sur les N pages.
  const pageSizes = [];
  if (pageCount > 0) {
    const perPage = runPoppler('pdfinfo', ['-f', '1', '-l', String(pageCount), file]);
    const re = /^Page\s+(\d+)\s+size:\s+([\d.]+)\s+x\s+([\d.]+)\s+pts/gm;
    let m;
    while ((m = re.exec(perPage))) {
      pageSizes.push({ page: Number(m[1]), width: Number(m[2]), height: Number(m[3]) });
    }
  }

  return { pageCount, pageSizes };
}

function collectText(file) {
  // '-' = sortie sur stdout, pas de fichier temporaire.
  return runPoppler('pdftotext', ['-layout', file, '-']);
}

/**
 * Parse la sortie tabulaire de `pdffonts`. Le nom de police (1re colonne)
 * peut contenir des espaces internes... en pratique non (noms PostScript),
 * mais la colonne `type` (2e), elle, EN CONTIENT couramment (« CID
 * TrueType », « Type 1C »). Une simple découpe sur espace unique casserait
 * donc cette colonne. On découpe plutôt sur les runs de 2+ espaces pour les
 * 3 premières colonnes (name/type/encoding — chacune paddée par poppler à
 * une largeur fixe, donc toujours séparée par ≥2 espaces de la suivante),
 * puis sur espace simple pour `emb`/`sub`/`uni` (littéraux `yes`/`no`, sans
 * ambiguïté) et l'ID d'objet final (deux entiers). Les lignes d'en-tête et
 * de séparateur (tirets) ne contiennent aucun `yes`/`no` : elles ne matchent
 * jamais cette regex, pas besoin de les sauter explicitement par index.
 */
export function parsePdfFonts(output) {
  const FONT_LINE_RE =
    /^(\S.*?)\s{2,}(\S.*?)\s{2,}(\S.*?)\s{2,}(yes|no)\s+(yes|no)\s+(yes|no)\s+(\d+)\s+(-?\d+)\s*$/;
  const entries = [];
  for (const line of output.split('\n')) {
    const m = line.match(FONT_LINE_RE);
    if (!m) continue;
    entries.push({ name: m[1], type: m[2], encoding: m[3], emb: m[4], sub: m[5], uni: m[6] });
  }
  return entries;
}

function collectFonts(file) {
  return parsePdfFonts(runPoppler('pdffonts', [file]));
}

/**
 * Parse `pdfimages -list`. Toutes les colonnes sont des tokens SANS espace
 * interne (contrairement à `pdffonts`) : une découpe par espaces suffit.
 * Les lignes d'en-tête/séparateur sont écartées par un double filtre :
 * nombre de tokens (16, cf. les 16 en-têtes de colonne de poppler) ET
 * 1er token numérique (le numéro de page — l'en-tête a `page`, la ligne de
 * tirets n'a qu'un seul token contigu, aucun des deux n'est un entier).
 */
export function parsePdfImages(output) {
  const entries = [];
  for (const rawLine of output.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    const tokens = line.split(/\s+/);
    if (tokens.length < 16) continue;
    const page = Number(tokens[0]);
    if (!Number.isInteger(page)) continue;
    entries.push({
      page,
      type: tokens[2],
      width: Number(tokens[3]),
      height: Number(tokens[4]),
      xppi: Number(tokens[12]),
      yppi: Number(tokens[13]),
    });
  }
  return entries;
}

function collectImages(file) {
  return parsePdfImages(runPoppler('pdfimages', ['-list', file]));
}

/**
 * Parse `pdftotext -bbox` (XHTML, un `<page width=".." height="..">` par
 * page contenant des `<word .. yMax="..">token</word>`) — utilisé par B6
 * (ratio de remplissage vertical, mission PG.REFIX round 1) pour repérer la
 * coordonnée Y du bas du texte le plus BAS de chaque page, sans dépendance
 * npm supplémentaire (même binaire `pdftotext` que `collectText`, juste une
 * option différente). Parseur volontairement minimal (regex, pas un vrai
 * parseur XML) : la sortie de `pdftotext -bbox` est un format STABLE et
 * plat, pas du XML arbitraire à valider.
 */
export function parseBBoxPages(xml) {
  const pages = [];
  const pageRe = /<page width="([0-9.]+)" height="([0-9.]+)">([\s\S]*?)<\/page>/g;
  let pm;
  while ((pm = pageRe.exec(xml))) {
    const width = Number(pm[1]);
    const height = Number(pm[2]);
    const body = pm[3];
    let maxYMax = 0;
    const wordRe = /yMax="([0-9.]+)"/g;
    let wm;
    while ((wm = wordRe.exec(body))) {
      maxYMax = Math.max(maxYMax, Number(wm[1]));
    }
    pages.push({ width, height, maxYMax });
  }
  return pages;
}

function collectBBox(file) {
  return parseBBoxPages(runPoppler('pdftotext', ['-bbox', file, '-']));
}

// ===========================================================================
// Assertions A1..A8 — chacune retourne { ok: boolean, detail: string,
// skip?: boolean }. `detail` sert de « libellé » sur PASS et de « constat
// mesuré » sur FAIL (même champ, format de sortie unifié — voir printLine).
// ===========================================================================

export function assertA1_geometry(pdfInfo, format) {
  const { pageCount, pageSizes } = pdfInfo;
  if (pageCount < MIN_PAGES) {
    return { ok: false, detail: `Pages: ${pageCount} — inférieur au plancher requis (${MIN_PAGES})` };
  }
  if (pageSizes.length !== pageCount) {
    return {
      ok: false,
      detail: `pdfinfo n'a renvoyé que ${pageSizes.length} taille(s) de page exploitable(s) pour ${pageCount} pages annoncées`,
    };
  }
  const target = PAGE_DIMENSIONS_PT[format];
  const outOfTolerance = pageSizes.filter(
    (p) =>
      Math.abs(p.width - target.w) > PAGE_SIZE_TOLERANCE_PT || Math.abs(p.height - target.h) > PAGE_SIZE_TOLERANCE_PT
  );
  if (outOfTolerance.length > 0) {
    const first = outOfTolerance[0];
    return {
      ok: false,
      detail: `${outOfTolerance.length}/${pageCount} page(s) hors tolérance ±${PAGE_SIZE_TOLERANCE_PT}pt (attendu ${target.w} x ${target.h} pts « ${format} », ex. page ${first.page} mesurée ${first.width} x ${first.height})`,
    };
  }
  return {
    ok: true,
    detail: `${pageCount} pages, ${target.w} x ${target.h} pts (« ${format} »), dimensions homogènes ±${PAGE_SIZE_TOLERANCE_PT}pt`,
  };
}

export function assertA2_realText(text) {
  const nonBlank = text.replace(/\s/g, '').length;
  const ok = nonBlank >= MIN_NON_BLANK_CHARS;
  return {
    ok,
    detail: `${nonBlank} caractère(s) non blanc(s) extrait(s) par pdftotext -layout (seuil ${MIN_NON_BLANK_CHARS})`,
  };
}

export function assertA3_sectionOrder(text, { lenient }) {
  const norm = normalize(text);
  const results = MARKERS.map((m) => {
    const idx = norm.indexOf(normalize(m.text));
    return { ...m, idx, found: idx !== -1 };
  });

  // En mode strict, TOUT marqueur manquant fait échouer. En mode lenient,
  // seuls les marqueurs NON conditionnels manquants font échouer — un
  // marqueur conditionnel absent devient un SKIP (donnée non saisie dans ce
  // jeu de test, pas un défaut structurel).
  const missingBlocking = results.filter((r) => !r.found && (!lenient || !r.conditional));
  if (missingBlocking.length > 0) {
    const list = missingBlocking.map((r) => `#${r.n} « ${r.text} »`).join(', ');
    return { ok: false, detail: `marqueur(s) manquant(s) : ${list}` };
  }

  const present = results.filter((r) => r.found);
  const skipped = results.filter((r) => !r.found);
  let prev = null;
  for (const r of present) {
    if (prev && r.idx <= prev.idx) {
      return {
        ok: false,
        detail: `ordre rompu : #${r.n} « ${r.text} » (index ${r.idx}) n'arrive pas après #${prev.n} « ${prev.text} » (index ${prev.idx})`,
      };
    }
    prev = r;
  }

  const skipNote = skipped.length > 0 ? ` — SKIP (conditionnel(s) absent(s)) : ${skipped.map((r) => `#${r.n}`).join(', ')}` : '';
  return {
    ok: true,
    detail: `${present.length}/${MARKERS.length} marqueurs présents, index strictement croissant${skipNote}`,
  };
}

// Titre « 7. » : au moins une lettre majuscule (accentuée FR incluse) doit
// suivre immédiatement l'espace après le point, pour ne matcher que des
// TITRES de section (« 7. ARTICULATION… ») et pas un numéro de liste isolé
// suivi d'un mot en bas de casse ou d'un chiffre (ex. horaire « 07. 30 »
// n'existe pas dans ce format mais on se prémunit du cas général). Le
// lookbehind `(?<!\d)` évite de matcher le « 7. » final d'un nombre à deux
// chiffres du type « 17. » qui n'existe dans aucune donnée de ce jeu, par
// prudence défensive plutôt que par nécessité observée.
const HEADING_SEVEN_RE = /(?<!\d)7\.\s+[A-ZÀ-ÝŒ]/g;

export function assertA4_duplicateSevenPreserved(text) {
  const norm = normalize(text);
  const matches = norm.match(HEADING_SEVEN_RE) ?? [];
  const ok = matches.length === 2;
  return {
    ok,
    detail: `${matches.length} titre(s) « 7. XXX » détecté(s) (attendu exactement 2 : « 7. ARTICULATION & ORDRES DE MOUVEMENT » et « 7. RÉCAPITULATIF PATRACDVR » — défaut hérité reproduit tel quel, SPEC §7 A4)`,
  };
}

export function assertA5_embeddedFonts(fonts) {
  if (fonts.length < 3) {
    return { ok: false, detail: `${fonts.length} police(s) listée(s) par pdffonts (minimum 3 attendu)` };
  }
  const notEmbedded = fonts.filter((f) => f.emb !== 'yes' || f.sub !== 'yes');
  const hasOswald = fonts.some((f) => f.name.includes('Oswald'));
  const hasJetBrains = fonts.some((f) => f.name.includes('JetBrainsMono'));

  if (notEmbedded.length > 0) {
    const list = notEmbedded.map((f) => `${f.name} (emb=${f.emb} sub=${f.sub})`).join(', ');
    return { ok: false, detail: `${notEmbedded.length}/${fonts.length} police(s) non intégralement embarquée(s)/sous-ensemblée(s) : ${list}` };
  }
  if (!hasOswald || !hasJetBrains) {
    const familles = fonts.map((f) => f.name).join(', ');
    const manquant = [!hasOswald && 'Oswald', !hasJetBrains && 'JetBrainsMono'].filter(Boolean).join(' et ');
    return { ok: false, detail: `famille ${manquant} absente (polices présentes : ${familles})` };
  }
  return {
    ok: true,
    detail: `${fonts.length} police(s), toutes emb=yes sub=yes, Oswald + JetBrainsMono présentes`,
  };
}

export function assertA6_noRasterization(images, pdfInfo, photosLimit) {
  const { pageCount, pageSizes } = pdfInfo;
  const count = images.length;
  const overLimit = count > photosLimit;

  let fullPageDetail = null;
  if (count === pageCount && count > 0) {
    const areaByPage = new Map(pageSizes.map((p) => [p.page, p.width * p.height]));
    for (const img of images) {
      const pageArea = areaByPage.get(img.page);
      // ppi manquant/nul (ex. image vectorielle sans résolution intrinsèque)
      // ⇒ couverture non calculable pour cette image, on l'ignore plutôt que
      // de produire un NaN silencieusement comptabilisé comme « couvrant ».
      if (!pageArea || !img.xppi || !img.yppi) continue;
      const widthPt = (img.width / img.xppi) * 72;
      const heightPt = (img.height / img.yppi) * 72;
      const coverage = (widthPt * heightPt) / pageArea;
      if (coverage >= FULL_PAGE_COVERAGE_RATIO) {
        fullPageDetail = `page ${img.page} : ${img.width}x${img.height}px @ ${img.xppi}x${img.yppi}ppi ≈ ${(coverage * 100).toFixed(1)}% de la surface de sa page`;
        break;
      }
    }
  }

  const ok = !overLimit && !fullPageDetail;
  const parts = [`${count} image(s) intégrée(s) (limite --photos=${photosLimit})`];
  if (overLimit) parts.push(`dépassement (${count} > ${photosLimit})`);
  if (count === pageCount && count > 0) parts.push(`nb_images == nb_pages (${count})`);
  if (fullPageDetail) parts.push(`signature de rastérisation html2canvas+jsPDF détectée : ${fullPageDetail}`);
  return { ok, detail: parts.join(' ; ') };
}

/**
 * POURQUOI inconditionnel (ne dépend PAS de --photos) : la SPEC §7 formule
 * cette assertion « avec --photos=0 », qui décrit le SCÉNARIO nominal pour
 * lequel le seuil de 1 Mio a été calibré (un PDF v3 sans photo embarquée),
 * pas une garde d'exécution qui désactiverait le contrôle dès que
 * `--photos` est non nul. Vérifié à l'exécution obligatoire de la mission
 * (`--photos=14` sur l'étalon raster 2,53 Mo) : le résultat ATTENDU y est
 * `FAIL A7`, pas un SKIP — un premier essai de ce script qui sautait le
 * contrôle dès `--photos>0` produisait un SKIP au lieu du FAIL attendu,
 * corrigé ici (cf. tests/pdf/README.md, section démonstration). Un vrai
 * PDF v3 avec des photos réellement embarquées dépassera donc légitimement
 * 1 Mio et fera échouer A7 pour une raison SANS RAPPORT avec la
 * rastérisation (poids des photos, pas un retour à html2canvas) — c'est un
 * comportement assumé de l'outil, pas un bug : un test avec photos doit
 * interpréter un FAIL A7 à la lumière des 7 autres assertions (A2/A5/A6
 * toujours vertes ⇒ pas de régression malgré le FAIL A7 isolé).
 */
export function assertA7_weight(fileSizeBytes) {
  const ok = fileSizeBytes <= MAX_BYTES_WHEN_NO_PHOTOS;
  return {
    ok,
    detail: `${fileSizeBytes} octet(s) (limite ${MAX_BYTES_WHEN_NO_PHOTOS} o = 1 Mio — scénario nominal --photos=0, vérifié inconditionnellement)`,
  };
}

/**
 * A8 utilise `normalize()` (cf. commentaire au point de définition) sur le
 * texte extrait ET sur chaque chaîne de `expect[]`, pour la MÊME raison
 * anti-wrap que A3 : une chaîne saisie assez longue (ex. un fragment de
 * `missions_psig`) peut chevaucher un retour à la ligne introduit par
 * `pdftotext -layout` si le champ source est rendu sur plusieurs lignes
 * dans le PDF. La SPEC ne l'exige pas explicitement pour A8 (seule A3 le
 * mentionne), mais l'omettre exposerait cette assertion au même faux
 * négatif — pas de raison de traiter le cas différemment.
 */
export function assertA8_sampleData(text, samplePath) {
  if (!samplePath) {
    return { ok: true, skip: true, detail: 'SKIP — --sample non fourni, assertion non applicable' };
  }
  if (!existsSync(samplePath)) {
    return { ok: false, detail: `fichier d'échantillon introuvable : ${samplePath}` };
  }
  let sample;
  try {
    sample = JSON.parse(readFileSync(samplePath, 'utf8'));
  } catch (err) {
    return { ok: false, detail: `JSON invalide dans ${samplePath} : ${err instanceof Error ? err.message : String(err)}` };
  }
  const expect = Array.isArray(sample?.expect) ? sample.expect : [];
  if (expect.length === 0) {
    return { ok: false, detail: `${samplePath} ne contient aucune chaîne dans "expect"` };
  }

  const norm = normalize(text);
  const missing = expect.filter((s) => !norm.includes(normalize(String(s))));
  const ok = missing.length === 0;
  const detail = ok
    ? `${expect.length}/${expect.length} chaîne(s) attendue(s) (échantillon ${samplePath}) trouvée(s) dans pdftotext`
    : `${expect.length - missing.length}/${expect.length} trouvée(s) — manquante(s) : ${missing.map((s) => JSON.stringify(s)).join(', ')}`;
  return { ok, detail };
}

// ===========================================================================
// B1..B3 — GUARDRAIL PAGINATION (mission PG.GUARD, correctif pagination PDF v3
// « mode rapide sans Playwright ») : 3 assertions STRUCTURELLES supplémentaires,
// indépendantes de A1-A8, détectant les 3 défauts prouvés sur un vrai PDF de
// 21 pages généré par la voie A (pdfmake) : queues orphelines (débordement
// d'une conduite à tenir ZMSPCP/MOICP sur une page quasi vide), pages à titre
// seul pour une section quasi vide, et mots du Store cassés verticalement
// dans les colonnes étroites du tableau PATRACDVR. Toujours évaluées
// (INDÉPENDANTES de `--lenient`, qui ne régit que les marqueurs conditionnels
// de A3) — un défaut de pagination n'est jamais « acceptable » selon le jeu
// de données saisi. Contre-épreuve : `tests/pdf/fixtures/long-case.json` +
// `tests/pdf/generate-from-fixture.mjs` (cf. `tests/pdf/README.md`).
// ===========================================================================

/**
 * Un fichier `pdftotext -layout` (sans `-nopgbrk`) sépare ses pages par `\f`
 * (form feed) — même découpage que `collectText`. `pdftotext` termine TOUJOURS
 * sa sortie par un `\f` final (y compris après la dernière page) : un
 * `split('\f')` naïf produit donc un dernier élément fantôme `''` qui
 * décalerait de 1 la détection « dernière page » (garde/finale de B1/B3) —
 * retiré ici, PAS dans `collectText` (A2/A3/A4/A8 travaillent sur le texte
 * entier, insensibles à ce `\f` de fin).
 */
function splitPages(text) {
  const pages = text.split('\f');
  if (pages.length > 0 && pages[pages.length - 1] === '') {
    pages.pop();
  }
  return pages;
}

/** Caractères non blancs d'une page — même définition que A2 (`assertA2_realText`), appliquée par PAGE plutôt qu'au document entier. */
function nonBlankLength(pageText) {
  return pageText.replace(/\s/g, '').length;
}

const ORPHAN_MIN_NON_BLANK_CHARS = 120;
// BLIND.FIX (point 5) — mode voie B : `ORPHAN_MIN_NON_BLANK_CHARS` (120) est
// calibré sur la voie A (pdfmake), où PLUSIEURS sections partagent
// normalement une page — une page sous ce seuil y signale un vrai
// débordement. La voie B (print-view.ts) est structurée en pages DÉDIÉES
// « une section = un `.adv-page` » (cf. son propre en-tête de fichier) : une
// page « 4. MISSION DE L'UNITÉ » à 2 lignes de mission, ou une galerie à 1
// photo, y est courte PAR CONCEPTION, pas par débordement — constat mesuré
// sur la recette complétée (`recipe-data.json`, bloc logistique BLIND.FIX
// point 6) : cette conception légitime déclenchait déjà des faux positifs
// avant même d'ajouter la moindre donnée volumineuse. Seuil VOIE B
// nettement plus bas (20, pas 0 : une page RÉELLEMENT vide resterait
// suspecte) plutôt qu'un skip total — la voie B garde un filet contre une
// vraie page blanche/quasi blanche.
const ORPHAN_MIN_NON_BLANK_CHARS_VOIE_B = 20;

/**
 * B1 — anti-orpheline : aucune page (hors GARDE = page 1, FINALE = dernière
 * page, et pages PHOTO = au moins une image `pdfimages` dessus, cf. `images`
 * de A6) ne doit tomber sous `ORPHAN_MIN_NON_BLANK_CHARS` (120) caractères non
 * blancs — signature d'une queue orpheline : un bloc non-`unbreakable`
 * (ex. `labelValue('C conduite à tenir', …)` dans `buildZmspcpPage`/
 * `buildMoicpPage`, `document-builder.ts`) déborde de sa page et n'y laisse
 * qu'un fragment de fin de phrase (constat terrain : « fixer l'adversaire. »
 * seule sur une page, « porte » sur une autre).
 */
export function assertB1_noOrphanPage(text, images, { voie = 'a' } = {}) {
  const pages = splitPages(text);
  const pageCount = pages.length;
  if (pageCount === 0) {
    return { ok: true, detail: 'document vide — aucune page à examiner' };
  }
  const threshold = voie === 'b' ? ORPHAN_MIN_NON_BLANK_CHARS_VOIE_B : ORPHAN_MIN_NON_BLANK_CHARS;
  const pagesWithImage = new Set(images.map((img) => img.page));
  const orphans = [];
  for (let i = 0; i < pageCount; i++) {
    const pageNum = i + 1;
    if (pageNum === 1 || pageNum === pageCount) continue; // garde / finale
    if (pagesWithImage.has(pageNum)) continue; // page photo pleine page
    const len = nonBlankLength(pages[i]);
    if (len < threshold) {
      orphans.push({ page: pageNum, len });
    }
  }
  if (orphans.length > 0) {
    const list = orphans.map((o) => `page ${o.page} (${o.len} car.)`).join(', ');
    return {
      ok: false,
      detail: `${orphans.length} page(s) orpheline(s) — < ${threshold} caractères non blancs (hors garde/finale/photo) : ${list}`,
    };
  }
  return {
    ok: true,
    detail: `0 page orpheline sur ${pageCount} page(s) (hors garde/finale/photo, seuil ${threshold} car.${voie === 'b' ? ', mode voie B' : ''})`,
  };
}

// Lettres capitales (+ accentuées FR) — vocabulaire des valeurs Store rendues
// en gras/centré dans les colonnes étroites du PATRACDVR (trigrammes,
// véhicules, direction) : `buildPatracPage` (document-builder.ts) rend CES
// valeurs telles quelles (jamais `.toUpperCase()`), donc une casse EXISTANTE
// tout-capitales dans le texte extrait signe une valeur SAISIE ainsi par
// l'utilisateur (ex. « SHARAN », « GILETTE »), pas un artefact de mise en forme.
const UPPER_CLASS = 'A-ZÀÂÄÉÈÊËÏÎÔÖÙÛÜÇ';
const WORD_SPLIT_TAIL_RE = new RegExp(`^[${UPPER_CLASS}]{2,}$`);
const WORD_SPLIT_HEAD_RE = new RegExp(`^[${UPPER_CLASS}]{1,4}$`);
// Tolérance de colonne (caractères) entre la fin d'un fragment et le début du
// suivant sur la ligne d'après — `pdftotext -layout` positionne le texte sur
// une grille de caractères façon monospace ; deux fragments de la MÊME
// colonne de tableau (donc potentiellement le MÊME mot coupé) restent à une
// poignée de caractères l'un de l'autre d'une ligne à l'autre.
const WORD_SPLIT_COLUMN_TOLERANCE = 3;
// En-têtes LITTÉRALES du tableau PATRACDVR (`buildPatracPage`, `headers`) —
// jamais des valeurs du Store, exclues des deux côtés d'une paire suspecte
// pour ne jamais confondre un en-tête (« VL », « DIR »…) avec un fragment de
// mot cassé situé juste en dessous dans la même colonne.
const PATRAC_HEADER_TOKENS = new Set(['VL', 'PAX', 'CELLULE', 'FONCTION', 'PPALE', 'SEC', 'AFIS', 'EQPT', 'GREN', 'DIR']);

/** Découpe une ligne `pdftotext -layout` en tokens `{ text, col }` (`col` = index caractère de début, cf. tolérance de colonne ci-dessus). */
function lineTokens(line) {
  const tokens = [];
  const re = /\S+/g;
  let m;
  while ((m = re.exec(line))) {
    tokens.push({ text: m[0], col: m.index });
  }
  return tokens;
}

/**
 * B2 — anti-césure verticale : aucun mot du Store scindé en fragments
 * empilés dans le tableau PATRACDVR (constat terrain : « SHARA\nN »,
 * « GILE\nTTE », « KODIA\nQ\nBANA » — colonnes trop étroites pour
 * `SHARAN`/`GILETTE`/`KODIAQ`, pas de césure au tiret). Portée volontairement
 * restreinte à la section PATRACDVR (entre le marqueur `MARKERS[13]` et la
 * page finale `MARKERS[14]`, ou la fin du document si celle-ci est absente) :
 * hors de cette section, les libellés STATIQUES du gabarit (`Z ZONE :`,
 * `PROF. BÂTI`, titres `h2`…) produisent de FAUX positifs géométriques
 * (lettre de libellé directement au-dessus d'un titre, texte justifié qui
 * s'aligne par hasard) qui n'ont RIEN à voir avec une valeur du Store —
 * vérifié en confrontant ce détecteur au PDF de la recette normale (0 faux
 * positif) avant de le restreindre à cette portée. Détection : pour chaque
 * paire de lignes adjacentes, un token tout-capitales de fin de ligne
 * (2+ lettres) suivi, à la MÊME colonne (± `WORD_SPLIT_COLUMN_TOLERANCE`),
 * d'un token tout-capitales de 1 à 4 lettres en tête de ligne suivante —
 * combinaison ≥ 4 lettres, ni l'un ni l'autre n'étant un en-tête littéral du
 * tableau. Une ligne se terminant par un TIRET n'entre jamais dans ce motif
 * (le tiret n'est pas une lettre capitale) — la césure légitime au tiret
 * n'est donc jamais signalée, conformément à la règle cible.
 */
// BLIND.FIX (point 5) — mode voie B : constat terrain « KODIAQ BANA » — DEUX
// mots COMPLETS et légitimes (ex. modèle de véhicule + fragment de couleur/
// immatriculation) qui se replient l'un sous l'autre, DANS LA MÊME COLONNE,
// sur deux lignes `pdftotext` adjacentes SANS être une césure — la voie B
// (tableau HTML natif, cf. `print-style.ts::.patrac`) n'a pas la même grille
// de colonnes fixes que le tableau pdfmake de la voie A, deux valeurs
// INDÉPENDANTES (pas une seule cellule enroulée) peuvent donc s'aligner par
// coïncidence. Distinction retenue, SANS dictionnaire : une césure RÉELLE
// (cellule d'UNE ligne de tableau qui s'enroule) laisse alors la ligne
// suivante quasi vide de tout AUTRE contenu (seule la suite du mot y
// figure) ; deux valeurs INDÉPENDANTES empilées appartiennent, elles, à des
// LIGNES DE TABLEAU DIFFÉRENTES et la ligne du « head » porte typiquement
// d'AUTRES tokens (les autres colonnes de cette ligne, ex. `PPR`, `India 4`).
// En mode voie B, on exige donc en plus que la ligne du « head » ne
// contienne PAS d'autre token que le fragment candidat (hors en-têtes
// littéraux) — une vraie césure passe ce filtre (rien d'autre sur cette
// ligne), deux mots complets de lignes différentes ne le passent
// généralement pas.
function otherTokensOnLine(line, head) {
  return lineTokens(line).filter((t) => t.text !== head.text && !PATRAC_HEADER_TOKENS.has(t.text));
}

export function assertB2_noVerticalWordSplit(text, { voie = 'a' } = {}) {
  const pages = splitPages(text);
  const patracMarker = MARKERS[13]; // '7. RÉCAPITULATIF PATRACDVR'
  const finalMarker = MARKERS[14]; // 'AVEZ-VOUS DES QUESTIONS ?'
  const normPages = pages.map((p) => normalize(p));
  const startIdx = normPages.findIndex((p) => p.includes(normalize(patracMarker.text)));
  if (startIdx === -1) {
    return { ok: true, skip: true, detail: 'SKIP — aucun tableau PATRACDVR dans ce document, assertion non applicable' };
  }
  let endIdx = normPages.findIndex((p, i) => i > startIdx && p.includes(normalize(finalMarker.text)));
  if (endIdx === -1) endIdx = pages.length;

  const hits = [];
  for (let pi = startIdx; pi < endIdx; pi++) {
    const lines = pages[pi].split('\n');
    for (let i = 0; i < lines.length - 1; i++) {
      const tails = lineTokens(lines[i]).filter(
        (t) => WORD_SPLIT_TAIL_RE.test(t.text) && !PATRAC_HEADER_TOKENS.has(t.text),
      );
      if (tails.length === 0) continue;
      const heads = lineTokens(lines[i + 1]).filter(
        (t) => WORD_SPLIT_HEAD_RE.test(t.text) && !PATRAC_HEADER_TOKENS.has(t.text),
      );
      if (heads.length === 0) continue;
      for (const tail of tails) {
        for (const head of heads) {
          if (Math.abs(tail.col - head.col) > WORD_SPLIT_COLUMN_TOLERANCE) continue;
          if (voie === 'b' && otherTokensOnLine(lines[i + 1], head).length > 0) continue;
          const combined = tail.text + head.text;
          if (combined.length < 4) continue;
          hits.push({ page: pi + 1, fragment1: tail.text, fragment2: head.text, combined });
        }
      }
    }
  }

  if (hits.length > 0) {
    const list = hits.map((h) => `page ${h.page} « ${h.fragment1} » + « ${h.fragment2} » = « ${h.combined} »`).join(', ');
    return { ok: false, detail: `${hits.length} mot(s) probablement cassé(s) verticalement dans le PATRACDVR : ${list}` };
  }
  return {
    ok: true,
    detail: `0 mot cassé verticalement dans le PATRACDVR (pages ${startIdx + 1}-${endIdx}${voie === 'b' ? ', mode voie B' : ''})`,
  };
}

const TITLE_ONLY_MAX_CONTENT_CHARS = 40;

/**
 * B3 — anti-page-titre-seul : aucune page ne doit porter un titre de section
 * (un des 15 `MARKERS`, cf. A3) avec MOINS de `TITLE_ONLY_MAX_CONTENT_CHARS`
 * (40) caractères non blancs de CONTENU (le texte de la page une fois le
 * titre matché lui-même déduit) — constat terrain : une page « LOGISTIQUE -
 * Détail » quasi noire, une page « Effraction - Détail » réduite à 4 badges,
 * pour une section dont les données saisies sont vides.
 *
 * Exclusion volontaire du marqueur FINALE (`MARKERS[14]`, « AVEZ-VOUS DES
 * QUESTIONS ? ») : cette page de clôture est un titre seul PAR CONCEPTION
 * (langage strategica, écart E2/E5 du README) — vérifié en confrontant ce
 * détecteur au PDF de la recette normale (`recipe-data.json`, qui remplit
 * TOUTES les sections) avant d'ajouter cette exclusion : sans elle, B3 FAIL
 * systématiquement sur cette page de clôture légitime, quel que soit le jeu
 * de données (faux positif garanti, pas un défaut de pagination).
 */
export function assertB3_noTitleOnlyPage(text) {
  const pages = splitPages(text);
  const finalMarkerNorm = normalize(MARKERS[14].text);
  const hits = [];
  pages.forEach((pageText, idx) => {
    const norm = normalize(pageText);
    const matched = MARKERS.filter((m) => norm.includes(normalize(m.text)));
    if (matched.length === 0) return;
    if (matched.length === 1 && normalize(matched[0].text) === finalMarkerNorm) return;
    const titleLen = Math.max(...matched.map((m) => normalize(m.text).replace(/\s/g, '').length));
    const total = nonBlankLength(pageText);
    const contentLen = Math.max(0, total - titleLen);
    if (contentLen < TITLE_ONLY_MAX_CONTENT_CHARS) {
      hits.push({ page: idx + 1, contentLen, titles: matched.map((m) => m.text) });
    }
  });
  if (hits.length > 0) {
    const list = hits
      .map((h) => `page ${h.page} « ${h.titles.join(' / ')} » (${h.contentLen} car. de contenu)`)
      .join(', ');
    return {
      ok: false,
      detail: `${hits.length} page(s) à titre seul — < ${TITLE_ONLY_MAX_CONTENT_CHARS} caractères de contenu hors titre : ${list}`,
    };
  }
  return { ok: true, detail: `0 page à titre seul (seuil ${TITLE_ONLY_MAX_CONTENT_CHARS} car. de contenu hors titre)` };
}

// ===========================================================================
// B4..B6 — GUARDRAIL PAGINATION round 2 (mission PG.REFIX) : les 3 défauts
// SUPPLÉMENTAIRES prouvés sur un PDF réel (`long-case.json`) que B1-B3
// laissaient passer — le rapport précédent avait déclaré vert un PDF qui en
// portait encore 3 : (a) queues NUES sans titre/« (suite) » pour les blocs
// ZMSPCP/MOICP (B1 ne voit qu'un déficit de CARACTÈRES, pas l'absence d'un
// EN-TÊTE) ; (b) une page à titre seul dont le contenu n'est fait que de
// libellés vides `LABEL : -` (B3 compte ces tirets comme du contenu) ; (c)
// la couverture scindée en 2 pages aux 2/3 vides (B1/B3 EXCLUENT
// délibérément la page de garde comme légitimement courte — ce défaut
// précis en fait une exception). Toujours évaluées, INDÉPENDANTES de
// `--lenient` (même principe que B1-B3).
// ===========================================================================

/** Un fragment « (suite) »/« (SUITE) » (port `h2()`, `blocks.ts` — MAJUSCULE le texte). */
const SUITE_RE = /\(suite\)/i;

/**
 * B4 — anti-queue-nue : aucune page (hors garde/finale/photo, même exclusion
 * que B1) ne doit commencer par un item à tiret (`- ...`) SANS le fragment
 * de titre `(suite)` qui doit obligatoirement le précéder — constat terrain
 * PG.REFIX round 1 : `catItemsPerPageBudget` (theme.ts) sous-estimait le
 * volume RÉEL d'un item qui s'enroule sur 2+ lignes (colonne `grid2` à
 * demi-largeur), la scission ne se déclenchait donc jamais et pdfmake
 * débordait la page SANS jamais poser le `h2(... (suite))`/`fieldLabel(...
 * (suite))` que `buildArticulationCorePages` (document-builder.ts) prévoit
 * pourtant pour ce cas — page 8/page 10 du PDF réel commençant brut par
 * « - Rendre compte de toute anomalie sonore… »/« - Rendre compte au chef de
 * dispositif… ». Portée délibérément restreinte au motif EXACT du défaut
 * (1re ligne non-blanche commençant par un tiret de liste) plutôt qu'à
 * « toute page sans marqueur » : la pagination automatique d'un TABLEAU
 * (`headerRows:1`, PATRACDVR notamment) est un écart ASSUMÉ (E3, README) —
 * une continuation de tableau ne commence jamais par un tiret, donc jamais
 * signalée ici à tort.
 */
export function assertB4_noHeaderlessDashContinuation(text, images) {
  const pages = splitPages(text);
  const pageCount = pages.length;
  if (pageCount === 0) {
    return { ok: true, detail: 'document vide — aucune page à examiner' };
  }
  const pagesWithImage = new Set(images.map((img) => img.page));
  const hits = [];
  for (let i = 0; i < pageCount; i++) {
    const pageNum = i + 1;
    if (pageNum === 1 || pageNum === pageCount) continue; // garde / finale
    if (pagesWithImage.has(pageNum)) continue; // page photo pleine page
    const firstLine = pages[i].split('\n').map((l) => l.trim()).find((l) => l !== '');
    if (firstLine === undefined) continue;
    if (firstLine.startsWith('-') && !SUITE_RE.test(pages[i].split('\n').slice(0, 3).join(' '))) {
      hits.push({ page: pageNum, firstLine });
    }
  }
  if (hits.length > 0) {
    const list = hits.map((h) => `page ${h.page} (« ${h.firstLine.slice(0, 60)} »)`).join(', ');
    return {
      ok: false,
      detail: `${hits.length} page(s) de continuation SANS titre/« (suite) » — 1re ligne non blanche est un item à tiret brut : ${list}`,
    };
  }
  return { ok: true, detail: `0 queue nue sur ${pageCount} page(s) (1re ligne à tiret sans titre « (suite) » précédent)` };
}

// Libellé `LABEL : -` COMPLET (`labelValue()`, blocks.ts — port MAJUSCULE
// `${label.toUpperCase()} : ${value}`) dont la valeur est le repli littéral
// `-` (`strOr`, document-builder.ts) — unité de mesure `mm` optionnelle
// (ex. `BÂTI À BÂTI : - mm`, `buildEffractionPage`). Capture le LIBELLÉ
// entier (pas seulement `: -`) pour pouvoir le déduire du contenu utile
// restant (cf. `assertB5_noEmptyFieldDominatedPage`) — un champ vide n'est
// jamais du contenu SAISI, qu'il s'agisse du libellé ou de la valeur.
const EMPTY_FIELD_RE = /[A-ZÀ-ÖØ-Þ0-9./' ]{2,40}:\s*-(?:\s*mm)?(?=\s|$)/g;
const EMPTY_FIELD_MIN_COUNT = 4;
const B5_CONTENT_MAX_CHARS = 250;
// Repli littéral des listes vides (`ciblesBody`/`hypBody`/`hypRows`,
// document-builder.ts : « Aucune cible renseignée. », « Aucune hypothèse
// saisie »…) — jamais du contenu SAISI non plus.
const PLACEHOLDER_PHRASE_RE = /Aucune[^\n]{0,60}/gi;
// Bande de pied de page document-wide (`buildFooter`, document-builder.ts,
// présente sur TOUTES les pages sauf la garde — écart assumé E2) + le
// compteur `n / N` sur la ligne suivante : jamais du contenu de section,
// exclus avant de compter le contenu utile restant.
const FOOTER_LINE_RE = /^\s*OI\s*-.*CONFIDENTIEL\s*$/gim;
const PAGE_COUNTER_LINE_RE = /^\s*\d+\s*\/\s*\d+\s*$/gm;

/**
 * B5 — anti-section-vide-non-omise : aucune page ne doit être DOMINÉE par
 * des libellés de valeur vide (`LABEL : -`, ≥ `EMPTY_FIELD_MIN_COUNT` sur la
 * page) tout en ayant, une fois le pied de page document-wide déduit, moins
 * de `B5_CONTENT_MAX_CHARS` caractères non blancs de contenu — constat
 * terrain PG.REFIX round 1 : la page « ARTICULATION : EFFRACTION » d'un
 * bloc créé mais jamais renseigné (STRUCTURE/SERRURERIE/ENVIRONNEMENT/
 * H. PORTE/PROF. BÂTI/BÂTI À BÂTI/DORMANT/PROF. LINTEAUX tous à `-`, «
 * Aucune hypothèse saisie ») passait B3 (qui compte les tirets ET les
 * libellés comme du « contenu ») alors que `document-builder.ts` prévoit
 * pourtant la règle « section vide = OMISE » ailleurs (`buildCatPage`/
 * `buildPatracPage`) — jamais portée aux blocs effraction avant ce
 * correctif. Double condition volontaire (nombre de champs vides ET volume
 * total modeste) : une page RICHE peut légitimement contenir quelques
 * `LABEL : -` isolés (champ optionnel non saisi) sans être pour autant une
 * « section vide » — seule la COMBINAISON des deux signaux est probante.
 */
export function assertB5_noEmptyFieldDominatedPage(text) {
  const pages = splitPages(text);
  const hits = [];
  pages.forEach((pageText, idx) => {
    const emptyFieldMatches = pageText.match(EMPTY_FIELD_RE) ?? [];
    if (emptyFieldMatches.length < EMPTY_FIELD_MIN_COUNT) return;
    const stripped = pageText
      .replace(EMPTY_FIELD_RE, '')
      .replace(PLACEHOLDER_PHRASE_RE, '')
      .replace(FOOTER_LINE_RE, '')
      .replace(PAGE_COUNTER_LINE_RE, '');
    const contentLen = nonBlankLength(stripped);
    if (contentLen <= B5_CONTENT_MAX_CHARS) {
      hits.push({ page: idx + 1, emptyFields: emptyFieldMatches.length, contentLen });
    }
  });
  if (hits.length > 0) {
    const list = hits
      .map((h) => `page ${h.page} (${h.emptyFields} champ(s) « LABEL : - », ${h.contentLen} car. de contenu hors pied de page)`)
      .join(', ');
    return {
      ok: false,
      detail: `${hits.length} page(s) dominée(s) par des libellés vides (≥ ${EMPTY_FIELD_MIN_COUNT} « LABEL : - », ≤ ${B5_CONTENT_MAX_CHARS} car. de contenu) — section vide non omise : ${list}`,
    };
  }
  return { ok: true, detail: `0 page dominée par des libellés vides (seuils ${EMPTY_FIELD_MIN_COUNT} champs / ${B5_CONTENT_MAX_CHARS} car.)` };
}

const FILL_RATIO_MIN = 0.35;

/**
 * B6 — anti-page-clairsemée : ratio de remplissage vertical (Y du mot le
 * plus bas d'une page ÷ hauteur de page, `pdftotext -bbox`) ≥
 * `FILL_RATIO_MIN` sur TOUTE page sauf la FINALE (`MARKERS[14]`, « AVEZ-VOUS
 * DES QUESTIONS ? » — page de clôture courte PAR CONCEPTION, écart assumé
 * E2/E5, même exclusion que B3). Délibérément PAS d'exclusion de la page de
 * GARDE (à la différence de B1/B3) : c'est précisément CETTE page qui
 * portait le défaut « carte esseulée » constaté PG.REFIX round 1
 * (couverture scindée en 2 pages aux 2/3 vides — `situationCard` reportée
 * en bloc sur la page 2 par `grid2`, colonnes non synchronisées pour la
 * pagination pdfmake).
 *
 * SEUIL CALIBRÉ VOLONTAIREMENT BAS (35 %, pas 50 %) — écart mesuré,
 * documenté ici plutôt que deviné : le PDF fautif (avant correctif) mesurait
 * 0,54 sur sa garde scindée, MAIS une garde LÉGITIMEMENT minimale (`RAS.`/
 * `RAS.`, aucune cible) mesure 0,59 — MOINS remplie encore, par construction
 * (peu de données saisies ⇒ peu de contenu, sans aucun bug). Un simple ratio
 * ne peut donc PAS discriminer de façon fiable « couverture scindée » de
 * « couverture légitimement courte » dans cette bande 0,5-0,6 : cette
 * assertion reste un FILET GÉNÉRIQUE contre les cas plus sévères (page quasi
 * vide, < 35 %), le défaut PRÉCIS « carte esseulée » de la couverture est
 * couvert de façon fiable par A3 (ordre des marqueurs #2/#3) et B4/B5
 * ci-dessus, pas par ce seuil. Le pied de page document-wide (présent sur
 * toutes les pages SAUF la garde) pousse par ailleurs mécaniquement le ratio
 * de toute autre page vers ~0,97 — cette assertion est donc, par
 * construction du document, surtout un filet pour la garde ; conservée
 * générique (pas de branche spéciale « page 1 ») pour rester valide si
 * `buildFooter`/la géométrie de couverture évoluent.
 */
// BLIND.FIX (point 5) — mode voie B : `FILL_RATIO_MIN` (35 %) suppose une
// page qui accumule PLUSIEURS sections (voie A) — un ratio bas y signale un
// vrai gâchis de place (carte esseulée, cf. JSDoc ci-dessus). La voie B
// (une section = un `.adv-page`, cf. en-tête `print-view.ts`) produit des
// pages COURTES PAR CONCEPTION dès qu'une section a peu de contenu (ex.
// « 4. MISSION DE L'UNITÉ » à 2 lignes, une galerie à 1 photo) — constat
// mesuré (`recipe-data.json` complétée, BLIND.FIX point 6) : 20 % de
// remplissage sur une page MISSION parfaitement légitime. Cette assertion
// est SKIP (pas silencieusement PASS) en mode voie B — le filet reste actif
// en voie A par défaut, inchangé.
export function assertB6_verticalFillRatio(bboxPages, { voie = 'a' } = {}) {
  if (voie === 'b') {
    return {
      ok: true,
      skip: true,
      detail: 'SKIP (mode voie B) — pages dédiées « une section = une page » légitimement peu remplies par conception, non applicable',
    };
  }
  const pageCount = bboxPages.length;
  if (pageCount === 0) {
    return { ok: true, detail: 'document vide — aucune page à examiner' };
  }
  const hits = [];
  bboxPages.forEach((page, idx) => {
    const pageNum = idx + 1;
    if (pageNum === pageCount) return; // finale, courte par conception
    if (page.height <= 0) return;
    const ratio = page.maxYMax / page.height;
    if (ratio < FILL_RATIO_MIN) {
      hits.push({ page: pageNum, ratio });
    }
  });
  if (hits.length > 0) {
    const list = hits.map((h) => `page ${h.page} (${(h.ratio * 100).toFixed(0)} %)`).join(', ');
    return {
      ok: false,
      detail: `${hits.length} page(s) sous ${(FILL_RATIO_MIN * 100).toFixed(0)} % de remplissage vertical (hors finale) : ${list}`,
    };
  }
  return { ok: true, detail: `0 page sous ${(FILL_RATIO_MIN * 100).toFixed(0)} % de remplissage vertical (hors finale)` };
}

// ===========================================================================
// B7 — GUARDRAIL PAGINATION round 3 (mission BLIND.REFIX round 2) : la table
// Hypothèses d'Effraction (voie A, `buildEffractionPages`) débordait
// NATURELLEMENT sa page (en-tête de tableau répétée par `headerRows:1`, MAIS
// SANS aucun titre « ARTICULATION : EFFRACTION »/« (SUITE) ») avant que la
// scission pilotée n'ait l'occasion de se déclencher — `hypothesisRowCost`/
// `chunkItemsByCost` sous-estimaient le volume réel du 1er fragment (surcoût
// MISSION + carte « Caractéristiques Techniques » jamais déduit du budget) —
// reproduit sur `effrac-n4`/`n6`/`n8`/`12-hypotheses.json`, preuve
// `A-effrac12L-11.png` (p.11 : en-tête répétée + 1 hypothèse, aucun titre).
// ===========================================================================

/** Ligne de tableau Hypothèses d'Effraction (`hypothesisTableRow`, document-builder.ts — colonne 1 « Hypothese N »). */
const HYP_ROW_RE = /^\s*Hypothese\s+\d+\b/m;

/** Titre de section EFFRACTION, avec ou sans son suffixe `(SUITE)` (`buildEffractionPages`, document-builder.ts). */
const EFFRACTION_TITLE_RE = /ARTICULATION\s*:\s*EFFRACTION/;

/**
 * B7 — anti-queue-de-tableau-sans-titre : toute page contenant AU MOINS une
 * ligne du tableau Hypothèses d'Effraction (`Hypothese N` en 1re colonne)
 * doit également porter, sur cette MÊME page, le titre de section
 * « ARTICULATION : EFFRACTION » (page 1 du bloc) OU son suffixe
 * « (SUITE) » (scission pilotée) — jamais une page de continuation
 * NATURELLE de pdfmake (en-tête de tableau seule, aucun titre) qui
 * désynchroniserait la coupure réelle du repère visuel destiné à
 * l'utilisateur. Toujours évaluée, INDÉPENDANTE de `--lenient` (même
 * principe que B1/B4).
 */
export function assertB7_effractionSuiteTitlePresent(text) {
  const pages = splitPages(text);
  const pageCount = pages.length;
  if (pageCount === 0) {
    return { ok: true, detail: 'document vide — aucune page à examiner' };
  }
  const hits = [];
  pages.forEach((pageText, idx) => {
    if (HYP_ROW_RE.test(pageText) && !EFFRACTION_TITLE_RE.test(pageText)) {
      hits.push(idx + 1);
    }
  });
  if (hits.length > 0) {
    return {
      ok: false,
      detail: `${hits.length} page(s) portant une ligne « Hypothese N » SANS titre « ARTICULATION : EFFRACTION »/« (SUITE) » sur la même page : ${hits.join(', ')}`,
    };
  }
  return { ok: true, detail: `0 page de continuation de tableau Hypothèses d'Effraction sans titre (sur ${pageCount} page(s))` };
}

// ===========================================================================
// CLI
// ===========================================================================

function printUsage() {
  console.error(
    'Usage : node tests/pdf/verify-structure.mjs <fichier.pdf> [--format=a4|16:9] [--photos=N] [--sample=<fichier.json>] [--json] [--lenient] [--voie=a|b]'
  );
}

function parseArgs(argv) {
  const args = argv.slice(2);
  const flags = args.filter((a) => a.startsWith('--'));
  const positional = args.filter((a) => !a.startsWith('--'));

  if (positional.length !== 1) {
    printUsage();
    process.exit(2);
  }
  const file = positional[0];

  const getValue = (name) => {
    const flag = flags.find((f) => f === `--${name}` || f.startsWith(`--${name}=`));
    if (!flag) return undefined;
    const eq = flag.indexOf('=');
    return eq === -1 ? '' : flag.slice(eq + 1);
  };

  const formatRaw = getValue('format') ?? 'a4';
  const format = formatRaw.toLowerCase();
  if (format !== 'a4' && format !== '16:9') {
    console.error(`Format invalide : "${formatRaw}" (attendu : a4 ou 16:9)`);
    printUsage();
    process.exit(2);
  }

  const photosRaw = getValue('photos') ?? '0';
  const photos = Number(photosRaw);
  if (!Number.isInteger(photos) || photos < 0) {
    console.error(`--photos invalide : "${photosRaw}" (entier ≥ 0 attendu)`);
    printUsage();
    process.exit(2);
  }

  const sample = getValue('sample') || undefined;
  const json = flags.some((f) => f === '--json');
  const lenient = flags.some((f) => f === '--lenient');

  // BLIND.FIX (point 5) — `--voie=a|b` : voie A (pdfmake, défaut — comportement
  // INCHANGÉ) ou voie B (print-view.ts/navigateur) pour les gardes B1/B2/B6
  // (cf. leur JSDoc respective) dont le calibrage suppose par défaut la
  // pagination dense multi-sections de la voie A — inapplicable à la voie B
  // qui a une page dédiée par section PAR CONCEPTION.
  const voieRaw = (getValue('voie') ?? 'a').toLowerCase();
  if (voieRaw !== 'a' && voieRaw !== 'b') {
    console.error(`--voie invalide : "${voieRaw}" (attendu : a ou b)`);
    printUsage();
    process.exit(2);
  }

  return { file, format, photos, sample, json, lenient, voie: voieRaw };
}

function main() {
  const opts = parseArgs(process.argv);

  if (!existsSync(opts.file)) {
    console.error(`Fichier PDF introuvable : ${opts.file}`);
    process.exit(2);
  }

  const missingBinaries = findMissingBinaries();
  if (missingBinaries.length > 0) {
    console.error(
      `Binaire(s) poppler introuvable(s) dans le PATH : ${missingBinaries.join(', ')}.\n` +
        `Installez le paquet système "${POPPLER_PACKAGE_HINT}" (fournit pdfinfo/pdftotext/pdffonts/pdfimages) puis relancez.`
    );
    process.exit(2);
  }

  let pdfInfo, text, fonts, images, fileSizeBytes, bboxPages;
  try {
    pdfInfo = collectPdfInfo(opts.file);
    text = collectText(opts.file);
    fonts = collectFonts(opts.file);
    images = collectImages(opts.file);
    fileSizeBytes = statSync(opts.file).size;
    bboxPages = collectBBox(opts.file);
  } catch (err) {
    // Fichier existant mais illisible par poppler (corrompu, pas un PDF...)
    // — l'outil ne peut faire tourner AUCUNE assertion, même traitement que
    // les autres gardes d'exécution (code 2), pas une trace de pile brute.
    console.error(`Échec d'analyse du PDF (fichier corrompu ou non-PDF ?) : ${err instanceof Error ? err.message : String(err)}`);
    process.exit(2);
  }

  const assertions = [
    { code: 'A1', ...assertA1_geometry(pdfInfo, opts.format) },
    { code: 'A2', ...assertA2_realText(text) },
    { code: 'A3', ...assertA3_sectionOrder(text, { lenient: opts.lenient }) },
    { code: 'A4', ...assertA4_duplicateSevenPreserved(text) },
    { code: 'A5', ...assertA5_embeddedFonts(fonts) },
    { code: 'A6', ...assertA6_noRasterization(images, pdfInfo, opts.photos) },
    { code: 'A7', ...assertA7_weight(fileSizeBytes) },
    { code: 'A8', ...assertA8_sampleData(text, opts.sample) },
    // Guardrail pagination (mission PG.GUARD) — toujours évaluées, INDÉPENDANTES
    // de --lenient (cf. en-tête de ces 3 fonctions).
    { code: 'B1', ...assertB1_noOrphanPage(text, images, { voie: opts.voie }) },
    { code: 'B2', ...assertB2_noVerticalWordSplit(text, { voie: opts.voie }) },
    { code: 'B3', ...assertB3_noTitleOnlyPage(text) },
    // Guardrail pagination round 2 (mission PG.REFIX) — mêmes garanties que
    // B1-B3 (toujours évaluées, indépendantes de --lenient).
    { code: 'B4', ...assertB4_noHeaderlessDashContinuation(text, images) },
    { code: 'B5', ...assertB5_noEmptyFieldDominatedPage(text) },
    { code: 'B6', ...assertB6_verticalFillRatio(bboxPages, { voie: opts.voie }) },
    // Guardrail pagination round 3 (mission BLIND.REFIX round 2) — même
    // garantie que B1/B4 (toujours évaluée, indépendante de --lenient).
    { code: 'B7', ...assertB7_effractionSuiteTitlePresent(text) },
  ];

  for (const a of assertions) {
    console.log(`${a.ok ? 'PASS' : 'FAIL'} ${a.code} — ${a.detail}`);
  }

  const passCount = assertions.filter((a) => a.ok).length;
  const allOk = passCount === assertions.length;
  console.log(`${passCount}/${assertions.length} assertions`);

  if (opts.json) {
    console.log(
      JSON.stringify({
        ok: allOk,
        file: opts.file,
        assertions: assertions.map((a) => ({ code: a.code, ok: a.ok, detail: a.detail })),
      })
    );
  }

  process.exit(allOk ? 0 : 1);
}

// N'exécute `main()` (donc `process.exit()`) que lorsque ce fichier est le
// point d'entrée `node tests/pdf/verify-structure.mjs ...` — PAS quand il
// est importé comme module (cf. `tests/unit/oi/pdf-pdf-p8-verify-structure.test.ts`,
// qui importe les fonctions pures ci-dessus par leur `export`) : sans cette
// garde, un simple `import` depuis le test unitaire déclencherait `main()`
// avec `process.argv` du test runner, donc `process.exit(2)` (usage
// invalide) et ferait crasher toute la suite vitest.
const isMainModule = import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  main();
}
