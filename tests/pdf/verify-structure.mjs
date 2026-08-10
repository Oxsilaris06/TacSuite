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
 *       [--photos=N] [--sample=<fichier.json>] [--fixture=<fichier.json>]
 *       [--json] [--lenient]
 *
 * Défauts : --format=a4, --photos=0, mode strict (pas de --lenient).
 * Sortie : une ligne `PASS <code> — <libellé>` ou `FAIL <code> — <constat
 * mesuré>` par assertion (A1..A8 historiques + guardrail pagination B1/B2/B5/
 * B6/B9 + guardrail de contrat C1..C5, mission P4 « une page = un usage »),
 * puis un résumé `N/M assertions`. Avec `--json`, émet EN PLUS (pas à la
 * place — les lignes lisibles restent imprimées) un objet `{ ok, file,
 * assertions: [{ code, ok, detail }] }` sur stdout, en dernière ligne.
 * Code de sortie : 0 si toutes les assertions passent, 1 sinon, 2 en cas de
 * garde d'exécution (binaire poppler absent, fichier PDF introuvable,
 * arguments invalides — l'outil n'a alors PU faire tourner aucune assertion).
 *
 * MISSION P4 (contrat « une page = un usage », commit a57b128) — réécriture
 * des gardes structurelles pour le nouveau moteur (voie A pdfmake
 * exclusivement, la voie B `print-view.ts`/navigateur ayant été retirée de
 * l'app en R4-a) : chaque fiche adversaire, chaque bloc ZMSPCP/MOICP tient
 * désormais EXACTEMENT sur une page (refonte totale, plus de continuation
 * « (SUITE) ») ; une cellule effraction s'étend sur 1..K pages AUTONOMES aux
 * titres distincts (jamais « (SUITE) ») ; si même le palier de police
 * plancher ne suffit pas, `buildOiDocDefinition` REFUSE explicitement la
 * génération (`OiPdfFitRefusalError`) plutôt que de produire un document
 * tronqué. L'option `--voie=a|b` de calibrage historique (B1/B2/B6/B8/B9
 * doublées d'un seuil « voie B ») a été RETIRÉE avec elle : la voie B
 * n'existe plus dans l'app, ce calibrage n'a donc plus de raison d'être
 * maintenu ici (git history en garde la trace si un jour une page dédiée par
 * section resservait).
 *
 * Détail des 8 assertions A1-A8 et de leurs seuils : voir
 * `tests/pdf/README.md` et `docs/SPEC-PDF-V3.md` §7 (tableau « Assertions
 * exactes »). B1/B2/B5/B6/B9 (guardrail pagination CONSERVÉ/ADAPTÉ des
 * rounds PG.GUARD/PG.REFIX/GD.GUARDS — B3/B4/B7/B8/B10/B11 ont été RETIRÉES,
 * leur motif étant désormais couvert par les gardes de CONTRAT C1..C4 ci-
 * dessous, plus directement adaptées au nouveau layout) et C1..C5 (nouvelles
 * gardes de CONTRAT mission P4) sont documentées en JSDoc à leur point de
 * définition et TOUJOURS évaluées, indépendamment de `--lenient` (qui ne
 * régit que les marqueurs conditionnels de A3).
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
// RECALIBRAGE MISSION P4 (nouveau layout « une page = un usage ») : le
// plancher historique de 12 pages datait d'un layout où les continuations
// « (SUITE) » et les pages à titre seul gonflaient artificiellement le
// compte de pages pour un même volume de données — l'objectif même de la
// refonte P1 est de rendre le document PLUS COMPACT (fiche adversaire/
// ZMSPCP/MOICP sur une page dense au lieu de plusieurs pages aérées).
// `tests/pdf/fixtures/long-case.json` (dossier réaliste, sans adversaire ni
// photo) mesure désormais 10 pages sur un PDF frais généré par
// `generate-from-fixture.mjs` — un plancher à 12 ferait donc FAIL à tort un
// dossier légitime. Nouveau plancher choisi sous ce plancher mesuré tout en
// restant un filet utile contre une régression grossière (ex. document
// réduit à sa seule garde + page finale).
const MIN_PAGES = 8;
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
// B1/B2/B5/B6/B9 — GUARDRAIL PAGINATION CONSERVÉ/ADAPTÉ (missions PG.GUARD/
// PG.REFIX/GD.GUARDS) pour le nouveau contrat « une page = un usage »
// (mission P4, commit a57b128). B3/B4/B7/B8/B10/B11 ont été RETIRÉES : leur
// motif (continuation « (SUITE) » sans titre) ne peut plus se produire de la
// même façon depuis que fiche adversaire/ZMSPCP/MOICP/cellule effraction
// n'utilisent plus JAMAIS de continuation « (SUITE) » (garde inverse C1
// ci-dessous) — le motif qu'elles couvraient est désormais directement
// vérifié par les gardes de CONTRAT C2..C4 (spécifiques à chaque usage,
// plus précises que l'ancienne détection générique par signature de texte).
// L'option historique `--voie=a|b` a été RETIRÉE avec son propre calibrage
// (la voie B n'existe plus dans l'app, cf. en-tête de fichier) : B1/B2/B6/B9
// n'ont donc plus qu'un seul comportement (l'ancien « voie A », INCHANGÉ).
// Toujours évaluées, INDÉPENDANTES de `--lenient` (qui ne régit que les
// marqueurs conditionnels de A3).
// ===========================================================================

/**
 * Un fichier `pdftotext -layout` (sans `-nopgbrk`) sépare ses pages par `\f`
 * (form feed) — même découpage que `collectText`. `pdftotext` termine TOUJOURS
 * sa sortie par un `\f` final (y compris après la dernière page) : un
 * `split('\f')` naïf produit donc un dernier élément fantôme `''` qui
 * décalerait de 1 la détection « dernière page » — retiré ici, PAS dans
 * `collectText` (A2/A3/A4/A8 travaillent sur le texte entier, insensibles à
 * ce `\f` de fin).
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

/**
 * B1 — anti-orpheline : aucune page (hors GARDE = page 1, FINALE = dernière
 * page, et pages PHOTO = au moins une image `pdfimages` dessus, cf. `images`
 * de A6) ne doit tomber sous `ORPHAN_MIN_NON_BLANK_CHARS` (120) caractères non
 * blancs — signature d'une queue orpheline. Sous le nouveau contrat (mission
 * P4), ce motif précis ne devrait plus se produire pour fiche adversaire/
 * ZMSPCP/MOICP/cellule effraction (solveur fit-to-page + refus explicite),
 * mais reste un filet générique utile pour toute AUTRE page du document
 * (couverture, environnement, mission+exécution, CAT, PATRACDVR) où un bloc
 * `unbreakable:false` pourrait encore déborder marginalement.
 */
export function assertB1_noOrphanPage(text, images) {
  const pages = splitPages(text);
  const pageCount = pages.length;
  if (pageCount === 0) {
    return { ok: true, detail: 'document vide — aucune page à examiner' };
  }
  const pagesWithImage = new Set(images.map((img) => img.page));
  const orphans = [];
  for (let i = 0; i < pageCount; i++) {
    const pageNum = i + 1;
    if (pageNum === 1 || pageNum === pageCount) continue; // garde / finale
    if (pagesWithImage.has(pageNum)) continue; // page photo pleine page
    const len = nonBlankLength(pages[i]);
    if (len < ORPHAN_MIN_NON_BLANK_CHARS) {
      orphans.push({ page: pageNum, len });
    }
  }
  if (orphans.length > 0) {
    const list = orphans.map((o) => `page ${o.page} (${o.len} car.)`).join(', ');
    return {
      ok: false,
      detail: `${orphans.length} page(s) orpheline(s) — < ${ORPHAN_MIN_NON_BLANK_CHARS} caractères non blancs (hors garde/finale/photo) : ${list}`,
    };
  }
  return {
    ok: true,
    detail: `0 page orpheline sur ${pageCount} page(s) (hors garde/finale/photo, seuil ${ORPHAN_MIN_NON_BLANK_CHARS} car.)`,
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
 * hors de cette section, les libellés STATIQUES du gabarit produisent de
 * FAUX positifs géométriques qui n'ont RIEN à voir avec une valeur du Store.
 * Détection : pour chaque paire de lignes adjacentes, un token tout-capitales
 * de fin de ligne (2+ lettres) suivi, à la MÊME colonne
 * (± `WORD_SPLIT_COLUMN_TOLERANCE`), d'un token tout-capitales de 1 à 4
 * lettres en tête de ligne suivante — combinaison ≥ 4 lettres, ni l'un ni
 * l'autre n'étant un en-tête littéral du tableau.
 */
export function assertB2_noVerticalWordSplit(text) {
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
    detail: `0 mot cassé verticalement dans le PATRACDVR (pages ${startIdx + 1}-${endIdx})`,
  };
}

/** Fragment « (suite) »/« (SUITE) » — cf. garde inverse C1 ci-dessous : n'existe plus QUE pour les pages de galerie photo multi-clichés (`galleryPages`, `blocks.ts`), jamais pour fiche adversaire/ZMSPCP/MOICP/cellule effraction (mission P4). */
const SUITE_RE = /\(suite\)/i;

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
 * de `B5_CONTENT_MAX_CHARS` caractères non blancs de contenu — signale une
 * section créée mais jamais renseignée qui aurait dû être OMISE plutôt que
 * rendue avec ses replis `-`. Inchangée par la mission P4 (comportement
 * indépendant du découpage en pages).
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

// Titres de page reconnus comme des pages d'USAGE À CONTRAT DUR (mission P1 :
// fiche adversaire/ZMSPCP/MOICP tiennent TOUJOURS sur une page unique, une
// cellule effraction sur 1..K pages autonomes) — sert au recalibrage B6
// ci-dessous : un petit dossier peu renseigné peut légitimement laisser une
// telle page assez peu remplie (aération PAR CONCEPTION, pas un bug de
// pagination), à la différence d'une page COMPOSITE historique (couverture,
// environnement, mission+exécution, CAT, PATRACDVR) qui accumule plusieurs
// blocs et où un remplissage bas signale plus probablement un déficit réel
// (ex. carte esseulée, colonne reportée en bloc).
const ADV_FICHE_TITLE_RE = /\d+\.\d+\s+FICHE ADVERSAIRE\s*:/;
const ZM_TITLE_RE = /ARTICULATION\s*:\s*ZMSPCP\s*-/;
const MO_TITLE_RE = /ARTICULATION\s*:\s*MOICP\s*-/;
/** Titre effraction, base OU une de ses 2 variantes de page autonome (cf. C4) — capture le suffixe (`undefined` si page 1/unique). */
const EFFRAC_TITLE_RE = /ARTICULATION\s*:\s*EFFRACTION\s*-\s*(.*?)(?:\s+—\s+(MISSION\s*&\s*CARACT[ÉE]RISTIQUES|HYPOTH[ÈE]SES\s+[\d]+(?:-[\d]+)?))?\s*$/m;

/**
 * Une page « d'usage à contrat dur » (mission P1) — porte le titre d'une
 * fiche adversaire, d'un bloc ZMSPCP/MOICP, ou d'une page effraction (base,
 * « — MISSION & CARACTÉRISTIQUES » ou « — HYPOTHÈSES <plage> »). Pour
 * l'effraction, renvoie en plus le TITRE DE BASE (sans suffixe) — sert à B6
 * pour repérer si CE groupe se poursuit sur la page suivante (cf. JSDoc B6).
 */
function usagePageInfo(pageText) {
  if (ADV_FICHE_TITLE_RE.test(pageText)) return { kind: 'adversary' };
  if (ZM_TITLE_RE.test(pageText)) return { kind: 'zmspcp' };
  if (MO_TITLE_RE.test(pageText)) return { kind: 'moicp' };
  const m = pageText.match(EFFRAC_TITLE_RE);
  if (m) return { kind: 'effraction', base: m[1].trim(), suffix: m[2] };
  return null;
}

/**
 * B6 — anti-page-clairsemée : ratio de remplissage vertical (Y du mot le
 * plus bas d'une page ÷ hauteur de page, `pdftotext -bbox`) ≥
 * `FILL_RATIO_MIN` sur TOUTE page sauf la FINALE (`MARKERS[14]`).
 *
 * RECALIBRAGE MISSION P4 (nouveau layout « une page = un usage ») : une page
 * d'usage à contrat dur (`usagePageInfo`, ci-dessus) est EXEMPTÉE de ce
 * seuil SAUF si elle appartient à un groupe effraction dont une AUTRE page
 * du MÊME titre de base la suit immédiatement — c'est-à-dire quand du
 * contenu du même usage suit (directive P4) : une cellule effraction scindée
 * en pages « MISSION & CARACTÉRISTIQUES » / « HYPOTHÈSES … » dont l'une des
 * pages intermédiaires serait anormalement clairsemée alors que la suivante
 * appartient encore au même bloc reste un signal de mauvaise répartition
 * (`packHypotheses` aurait dû regrouper davantage) — un petit dossier peu
 * renseigné, lui, ne produit jamais plus d'une page effraction par cellule,
 * donc jamais ce motif. Les pages COMPOSITES (couverture, environnement,
 * mission+exécution, articulation vue d'ensemble, CAT, PATRACDVR) restent
 * couvertes SANS exemption (comportement historique inchangé) : un déficit
 * de remplissage y reste le signal fiable d'origine (carte esseulée, etc.).
 */
export function assertB6_verticalFillRatio(bboxPages, text) {
  const pageCount = bboxPages.length;
  if (pageCount === 0) {
    return { ok: true, detail: 'document vide — aucune page à examiner' };
  }
  const pages = splitPages(text);
  const infos = pages.map((p) => usagePageInfo(p));
  const hits = [];
  bboxPages.forEach((page, idx) => {
    const pageNum = idx + 1;
    if (pageNum === pageCount) return; // finale, courte par conception
    if (page.height <= 0) return;
    const info = infos[idx];
    if (info) {
      if (info.kind !== 'effraction') return; // fiche adversaire/ZMSPCP/MOICP : toujours exemptée (1 page, aération légitime)
      const next = infos[idx + 1];
      const continues = next && next.kind === 'effraction' && next.base === info.base;
      if (!continues) return; // dernière page du groupe (ou groupe à 1 page) : aération légitime
    }
    const ratio = page.maxYMax / page.height;
    if (ratio < FILL_RATIO_MIN) {
      hits.push({ page: pageNum, ratio });
    }
  });
  if (hits.length > 0) {
    const list = hits.map((h) => `page ${h.page} (${(h.ratio * 100).toFixed(0)} %)`).join(', ');
    return {
      ok: false,
      detail: `${hits.length} page(s) sous ${(FILL_RATIO_MIN * 100).toFixed(0)} % de remplissage vertical (hors finale/usages aérés légitimes) : ${list}`,
    };
  }
  return { ok: true, detail: `0 page sous ${(FILL_RATIO_MIN * 100).toFixed(0)} % de remplissage vertical (hors finale, pages-usage à contrat dur exemptées sauf continuation effraction)` };
}

/** En-tête à 4 colonnes du tableau Hypothèses d'Effraction (répétée sur chaque page effraction dense, cf. `hypothesesTableHeader`, document-builder.ts). */
const HYP_TABLE_HEAD_RE = /Technique\s*\/\s*Moyen/;

/**
 * Retire d'un texte de page le pied de page document-wide (`buildFooter`,
 * document-builder.ts — bande « OI - … CONFIDENTIEL » + compteur « n / N »)
 * avant toute mesure de contenu.
 */
function stripFooter(pageText) {
  return pageText.replace(FOOTER_LINE_RE, '').replace(PAGE_COUNTER_LINE_RE, '');
}

// Signatures STATIQUES du gabarit (jamais du texte utilisateur) : titres de
// bloc et en-têtes de tableau susceptibles de rester orphelins en BAS de
// page quand pdfmake coupe naturellement juste après eux. Sources :
// `buildAdversaryFiche` (IDENTITÉ, DANGEROSITÉ, LOCALISATION, MOBILITÉ, ATCD),
// `buildEffractionPages` (Hypothèses d'Effraction, Caractéristiques
// Techniques, Description des Hypothèses), `buildArticulationPage`
// (Composition par Cellule) — document-builder.ts. Apostrophe tolérante
// `['’]` : même précaution que `normalize()` (le moteur de rendu peut
// substituer l'apostrophe courbe).
const B9_TRAILING_TITLE_RES = [
  /Hypothèses d['’]Effraction/,
  /Caractéristiques Techniques/,
  /Description des Hypothèses/,
  /DANGEROSITÉ/,
  /LOCALISATION/,
  /MOBILITÉ/,
  /IDENTITÉ/,
  /\bATCD\b/,
  /Composition par Cellule/,
  HYP_TABLE_HEAD_RE,
];

/**
 * B9 — anti-titre-orphelin-en-bas-de-page : aucune page (hors FINALE) ne
 * doit se TERMINER par un titre de bloc ou un en-tête de tableau non suivi
 * de données sur la même page — les 2 dernières lignes non blanches de la
 * page (pied de page et compteur retirés) matchent une des signatures
 * `B9_TRAILING_TITLE_RES`.
 *
 * RESSERRAGE issu du balayage anti-faux-positifs (round GD.GUARDS, préservé
 * tel quel par la mission P4) : le critère retenu est que la DERNIÈRE ligne
 * non blanche matche une signature — couvre le titre seul en dernière ligne
 * ET le titre + son thead (le thead EST alors la dernière ligne), sans faux
 * positif sur un titre/thead SUIVI de données (jamais en dernière ligne).
 */
export function assertB9_noTrailingTitle(text) {
  const pages = splitPages(text);
  const pageCount = pages.length;
  if (pageCount === 0) {
    return { ok: true, detail: 'document vide — aucune page à examiner' };
  }
  const hits = [];
  pages.forEach((pageText, idx) => {
    const pageNum = idx + 1;
    if (pageNum === pageCount) return; // finale, courte par conception
    const lines = stripFooter(pageText.normalize('NFC'))
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l !== '');
    if (lines.length === 0) return;
    const lastLine = lines[lines.length - 1];
    const matched = B9_TRAILING_TITLE_RES.find((re) => re.test(lastLine));
    if (matched) {
      hits.push({ page: pageNum, tail: lastLine.slice(0, 70) });
    }
  });
  if (hits.length > 0) {
    const list = hits.map((h) => `page ${h.page} (queue « ${h.tail} »)`).join(', ');
    return {
      ok: false,
      detail: `${hits.length} page(s) se terminant par un titre/en-tête de tableau orphelin (données reléguées à la page suivante) : ${list}`,
    };
  }
  return { ok: true, detail: `0 titre/en-tête orphelin en bas de page sur ${pageCount} page(s) (hors finale)` };
}

// ===========================================================================
// C1..C5 — GARDES DE CONTRAT (mission P4, « une page = un usage »,
// commit a57b128) : vérifient DIRECTEMENT le nouveau contrat livré par le
// paquet P1/P2 sur `document-builder.ts` — fiche adversaire/ZMSPCP/MOICP
// TIENNENT sur une page UNIQUE, une cellule effraction s'étend sur 1..K
// pages AUTONOMES aux titres distincts, et plus AUCUNE continuation
// « (SUITE) » n'existe pour ces 4 usages (seules les galeries photo
// conservent leur propre « (suite) » de page-à-page, mécanisme distinct et
// inchangé — « 1 photo = 1 page », jamais concerné par la refonte P1).
// Toujours évaluées, INDÉPENDANTES de `--lenient`.
// ===========================================================================

/**
 * C1 — zéro continuation « (SUITE) » pour les usages à contrat dur (mission
 * P1) : garde INVERSE des anciennes B7/B10 (qui EXIGEAIENT un « (SUITE) » en
 * cas de débordement) — désormais AUCUNE occurrence n'est tolérée en dehors
 * des pages de galerie photo. Exclusion des pages portant AU MOINS une image
 * (`pdfimages`, même détection que A6/B1) : `galleryPages()` (blocks.ts)
 * conserve un suffixe « (suite) » LÉGITIME et volontairement INCHANGÉ pour
 * étiqueter la Nième page d'une même galerie multi-photos (chaque page =
 * 1 photo = son propre usage, un mécanisme totalement distinct de l'ancienne
 * scission « (SUITE) » de fiche adversaire/ZMSPCP/MOICP/effraction que la
 * mission P1 a supprimée) — vérifié sur un PDF réel généré depuis
 * `tests/pdf/fixtures/volumetric-stress.json` (56 photos, plusieurs galeries
 * à 3-4 clichés) : chaque occurrence de « (SUITE) » y tombe exclusivement
 * sur une page portant une image.
 */
export function assertC1_zeroSuiteFragment(text, images) {
  const pages = splitPages(text);
  const pagesWithImage = new Set(images.map((img) => img.page));
  const hits = [];
  pages.forEach((pageText, idx) => {
    const pageNum = idx + 1;
    if (pagesWithImage.has(pageNum)) return; // page de galerie photo : « (suite) » y est légitime (cf. JSDoc)
    if (SUITE_RE.test(pageText)) {
      hits.push(pageNum);
    }
  });
  if (hits.length > 0) {
    return {
      ok: false,
      detail: `${hits.length} page(s) hors galerie photo portant encore un fragment « (SUITE) » — interdit pour fiche adversaire/ZMSPCP/MOICP/effraction (mission P1) : ${hits.join(', ')}`,
    };
  }
  return { ok: true, detail: `0 fragment « (SUITE) » hors page de galerie photo` };
}

/** Signatures de contenu propres à la fiche adversaire (`buildAdversaryFiche`, document-builder.ts) — jamais utilisées ailleurs dans le document. */
const FICHE_CONTENT_RES = [/\bIDENTIT[ÉE]\b/, /\bDANGEROSIT[ÉE]\b/, /\bLOCALISATION\b/, /\bMOBILIT[ÉE]\b/, /\bATCD\b/];

/**
 * C2 — fiche adversaire : EXACTEMENT une page (mission P1, refonte totale de
 * `buildAdversaryFiche`). Détection par SPILLOVER (même principe que
 * l'ancien B10, restreint à ce seul usage) : toute page qui porte une
 * signature de contenu propre à la fiche (IDENTITÉ/DANGEROSITÉ/LOCALISATION/
 * MOBILITÉ/ATCD) SANS porter elle-même le titre « N.M FICHE ADVERSAIRE : »
 * est une preuve directe de débordement — la fiche a dépassé sa page unique,
 * qu'un « (SUITE) » l'accompagne ou non (C1 l'interdit de toute façon).
 */
export function assertC2_adversaryFicheSinglePage(text) {
  const pages = splitPages(text);
  const hits = [];
  pages.forEach((pageText, idx) => {
    const pageNum = idx + 1;
    if (ADV_FICHE_TITLE_RE.test(pageText)) return; // page portant son propre titre : légitime
    const matched = FICHE_CONTENT_RES.filter((re) => re.test(pageText));
    if (matched.length > 0) {
      hits.push({ page: pageNum, count: matched.length });
    }
  });
  if (hits.length > 0) {
    const list = hits.map((h) => `page ${h.page} (${h.count} signature(s) de contenu fiche sans titre)`).join(', ');
    return {
      ok: false,
      detail: `${hits.length} page(s) portant du contenu de fiche adversaire SANS son titre « N.M FICHE ADVERSAIRE : » — débordement au-delà de la page unique attendue : ${list}`,
    };
  }
  return { ok: true, detail: `0 débordement de fiche adversaire détecté (chaque fiche tient sur sa page titrée)` };
}

/** Signature de contenu propre aux pages ZMSPCP/MOICP (`buildArticulationPage`, document-builder.ts) — jamais utilisée ailleurs. */
const ARTICULATION_BLOCK_CONTENT_RE = /Composition par Cellule/;

/**
 * C3 — bloc ZMSPCP/MOICP : EXACTEMENT une page (mission P1, refonte totale de
 * `buildArticulationPage`, mutualisée par les deux blocs). Même principe de
 * détection par SPILLOVER que C2 : toute page portant « Composition par
 * Cellule » (signature unique à ce gabarit) sans porter elle-même un titre
 * « ARTICULATION : ZMSPCP - » ou « ARTICULATION : MOICP - » est la preuve
 * d'un débordement au-delà de la page unique attendue.
 */
export function assertC3_articulationBlockSinglePage(text) {
  const pages = splitPages(text);
  const hits = [];
  pages.forEach((pageText, idx) => {
    const pageNum = idx + 1;
    if (ZM_TITLE_RE.test(pageText) || MO_TITLE_RE.test(pageText)) return;
    if (ARTICULATION_BLOCK_CONTENT_RE.test(pageText)) {
      hits.push(pageNum);
    }
  });
  if (hits.length > 0) {
    return {
      ok: false,
      detail: `${hits.length} page(s) portant « Composition par Cellule » (contenu ZMSPCP/MOICP) SANS titre « ARTICULATION : ZMSPCP/MOICP - » — débordement au-delà de la page unique attendue : ${hits.join(', ')}`,
    };
  }
  return { ok: true, detail: `0 débordement de bloc ZMSPCP/MOICP détecté (chaque bloc tient sur sa page titrée)` };
}

/** Signatures de contenu propres à la région Hypothèses d'Effraction (`buildEffractionPages`, document-builder.ts) — jamais utilisées ailleurs. */
const EFFRAC_CONTENT_RES = [/Hypothèses d['’]Effraction/, HYP_TABLE_HEAD_RE, /Caractéristiques Techniques/];

/**
 * C4 — cellule effraction : 1..K pages AUTONOMES aux titres DISTINCTS,
 * jamais de coupure d'hypothèse en son milieu (mission P1, directive Nico
 * 2026-08-10, escalade a→e de `buildEffractionPages` jusqu'au refus explicite
 * au palier plancher). Deux vérifications structurelles complémentaires,
 * toutes deux tirées du texte `pdftotext` :
 *
 *  1. SPILLOVER (même principe que C2/C3) : toute page portant une signature
 *     de contenu Hypothèses d'Effraction SANS porter elle-même un titre
 *     « ARTICULATION : EFFRACTION - » (base, « — MISSION & CARACTÉRISTIQUES »
 *     ou « — HYPOTHÈSES <plage> ») est la preuve qu'une page a débordé sans
 *     que `packHypotheses` (document-builder.ts) ne lui ait attribué son
 *     propre titre autonome — exactement le motif qu'interdit la directive
 *     « jamais de coupure en milieu d'hypothèse, chaque page se suffit ».
 *  2. CONTIGUÏTÉ DES PLAGES : pour chaque titre de base effraction, les
 *     plages « HYPOTHÈSES a-b » qui le suivent doivent être STRICTEMENT
 *     croissantes et NON chevauchantes (`prevEnd < nextStart`) — le proxy
 *     texte le plus direct disponible pour « aucune hypothèse (H1..Hn)
 *     n'apparaît scindée entre 2 pages, ni dupliquée, ni omise » sans
 *     dépendre du vocabulaire libre saisi par l'utilisateur pour chaque
 *     hypothèse (identifiants non fiables pour une regex générique).
 */
export function assertC4_effractionAutonomousPages(text) {
  const pages = splitPages(text);
  const hits = [];

  // 1. Spillover.
  pages.forEach((pageText, idx) => {
    const pageNum = idx + 1;
    if (EFFRAC_TITLE_RE.test(pageText)) return;
    const matched = EFFRAC_CONTENT_RES.filter((re) => re.test(pageText));
    if (matched.length > 0) {
      hits.push(`page ${pageNum} : contenu Hypothèses d'Effraction sans titre « ARTICULATION : EFFRACTION - » (débordement)`);
    }
  });

  // 2. Contiguïté des plages « HYPOTHÈSES a-b » par titre de base, dans
  //    l'ordre de rencontre du document.
  const lastRangeEndByBase = new Map();
  pages.forEach((pageText, idx) => {
    const pageNum = idx + 1;
    const m = pageText.match(EFFRAC_TITLE_RE);
    if (!m || !m[2] || !/^HYPOTH/i.test(m[2])) return;
    const base = m[1].trim();
    const rangeMatch = m[2].match(/(\d+)(?:-(\d+))?\s*$/);
    if (!rangeMatch) return;
    const start = Number(rangeMatch[1]);
    const end = rangeMatch[2] ? Number(rangeMatch[2]) : start;
    const prevEnd = lastRangeEndByBase.get(base);
    if (prevEnd !== undefined && start <= prevEnd) {
      hits.push(`page ${pageNum} : plage « HYPOTHÈSES ${rangeMatch[0]} » chevauche ou répète la précédente (fin ${prevEnd}) pour « ${base} »`);
    }
    lastRangeEndByBase.set(base, end);
  });

  if (hits.length > 0) {
    return {
      ok: false,
      detail: `${hits.length} anomalie(s) de pagination effraction : ${hits.join(' ; ')}`,
    };
  }
  return { ok: true, detail: `0 anomalie de pagination sur les cellules effraction (spillover et contiguïté des plages d'hypothèses)` };
}

const FIXTURE_INTEGRITY_MIN_LEN = 12;
// Clés JAMAIS exploitables telles quelles : `id`/`annotations`/`tools` sont
// des identifiants ou du JSON sérialisé jamais rendus verbatim dans le texte
// (`tools`/`annotations`, `OiPhotoMeta`) ; `title` est exclu car TOUS les
// titres « title » du contrat (`zmspcp_blocks[].title`, `moicp_blocks[].title`,
// `effraction_blocks[].title`) transitent par `blocks.h2()` qui les
// MAJUSCULE (`document-builder.ts`, aucune CSS possible sous pdfmake,
// contrairement à l'ancienne voie B) — leur casse SAISIE originale
// n'apparaît donc JAMAIS verbatim dans le texte extrait, un test
// sensible à la casse (cf. `normalize()`, volontairement inchangé) y
// échouerait à tort. Coût accepté : les titres d'hypothèse effraction
// (`OiEffractionHypothesis.title`, rendu SANS majuscule forcée) échappent
// aussi à ce filtre par clé plutôt que par usage — préférence pour un filtre
// simple et sûr (aucun faux FAIL) à une couverture exhaustive.
// `options` exclue en plus (mission P4, balayage réel) : `formData.options`
// porte les CATALOGUES de valeurs des listes déroulantes de l'UI
// (`fonctions`/`gpbs`/… — cf. `formulaires.ts`), jamais une valeur SAISIE —
// seule la valeur CHOISIE (dans les champs `fonction`/`gpb`… des membres
// PATRACDVR) est rendue dans le PDF ; le catalogue complet ne l'est jamais.
const FIXTURE_INTEGRITY_SKIP_KEYS = new Set(['id', 'annotations', 'tools', 'title', 'options']);

/**
 * Parcourt récursivement `formData` (fixture `{ formData, photosBase64?,
 * isDark? }`, même forme que `generate-from-fixture.mjs`) et collecte
 * l'ensemble des chaînes de texte libre plausiblement rendues verbatim dans
 * le PDF (longueur ≥ `FIXTURE_INTEGRITY_MIN_LEN`, hors replis `-`, hors clés
 * `FIXTURE_INTEGRITY_SKIP_KEYS`).
 */
function collectFixtureIntegrityStrings(formData) {
  const found = new Set();
  function walk(value, key) {
    if (key !== undefined && FIXTURE_INTEGRITY_SKIP_KEYS.has(key)) return;
    if (typeof value === 'string') {
      const t = value.trim();
      if (t.length >= FIXTURE_INTEGRITY_MIN_LEN && t !== '-') {
        found.add(t);
      }
    } else if (Array.isArray(value)) {
      value.forEach((v) => walk(v, key));
    } else if (value !== null && typeof value === 'object') {
      Object.entries(value).forEach(([k, v]) => walk(v, k));
    }
  }
  walk(formData, undefined);
  return Array.from(found);
}

/** Découpe normalisée en mots (espaces déjà collapsés par `normalize()`). */
function wordsOf(s) {
  const n = normalize(s);
  return n === '' ? [] : n.split(' ');
}

/**
 * Découpe LÂCHE — en plus des espaces, sur les TIRETS `-` (`breakLongTokens`,
 * `text-utils.ts` : les champs de test « cesurage » de ce dépôt sont des
 * TOKENS ininterrompus de centaines de caractères ponctués de vrais tirets,
 * ex. `identifiant-1-longue-suite-de-caracteres` — `estimateWrappedLines`/
 * pdfmake les replie à l'un de ces tirets RÉELS quand ils dépassent la
 * largeur de colonne, et `pdftotext -layout` restitue alors le saut de ligne
 * comme un ESPACE juste après ce tiret (`normalize()` le collapse mais ne
 * peut pas savoir qu'aucun espace n'existait à cet endroit dans le texte
 * SAISI) — un simple découpage sur espaces verrait alors « suite-de-
 * caracteres » scindé différemment côté texte saisi (1 mot) et côté texte
 * rendu (2 mots, à cause de l'espace inséré). Découper aussi sur `-` DES
 * DEUX CÔTÉS élimine cette ambiguïté de position de rupture sans jamais
 * masquer une vraie perte de mot.
 */
function looseWordsOf(s) {
  const n = normalize(s);
  return n === '' ? [] : n.split(/[\s-]+/).filter((w) => w !== '');
}

/** Multiset (mot -> occurrences) — cf. `wordCoverageRatio` ci-dessous. */
function wordMultiset(words) {
  const m = new Map();
  for (const w of words) m.set(w, (m.get(w) ?? 0) + 1);
  return m;
}

/**
 * Ratio de couverture PAR SAC DE MOTS (ordre ignoré, multiplicité respectée)
 * de `needleWords` dans `haystackMultiset` — cf. JSDoc `assertC5_fixtureIntegrity`
 * (repli anti-intercalation de colonnes `grid2`) : un layout `grid2()` répartit
 * le texte d'un champ sur des lignes physiques NON CONTIGUËS de `pdftotext
 * -layout` (la colonne voisine s'intercale entre deux fragments), ce qui peut
 * aussi FAIRE REMONTER l'ordre relatif de fragments lointains (deux
 * fragments d'un même champ long peuvent apparaître sur des lignes émises
 * dans un ordre différent de leur ordre de lecture naturel selon la hauteur
 * relative des colonnes voisines à cet endroit précis de la page) — une
 * sous-séquence STRICTEMENT ordonnée s'est révélée trop fragile en pratique
 * (faux FAIL mesuré sur `volumetric-stress.json`, ATCD d'adversaire coupé
 * par un titre `DANGEROSITÉ` intercalé). Le SAC DE MOTS reste un test fort :
 * une VRAIE troncature (perte du dernier tiers d'un champ) fait chuter le
 * ratio de couverture largement sous le seuil, alors qu'une INTERCALATION/
 * un RÉORDONNANCEMENT de colonnes ne PERD aucun mot, seulement leur position
 * relative.
 */
function wordCoverageRatio(needleWords, haystackMultiset) {
  if (needleWords.length === 0) return 1;
  let hits = 0;
  const consumed = new Map();
  for (const w of needleWords) {
    const avail = (haystackMultiset.get(w) ?? 0) - (consumed.get(w) ?? 0);
    if (avail > 0) {
      hits++;
      consumed.set(w, (consumed.get(w) ?? 0) + 1);
    }
  }
  return hits / needleWords.length;
}

const FIXTURE_INTEGRITY_COVERAGE_MIN = 0.9;

/**
 * C5 — anti-troncature ÉTENDUE : extension de A8 (`assertA8_sampleData`),
 * demandée par la mission P4 « le texte saisi doit être INTÉGRALEMENT
 * présent ». A8 exige un fichier `--sample` distinct, curaté à la main
 * (`expect: []`) — utile pour un étalon externe (`oi-reference/recipe-
 * data.json`) mais jamais activé en CI sur les fixtures de ce dépôt (cf.
 * README, désaccord de données). C5 dérive au contraire ses chaînes
 * attendues DIRECTEMENT de la fixture `--fixture` utilisée pour générer le
 * PDF (`tests/pdf/generate-from-fixture.mjs <fixture> --out=...` puis
 * `verify-structure.mjs <pdf> --fixture=<même fixture>`) — zéro désaccord de
 * données possible (même source), donc activable en CI SANS curation
 * manuelle. Couvre tout champ texte libre ≥ 12 caractères de `formData`
 * (situation, missions, ATCD, hypothèses, mesures effraction…) — précisément
 * les champs volumineux que le solveur fit-to-page (mission P1) doit faire
 * TENIR intégralement ou REFUSER, jamais tronquer silencieusement.
 *
 * REPLI ANTI-INTERCALATION DE COLONNES : un champ long posé en `grid2()`
 * (`situation_generale`/`situation_particuliere` à côté de `ciblesCard`,
 * `amies`/`terrain_info` à côté de `population`/`cadre_juridique`…) s'enroule
 * sur PLUSIEURS lignes physiques dans sa colonne ; `pdftotext -layout`
 * restitue le document ligne-de-page-physique par ligne-de-page-physique, et
 * intercale donc le DÉBUT de la colonne voisine ENTRE deux fragments
 * consécutifs de notre champ (ex. « …un jeu de » <contenu de la colonne
 * voisine> « données volontairement… ») — un simple `includes()` de la
 * chaîne intégrale y échoue à tort alors que le texte est INTÉGRALEMENT
 * présent, seulement réparti sur des lignes non contiguës — voire, dans
 * certains cas, sur des lignes émises dans un ordre relatif différent selon
 * la hauteur des colonnes voisines à cet endroit (une sous-séquence
 * STRICTEMENT ordonnée s'est révélée trop fragile, faux FAIL mesuré). Repli :
 * si le `includes()` direct échoue pour une chaîne d'au moins 4 mots, on
 * vérifie une couverture PAR SAC DE MOTS (`wordCoverageRatio`, ordre ignoré,
 * multiplicité respectée) ≥ `FIXTURE_INTEGRITY_COVERAGE_MIN` (90 %) dans le
 * texte complet — un VRAI tronquage (perte du dernier tiers d'un ATCD,
 * coupure en milieu de phrase) fait chuter ce ratio largement sous le seuil,
 * alors qu'une intercalation/un réordonnancement de colonnes ne fait
 * qu'ESPACER/DÉPLACER les mots, jamais en perdre.
 */
export function assertC5_fixtureIntegrity(text, fixturePath) {
  if (!fixturePath) {
    return { ok: true, skip: true, detail: 'SKIP — --fixture non fourni, assertion non applicable' };
  }
  if (!existsSync(fixturePath)) {
    return { ok: false, detail: `fixture introuvable : ${fixturePath}` };
  }
  let fixture;
  try {
    fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));
  } catch (err) {
    return { ok: false, detail: `JSON invalide dans ${fixturePath} : ${err instanceof Error ? err.message : String(err)}` };
  }
  const formData = fixture && typeof fixture === 'object' ? fixture.formData : undefined;
  if (!formData || typeof formData !== 'object') {
    return { ok: false, detail: `${fixturePath} ne contient pas de clé "formData" exploitable` };
  }
  const expected = collectFixtureIntegrityStrings(formData);
  if (expected.length === 0) {
    return { ok: false, detail: `${fixturePath} ne fournit aucune chaîne exploitable (≥ ${FIXTURE_INTEGRITY_MIN_LEN} car.) pour l'intégrité` };
  }
  const norm = normalize(text);
  const haystackMultiset = wordMultiset(wordsOf(text));
  const looseHaystackMultiset = wordMultiset(looseWordsOf(text));
  const missing = expected.filter((s) => {
    if (norm.includes(normalize(s))) return false;
    const needleWords = wordsOf(s);
    if (needleWords.length >= 4 && wordCoverageRatio(needleWords, haystackMultiset) >= FIXTURE_INTEGRITY_COVERAGE_MIN) return false;
    // Repli supplémentaire (découpage sur tirets EN PLUS des espaces, cf.
    // JSDoc `looseWordsOf`) pour les tokens ininterrompus « cesurage » —
    // n'accepte que si la découpe lâche produit au moins 4 fragments (même
    // garde-fou anti-faux-PASS que le repli mots).
    const looseNeedleWords = looseWordsOf(s);
    if (looseNeedleWords.length >= 4 && wordCoverageRatio(looseNeedleWords, looseHaystackMultiset) >= FIXTURE_INTEGRITY_COVERAGE_MIN) return false;
    return true;
  });
  const ok = missing.length === 0;
  const detail = ok
    ? `${expected.length}/${expected.length} chaîne(s) saisie(s) (≥ ${FIXTURE_INTEGRITY_MIN_LEN} car., dérivées de ${fixturePath}) intégralement présente(s) dans pdftotext`
    : `${expected.length - missing.length}/${expected.length} présente(s) — manquante(s) ou TRONQUÉE(S) (${missing.length}) : ${missing.slice(0, 5).map((s) => JSON.stringify(s.length > 60 ? `${s.slice(0, 60)}…` : s)).join(', ')}${missing.length > 5 ? `, … (+${missing.length - 5})` : ''}`;
  return { ok, detail };
}


// ===========================================================================
// CLI
// ===========================================================================

function printUsage() {
  console.error(
    'Usage : node tests/pdf/verify-structure.mjs <fichier.pdf> [--format=a4|16:9] [--photos=N] [--sample=<fichier.json>] [--fixture=<fichier.json>] [--json] [--lenient]'
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
  const fixture = getValue('fixture') || undefined;
  const json = flags.some((f) => f === '--json');
  const lenient = flags.some((f) => f === '--lenient');

  return { file, format, photos, sample, fixture, json, lenient };
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
    // Guardrail pagination CONSERVÉ/ADAPTÉ (missions PG.GUARD/PG.REFIX/
    // GD.GUARDS) — toujours évaluées, INDÉPENDANTES de --lenient.
    { code: 'B1', ...assertB1_noOrphanPage(text, images) },
    { code: 'B2', ...assertB2_noVerticalWordSplit(text) },
    { code: 'B5', ...assertB5_noEmptyFieldDominatedPage(text) },
    { code: 'B6', ...assertB6_verticalFillRatio(bboxPages, text) },
    { code: 'B9', ...assertB9_noTrailingTitle(text) },
    // Gardes de CONTRAT (mission P4, « une page = un usage », commit a57b128)
    // — toujours évaluées, INDÉPENDANTES de --lenient.
    { code: 'C1', ...assertC1_zeroSuiteFragment(text, images) },
    { code: 'C2', ...assertC2_adversaryFicheSinglePage(text) },
    { code: 'C3', ...assertC3_articulationBlockSinglePage(text) },
    { code: 'C4', ...assertC4_effractionAutonomousPages(text) },
    { code: 'C5', ...assertC5_fixtureIntegrity(text, opts.fixture) },
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
