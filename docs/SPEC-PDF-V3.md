# SPEC-PDF-V3 — Moteur PDF vectoriel de l'OI (voie A pdfmake + voie B impression HTML)

État : **spécification d'exécution**, arrêtée le 2026-08-02.
Décision utilisateur : **A + B**.
Référence opposable : `../../.tacsuite-prep/etude-pdf-strategica.md`.
Structure du document : **les 14 sections ACTUELLES de l'OI TacSuite, dans leur ordre actuel**
(`docs/recon-oi.md` §4, empreinte `../../.tacsuite-prep/oi-reference/fingerprint.md`).
Langage visuel : **strategica** (`Praxis-Rust/android/.../ui/order/OrderPdfStyle.kt`,
`OrderHtml.kt`, `OrderHtmlPhotos.kt`, `OrderHtmlAdversaires.kt`, `ui/pdf/PdfFontFaces.kt`).

> **Règle de lecture** : *la STRUCTURE reste la nôtre, le LANGAGE VISUEL vient de strategica.*
> Toute divergence de structure (section ajoutée, retirée, renumérotée, réordonnée) est un
> **défaut**, pas une amélioration. Y compris le défaut hérité des **deux sections « 7. »**
> (`7. ARTICULATION & ORDRES DE MOUVEMENT` et `7. RÉCAPITULATIF PATRACDVR`), qui est
> **reproduit tel quel** et asserté comme tel (cf. §7, assertion A4).

---

## 1. Choix de la bibliothèque — **pdfmake 0.3.11** (retenu)

### 1.1 Banc réel (2026-08-02)

Deux applications Vite 8 (rolldown, mêmes réglages que le projet) construites puis
exécutées dans Chromium headless (Playwright du projet), même document de test
(titre Oswald, phrase FR pleine d'accents, tableau 4 colonnes), mêmes 3 TTF
(`oswald_500.ttf`, `jetbrains_mono_400.ttf`, `jetbrains_mono_700.ttf`) embarqués en VFS
base64. Artefacts du banc : `scratchpad/pmvite/` (0.2.23) et `scratchpad/pmvite3/` (0.3.11).

| Critère | pdfmake **0.2.23** | pdfmake **0.3.11** |
|---|---|---|
| dist-tag npm | (ligne de maintenance) | **`latest`** |
| Bundle Vite brut | 1 741 342 o | **1 387 953 o** |
| Bundle Vite gzip | 762 986 o | **537 028 o** |
| dont VFS 3 TTF (gzip) | 193 174 o | 193 174 o |
| **Bibliothèque seule (gzip)** | ~570 Ko | **~344 Ko** |
| Génération en page | OK (14 772 car. b64) | OK (14 788 car. b64) |
| PDF produit | 11 078 o | 11 090 o |
| `pdffonts` | 3 × CID TrueType, `emb=yes sub=yes uni=yes` | idem |
| `pdftotext -layout` | accents FR **exacts** (`Éléphant`, `œuf`, `n°1`, `—`) | idem |
| API | callbacks (`getBase64(cb)`) | **promesses** (`await getBlob()`) |
| Enregistrement polices | mutation de globals (`pdfMake.vfs = …`) | **`addVirtualFileSystem()` / `addFonts()`** |
| Typages | `@types/pdfmake` décrit l'API **0.3** | **`@types/pdfmake@0.3.3` aligné** |

### 1.2 Décision et justification

**pdfmake `0.3.11`** (épinglé exact, comme les autres dépendances d'exécution du projet)
+ **`@types/pdfmake@0.3.3`** en devDependency.

1. C'est la version `latest` publiée (la ligne 0.3 n'est plus en beta) ;
2. −226 Ko gzip de bibliothèque par rapport à 0.2.23, à qualité de sortie **identique** ;
3. API à promesses : s'insère sans imbrication de callbacks dans le `try/catch/finally`
   existant de `downloadOiPdf()` (loader `#pdfLoadingModal`, toasts) ;
4. `addVirtualFileSystem()`/`addFonts()` n'exigent pas de muter des globals ;
5. les typages DefinitelyTyped correspondent **exactement** à cette API
   (`addVirtualFileSystem`, `addFonts`, `TCreatedPdf` à promesses) — vérifié en
   compilation sous les réglages `strict` + `noUncheckedIndexedAccess` +
   `exactOptionalPropertyTypes` du projet, **0 erreur**.

Risque accepté : la documentation communautaire (StackOverflow, blogs) est majoritairement
en 0.2.x. **Ne jamais recopier un extrait 0.2.x** (`pdfMake.vfs = …`,
`createPdf(dd).getBase64(cb)`) : il ne compile pas et/ou ne s'exécute pas en 0.3.

### 1.3 PIÈGE VÉRIFIÉ — forme d'import obligatoire

```ts
import pdfMake from 'pdfmake';                       // ✅ SEULE forme correcte
import type { TDocumentDefinitions } from 'pdfmake/interfaces';
```

* `import * as pdfMake from 'pdfmake'` **compile** mais **plante à l'exécution** :
  `TypeError: Cannot set property fonts of #<en> which has only a getter`
  (l'espace de noms ESM est figé ; `addFonts()` fait `this.fonts = …`). Constaté au banc.
* Les imports nommés (`import { addFonts } from 'pdfmake'`) sont également proscrits :
  le module exporte une **instance de classe**, les méthodes détachées perdent `this`.
* Chargement : **`await import('pdfmake')`** (import dynamique) dans `engine-v3.ts`, pour
  que la bibliothèque forme son propre chunk et ne pèse pas sur le démarrage de l'OI.

### 1.4 Capacités validées au banc (à considérer comme acquises)

| Besoin | Forme pdfmake validée |
|---|---|
| A4 paysage | `pageSize: 'A4'`, `pageOrientation: 'landscape'` → 841,89 × 595,28 pts |
| Format 16:9 (338 × 190,125 mm) | `pageSize: { width: 958.11, height: 539.01 }` → mesuré `958.11 x 539.01 pts` |
| En-tête de tableau répété à chaque page | `table.headerRows: 1` → en-tête présent sur **les 4** pages d'un tableau de 80 lignes |
| Pied de page + pagination | `footer: (currentPage, pageCount) => …` → `1 / 5` … `5 / 5` |
| Image ratio préservé (= `object-fit: contain`) | `{ image, fit: [w, h] }` |
| Filigrane | `{ image, fit, opacity: 0.7, absolutePosition: { x, y } }` — hors flux, JPEG embarqué tel quel |
| Pagination automatique | 80 lignes → 4 pages, 18 260 o total |

### 1.5 Limite connue de pdfkit (moteur sous-jacent) — **garde obligatoire**

pdfkit n'accepte que **JPEG et PNG**. Les photos de l'OI viennent d'IndexedDB et peuvent
être en WebP/AVIF/autre (upload utilisateur), ou avoir traversé
`createAnnotatedImageBlob()`. Une image non supportée fait **échouer tout le document**.

⇒ `engine-v3.ts` normalise **avant** de construire la définition
(`normalizePhotos()`, §3.5) : tout ce qui n'est pas `data:image/jpeg` ou `data:image/png`
est ré-encodé en JPEG via `<canvas>`, et toute image dont le plus grand côté dépasse
`MAX_PHOTO_PX` (2000) est réduite. Une photo qui ne peut pas être normalisée est
**omise avec un avertissement**, jamais propagée telle quelle.

---

## 2. Architecture cible

Nouveau dossier **`src/apps/oi/pdf/`**. `pdf-engine-v2.ts` **n'est pas découpé** (l'interdit
d'architecture de `SPEC-OI-CONVERSION.md` §7 porte sur ce fichier ; le nouveau moteur est
un module distinct, la contrainte ne s'y applique pas).

```
src/apps/oi/pdf/
├── fonts/                        # sources non bundlées (lues par le script de génération)
│   ├── oswald_500.ttf
│   ├── jetbrains_mono_400.ttf
│   ├── jetbrains_mono_700.ttf
│   ├── OFL-Oswald.txt            # licence SIL OFL 1.1
│   ├── OFL-JetBrainsMono.txt     # licence SIL OFL 1.1
│   └── README.md                 # provenance + commande de régénération
├── fonts.generated.ts            # GÉNÉRÉ — `PDF_FONT_VFS` (base64 des 3 TTF, ~415 Ko)
├── fonts.ts                      # PDF_FONTS (mapping familles) + fontFacesCss()
├── theme.ts                      # palettes strategica, barèmes adaptatifs, géométrie de page
├── blocks.ts                     # primitives pdfmake (card, h2, labelValue, pill, figure…)
├── document-builder.ts           # 14 sections → TDocumentDefinitions  (le gros morceau)
├── engine-v3.ts                  # orchestration voie A + téléchargement
├── print-style.ts                # CSS strategica porté (voie B)
└── print-view.ts                 # document HTML autonome + window.print() (voie B)

scripts/gen-pdf-fonts.mjs         # fonts/*.ttf → fonts.generated.ts (npm run gen:pdf-fonts)
tests/pdf/verify-structure.mjs    # protocole de non-régression STRUCTUREL
tests/pdf/README.md
tests/unit/oi/pdf/*.test.ts       # tests unitaires (logique pure, TDD)
```

Graphe de dépendances (aucun cycle) :

```
fonts.generated.ts ──▶ fonts.ts ──┬──▶ engine-v3.ts ──▶ document-builder.ts ──▶ blocks.ts ──▶ theme.ts
                                  └──▶ print-view.ts ──▶ print-style.ts ─────────────────────▶ theme.ts
                                        engine-v3.ts ──▶ pdf-engine-v2.ts (collectAllData uniquement)
```

### 2.1 Contrats de module (exports attendus)

**`fonts.ts`** — aucune dépendance à pdfmake (utilisable par la voie B seule).
```ts
export { PDF_FONT_VFS } from './fonts.generated.js';      // Record<string, string> (base64 nu)
export const PDF_FONTS: {                                  // mapping pdfmake
  Oswald:        { normal: 'Oswald-500.ttf';        bold: 'Oswald-500.ttf' };
  JetBrainsMono: { normal: 'JetBrainsMono-400.ttf'; bold: 'JetBrainsMono-700.ttf' };
};
/** Port de PdfFontFaces.kt:47-53 — @font-face base64 pour la voie B (zéro réseau). */
export function fontFacesCss(): string;
```
Note : une seule graisse Oswald existe (Medium 500) ; `bold` pointe volontairement sur le
même fichier — les titres strategica sont en `font-weight:500`, pas en gras synthétique.

**`theme.ts`** — pur, zéro DOM, zéro pdfmake.
```ts
export type OiPdfFormat = 'a4' | '16:9';
export interface OiPdfPalette { bg; text; accent; danger; warning; border; headerRow;
                                cardAlt; muted; watermarkOpacity; dark: boolean; }
export const PDF_LIGHT: OiPdfPalette;     // strategica LIGHT (OrderPdfStyle.kt:30-42)
export const PDF_DARK:  OiPdfPalette;     // strategica DARK  (OrderPdfStyle.kt:43-56)
export function palette(isDark: boolean): OiPdfPalette;
export function mm(valueMm: number): number;                 // mm → points (×2.834645669)
export function pageGeometry(format: OiPdfFormat): {
  widthPt: number; heightPt: number; marginsPt: [number, number, number, number];
  contentWidthPt: number; contentHeightPt: number; landscape: true;
};
export function documentFontPx(volume: number): number;      // 800/1500 → 14/12/10
export function adaptivePagePx(fields: string[], extraLines?: number): number; // 500/1000/1800 → 14/12/10/9
export function patracFontPx(rowCount: number): number;      // 14/22/32 → 14/12/10/9
export function photoPageGalleryHeightMm(landscape: boolean): number;
export function fullPageHeightMm(landscape: boolean): number;
```

**`blocks.ts`** — pur, primitives visuelles strategica exprimées en `Content` pdfmake.
```ts
export function h1(text, p): Content;            export function h2(text, p): Content;
export function h3(text, p): Content;            export function labelValue(label, value, p): Content;
export function card(body, p, opts?): Content;   export function accentCard(body, p, kind): Content;
export function grid2(left, right, gapPt?): Content;         // .row/.col strategica
export function pill(text, p): Content;          export function pillRow(items, p, perRow?): Content;
export function badgeRow(items, p, perRow?): Content;
export function kvTable(rows: [string, string][], p): Content;   // table .k strategica
export function figure(dataUrl, boxPt: [number, number], p): Content;
export function emptyLine(): Content;
export const LAYOUT_BORDERED, LAYOUT_PILL, LAYOUT_NONE: CustomTableLayout;
```
Contrainte : pdfmake n'a **ni `border-radius` ni `box-shadow`**. Les « cartes » sont des
tables 1×1 à bordure 1 pt (`LAYOUT_BORDERED`) ou à liseré gauche épais
(`accentCard`, équivalent `.accent-card`/`.danger-card`/`.warning-card`). Les « pilules »
sont des tables 1×1 bordées ; les rangées de pilules sont **découpées en lignes de
`perRow` éléments** (pdfmake ne sait pas faire retourner une ligne de `columns`).

**`document-builder.ts`** — pur (aucun accès DOM ni IndexedDB).
```ts
export function buildOiDocDefinition(
  data: OiPdfCollectedData,
  opts: { format: OiPdfFormat },
): TDocumentDefinitions;
export function oiPdfFileName(formData: OiFormData): string;   // OI_<date>_<trigramme>.pdf
```

**`engine-v3.ts`** — DOM + pdfmake.
```ts
export async function buildOiPdfBlob(data: OiPdfCollectedData, opts: { format: OiPdfFormat }): Promise<Blob>;
export async function normalizePhotos(photosBase64: Record<string, string>): Promise<Record<string, string>>;
export async function downloadOiPdfV3(): Promise<void>;
```

**`print-style.ts`** / **`print-view.ts`** — voie B.
```ts
export function printCss(p: OiPdfPalette, fontPx: number, landscape: boolean, fontFaces: string): string;
export function buildPrintDocument(data: OiPdfCollectedData, opts: { format: OiPdfFormat }): string; // HTML complet
export async function printOiHighQuality(deps?: { print?: (w: Window) => void }): Promise<void>;
```

---

## 3. Table de mapping exhaustive

Ligne source = `src/apps/oi/pdf-engine-v2.ts`. Palette = `theme.ts` (valeurs strategica).
`p.*` = champ de palette. Toutes les mesures en mm sont converties par `mm()`.

### 3.1 Blocs transverses (CSS global de `generateHTML`, :637-770)

| # | Bloc source | Voie A — pdfmake | Voie B — CSS print |
|---|---|---|---|
| T1 | `@import` Google Fonts `:639` — **dépendance réseau, défaut corrigé** | `pdfMake.addVirtualFileSystem(PDF_FONT_VFS)` + `addFonts(PDF_FONTS)` | `fontFacesCss()` (base64 `data:font/ttf`), **zéro requête** |
| T2 | `.pdf-export-container` police/corps `:643-653` | `defaultStyle: { font: 'JetBrainsMono', fontSize: documentFontPx(volume), lineHeight: 1.45, color: p.text }` | `body{font-family:'JetBrains Mono',monospace;font-size:Npx;line-height:1.45;color:p.text}` |
| T2b | `body{background:${p.bg}}` `:649` | `background: (currentPage, pageSize) => ({ canvas: [{ type:'rect', x:0, y:0, w:pageSize.width, h:pageSize.height, color:p.bg, lineWidth:0 }] })` — clé `background` de la `TDocumentDefinitions`, fond plein cadre sur chaque page (D1/D2, `pdfv3-design-fix/DEFAUTS.md`) | `body{background:${p.bg}}` |
| T3 | `.pdf-page` géométrie `:654-660` + `pagePadding` `:635` | `pageSize` + `pageMargins` de `pageGeometry()` — **plus aucune page manuelle** | `@page{size:A4 landscape;margin:8mm 0 11mm 0}` (clair) / `margin:0` + `padding` body (sombre), cf. `OrderPdfStyle.kt:84-95` |
| T4 | `h1` `:671` | `blocks.h1` — `font:'Oswald'`, 36 pt, `color: p.accent`, encadré 4 pt (table 1×1 `LAYOUT_BORDERED`) | `h1{font-family:'Oswald';font-weight:500;letter-spacing:2px;text-transform:uppercase;color:accent}` |
| T5 | `h2` `:672` (barre 2 px sous le titre) | `blocks.h2` — texte Oswald 17 pt + `{ canvas: [{ type:'line', lineWidth:2, lineColor:p.accent }] }` | `h2{border-bottom:2px solid accent;page-break-after:avoid}` (verbatim strategica) |
| T6 | `h3` `:673` | `blocks.h3` — 12 pt, gras, souligné, `color: p.accent` | `h3{text-decoration:underline;page-break-after:avoid}` |
| T7 | `.grid` 2 colonnes `:674-677` | `blocks.grid2` → `{ columns: [ {width:'*'}, {width:'*'} ], columnGap: mm(6) }` | `.row{display:flex;gap:16px}.col{flex:1;min-width:0}` |
| T8 | `.card` `:678-689` (fond, bord, **rayon 16 px, ombre**) | `blocks.card` → table 1×1, `LAYOUT_BORDERED` (1 pt `p.border`), **SANS `fillColor` par défaut** (transparente, comme `.box`) — `opts.fillColor` reste le seul moyen d'obtenir un fond plein (D8, `pdfv3-design-fix/DEFAUTS.md`). **Rayon et ombre non transposables : abandonnés** (écart assumé E1) | `.box{border:1px solid border;padding:8px;page-break-inside:avoid}` (aucune propriété `background`) |
| T9 | `.label` / `.value` `:709-710` | `blocks.labelValue` → `{ text:[{text:LABEL+' : ',bold:true,color:p.accent}, {text:value}] }`, `preserveLeadingSpaces` pour le `pre-wrap` | `.k{font-weight:bold;width:30%;background:cardAlt}` + `<p><strong>…</strong></p>` |
| T10 | `table` / `th` / `td` `:711-714` | `table` + `layout: LAYOUT_BORDERED`, `headerRows: 1`, cellules d'en-tête `fillColor: p.headerRow` | `table{border-collapse:collapse;table-layout:fixed}td,th{border:1px solid border;padding:4px}tr{page-break-inside:avoid}` |
| T11 | `.badge` `:757` | `blocks.badgeRow` (table de pilules, `fillColor: p.accent`, texte blanc) | `.pill{border:1px solid accent;border-radius:10px;padding:2px 9px}` |
| T12 | `.tool-badge` `:727-733` | pilule `fillColor: p.warning`, texte noir | `.tool-badge{background:warning;color:#000;padding:2px 6px}` |
| T13 | `.monospaced` `:758` | `font: 'JetBrainsMono'` (police par défaut du document — no-op) | idem |
| T14 | `.pdf-footer` / `.footer-card` `:807-813` — **présent sur la SEULE dernière page** | `footer: (currentPage, pageCount) => …` — bande centrée `OI - <trigramme> - <unité> - CONFIDENTIEL` + `<n> / <N>`, **sur toutes les pages sauf la garde** (écart assumé E2) | `@page` + bloc `.op-card`/pied strategica ; pagination via `@page`-counters non fiable → bande répétée en `position:running` non utilisée, pied porté par la page finale + mention garde |
| T15 | `.bg-watermark` `:738-742` | `{ image, fit:[contentWidthPt, contentHeightPt], opacity: p.watermarkOpacity, absolutePosition:{x:0,y:0} }` dans le contenu des pages garde/finale | `.watermark{position:absolute;inset:0}` + `.watermark img{object-fit:contain;opacity:…}` (verbatim `OrderPdfStyle.kt:201-204`) |
| T16 | `_fitPageToBudget()` `:558-603` (scale CSS anti-débordement) | **SUPPRIMÉ** — remplacé par la pagination automatique + `adaptivePagePx()`/`patracFontPx()` par section | **SUPPRIMÉ** — `page-break-inside:avoid` + police adaptative inline par page dédiée |

### 3.2 Les 14 sections — mapping bloc par bloc

| # | Section (ordre imposé) | Source | Voie A — pdfmake | Voie B — CSS print |
|---|---|---|---|---|
| **1** | **Page de garde** `ORDRE INITIAL` | `:817-855` | Filigrane (T15) ; carte OP/DATE en `absolutePosition:{x: W-mm(60), y: mm(2)}` (table `LAYOUT_BORDERED`, `fillColor:p.cardAlt`) ; `h1` encadré 4 pt centré ; `grid2` [ `card` « 1. SITUATION GLOBALE » = 2 × `labelValue` (générale, particulière) \| `card` « CIBLES(S) » = liste `{nom en gras accent 1.25em} / {stature + ethnie, muted}` séparée par des filets 0,5 pt, ou repli `Aucune cible renseignée.` ] ; `pageBreak:'after'` | `.fullpage` + `.watermark` + `.op-card` + `<h1 style="border:4px solid …">` + `.cible` + `.row/.col` |
| **2** | **Fiches adversaires** `2.<i> FICHE ADVERSAIRE : <nom>` (une page par adversaire) | `:894-970` | Page dédiée, `fontSize: adaptivePagePx(champs de la fiche)`. `columns` [ photo principale `figure(src, [mm(70), mm(MAX_ADV_PORTRAIT_H)])` bordée 2 pt accent (omise si absente) \| colonne : `card` IDENTITÉ (`h3` + `kvTable()` — table `.k` bordée `p.border`, colonne label 30 % grasse `fillColor: p.cardAlt` — 6 lignes Naissance/Profession/Situation familiale/Signalement/Signes particuliers/Substances ; + « Moyens Employés » si `me_list` non vide, D4 `pdfv3-design-fix/DEFAUTS.md`) puis `card` DANGEROSITÉ (`h3` filet **danger**, Armes Connues en `p.danger` gras, Dangerosité/ATCD) ] puis `grid2` [ `card` LOCALISATION (Domicile, Volume/Esprit) \| `card` MOBILITÉ (Véhicules/Plaques, Attitude Attendue) ] | `.adv-page` (+ `.adv-fill` si volume < 1000) `style="font-size:Npx"` ; `.fiche-head` > `.fiche-photo` + `.fiche-id` ; `.card-head` ; table `.k` continue ; `.danger-card` dessous |
| **2b** | Galeries de l'adversaire : `Adversaire : <nom> (Photos annexes)` puis `(Renfort possible)` | `:960-968` | `galleryPages()` (§3.3) | `.adv-page` + `.photo-page-gallery` |
| **3** | `3. ENVIRONNEMENT ET AMIS` | `:972-996` | `h2` + `grid2` [ `card` (Forces Amies/Concours, Terrain/Météo, Éclairage, Lever du soleil) \| `card` (Population/Voisinage, Faune/Animaux, Cadre Juridique) ] + `grid2` [ `card` Accès Principal \| `card` Cheminement Initial ] | page dédiée `.adv-page`, `.row/.col`, `field()` |
| **4** | `4. MISSION DE L'UNITÉ` | `:998-1003` | `h2` + `accentCard('accent')` : liseré gauche 6 pt `p.accent`, `fillColor: p.cardAlt`, texte `missions_psig` en 1,5–1,8 × `fontSize`, gras, `preserveLeadingSpaces` | `.accent-card{font-weight:bold}` (verbatim `OrderHtml.kt:201`) |
| **5** | `5. EXÉCUTION` | `:1007-1030` | `h2` + `columns` [ `labelValue('Date d\'exécution')` \| `labelValue('Heure H')` en 1,2 em gras accent ] + `labelValue('Idée de Manœuvre / Action')` + `grid2` [ `card` « Chronologie Prévisionnelle » = table 2 colonnes (`Heure` 22 %, `Événement`), `headerRows:1`, repli `N/A` \| `card` « Hypothèses d'ensemble » = liste `H<i> :` en `p.danger` gras + texte, liseré gauche 4 pt, repli `-` ] | `.adv-page` + `.row/.col` + `<table class="avoid">` + `<ul><li><strong style="color:danger">H1:</strong>…` |
| **6** | `6. LOGISTIQUE & TRANSPORTS (Cheminement)` — galerie | `:1033-1039` | `galleryPages()` sur `photo_container_transport_pr_preview_container` ⧺ `…_domicile_…` | `.adv-page` + `.photo-page-gallery` |
| **7** | `7. ARTICULATION & ORDRES DE MOUVEMENT` | `:1042-1057` | `h2` + `grid2` [ `card` « Ordre Rame VL » = `pillRow` numérotées (`<i>` gras accent + libellé) \| `card` « Colonne Progression » = idem ] + `card` « Ordre de Pénétration » = `pillRow(penetration, p, { numbered: true })` — **même pastille inline numérotée** que « Ordre Rame VL »/« Colonne Progression », plus aucun pavé dédié (D7, `pdfv3-design-fix/DEFAUTS.md` ; `bigPillRow`/`bigPenetrationPill` supprimées) + ligne `PLACE DU CHEF : <valeur en accent>` | `.pill` (`OrderPdfStyle.kt:137-139`), `.pill b{color:accent}` |
| **8a** | Galerie `Baptême Terrain — <titre ZMSPCP>` | `:1073-1074` | `galleryPages()` | idem §3.3 |
| **8b** | `Articulation : ZMSPCP - <titre>` | `:1075-1094` | `h2` + `grid2` [ `card` « ZMSPCP » = 5 `labelValue` (`Z zone`, `M mission`, `S secteur`, `P points particuliers`, `C conduite à tenir`) \| `card` « Composition par Cellule » = pour chaque cellule un bloc bordé 1 pt accent, `fillColor: p.cardAlt` **plein** (jamais de `fillOpacity`, D5 `pdfv3-design-fix/DEFAUTS.md`) : nom de cellule en 0,7 em gras accent souligné + `pillRow(trigrammes, p, { perRow: 6 })` en **pastille contour** (jamais un badge plein, D6 ; `badgeRow` n'a plus d'appelant dans `document-builder.ts` mais reste exporté) ; puis `Place du Chef` ] | `.row/.col` + `.box` + `.pill` ; classes `.cell-group/.cell-name/.cell-members` portées **verbatim** de `pdf-engine-v2.ts:760-762` |
| **8c** | Galerie `ZMSPCP : <titre> (Emplacement AO)` | `:1096-1097` | `galleryPages()` | idem |
| **8d** | `Articulation : MOICP - <titre>` | `:1104-1123` | identique à 8b, libellés `M mission / O objectif / I itinéraire / P points particuliers / C conduite à tenir` | idem 8b |
| **8e** | Galerie `MOICP : <titre>` (extérieur puis intérieur) | `:1125-1127` | `galleryPages([...ext, ...int])` — **ordre conservé** | idem |
| **8f** | `Articulation : EFFRACTION - <titre>` | `:1138-1185` | `h2` + `columns` [ photo de porte `figure(src,[mm(70), mm(EFFRAC_TOP_H)])` bordée 2 pt accent, **avec bandeau d'outils** : `pillRow` `tool-badge` posée en `absolutePosition` sous la photo (repli `PORTE` si aucun outil) \| `card` « Caractéristiques Techniques » = grille 2 colonnes (`labelValue` ×6 : Structure, Serrurerie, Environnement, Bâti à Bâti mm, Dormant à Dormant mm, Prof. Linteaux mm) + filet pointillé pleine largeur + (H. Porte, H. Marche) + Prof. Bâti sur 2 colonnes ] + `card` « Hypothèses d'Effraction » = table **4 colonnes** (`Hypothèse` 20 %, `Technique / Moyen` 30 %, `Dégagement` 25 %, `Assaut` 25 %), `headerRows:1`, 1re colonne gras accent, repli `Aucune hypothèse saisie` | `.fiche-head` + `.effrac-specs` (grille 2 col., portée verbatim de `:766-768`) + `<hr>` + `<table>` 4 colonnes |
| **8g** | Galerie `Effraction : <titre>` | `:1186-1187` | `galleryPages()` sur toutes les photos `photo_effrac_<id>` | idem |
| **9** | `8. CONDUITES À TENIR GÉNÉRALES` (**omise** si les 3 champs sont vides) | `:1195-1216` | `h2` + `grid2` [ `accentCard('accent')` « CAT Générales » \| `accentCard('danger')` « Conditions de Désengagement (NO-GO) » (texte `p.danger` gras) ] + `accentCard('warning')` « Liaison » | `.accent-card` / `.danger-card` / `.warning-card` (verbatim `OrderPdfStyle.kt:131-136`) |
| **10** | `7. RÉCAPITULATIF PATRACDVR` (+ `(Partie n)` si scindé) | `:1219-1280` | Page(s) dédiée(s), `fontSize: patracFontPx(rowCount)`. **UNE seule table**, `headerRows: 1` (l'en-tête se répète tout seul → la **pagination manuelle `MAX_MEMBERS_PER_PAGE` est supprimée**, écart assumé E3). **Nos 8/9 colonnes conservées** : `VL 7 % / PAX 7 % / CELLULE 10 % / FONCTION 14 % / PPALE 10 % / SEC. 10 % / AFIS 8 % / EQPT+GREN. 28 ou 34 % / [DIR 6 %]` — colonne `DIR` présente **seulement si** au moins un membre a `dir` non vide (condition `:1227` conservée). Cellule `VL` : `fillColor: p.headerRow` sur la 1re ligne de chaque véhicule, vide ensuite. `EQPT/GREN.` = `[equipement, equipement2, grenades, tenue, gpb].filter(v => v && v !== 'Sans').join(', ')` ou `-` | `.patrac` + `<colgroup>` + `<thead>` (en-tête répété à l'impression) ; `.patrac td{text-align:center;overflow-wrap:normal}` (verbatim `OrderPdfStyle.kt:124-128`) |
| **11** | Page finale `AVEZ-VOUS DES QUESTIONS ?` | `:1283-1294` | Filigrane (T15) + `h1` 44 pt centré `p.accent` + filet 4 pt à 15 % d'opacité + bande de pied confidentiel | `.fullpage` + `.watermark` + `<h1>` + filet + `.muted` |

> ⚠️ **Le tableau PATRACDVR de strategica compte 12 colonnes** (`OrderHtml.kt:283-301`).
> Ce n'est **pas** notre schéma. On garde **nos 8/9 colonnes** (structure = la nôtre) et on
> n'emprunte à strategica que le **traitement visuel** : `colgroup` de largeurs calibrées,
> `thead` répété, coupure aux espaces uniquement, police adaptée au nombre de lignes,
> ligne de regroupement par véhicule.

### 3.3 Galeries photo — helper `renderGallery()` (`:858-891`) → `galleryPages()`

Comportement source : **une photo par page**, titre `<h2>` = `<titre> (Photo i/N)`, cadre
bordé, légende (`customTitle` ou `<titre> - Détail`), badges d'outils sous la légende.

| Aspect | Voie A — pdfmake | Voie B — CSS print |
|---|---|---|
| Découpage | **2 photos max par page** (langage strategica, `OrderHtmlPhotos.kt:70-82`) ; titre suffixé `(suite)` au-delà de la 1re page — **écart assumé E4** (1/page → 2/page) | idem, `.photo-page-gallery` |
| Axe | 2 photos paysage → 2 rangées ; sinon 2 colonnes (`isLandscape()`) | `.photo-rows` / `.photo-cols` |
| Cadre | `figure()` : bordure 2 pt `p.accent`, `fillColor: p.cardAlt` | `.page-fig{border:2px solid accent;background:cardAlt}` |
| Image | `{ image, fit: [boxW, boxH] }` (ratio préservé, jamais rognée) | `.page-fig img{max-width:100%;max-height:100%;object-fit:contain}` |
| Légende | ligne centrée `p.accent` gras sous le cadre | `.photo-caption` |
| Badges d'outils | `pillRow` `tool-badge` (`p.warning`), + pilule `other_tools` si présent | `.tool-badge` |
| Hauteur utile | `photoPageGalleryHeightMm(landscape)` = `fullPageHeightMm − 14` | `.photo-page-gallery{height:Nmm}` |

`galleryPages()` vit dans `blocks.ts` :
```ts
export function galleryPages(
  title: string, photos: OiPhotoMeta[], photosBase64: Record<string, string>,
  p: OiPdfPalette, geo: ReturnType<typeof pageGeometry>,
): Content[];   // [] si aucune photo — section vide OMISE
```

### 3.4 Règles de fidélité non négociables (reprises de `generateHTML`)

1. **Section vide ⇒ section omise** (galeries vides, page CAT sans champ, PATRACDVR sans
   membre, fiche adversaire inexistante).
2. **Repli `-`** pour tout champ vide affiché (`|| '-'`), `'Ras'` pour
   `signes_particuliers`, `Aucune cible renseignée.`, `N/A`, `Aucune hypothèse saisie`.
3. **Ordre des photos** conservé (extérieur avant intérieur pour MOICP, PR avant domicile
   pour la logistique, baptême **avant** la page ZMSPCP, emplacement AO **après**).
4. **Boucle d'articulation** : `for i < max(moicp.length, zmspcp.length, effrac.length)`,
   avec l'ordre interne ZMSPCP → MOICP → EFFRACTION (`:1066-1189`).
5. **Mapping trigramme → cellule** (`memberToCell`, `:779-798`) : construit depuis
   `patracdvr_rows`, repli `NON ASSIGNÉ` / `SANS CELLULE`.
6. **Nom de fichier** : `OI_${date_op.replace(/\//g,'-')}_${trigramme_redacteur}.pdf`,
   replis `SANS_DATE` et `RED` (`:442-444`) — **contrat E2E**.
7. **Thème** : `isDark` vient de `collectAllData()` (`:529`), inchangé.
8. **Échappement** : `document-builder.ts` produit du **texte pur** (pdfmake n'interprète pas
   le HTML) — le risque XSS théorique de `generateHTML` disparaît de la voie A. La voie B,
   elle, produit du HTML : elle **doit** utiliser `esc()`/`nl2br()` (port de
   `OrderPdfStyle.kt:216-218`) sur **toute** valeur issue du Store.

### 3.5 `normalizePhotos()` (`engine-v3.ts`)

```
pour chaque (id, dataUrl) de photosBase64 :
  si dataUrl commence par 'data:image/jpeg' ou 'data:image/png'
     et que la plus grande dimension ≤ MAX_PHOTO_PX (2000)  → conservé tel quel
  sinon → décodage (Image), dessin sur <canvas> redimensionné, canvas.toDataURL('image/jpeg', 0.85)
  en cas d'échec → entrée OMISE + console.warn('[PDF v3] photo <id> ignorée (format non supporté)')
```

---

## 4. Devenir de l'ancien moteur

| Élément | Décision |
|---|---|
| `PDFEngineV2.generateHTML()` | **CONSERVÉ tel quel** — c'est le rendu de l'**aperçu HTML in-app** (`openPreview`, `:110-142`) et du **mode « Présenter ici »** (`openPresentInPlace`, `:158-184`). Aucune modification. |
| `PDFEngineV2.collectAllData()` / `blobToBase64()` | **CONSERVÉS et RÉUTILISÉS** par `engine-v3.ts` — collecteur unique (photos IndexedDB + fusion des annotations + fond personnalisé). |
| `PDFEngineV2.downloadOiPdf()` (`:281-467`) | **REMPLACÉ** dans le câblage du bouton par `downloadOiPdfV3()`. Le corps html2canvas+jsPDF est **retiré en phase Intégration**, pas dans les paquets. |
| `PDFEngineV2._fitPageToBudget()` (`:558-603`) | Reste utilisé par `openPreview` (`:137`) → **CONSERVÉ**. |
| `html2canvas` | **NE PAS TOUCHER.** Toujours utilisé par `src/apps/pctac/planmap/capture.ts:17` et `src/apps/oi/carto/capture.ts:47`. Le retirer casserait PC-Tac et la carto OI. |
| `jspdf` | **Seul consommateur = `src/apps/oi/pdf-engine-v2.ts:34`** (vérifié : `grep -rn jspdf src/` ne renvoie que ce fichier + le mock du test unitaire). Une fois le corps raster retiré, `jspdf` **sort des dépendances** (`npm uninstall jspdf`) — résout la vulnérabilité `dompurify` transitive notée en Phase 0. **Retrait = phase Intégration**, après validation du nouveau chemin. |
| `pdf-lib` | **NE PAS TOUCHER** — moteur du PDF PATRACDVR autonome (`#patracdvrPdfBtn`, E2E `oi.spec.ts:626`). |
| `tests/unit/oi/oi-pdf-engine-v2.test.ts` | Les `describe` `collectAllData` / `generateHTML` / `_fitPageToBudget` **restent verts**. Le `describe` `downloadOiPdf` (`:467-550`) devra être réorienté en phase Intégration. |

---

## 5. Interface utilisateur

### 5.1 Bouton existant — bascule silencieuse

`oi/index.html:39-42` — `#downloadPdfBtn` **inchangé** (id, classe, libellé, icône,
position). Seule la fonction câblée change (`main.ts:576-577`), en phase Intégration :
`window.downloadOiPdf` → `downloadOiPdfV3`. **Aucun écart DOM.**
Contrat E2E préservé : `oi.spec.ts:957-971` (téléchargement automatique, nom `^OI_.*\.pdf$`).

### 5.2 Nouveau bouton « Imprimer — qualité maximale »

* **Emplacement** : `oi/index.html`, dans `.modal-actions-pdf` (`:24-47`), **entre**
  `#presentHereBtn` (`:33`) et `#downloadPdfBtn` (`:39`).
* **Balisage exact** (délégation `data-action`, conforme à `DECISIONS-DOM-ECARTS.md` §8) :

```html
<button id="printHqBtn" type="button" class="wizard-nav-btn"
    data-action="print-oi-high-quality"
    title="Ouvre la boîte d'impression du navigateur : PDF entièrement vectoriel, texte sélectionnable (qualité maximale)">
    Imprimer — qualité maximale <span class="material-symbols-outlined"
        style="font-size: 1.2em;">print</span>
</button>
```

* **Câblage** (phase Intégration) : entrée `'print-oi-high-quality'` dans `oiClickActions`
  (`src/apps/oi/main.ts:~230-337`) → `void import('@oi/pdf/print-view.js').then(m => m.printOiHighQuality())`.
* **Écart DOM** : à consigner dans `docs/DECISIONS-DOM-ECARTS.md` en **§12** (nouveau
  chapitre, même forme que §6 « ajout de `#portalLink` ») : ajout assumé, sans équivalent
  dans `GStart-main/4.html`, justifié par la voie B de la présente spec.
* **Impact `tests/visual/compare.mjs`** : **AUCUN masque requis.** Les 9 états OI capturés
  (`compare.mjs:185-196` : `step0-situation` … `step7-finalisation`, `cartography-modal`)
  n'ouvrent jamais `#presentationModal`, qui est un `<dialog>` fermé par défaut. Le bouton
  n'est donc visible dans aucune capture de référence. **À revérifier** par
  `npm run test:visual` après ajout : si un diff apparaît sur un état OI, il s'agit d'une
  régression réelle, pas de ce bouton.

### 5.3 Voie B — mécanique d'impression

1. `collectAllData()` (moteur v2, inchangé) ;
2. `buildPrintDocument(data, { format })` → document HTML **autonome** (`<!DOCTYPE html>` …
   `<style>` = `printCss(...)` avec `fontFacesCss()` inline) ;
3. injection dans un `<iframe>` **même origine**, hors écran
   (`position:fixed;left:-10000px;width:0;height:0;border:0`), via `srcdoc` ;
4. `await` sur `iframe.onload` **et** `iframe.contentDocument.fonts.ready` ;
5. `iframe.contentWindow.focus()` puis `deps.print(iframe.contentWindow)`
   (défaut `(w) => w.print()` — **couture de test**) ;
6. retrait de l'iframe sur `afterprint` **ou** après un délai de garde de 60 s.

Le `<iframe>` (et non un nouvel onglet) évite le blocage de pop-up et garantit que les
règles `@page` du document imprimé sont bien celles de `printCss()`, sans héritage des
feuilles de style de l'application.

---

## 6. Licences OFL

| Fichier | Provenance | Destination |
|---|---|---|
| `oswald_500.ttf` | `Praxis-Rust/android/app/src/main/assets/fonts/oswald_500.ttf` (86 428 o) | `src/apps/oi/pdf/fonts/oswald_500.ttf` |
| `jetbrains_mono_400.ttf` | idem (112 172 o) | `src/apps/oi/pdf/fonts/jetbrains_mono_400.ttf` |
| `jetbrains_mono_700.ttf` | idem (112 092 o) | `src/apps/oi/pdf/fonts/jetbrains_mono_700.ttf` |
| Texte OFL 1.1 Oswald | `node_modules/@fontsource/oswald/LICENSE` (déjà une dépendance du projet) | `src/apps/oi/pdf/fonts/OFL-Oswald.txt` |
| Texte OFL 1.1 JetBrains Mono | `node_modules/@fontsource/jetbrains-mono/LICENSE` | `src/apps/oi/pdf/fonts/OFL-JetBrainsMono.txt` |

* `src/apps/oi/pdf/fonts/README.md` : provenance exacte, empreintes SHA-256, rappel que les
  deux familles sont sous **SIL Open Font License 1.1** (redistribution autorisée, y compris
  embarquée dans un PDF, sans obligation de licence sur le document produit), et commande de
  régénération `npm run gen:pdf-fonts`.
* `README.md` (racine) : une section **« Polices embarquées »** listant Oswald et JetBrains
  Mono, leur licence OFL 1.1 et le chemin des textes de licence.
* Les `.ttf` **ne sont pas servis** : ils ne sont lus que par `scripts/gen-pdf-fonts.mjs`.
  Seul `fonts.generated.ts` (base64) entre dans le bundle. Aucun fichier de police
  supplémentaire n'apparaît dans `dist/`.

---

## 7. Protocole de non-régression STRUCTUREL

Outil : **`tests/pdf/verify-structure.mjs`** — script Node autonome (aucune dépendance npm,
appelle les binaires poppler déjà validés sur la machine : `pdfinfo`, `pdftotext`,
`pdffonts`, `pdfimages`).

```
node tests/pdf/verify-structure.mjs <fichier.pdf> [--format=a4|16:9] [--photos=N]
                                    [--sample=<fichier.json>] [--json] [--lenient]
```
Sortie : une ligne `PASS <code> — <libellé>` ou `FAIL <code> — <constat>` par assertion,
puis un résumé. Code de sortie `0` si toutes les assertions passent, `1` sinon.
`--json` émet en plus `{ ok, assertions: [{ code, ok, detail }] }` sur stdout.

### Assertions exactes

| Code | Assertion | Détail |
|---|---|---|
| **A1** | Géométrie | `pdfinfo` : `Pages:` ≥ **12** ; `Page size` identique sur toutes les pages (`pdfinfo -f 1 -l <N>`), et égale à **841,89 × 595,28 pts** (`--format=a4`, défaut) ou **958,11 × 539,01 pts** (`--format=16:9`), tolérance ±0,5 pt. |
| **A2** | Texte réel | `pdftotext -layout` renvoie ≥ **1 500** caractères non blancs. *(Sur `oi-reference/reference.pdf`, cette assertion échoue — sortie vide : c'est exactement l'anti-pattern que la v3 supprime.)* |
| **A3** | Ordre des sections | Les **15 marqueurs** ci-dessous sont tous présents, et l'index de leur **première** occurrence est **strictement croissant**. Normalisation avant recherche : NFC, espaces consécutifs réduits à un, apostrophes typographiques `’`→`'`, tirets `–`/`—` conservés. |
| **A4** | Défaut hérité préservé | Exactement **2** occurrences distinctes d'un titre commençant par `7. ` (`7. ARTICULATION…` et `7. RÉCAPITULATIF…`). Une seule ⇒ FAIL (section perdue ou renumérotée à tort). |
| **A5** | Polices vectorielles | `pdffonts` : ≥ 3 lignes ; **toutes** les polices listées ont `emb = yes` **et** `sub = yes` ; au moins une famille contenant `Oswald` et une contenant `JetBrainsMono`. Aucune police non embarquée tolérée. |
| **A6** | Absence de rastérisation | `pdfimages -list` : nombre d'images ≤ `--photos` (défaut **0**). FAIL supplémentaire si `nb_images == nb_pages` **et** qu'au moins une image par page couvre ≥ 80 % de la surface de sa page (signature exacte de html2canvas+jsPDF). |
| **A7** | Poids | Avec `--photos=0` : taille du fichier ≤ **1 048 576 o** (1 Mio). *(Référence « avant » : 10,8 Mo pour `GStart-main/OI_2026-04-27_MHX-3.pdf`, 2,53 Mo pour `reference.pdf`.)* |
| **A8** | Données saisies | Si `--sample=<json>` : chaque chaîne du tableau `expect[]` du fichier apparaît dans la sortie `pdftotext`. Le fichier d'échantillon de référence est dérivé de `../../.tacsuite-prep/oi-reference/recipe-data.json` (nom d'opération, date, trigramme rédacteur, nom d'un adversaire, un trigramme PATRACDVR, un fragment de `missions_psig`). |

**Liste des 15 marqueurs (ordre imposé, verbatim)** — source :
`oi-reference/fingerprint.md` §« Ordre des sections » + `pdf-engine-v2.ts`, et
identique à la liste déjà assertée par `tests/unit/oi/oi-pdf-engine-v2.test.ts:343-359` :

```
1.  ORDRE INITIAL
2.  1. SITUATION GLOBALE
3.  CIBLES(S)
4.  2.1 FICHE ADVERSAIRE
5.  3. ENVIRONNEMENT ET AMIS
6.  4. MISSION DE L'UNITÉ
7.  5. EXÉCUTION
8.  6. LOGISTIQUE & TRANSPORTS
9.  7. ARTICULATION & ORDRES DE MOUVEMENT
10. Articulation : ZMSPCP
11. Articulation : MOICP
12. Articulation : EFFRACTION
13. 8. CONDUITES À TENIR GÉNÉRALES
14. 7. RÉCAPITULATIF PATRACDVR
15. AVEZ-VOUS DES QUESTIONS ?
```

Marqueurs **4, 8, 10, 11, 12, 13** conditionnés par les données. Mode par défaut
(**strict**) : les 15 sont exigés — le jeu de rejeu `recipe-data.json` les produit tous.
Mode `--lenient` : un marqueur conditionnel absent est signalé `SKIP` sans faire échouer,
mais l'ordre des marqueurs **présents** reste asserté.

### Ce que le protocole **NE** fait **PLUS**

* Pas de comparaison pixel des pages : le rendu vectoriel est un changement **voulu**,
  l'étalon raster de `oi-reference/reference.pdf` devient **caduc pour la voie A**
  (cf. `fingerprint.md`, note « hashes non reproductibles »).
* Pas d'égalité stricte à 14 pages : la pagination devient automatique, donc dépendante du
  volume. Seul le **plancher de 12 pages** et l'**ordre des sections** font foi.
* Le diff pixel reste pertinent **uniquement sur les images extraites** (`pdfimages`), les
  photos et la carto restant raster par nature — non automatisé dans cette version de
  l'outil (constat manuel si besoin).

### Écarts visuels ASSUMÉS (à ne pas traiter comme des régressions)

| Réf | Écart | Justification |
|---|---|---|
| **E1** | Perte des coins arrondis (16 px) et des ombres portées des `.card` | pdfmake n'a ni `border-radius` ni `box-shadow` ; strategica utilise des cadres nets 1 px |
| **E2** | Bande de pied de page + pagination `n / N` sur **toutes** les pages (sauf la garde) au lieu de la seule page finale | La pagination automatique la rend gratuite et utile ; le pied unique était un artefact du rendu page-par-page |
| **E3** | Suppression de la pagination manuelle PATRACDVR (`MAX_MEMBERS_PER_PAGE` 12/8) | `headerRows:1` répète l'en-tête et pdfmake coupe au bon endroit ; le titre `(Partie n)` disparaît |
| **E4** | Galeries à **2 photos** par page (au lieu d'une) | Langage strategica (`OrderHtmlPhotos.kt:70-82`), retour créateur « les images doubles prennent trop peu d'espace » |
| **E5** | Suppression du filigrane sur les pages intermédiaires (il n'y en avait déjà pas) et de `_fitPageToBudget` | Pagination automatique |
| **E6** | Palette : accents `#2563eb`/`#dc2626` → **`#0033a0`/`#c0392b`** (clair) et `#3b82f6` → **`#5b9bd5`** (sombre) | Langage visuel strategica (`OrderPdfStyle.kt:30-56`) — c'est l'objet du chantier |

---

## 8. Découpage en paquets (résumé)

| Paquet | Modèle | Cibles principales |
|---|---|---|
| **P1** dépendances + polices + VFS | haiku | `package.json`, `package-lock.json`, `README.md`, `scripts/gen-pdf-fonts.mjs`, `src/apps/oi/pdf/fonts/**`, `fonts.generated.ts`, `fonts.ts` |
| **P2** thème | sonnet | `src/apps/oi/pdf/theme.ts` + test |
| **P3** primitives | sonnet | `src/apps/oi/pdf/blocks.ts` + test |
| **P4** constructeur de document | sonnet | `src/apps/oi/pdf/document-builder.ts` + test |
| **P5** voie B (impression) | sonnet | `src/apps/oi/pdf/print-style.ts`, `print-view.ts` + tests |
| **P6** moteur v3 | sonnet | `src/apps/oi/pdf/engine-v3.ts` + test |
| **P7** UI + PWA + écart DOM | haiku | `oi/index.html`, `vite.config.ts`, `docs/DECISIONS-DOM-ECARTS.md` |
| **P8** protocole structurel | sonnet | `tests/pdf/verify-structure.mjs`, `tests/pdf/README.md` |

**Hors paquets — phase Intégration** (orchestrateur) :
câblage `#downloadPdfBtn` → `downloadOiPdfV3`, entrée `oiClickActions['print-oi-high-quality']`,
retrait du corps raster de `downloadOiPdf()`, `npm uninstall jspdf`, réorientation du
`describe('downloadOiPdf')` du test unitaire, ajout des tests E2E du nouveau bouton,
exécution complète (`npm run typecheck && npm run lint && npm test && npm run test:e2e && npm run test:visual`).

---

## § Pagination v2 (correctif PG.IMPL, mode rapide sans Playwright)

Addendum au §7 (guardrail B1-B3, `tests/pdf/verify-structure.mjs`) : modèle de
pagination des blocs ZMSPCP/MOICP et du tableau PATRACDVR de
`document-builder.ts` (voie A, pdfmake), motivé par 3 défauts **prouvés** sur
un PDF réel de 21 pages avant correctif — queues orphelines (« fixer
l'adversaire. » seule sur une page), pages à titre seul, mots du Store cassés
lettre à lettre dans le PATRACDVR (« SHARA N », « GILE TTE », « KODIA Q
BANA »). Contre-épreuve TDD : `tests/pdf/fixtures/long-case.json` +
`tests/pdf/verify-structure.mjs --lenient` (assertions B1/B2/B3, indépendantes
de `--lenient`) — FAIL avant ce correctif (B1 page 9 à 114 caractères, B2 3
mots cassés page 15), PASS après (les deux, thème clair ET sombre, format
`a4` ET `16:9`), sans régresser les 1628 tests préexistants (1631 après ajout
des 3 tests dédiés `tests/unit/oi/pdf/oi-pdf-document-builder.test.ts`).

### Contrainte de départ : module PUR

`document-builder.ts` reste un module PUR (zéro pdfmake en VALEUR, cf. son
en-tête) — la mesure réelle du rendu (`pageSize:{height:Infinity}`, bench
`pdfmake-pagination-bench` q5) est donc **hors de portée** de ce fichier :
c'est une capacité du seul harnais de test (`tests/pdf/generate-from-fixture.mjs`),
jamais du code de production. Le modèle ci-dessous est donc entièrement
**heuristique par volume de caractères**, dans le prolongement direct des
barèmes déjà en place (`documentFontPx`, `adaptivePagePx`, `patracFontPx`,
`theme.ts`) — pas une mesure de rendu réelle.

### 1. Police adaptative AVANT scission (priorité 1-2)

`buildZmspcpPage`/`buildMoicpPage` calculent un palier de police propre au
bloc via `adaptivePagePx()` (déjà utilisée par la fiche adversaire), sur les
champs cœur (Z/M/S/P ou M/O/I/P, `cat`, `place_chef`) + un nombre de lignes
« virtuelles » proportionnel au nombre de groupes de cellule. Un champ « C
conduite à tenir » volumineux (beaucoup de `\n`) fait donc naturellement
tomber le palier au minimum (9 px) **avant** toute décision de scission —
sur `long-case.json` (bloc ZMSPCP à 20 items), ce seul mécanisme suffit à
faire tenir le bloc entier sur une page (vérifié par rendu réel +
`pdftoppm`, aucune scission déclenchée).

### 2. Frontières légitimes UNIQUEMENT (priorité 3, `splitAtDashBoundaries`)

Un champ « à tirets » (`- item\n- item...`) est découpé en items **seulement**
aux frontières `\n(?=-\s)` — jamais en milieu de phrase. Sans tiret détecté,
le champ reste un bloc unique, intact, JAMAIS scindé (repli identique au
comportement pré-correctif). Chaque item est ensuite rendu comme un élément
`unbreakable:true` **individuel** (`dashItemList`) — pas le bloc entier :
finding #1 du banc (`unbreakable` dépassant une page = **suppression
SILENCIEUSE**, 0 ligne rendue, aucune erreur) interdit d'appliquer
`unbreakable` à un bloc de la taille d'une page ; chaque item pris seul reste
très en-deçà de cette limite. Ce rendu par item s'applique **dès qu'une
frontière existe**, même sur une seule page — pas seulement en cas de
scission — pour que pdfmake ne puisse jamais rompre une phrase entre deux
lignes wrappées d'un même item.

### 3. Scission « (suite) » en dernier recours (priorité 3, garde-fou)

Si le nombre d'items dépasse `catItemsPerPageBudget(fontPx)` (`theme.ts` —
budget par NOMBRE D'ITEMS, mesure grossière calibrée empiriquement en
l'absence de mesure de rendu réelle, cf. contrainte module pur ci-dessus :
12/16/20/26 items selon le palier 14/12/10/9 px), le bloc est scindé en
fragments de `budget` items (`chunkItems`). Chaque fragment devient sa PROPRE
page : le premier conserve les champs cœur + la composition par cellule, les
suivants portent le titre `<Titre> (SUITE)` (port de la règle cible
strategica, `h2()` majuscule le texte) et uniquement la suite des items —
jamais de duplication ni de perte (vérifié exhaustivement par test unitaire,
30 items synthétiques → exactement 1 scission à l'item 26/30, chaque item
présent exactement une fois). Convention de saut de page : identique à
`galleryPages()` (cf. en-tête `document-builder.ts`) — seule la première page
du bloc reste nue, les suivantes portent déjà leur propre `pageBreak:'before'`,
consommées par `pushPages()` (pas `pushPage()`).

### 4. Sections vides omises

Déjà couvert par le code préexistant, non touché par ce correctif :
`buildCatPage`/`buildPatracPage` renvoient `null` si tous leurs champs sont
vides (§3.4 règle 1), et `galleryPages()` renvoie `[]` sans photo résolue —
aucune page « titre seul » n'est donc générée pour une section vide.

### 5. PATRACDVR : largeurs adaptées (`buildPatracPage`)

Cause du bug (bench q3, confirmée sur `long-case.json` p.15 AVANT correctif) :
les colonnes « code court » (véhicule, trigramme, cellule, fonction, armes,
AFIS, direction) étaient en largeur **pourcentage fixe** sans `noWrap` — un
mot sans espace plus large que la colonne (« SHARAN », « KODIAQ », « GILETTE »)
était cassé **lettre à lettre** par l'algorithme de wrap de pdfmake (aucune
césure au tiret possible pour un mot du Store). Corrigé en largeurs `'auto'`
+ `noWrap:true` sur cellule pour **toutes** les colonnes code court (largeur
= celle du plus long libellé RENCONTRÉ, jamais coupée) ; seule EQPT/GREN.
(texte combiné potentiellement long, plusieurs mots) reste en `'*'` sans
`noWrap`, conservant son retour à la ligne normal. `patracFontPx()` (palier
9-14 px selon le nombre de lignes, `theme.ts`) est inchangé.

### 6. Groupement 2 colonnes (ZMSPCP/MOICP)

Déjà porté par `grid2()` (champs cœur à gauche, composition par cellule à
droite) — inchangé par ce correctif, simplement préservé sur la première page
de chaque bloc scindé (les fragments « (SUITE) » n'ont qu'une colonne gauche
utile, la droite reste un espace réservateur `{ text: '' }` pour garder la
mise en page à 2 colonnes cohérente).

### Limites assumées

* Le budget `catItemsPerPageBudget` est une heuristique par NOMBRE D'ITEMS,
  pas par volume de caractères par item — un bloc à 20 items très longs
  (chacun sur 3-4 lignes) pourrait en théorie encore déborder d'une page
  malgré un nombre d'items sous le budget ; non observé sur les jeux de
  données réels disponibles (`long-case.json`, `recipe-data.json`).
* Seuls ZMSPCP/MOICP (`C conduite à tenir`) et PATRACDVR bénéficient de ce
  modèle — `buildEffractionPage`/`buildCatPage` (8. CONDUITES À TENIR
  GÉNÉRALES) restent au comportement pré-correctif, aucun défaut B1/B2/B3
  n'ayant été mesuré sur ces blocs.

---

## 9. Références

* Étude : `../../.tacsuite-prep/etude-pdf-strategica.md`
* Empreinte structurelle de l'étalon : `../../.tacsuite-prep/oi-reference/fingerprint.md`
* Recette de rejeu : `../../.tacsuite-prep/oi-reference/recipe.md` + `recipe-data.json`
* Source à conserver : `src/apps/oi/pdf-engine-v2.ts` (`generateHTML` `:608-1304`)
* Contrats E2E : `tests/e2e/oi.spec.ts:954-972` (téléchargement), `:903-908` (aperçu),
  `:973-987` (« Présenter ici »), `:626-635` (PDF PATRACDVR pdf-lib)
* Langage visuel : `Praxis-Rust/android/app/src/main/java/com/praxis/rust/ui/order/OrderPdfStyle.kt`,
  `OrderHtml.kt`, `OrderHtmlPhotos.kt`, `OrderHtmlAdversaires.kt`,
  `.../ui/pdf/PdfFontFaces.kt`, `.../ui/pdf/HtmlPdfPrinter.kt`
* Exports HTML de référence : `~/Téléchargements/praxis-pdf-preview/oi-{paysage,portrait,sombre}.html`
