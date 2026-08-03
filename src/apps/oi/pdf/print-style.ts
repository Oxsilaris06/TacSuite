/**
 * print-style.ts — Feuille de style CSS d'impression de l'OI (voie B, SPEC-PDF-V3.md
 * §2.1/§3.1/§3.2, paquet P5 « pdf-p5-print-view »). Module PUR : zéro DOM.
 *
 * `printCss()` est un port QUASI VERBATIM de `OrderPdfStyle.css`
 * (Praxis-Rust, `OrderPdfStyle.kt:81-212`, lecture seule) — les commentaires
 * qui expliquent les pièges (marges `@page` selon le thème, `.patrac`
 * insécable aux espaces, `min-width/min-height:0` des galeries, etc.) sont
 * conservés/traduits tels quels. Trois blocs sont des AJOUTS propres à NOTRE
 * structure (absents de strategica), clairement délimités plus bas :
 * `.effrac-specs`, `.cell-group`/`.cell-name`/`.cell-members`, `.tool-badge`,
 * et `.photo-caption` (légende de galerie, cf. SPEC-PDF-V3.md §3.3).
 *
 * `esc`/`nl2br`/`field`/`section` sont le port de `OrderPdfStyle.kt:216-223` ;
 * seul `esc()` diverge de l'original (voir sa JSDoc).
 */
import { fullPageHeightMm, photoPageGalleryHeightMm, type OiPdfPalette } from './theme.js';

/**
 * Feuille de style complète d'un document imprimé. Port QUASI VERBATIM de
 * `OrderPdfStyle.kt:81-212` (fonction `css`). [fontFaces] = déclarations
 * `@font-face` base64 (`fontFacesCss()`, `fonts.ts`) injectées EN TÊTE du
 * `<style>`, comme l'original (`OrderPdfStyle.kt:83`).
 */
export function printCss(p: OiPdfPalette, fontPx: number, landscape: boolean, fontFaces: string): string {
    // OrderPdfStyle.kt:115-120 — .row/.col dépendent de l'orientation : en
    // paysage les colonnes sont côte à côte (flex) ; en portrait, 89 mm par
    // colonne serait illisible, elles s'empilent en bloc.
    const rowCol = landscape
        ? '.row { display:flex; gap:16px; } .col { flex:1; min-width:0; }'
        : '.row { display:block; } .col { min-width:0; }';

    // OrderPdfStyle.kt:189-191 — SOMBRE (marges @page = 0) : les conteneurs
    // qui OUVRENT une page portent eux-mêmes l'air du haut, le padding du
    // body ne se répétant pas aux sauts de page fragmentés.
    const darkPageTopPad = p.dark ? '.adv-page { padding-top:8mm; } .page-break { padding-top:8mm; }' : '';

    return `
<style>
  ${fontFaces}
  /* CLAIR : marges VERTICALES portées par @page (le padding d'un body fragmenté
     ne se répète pas sur les pages intermédiaires — texte collé au bord sinon).
     SOMBRE : les marges @page sont du PAPIER non peignable → bandes blanches en
     haut/bas de chaque page. On les met à 0 (page intégralement noire) et l'air
     vertical passe dans le padding du body ; les pages intermédiaires d'un flux
     fragmenté perdent cet air, sur fond noir — assumé, préférable aux bandes. */
  @page { size: A4 ${landscape ? 'landscape' : 'portrait'}; margin: ${p.dark ? '0' : '8mm 0 11mm 0'}; }
  * { box-sizing: border-box; }
  body { background:${p.bg}; color:${p.text};
         font-family:'JetBrains Mono', monospace;
         font-size:${fontPx}px; line-height:1.45; margin:0;
         padding:${p.dark ? '8mm 11mm 11mm' : '0 11mm'};
         orphans:2; widows:2; }
  /* Mission BLIND.B §2 — filet veuves/orphelines (R17, regles-strategica.md :
     ABSENT de la source Kotlin elle-même, ajout propre à la voie B) : au
     moins 2 lignes de chaque côté d'une coupure de page dans tout paragraphe/
     cellule/item de texte libre. body seul ne suffit pas : orphans/widows ne
     s'appliquent qu'aux boîtes de fragment RÉELLEMENT fragmentables
     (paragraphes/cellules/items), pas par héritage magique sur tout leur
     contenu — on les répète donc explicitement sur les éléments de texte libre. */
  p, td, th, li { orphans:2; widows:2; }
  h1 { font-family:'Oswald', sans-serif; font-weight:500; color:${p.accent};
       letter-spacing:2px; text-transform:uppercase; margin:0 0 4px 0; }
  h2 { font-family:'Oswald', sans-serif; font-weight:500; color:${p.accent};
       border-bottom:2px solid ${p.accent}; padding-bottom:3px;
       margin:16px 0 8px 0; font-size:17px; text-transform:uppercase;
       letter-spacing:1px; page-break-after:avoid; }
  h3 { font-size:${fontPx}px; font-weight:bold; margin:10px 0 5px 0;
       text-decoration:underline; color:${p.accent}; page-break-after:avoid; }
  p { margin:3px 0; text-align:justify; overflow-wrap:anywhere; }
  .muted { color:${p.muted}; }
  .danger { color:${p.danger}; font-weight:bold; }
  .cible { color:${p.danger}; font-weight:bold; font-size:19px; margin:8px 0; }
  table { width:100%; border-collapse:collapse; font-size:${fontPx - 1}px;
          table-layout:fixed; }
  td, th { border:1px solid ${p.border}; padding:4px; text-align:left;
           vertical-align:top; overflow-wrap:anywhere; }
  th { background:${p.headerRow}; }
  tr { page-break-inside:avoid; }
  .k { font-weight:bold; width:30%; background:${p.cardAlt}; }
  ${rowCol}
  .box { border:1px solid ${p.border}; padding:8px; margin:6px 0;
         page-break-inside:avoid; overflow-wrap:anywhere; }
  .avoid { page-break-inside:avoid; }
  /* Tableau roster : colonnes calibrées, coupure aux espaces uniquement
     (anywhere tronquait les libellés en plein mot — constat terrain). */
  .patrac { font-size:${fontPx - 3}px; }
  .patrac td, .patrac th { padding:3px 2px; text-align:center;
                           overflow-wrap:normal; word-break:normal; }
  .card-head { background:${p.accent}; color:#fff; padding:5px;
               font-weight:bold; text-align:center; page-break-after:avoid; }
  /* Mission BLIND.B §2 : ces 3 cartes encapsulent souvent un <div> de texte
     libre directement (pas systématiquement un <p>, ex. catPage/adversaryFiche)
     — overflow-wrap pose son propre filet ici plutôt que de dépendre d'un
     enfant <p> qui ne l'aurait pas toujours. */
  .accent-card { border-left:6px solid ${p.accent}; background:${p.cardAlt};
                 padding:8px 10px; margin:6px 0; page-break-inside:avoid;
                 overflow-wrap:anywhere; }
  .danger-card { border-left:6px solid ${p.danger}; background:${p.cardAlt};
                 padding:8px 10px; margin:6px 0; page-break-inside:avoid;
                 overflow-wrap:anywhere; }
  .warning-card { border-left:6px solid ${p.warning}; background:${p.cardAlt};
                  padding:8px 10px; margin:6px 0; page-break-inside:avoid;
                  overflow-wrap:anywhere; }
  .pill { display:inline-block; border:1px solid ${p.accent}; border-radius:10px;
          padding:2px 9px; margin:2px 4px 2px 0; page-break-inside:avoid; }
  .pill b { color:${p.accent}; }
  /* Le cadre épouse le ratio réel (aspect-ratio inline par figure) ; 'contain'
     affiche la photo ENTIÈRE sans jamais la rogner, quel que soit le format
     (9:16, 16:9, atypique) — une éventuelle bande prend la teinte de la carte. */
  .fig { display:inline-block; vertical-align:top; border:2px solid ${p.accent};
         margin:2mm; page-break-inside:avoid; background:${p.cardAlt}; }
  .fig img { display:block; width:100%; height:100%; object-fit:contain; }
  .gallery { text-align:center; }
  /* PAGES PHOTO DÉDIÉES — la taille est portée par la PAGE, pas par une hauteur
     cible en mm : la galerie occupe toute la hauteur utile et chaque figure prend
     une moitié (flex:1 1 50%). Une seule figure ? elle prend tout. L'axe de
     découpe suit l'orientation des photos (portrait -> colonnes, paysage ->
     rangées) pour maximiser la surface utile sans jamais déformer : c'est
     max-width/max-height:100% + object-fit:contain qui préservent le ratio.
     min-width/min-height:0 est INDISPENSABLE — sans lui, la taille minimale
     de contenu d'un item flex l'empêche de se réduire et la seconde photo
     déborde sur la page suivante (limite de l'ancienne implémentation). */
  .photo-page-gallery { display:flex; height:${photoPageGalleryHeightMm(landscape)}mm; gap:4mm; }
  .photo-cols { flex-direction:row; }
  .photo-rows { flex-direction:column; }
  .page-fig { flex:1 1 50%; min-width:0; min-height:0; display:flex;
              align-items:center; justify-content:center;
              border:2px solid ${p.accent}; background:${p.cardAlt}; }
  .page-fig img { max-width:100%; max-height:100%; width:auto; height:auto;
                  object-fit:contain; display:block; }
  /* AJOUT propre à notre structure (absent de OrderPdfStyle.kt) : légende
     centrée sous chaque figure de galerie, port du besoin décrit par
     SPEC-PDF-V3.md §3.3 (« Légende »), langage visuel strategica (accent, gras). */
  .photo-caption { margin-top:6px; text-align:center; font-weight:bold; color:${p.accent}; }
  /* Fiche adversaire (décision créateur) : photo principale à GAUCHE, tableau
     de renseignement CONTINU (Naissance → Véhicules) à DROITE — deux colonnes
     dans les DEUX orientations (.row s'empile en portrait), l'ensemble
     insécable pour que le tableau ne soit jamais coupé ; l'encadré DANGEROSITÉ
     suit DESSOUS, sur toute la largeur. */
  .fiche-head { display:flex; gap:6mm; align-items:flex-start; margin-top:6px;
                page-break-inside:avoid; }
  /* La colonne épouse la largeur RÉELLE de la photo (déjà plafonnée en mm
     absolus côté Kotlin, cf. ficheColumnWidthMm) au lieu d'imposer 38 % fixes :
     l'ancien plafond fixe empilait un second pourcentage (96 % de 38 %) qui
     rendait la photo bien plus petite que la colonne réellement disponible
     (constat revue). max-width reste un garde-fou, rarement contraignant. */
  .fiche-photo { flex:0 1 auto; max-width:48%; text-align:center; }
  .fiche-id { flex:1; min-width:0; }
  /* Une fiche adversaire = une page ISOLÉE (saut avant ET après : la section
     suivante ne partage jamais la page de la dernière fiche). Sa police
     s'ADAPTE au volume de texte (inline par fiche) pour tenir sans débordement ;
     ses tableaux DOIVENT rester en unité relative, sinon la règle table{px}
     globale écrase l'adaptation là où vit le gros du texte. Les photos
     complémentaires (annexes/renforts) partent sur des pages à part. */
  .adv-page { page-break-before:always; page-break-after:always; }
  .adv-page table { font-size:0.95em; }
  /* Le tableau PATRAC d'une page dédiée suit aussi la police adaptative
     (une règle px absolue écraserait l'inline de la page). */
  .adv-page .patrac { font-size:0.8em; }
  ${darkPageTopPad}
  /* Fiche COURTE : dilatée sur la hauteur utile de page (blocs répartis
     uniformément) pour que la page paraisse complète. Les fiches denses ne
     portent pas cette classe (flux bloc = fragmentation d'impression sûre). */
  .adv-fill { display:flex; flex-direction:column; justify-content:space-evenly; min-height:${fullPageHeightMm(landscape)}mm; }
  .fullpage { height:${fullPageHeightMm(landscape)}mm; position:relative;
              display:flex; flex-direction:column; justify-content:center;
              align-items:center; overflow:hidden; }
  .watermark { position:absolute; top:0; left:0; width:100%; height:100%;
               z-index:-1; display:flex; justify-content:center; align-items:center; }
  .watermark img { width:100%; height:100%; object-fit:contain;
                   opacity:${p.watermarkOpacity}; }
  .op-card { position:absolute; top:2mm; right:2mm; border:1px solid ${p.border};
             background:${p.cardAlt}; padding:4px 10px; font-size:${fontPx - 2}px; }
  ul { margin:4px 0; padding-left:18px; }
  /* Mission BLIND.B §2 — coupure de mot ciblée (arbitrage 2) : un item de
     liste à tirets (conduite à tenir ZMSPCP/MOICP) est un texte libre comme
     un autre, il peut contenir un token sans espace > ~40 caractères (URL,
     référence…) qui ferait déborder la colonne à demi-largeur sans
     overflow-wrap:anywhere (même risque que R14, p/.box/td,th). */
  li { page-break-inside:avoid; overflow-wrap:anywhere; }
  hr { border:none; border-top:1px solid ${p.border}; margin:10px 0; }
  .page-break { page-break-before:always; }
  /* --- AJOUTS propres à NOTRE structure (absents de strategica) --- */
  /* Spécifications techniques EFFRACTION — port verbatim de pdf-engine-v2.ts:764-768 :
     grille rétrécissable (min-width:0) pour que les valeurs longues s'enroulent
     DANS la case au lieu de déborder. '.effrac-specs .label' suppose un '.label'
     de base (ci-dessous, port du même fichier :709-710, T9) — strategica n'a pas
     cette classe (son field()/section() produit des <p> sans libellé encadré) ;
     on la réintroduit ICI, seulement pour cette grille 2 colonnes. */
  .label { font-weight:bold; color:${p.accent}; font-size:0.75em;
           text-transform:uppercase; display:block; }
  .effrac-specs { display:grid; grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .effrac-specs > div { min-width:0; overflow-wrap:anywhere; }
  .effrac-specs .label { margin-bottom:1px; }
  /* Composition par cellule (ZMSPCP/MOICP) — port verbatim de pdf-engine-v2.ts:760-762,
     couleurs substituées par la palette strategica. L'original utilise un fond et
     un filet teintés à l'accent en rgba() (rgba(59,130,246,.05)/(.2)) : la palette
     strategica n'expose pas l'accent sous forme RGB décomposable, on retombe donc
     sur cardAlt/border, déjà le motif "carte" du reste de ce document. */
  .cell-group { border:1px solid ${p.accent}; border-radius:6px; padding:8px;
                background:${p.cardAlt}; margin-bottom:8px; page-break-inside:avoid; }
  .cell-name { font-size:0.7em; font-weight:bold; color:${p.accent};
               text-transform:uppercase; margin-bottom:4px; border-bottom:1px solid ${p.border}; }
  .cell-members { display:flex; flex-wrap:wrap; gap:5px; }
  /* Badge outil d'effraction — port de pdf-engine-v2.ts:727-733, fond p.warning.
     La couleur de texte est #000000 dans les deux thèmes côté source
     (ternaire isDark?'#000000':'#000000', no-op conservé tel quel dans
     l'original) : on la fixe directement, sans reproduire le ternaire mort. */
  .tool-badge { background:${p.warning}; color:#000000; padding:4px 10px;
                border-radius:6px; font-size:10pt; font-weight:bold;
                border:1px solid rgba(0,0,0,0.1); display:inline-block;
                white-space:normal; line-height:1.2; }
</style>
`;
}

/**
 * Échappement HTML générique. Port de `OrderPdfStyle.kt:216` (`esc`), ÉLARGI :
 * l'original strategica n'échappe QUE `& < >` (aucun attribut n'est jamais
 * construit avec une valeur utilisateur côté Kotlin). Ce module construit,
 * lui, des attributs `style`/`class` autour de contenu issu du Store — on
 * échappe donc aussi `"` (`&quot;`) pour empêcher une valeur contenant un
 * guillemet de s'échapper d'un attribut HTML. Accepte `unknown` (comme
 * l'original JS non typé, cf. `pdf-engine-v2.ts:197`) : `null`/`undefined`
 * deviennent la chaîne vide.
 */
export function esc(s: unknown): string {
    return String(s ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/** `esc()` + retours-ligne convertis en `<br/>` — port de `OrderPdfStyle.kt:218`. */
export function nl2br(s: unknown): string {
    return esc(s).replace(/\n/g, '<br/>');
}

/**
 * Paragraphe `<p><strong>Label :</strong> Valeur</p>`, OMIS (`''`) si la
 * valeur est vide/blanche — port de `OrderPdfStyle.kt:220-223`.
 */
export function field(label: string, value: unknown): string {
    const str = value == null ? '' : String(value);
    if (str.trim() === '') return '';
    return `<p><strong>${esc(label)} :</strong> ${nl2br(value)}</p>`;
}

/** Titre `<h2>` + corps — port de `OrderPdfStyle.kt:225-228`. */
export function section(title: string, body: string): string {
    return `<h2>${title}</h2>${body}`;
}
