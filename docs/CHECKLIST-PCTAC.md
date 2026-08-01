# Checklist fonctionnelle PC-Tac — P2.E1

Source des critères : `docs/recon-pctac.md` §6 (checklist fonctionnelle de
non-régression). Statuts vérifiés le 2026-08-01 contre
`http://127.0.0.1:9678/pctac/` (TacSuite dev) via
`tests/e2e/pctac.spec.ts` (26 tests, `npx playwright test tests/e2e/pctac.spec.ts
--project=chromium-desktop`) et via revue de code ciblée pour les items
infaisables en E2E.

## MISE À JOUR — P2.FIX reprise 1 (2026-08-01, après exécution de P2.D)

**Le constat bloquant du §0 ci-dessous est RÉSOLU.** `src/apps/pctac/main.ts`
câble désormais les 33 modules portés (imports §5.2, 22 étapes du
`DOMContentLoaded` §5.3 de `docs/SPEC-PCTAC-CONVERSION.md`), suivant à la
lettre l'ordre imposé — cf. compte-rendu de la mission P2.FIX (reprise 1) pour
le détail correctif par correctif. Le tableau du §1 et les commentaires du §0/§2
ci-dessous **restent tels quels comme trace historique du gate P2.E1** (avant
P2.D) ; ils ne sont volontairement PAS réécrits ligne par ligne ici (ce
réexamen exhaustif item par item est le livrable du prochain gate officiel
P2.E, pas de cette reprise correctrice). Seuls les deux points explicitement
signalés à revalider par la mission de reprise sont mis à jour ci-dessous :

- **Item #6 (mode PAX libre)** — REVALIDÉ, confirmé **NON-RÉGRESSION** (comme
  l'item #11) : `.mode-toggle-btn`, `#pax_select_wrapper_standard`,
  `#pax_select_wrapper_free` sont absents à la fois de `pctac2.html`
  (ORIGINAL, grep confirmé — 0 occurrence) et de `pctac/index.html` (porté).
  Aucun élément du DOM statique n'invoque `setPaxMode('free')`, et rien ne les
  injecte au runtime (`UI.initPaxModeAndColors` n'en crée aucun). C'est du
  code mort déjà présent dans la source, pas un défaut de câblage P2.D. La
  logique de `UI.setPaxMode` elle-même reste correcte (revérifiée en E2E via
  `window.setPaxMode('free')` invoqué directement). Test E2E mis à jour
  (`tests/e2e/pctac.spec.ts`, test « Main Courante — mode PAX libre + couleur
  personnalisée ») pour ne plus attendre un sélecteur inexistant.
- **Item #26 (légende repliable)** — ISOLÉE dans son propre test E2E
  (`Plan — légende repliable (élément <details> natif)`), indépendant de
  `#plan_btn_draw`. Confirmé **VERT**, comme anticipé (élément HTML natif
  `<details>`, aucun JS requis).

**Résultat du re-run complet** (`npx playwright test tests/e2e/pctac.spec.ts
--project=chromium-desktop`, 2026-08-01, après P2.D) : **30/30 tests verts**
(26 tests d'origine + 4 ajoutés en R7 de la reprise — drag&drop du journal
item #8, bascule 2D/3D item #16, import d'archive `.pctac.zip` item #30 ;
item #31 reste NON COUVERT, différé en Phase 3 comme prévu). Stable sur 3
exécutions consécutives (`--workers=4` et défaut). Comparaison visuelle
(`node tests/visual/compare.mjs pctac`) : 19/20 états sous le seuil de
0,1 % (contre 0/10 avant P2.D) ; 1 résidu (`tab-plan-panneau-tchap-live-mobile`,
0,119 %) documenté dans le compte-rendu de la mission comme point à instruire
séparément (diff diffus, non localisé à un élément précis, absent côté
desktop — probablement une variance de rendu des contrôles MapLibre hors
canvas masqué, pas une régression du câblage).

## MISE À JOUR — P2.FIX reprise 2 (2026-08-01) — réexamen exhaustif item par item

**Ceci est le réexamen annoncé comme livrable du « prochain gate officiel P2.E »**
par la mise à jour reprise 1 ci-dessus. Le tableau du §1 et le §3 sont
désormais réécrits ligne par ligne contre l'état réel post-P2.D — ils ne
sont plus une trace figée d'avant P2.D. Méthode : chaque ligne cite soit le
nom exact du `test()` Playwright qui l'établit (`tests/e2e/pctac.spec.ts`),
soit la revue de code déjà tracée en reprise 1 pour les points non
E2E-couvrables. §0 et les commentaires « historique » qui précèdent restent
en l'état, à titre de trace du gate P2.E1 initial (avant tout câblage) — ne
pas les prendre pour l'état courant.

**Run de référence** (2026-08-01, après les correctifs R1/R2/R3/R4/R5 de
cette reprise) :

- `npx playwright test tests/e2e/pctac.spec.ts` (30 tests × 2 projets
  `chromium-desktop` + `chromium-mobile`, sans filtre `--project`) :
  **60/60 verts**, ~18-19 s. Stable sur re-runs consécutifs.
- `node tests/visual/compare.mjs pctac` : **20/20 états sous le seuil de
  0,1 %**, code de sortie 0 (voir §3 pour le détail, incluant le correctif
  du masque d'en-tête scroll-aware qui débloquait le dernier résidu).
- `npx vitest run` : 838/838 verts (33 fichiers).
- `npx tsc --noEmit` : 0 erreur.

Deux correctifs de fond ont été nécessaires pour obtenir ce résultat (pas de
simple réécriture de la doc) :

- **R5 (test « Plan — dessin »)** : l'assertion finale de l'étape « tracer un
  rectangle par glisser » a été durcie (état persistant `localStorage`
  `pcTacPlanShapes` plutôt que la seule présence du canvas MapLibre), ce qui
  a révélé DEUX comportements réels à respecter pour que le test soit
  probant, tous deux vérifiés verbatim contre l'ORIGINAL
  (`GStart-main/modules/pctac/planMap.js`), donc PAS des régressions de
  portage : (1) `_setDrawColor` réinvoque `_setTool(this.drawTool)` dont le
  garde de toggle désélectionne l'outil si on choisit la couleur APRÈS
  l'outil (`planMap.js:2082-2089` vs `2003`) — le test clique désormais la
  couleur AVANT l'outil ; (2) en viewport ≤768px, `_setTool` active
  `drawPrecisionMode`, qui désactive le glisser direct sur la carte
  (`_handleDrawDown` retourne immédiatement, `planMap.js:2094`) au profit du
  flux réticule Viser/Valider — le test bascule sur ce flux quand
  `page.viewportSize().width <= 768`.
- **R1 (comparaison visuelle)** : le masque d'en-tête (rectangle fixe du
  bouton BETA retiré) ne suivait pas le défilement de page déclenché par
  l'ouverture du panneau Tchap live, faisant fuir ~189 px de bouton BETA hors
  masque sur l'état mobile. `tests/visual/compare.mjs` translate désormais ce
  masque de `-scrollY` (mesuré en direct sur la page capturée) avant de
  peindre les deux images — voir `tests/visual/README.md` § « Zones à
  masquer » pour le détail.

## 0. Constat bloquant (ÉTAT AU MOMENT DU GATE P2.E1, avant P2.D — historique)

**`src/apps/pctac/main.ts` est encore le placeholder de scaffold de la Phase 0**
(6 lignes utiles : import des polices auto-hébergées + CSS MapLibre + un
`console.info`). **P2.D (câblage : délégation d'événements, `UI.initElements()`,
montage de `PlanMap`/`TchapLive`, `PocheTuto.mount()`, service worker — cf.
`docs/SPEC-PCTAC-CONVERSION.md` §3 et §5) n'a pas encore été exécuté**, alors
que le plan (`docs/PLAN.md` §6) le place explicitement avant P2.E ("GATE
intégration"). Conséquence vérifiée en pratique :

- Les 17 modules `src/apps/pctac/*.ts` + `planmap/*.ts` (13 700 LOC portées,
  839 tests Vitest verts) existent et sont corrects **isolément**, mais
  **aucun n'est importé par `main.ts`**. `window.UI`, `window.PlanMap`,
  `window.Archive`, `window.PdfExport`, `window.LogManager`, `window.ImageStore`
  ne sont jamais posés ; `PocheTuto.mount()` n'est jamais appelé ; aucun
  listener (`click`, `submit`, `dragstart`...) n'est attaché.
- Le DOM porté (`pctac/index.html`) est correct et strictement conforme à
  l'original (cf. `docs/DECISIONS-DOM-ECARTS.md`, seul écart admis = bouton
  BETA), mais **statique** : seul l'onglet `view-main-courante` a la classe
  `active` figée dans le HTML ; tous les autres onglets, modales, dock, panneau
  Plan restent inatteignables par clic (CSS `display:none` sur les vues non
  actives + zéro listener), et le `<form id="log-form">` ne fait rien au submit
  faute de `preventDefault`/handler.
- **Sur 26 tests E2E fonctionnels, 23 échouent — tous pour cette UNIQUE cause
  racine** (confirmé en lisant l'intégralité des traces d'échec : chaque
  assertion rouge constate soit une classe `active` qui ne bascule jamais,
  soit un élément `hidden`/introuvable sous une vue restée inactive, jamais un
  sélecteur erroné ou une divergence de comportement métier). **Ce n'est donc
  PAS 23 régressions indépendantes du portage** — c'est UNE dépendance de
  planification manquante (P2.D). Les modules eux-mêmes ne sont pas mis en
  cause par ce run.
- Les 3 tests verts (structure des 7 onglets + libellés, liens externes
  statiques de l'onglet Liens, manifest PWA) confirment que le DOM statique et
  ses attributs ne dépendent pas du câblage et sont conformes.

**Recommandation à l'orchestrateur** : router une tâche P2.D (câblage
`main.ts`) avant de rejouer ce gate P2.E. Les tests ci-dessous (`tests/e2e/pctac.spec.ts`)
restent la cible opposable inchangée pour ce futur re-run — ne pas les
affaiblir pour les faire passer artificiellement.

## 1. Tableau — checklist §6 point par point (RÉÉCRIT — P2.FIX reprise 2, 2026-08-01)

**Ce tableau remplace intégralement celui du gate P2.E1** (avant P2.D) —
voir la mise à jour reprise 2 en tête de document pour la méthode et le run
de référence. Aucun des 40 items du §6 de `docs/recon-pctac.md` n'a été
retiré ; seuls les statuts et les preuves sont mis à jour.

Légende statuts : **VERT** (E2E vert, `npx playwright test tests/e2e/pctac.spec.ts`,
60/60 sur `chromium-desktop` + `chromium-mobile`) · **HORS-PORTAGE**
(exclusion actée) · **HORS-PHASE** (livrable d'une phase ultérieure) ·
**NON-RÉGRESSION** (déjà non fonctionnel dans l'ORIGINAL, donc pas un défaut
du portage) · **REVUE DE CODE** (infaisable en E2E, vérifié autrement) ·
**NON COUVERT** (aucun test dédié, assumé explicitement). Plus aucun item
n'est `BLOQUÉ (P2.D)` : la cause racine unique du §0 (câblage absent) est
résolue depuis P2.D.

| # | Item (recon-pctac.md §6) | Statut | Test / méthode | Résultat |
|---|---|---|---|---|
| 1 | Navigation : 7 onglets présents, libellés corrects | VERT | E2E structurel | `Navigation — structure des 7 onglets + bascule de vue` (étape 1) : les 7 `.tab-btn[data-view]` + 7 `#view-*` existent, libellés conformes, onglet par défaut actif |
| 2 | Navigation : clic onglet → bascule de vue | VERT | E2E comportemental | `Navigation — structure des 7 onglets + bascule de vue` (étapes « clic sur l'onglet … ») : les 6 onglets non-défaut basculent `.active` (vue + bouton), les autres vues perdent `.active` |
| 3 | Navigation : clavier flèches (a11y `makeTablist`) | VERT | E2E | `Navigation — structure des 7 onglets + bascule de vue` (étape « navigation clavier flèches sur la tablist ») : `ArrowRight` depuis Main Courante déplace le focus sur Adversaires |
| 4 | Navigation : dernier onglet restauré au reload | VERT | E2E | `Navigation — dernier onglet restauré après rechargement` : active Otages, `page.reload()`, `#view-otages` toujours `.active` |
| 5 | Main Courante : ajout entrée (PAX standard + couleur) | VERT | E2E | `Main Courante — ajout, tri, édition, suppression d'entrée` (étape « ajout d'une entrée en mode PAX standard ») |
| 6 | Main Courante : mode PAX libre + couleur perso | NON-RÉGRESSION (inchangé depuis reprise 1) | E2E + revue | `Main Courante — mode PAX libre + couleur personnalisée` : `.mode-toggle-btn`/`#pax_select_wrapper_standard`/`_free` **absents des DEUX** DOM statiques (grep confirmé sur `pctac2.html` ET `pctac/index.html`, 0 occurrence) ; aucun déclencheur UI ni injection runtime — code mort déjà présent dans la source, même statut que l'item #11. `window.setPaxMode('free')` vérifié fonctionnel via la façade |
| 7 | Main Courante : tri par heure | VERT | E2E | `Main Courante — ajout, tri, édition, suppression d'entrée` (étape « tri par heure ») : entrée 08:00 insérée après une entrée 10:00 apparaît en premier |
| 8 | Main Courante : réordonnancement drag&drop (souris + tactile) | VERT | E2E (`locator.dragTo()`, vraie séquence HTML5 DnD) | `Main Courante — réordonnancement du journal par glisser-déposer` : glisser la 2e ligne au-dessus de la 1re inverse l'ordre, persistant après `page.reload()` |
| 9 | Main Courante : autosuggestion lieu (historique) | VERT | E2E | `Main Courante — autosuggestion de lieu (historique)` : lieu saisi retrouvé dans `#lieu_suggestions option` après effacement du champ |
| 10 | Main Courante : édition / suppression entrée | VERT | E2E | `Main Courante — ajout, tri, édition, suppression d'entrée` (étapes « édition d'une entrée existante » et « suppression d'une entrée ») |
| 11 | Main Courante : recherche/filtre | NON-RÉGRESSION | E2E + grep source | `Main Courante — recherche/filtre journal (dépendance connue…)` : `#search_container`/`#searchInput`/`#addLogBtn` référencés par `UI.toggleSearchMode/filterLogs` (`ui.js:701-719`) **n'existent dans AUCUN DOM statique**, ni l'ORIGINAL ni le porté — code déjà mort dans la source avant le portage |
| 12 | Adversaires/Otages/Amis : CRUD fiche + photo + couleur + suppression | VERT | E2E (3 tests dédiés) | `Adversaires — CRUD fiche (nom, statut, notes) + suppression`, `Otages — CRUD fiche (nom, état/blessures) + suppression`, `Amis — CRUD (nom, unité, TPH, mission) + suppression` : création via formulaire + suppression pour les 3 collections |
| 13 | Photos : upload + compression + catégorisation + titre + lightbox + filtre persistant | VERT (nuance compression) | E2E + unitaire | `Photos — upload (input file), catégorisation, titre, lightbox, filtre` : upload `setInputFiles` + catégorie + titre + lightbox + filtre persistant après reload, tous vérifiés en E2E. `Utils.compressImage` (chemin interne, pas observable en dataURL depuis l'E2E) testé séparément (`tests/unit/pctac/pc-storage.test.ts`, describe « Utils — compressImage », vert) |
| 14 | Plan : recherche adresse/GPS (Nominatim) | VERT | E2E | `Plan — recherche adresse / coordonnées GPS (Nominatim)` : saisie de coordonnées GPS, `#plan_search_results` non vide |
| 15 | Plan : plein écran | NON COUVERT (assumé, voir §2) | REVUE DE CODE | Présence structurelle de `#plan_btn_fullscreen` vérifiée (`Plan — initialisation carte + toolbar unifiée`) ; Fullscreen API notoirement peu fiable en Chromium headless, pas de test comportemental dédié — assumé explicitement |
| 16 | Plan : bascule 2D/3D relief | VERT | E2E (`window.PlanMap.is3D`) | `Plan — bascule 2D/3D relief (#plan_btn_3d)` : `is3D` passe `false→true` puis `true→false` sur deux clics successifs (état interne fiable en headless, indépendant du rendu WebGL) |
| 17 | Plan : capture haute qualité PNG (`captureToDataUrl`) | VERT | E2E | `Plan — capture haute qualité (captureToDataUrl → dataUrl non vide)` : `window.PlanMap.captureToDataUrl()` retourne un `data:image/…` de longueur > 100 |
| 18 | Plan : ping (entité existante OU point libre, 5 catégories OTAN, choix d'icône) | VERT (nuance) | E2E | `Plan — ping : entité existante et point libre` : roue de création (`.plan-wheel`) ouverte, segment couleur (« Oscar ») pose directement un ping (2 `maplibregl.Marker`). Flux « point libre » couvert (3 catégories OTAN au total exercées à travers les tests Plan : Oscar, Inconnu, Inter) ; le rattachement à une **entité existante** via le catalogue d'icônes filtrable n'est pas exercé isolément en E2E — couvert par `tests/unit/pctac/pm-wheels.test.ts`/`pm-pins.test.ts` |
| 19 | Plan : dessin trait/rectangle/cercle/texte, 5 couleurs, undo/redo, effacer tout | VERT (nuance) | E2E (état persistant `localStorage`) | `Plan — dessin (trait/rectangle/cercle/texte) + couleurs + undo/redo + effacer` : les 5 boutons d'outil sont vérifiés visibles, l'outil rectangle est tracé (desktop : glisser direct ; mobile ≤768px : flux réticule Viser/Valider, cf. mise à jour reprise 2 en tête de document) et l'effet est vérifié sur `localStorage.pcTacPlanShapes` (1 après tracé, 0 après Ctrl+Z, 1 après Ctrl+Y, 0 après « Effacer »). Trait/cercle/texte : bouton présent et sélectionnable, tracé effectif non ré-exercé séparément (même mécanique `_handleDrawDown/Up` que rectangle, revue de code) |
| 20 | Plan : mesure distance/azimut | VERT | E2E | `Plan — mesure de distance / azimut` : deux clics sur la carte affichent un `.plan-measure-label` |
| 21 | Plan : verrou global + verrou par-annotation | VERT | E2E | `Plan — verrouillage global et par-annotation` : `#plan_draw_lock` bascule l'icône sur `lock` ; après pose d'un ping via la roue puis segment « Verrouiller », `.plan-lock-badge` affiche `lock` sur le marqueur |
| 22 | Plan : diamètres cercle affichables/masquables | VERT (nuance) | E2E | `Plan — diamètres cercle, overlay noms de rues` : le toggle `#plan_draw_diameter_toggle` est cliqué sans erreur ; le rendu effectif d'un label de diamètre sous un cercle tracé n'est pas ré-asserté séparément dans ce test (mécanique commune à `_renderLiveDiameter`, testée unitairement dans `tests/unit/pctac/pm-drawtools.test.ts`) |
| 23 | Plan : overlay noms de rues togglable | VERT | E2E | `Plan — diamètres cercle, overlay noms de rues` : `#plan_btn_labels` acquiert la classe `.active` après clic |
| 24 | Plan : AOI hors-ligne (cadrage, quota, téléchargement, retry) | VERT pour l'armement ; REVUE DE CODE pour le reste | E2E (armement) + revue | `Plan — zone hors-ligne (AOI) : armement du cadrage` : `#plan_btn_aoi` acquiert `.active`. Le flux complet (estimation tuiles, `storage.estimate()`, téléchargement avec backoff/retry, barre de progression annulable) reste HORS PÉRIMÈTRE E2E (vrai téléchargement réseau) — testé unitairement dans `tests/unit/pctac/pm-aoi.test.ts` (vert) |
| 25 | Plan : copier coordonnées (WGS84/DMS/MGRS) presse-papier | VERT | E2E (permissions clipboard accordées, chromium uniquement) | `Plan — copier coordonnées (WGS84/DMS/MGRS) via presse-papier` : pose d'un ping via la roue, segment « Copier coords » de la roue d'options rouverte automatiquement, `navigator.clipboard.readText()` non vide. Conversions elles-mêmes testées unitairement avec valeurs de référence croisées (`tests/unit/coords.test.ts`, vert) |
| 26 | Plan : légende repliable (statuts géoloc live) | VERT | E2E | `Plan — légende repliable (élément <details> natif)` : `<details id="plan_legend">` cliquable nativement via `<summary>`, indépendant de `#plan_btn_draw` |
| 27 | Plan : géoloc équipe live (Tchap) — panneau, connexion ProConnect/token, liste opérateurs, suivi, trace, reprise offline | VERT pour le panneau ; REVUE DE CODE pour la connexion réelle | E2E (ouverture panneau) + revue | `Plan — géoloc équipe live (Tchap) : panneau et bascule token/ProConnect` : `#tl_toggle` rend `#tl_panel` visible. **Connexion réelle (OAuth device-code RFC 8628 ou token manuel) explicitement HORS PÉRIMÈTRE E2E** (annotation `hors-e2e` du test elle-même, nécessite un vrai compte ProConnect / homeserver Tchap réel) — vérifiée par revue de code ciblée : `src/apps/pctac/tchap-live.ts` expose `{startManual, startOidc, stop, wireUI}`, s'auto-câble sur `DOMContentLoaded` comme l'original, testée unitairement (`tests/unit/pctac/pc-tchaplive.test.ts`, vert) |
| 28 | Liens : liens externes statiques (Google Maps, Google Earth, Tchap, WhatsApp) | VERT | E2E structurel | `Liens — liens externes statiques (Google Maps/Earth, Tchap, WhatsApp)` : 4/4 liens, `href` + `target="_blank"` conformes |
| 29 | Dock : export archive `.pctac.zip` | VERT | E2E (`page.waitForEvent('download')`) | `Dock global — export/import archive, import OI, thème, plein écran, PDF, reset` (étape « export archive .pctac.zip déclenche un téléchargement ») : téléchargement déclenché, nom de fichier `.zip` |
| 30 | Dock : import archive `.pctac.zip` (+ legacy `.json`) | VERT pour `.pctac.zip` ; NON COUVERT pour le legacy `.json` (gap noté) | E2E (fixture réaliste `jszip`) | `Dock — import archive .pctac.zip (checklist item #30)` : fixture `.pctac.zip` (manifest.json + data.json) injectée via `page.setInputFiles`, entrée de journal importée retrouvée dans `#logTable`. Le chemin legacy `Archive.importFile` → `_importLegacyJson` (`archive.ts:206-211`, fichier `.json` brut) n'a NI test E2E NI test unitaire dédié dans cette passe — gap réel, à couvrir dans une prochaine passe |
| 31 | Dock : passerelle import OI → PC-Tac (`.oi.zip`) | NON COUVERT (assumé, voir §2) | — | Dépend de l'app OI (Phase 3, non portée) pour produire un `.oi.zip` réel ; `Archive.importOiArchive` couvert unitairement (`tests/unit/pctac/pc-archive.test.ts`) |
| 32 | Dock : bascule thème clair/sombre | VERT | E2E | `Dock global — export/import archive, import OI, thème, plein écran, PDF, reset` (étape « bascule thème clair/sombre ») : `body.dark-mode` retiré après clic sur `#darkModeToggle` |
| 33 | Dock : plein écran | NON COUVERT (assumé, voir §2) | — | Doublon fonctionnel avec item 15 (même `toggleFullscreen`) ; présence structurelle de `#fullscreenToggle` vérifiée, pas retesté séparément |
| 34 | Dock : génération/téléchargement PDF | VERT | E2E (`page.waitForEvent('download')`) | `Dock global — …` (étape « génération PDF déclenche un téléchargement ») : téléchargement déclenché, nom de fichier `.pdf` |
| 35 | Dock : réinitialisation totale (confirmation + purge) | VERT | E2E | `Dock global — …` (étape « réinitialisation totale ») : `#resetModal` visible après clic, confirmation purge `#logTable` (0 ligne) |
| 36 | Dock : transfert par QR code | HORS-PORTAGE | Grep DOM + décision explicite | `Dock global — …` (étape « transfert par QR — EXCLU DU PORTAGE ») : `qrSync.js` exclu du portage (décision Phase 1). Aucun élément `id*="qr"` dans `pctac/index.html` porté — écart volontaire, pas une régression |
| 37 | Tuto interactif pas-à-pas (bouton injecté dans le dock) | VERT | E2E | `Tuto interactif — bouton injecté dans le dock + ouverture` : `.ptuto-dock` visible dans `#dockMenu`, clic ouvre un élément `[class*="ptuto"]` |
| 38 | Persistance : localStorage relu et ré-affiché après rechargement | VERT | E2E (seed direct localStorage + reload) | `Persistance — les données en localStorage sont ré-affichées après rechargement` : journal ET adversaires seedés directement en localStorage sont ré-affichés après `page.reload()` |
| 39 | Persistance : clés localStorage/IndexedDB inchangées | VERT (statique) | Revue de code | `src/apps/pctac/config.ts` déclare les mêmes clés (`pcTacLogData`, `pcTacAdversaries`, etc., cf. `docs/recon-pctac.md` §5) que l'original — vérifié par lecture directe, cohérent avec le protocole zéro régression §5 |
| 40 | PWA : installable, service worker offline-first | HORS-PHASE (P4.A) | E2E (manifest) + revue plan | `docs/PLAN.md` §6 place le SW/précache en **P4.A**, pas en Phase 2. Test E2E vérifie seulement la présence du `<link rel="manifest">` (vert) et de l'API `serviceWorker` du navigateur (vert) — aucun SW n'est enregistré côté TacSuite à ce stade (`public/` ne contient aucun `sw.js`), ce qui est CONFORME au plan, pas une régression |

## 2. Items non couverts par un test E2E dédié (état initial P2.E1 — historique)

Liste telle qu'établie au gate P2.E1 initial. **Mise à jour reprise 1** :
#8, #16, #26 et #30 sont désormais **COUVERTS** (voir note en tête de
document) ; seuls #15/#33 et #31 restent des trous assumés.

- ~~**#8 Drag&drop du journal**~~ — **COUVERT (reprise 1)** :
  `tests/e2e/pctac.spec.ts`, test « Main Courante — réordonnancement du
  journal par glisser-déposer », via `locator.dragTo()` (vraie séquence HTML5
  DnD dragstart/dragover/drop), avec vérification de la persistance après
  rechargement.
- **#15/#33 Plein écran** (Plan et Dock, même fonction `toggleFullscreen`) :
  la Fullscreen API est notoirement peu fiable en Chromium headless
  (nécessite un geste utilisateur "trusted" que Playwright simule
  correctement en théorie, mais non testé ici par prudence). **Reste NON
  COUVERT**, assumé explicitement (revue de code tracée dans le tableau §1).
- ~~**#16 Bascule 2D/3D relief**~~ — **COUVERT (reprise 1)** :
  `tests/e2e/pctac.spec.ts`, test « Plan — bascule 2D/3D relief
  (#plan_btn_3d) », vérifie `window.PlanMap.is3D` avant/après clic (état
  interne fiable en headless, indépendant du rendu WebGL réel).
- ~~**#30 Import d'archive `.pctac.zip`**~~ — **COUVERT (reprise 1)** :
  `tests/e2e/pctac.spec.ts`, test « Dock — import archive .pctac.zip
  (checklist item #30) », fixture `.pctac.zip` construite avec `jszip`
  (manifest.json + data.json), injectée via `page.setInputFiles`.
- **#31 Passerelle `.oi.zip`** : **reste NON COUVERT**, différé en Phase 3
  comme prévu — dépend de l'app OI (non portée) pour produire un `.oi.zip`
  réel ; `Archive.importOiArchive` est déjà couvert unitairement
  (`tests/unit/pctac/pc-archive.test.ts`).
- ~~**#26 Légende repliable isolée**~~ — **COUVERT (reprise 1)**, voir note en
  tête de document.

Aucun de ces items n'est un signe de régression constatée : ce sont des trous
de couverture E2E assumés (ou désormais comblés), listés pour transparence
vis-à-vis du critère d'acceptation §9.2 du plan ("Checklists fonctionnelles...
100% vérifiées en E2E").

**Mise à jour reprise 2** : à l'occasion du durcissement de l'assertion du
test « Plan — dessin » (voir tête de document), un trou de couverture
supplémentaire, non signalé jusqu'ici, a été identifié : le sous-item
« import legacy `.json` » de **#30** (`Archive.importFile` →
`_importLegacyJson`, `archive.ts:206-211`) n'a NI test E2E NI test unitaire
dédié — seul le sous-item `.pctac.zip` de #30 est couvert (E2E, reprise 1).
Assumé explicitement ici, comme #15/#33/#31 ; à couvrir dans une prochaine
passe.

## 3. Comparaison visuelle (RÉÉCRIT — P2.FIX reprise 2, 2026-08-01)

Outil : `tests/visual/compare.mjs pctac` (réutilisable Phase 3 pour l'OI,
`node tests/visual/compare.mjs oi`). Capture les 10 états PC-Tac de
`tests/visual/README.md` sur 9678, masque le rectangle fixe du bouton BETA
(`docs/DECISIONS-DOM-ECARTS.md`) + le canvas MapLibre (mesuré en direct côté
porté) sur LES DEUX images (baseline 9679 figée + capture 9678 fraîche),
diff pixelmatch, seuil 0,1 %.

**Résultat AVANT P2.D (run historique, conservé pour trace — voir §0)** :
10/10 états en échec (7 FAIL mesurés + 3 ERROR ni mesurables), toutes causes
consolidées dans la cause racine unique du §0 (aucune vue ne bascule au
clic). Détail intégral de ce run conservé dans l'historique git de ce
document ; non reproduit ici pour ne pas laisser croire qu'il s'agit de
l'état courant.

**Résultat courant (run du 2026-08-01, après R1/R2/R3/R4/R5 de cette
reprise), `node tests/visual/compare.mjs pctac`** :

| État | Desktop | Mobile |
|---|---:|---:|
| `initial-main-courante` | 0,018 % **PASS** | 0,067-0,081 % **PASS** |
| `tab-adversaires` | 0,012 % **PASS** | 0,043 % **PASS** |
| `tab-otages` | 0,012 % **PASS** | 0,042 % **PASS** |
| `tab-amis` | 0,012 % **PASS** | 0,042 % **PASS** |
| `tab-photos` | 0,011 % **PASS** | 0,041 % **PASS** |
| `tab-plan` | 0,018 % **PASS** | 0,062 % **PASS** |
| `tab-liens` | 0,021 % **PASS** | 0,072 % **PASS** |
| `tab-plan-panneau-recherche` | 0,018 % **PASS** | 0,062 % **PASS** |
| `tab-plan-dock-dessin` | 0,022 % **PASS** | 0,059 % **PASS** |
| `tab-plan-panneau-tchap-live` | 0,016 % **PASS** | 0,062 % **PASS** |

**20/20 états sous le seuil de 0,1 %** (2 viewports × 10 états), code de
sortie `0`. Stable sur re-runs répétés (`tab-plan-panneau-tchap-live-mobile`,
le dernier résidu identifié par le gate à corriger : 204 px / 0,062 %,
inchangé sur 2 runs consécutifs — voir R1 en tête de document pour le
correctif du masque d'en-tête scroll-aware qui débloque cet état). La légère
variation `initial-main-courante-mobile` (0,067 % à 0,081 % observée entre
deux runs) reste très en-deçà du seuil et correspond au même bruit
diffus/antialiasing déjà documenté pour les autres états — pas un signal de
régression.

## 4. Chiffres

- Tests E2E : 30 tests × 2 projets = **60/60 verts** (`npx playwright test
  tests/e2e/pctac.spec.ts`, ~18-19 s, `chromium-desktop` + `chromium-mobile`).
  Stable sur re-runs consécutifs.
- Tests unitaires : **838/838 verts** (`npx vitest run`, 33 fichiers — 838 et
  non 839 : `tests/unit/pctac/_scratch.test.ts`, fichier de debug non suivi
  par git, a été supprimé en R4 de cette reprise ; le total est désormais
  reproductible sur un clone frais).
- `tsc --noEmit` : 0 erreur (inclut `tests/e2e/pctac.spec.ts` et
  `tests/visual/compare.mjs` — ce dernier est du JS pur, non typé par tsc,
  vérifié seulement à l'exécution).
- Comparaison visuelle : **20/20 états PC-Tac sous le seuil de 0,1 %**, code
  de sortie 0, détail §3.
- `git status --porcelain` : vide (worktree propre, R4 de cette reprise).
