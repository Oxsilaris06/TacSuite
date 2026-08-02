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
 * mesuré>` par assertion (A1..A8), puis un résumé `N/8 assertions`. Avec
 * `--json`, émet EN PLUS (pas à la place — les lignes lisibles restent
 * imprimées) un objet `{ ok, file, assertions: [{ code, ok, detail }] }` sur
 * stdout, en dernière ligne.
 * Code de sortie : 0 si les 8 assertions passent, 1 sinon, 2 en cas de garde
 * d'exécution (binaire poppler absent, fichier PDF introuvable, arguments
 * invalides — l'outil n'a alors PU faire tourner aucune assertion).
 *
 * Détail des 8 assertions et de leurs seuils : voir `tests/pdf/README.md`
 * et `docs/SPEC-PDF-V3.md` §7 (tableau « Assertions exactes »).
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
// CLI
// ===========================================================================

function printUsage() {
  console.error(
    'Usage : node tests/pdf/verify-structure.mjs <fichier.pdf> [--format=a4|16:9] [--photos=N] [--sample=<fichier.json>] [--json] [--lenient]'
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

  return { file, format, photos, sample, json, lenient };
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

  let pdfInfo, text, fonts, images, fileSizeBytes;
  try {
    pdfInfo = collectPdfInfo(opts.file);
    text = collectText(opts.file);
    fonts = collectFonts(opts.file);
    images = collectImages(opts.file);
    fileSizeBytes = statSync(opts.file).size;
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
