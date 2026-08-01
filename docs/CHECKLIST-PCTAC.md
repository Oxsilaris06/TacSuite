# Checklist fonctionnelle PC-Tac — P2.E1

Source des critères : `docs/recon-pctac.md` §6 (checklist fonctionnelle de
non-régression). Statuts vérifiés le 2026-08-01 contre
`http://127.0.0.1:9678/pctac/` (TacSuite dev) via
`tests/e2e/pctac.spec.ts` (26 tests, `npx playwright test tests/e2e/pctac.spec.ts
--project=chromium-desktop`) et via revue de code ciblée pour les items
infaisables en E2E.

## 0. Constat bloquant — À LIRE AVANT LE TABLEAU

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

## 1. Tableau — checklist §6 point par point

Légende statuts : **VERT** (E2E vert) · **BLOQUÉ (P2.D)** (rouge, cause
racine unique décrite en §0) · **HORS-PORTAGE** (exclusion actée) ·
**HORS-PHASE** (livrable d'une phase ultérieure) · **NON-RÉGRESSION** (déjà
non fonctionnel dans l'ORIGINAL, donc pas un défaut du portage) ·
**REVUE DE CODE** (infaisable en E2E, vérifié autrement) · **NON COUVERT**
(aucun test dédié dans cette passe).

| # | Item (recon-pctac.md §6) | Statut | Test / méthode | Résultat |
|---|---|---|---|---|
| 1 | Navigation : 7 onglets présents, libellés corrects | VERT | E2E structurel | `Navigation — structure des 7 onglets…` (étape 1) : les 7 `.tab-btn[data-view]` + 7 `#view-*` existent, libellés conformes |
| 2 | Navigation : clic onglet → bascule de vue | BLOQUÉ (P2.D) | E2E comportemental | 6/6 onglets non-défaut : la classe `.active` ne bascule jamais (DOM figé) |
| 3 | Navigation : clavier flèches (a11y `makeTablist`) | BLOQUÉ (P2.D) | E2E | `makeTablist` (ui-platform.ts, 100% testé unitairement) jamais invoqué par `main.ts` |
| 4 | Navigation : dernier onglet restauré au reload | BLOQUÉ (P2.D) | E2E | Dépend du point 2 (bascule initiale déjà bloquée) — non isolable tant que 2 n'est pas résolu |
| 5 | Main Courante : ajout entrée (PAX standard + couleur) | BLOQUÉ (P2.D) | E2E | Formulaire visible (vue par défaut) mais `submit` sans effet (aucun listener) |
| 6 | Main Courante : mode PAX libre + couleur perso | BLOQUÉ (P2.D) + NON CONFIRMÉ | E2E + revue | `.mode-toggle-btn`/wrappers libres injectés au runtime par `UI.init` (`ui.js:122-137`), jamais exécuté ici ; **sélecteur non confirmé en pratique**, à revalider une fois P2.D fait |
| 7 | Main Courante : tri par heure | BLOQUÉ (P2.D) | E2E | Dépend de l'ajout (point 5) |
| 8 | Main Courante : réordonnancement drag&drop (souris + tactile) | REVUE DE CODE (OK) + BLOQUÉ (P2.D) pour l'E2E | Revue de `src/apps/pctac/ui.ts:310-340` vs `modules/pctac/ui.js:253-284` | Logique `dragstart/dragover/drop/dragend` portée à l'identique (mêmes listeners, même commentaire sur le bug historique corrigé) ; **non atteignable par clic/drag E2E réel tant que P2.D n'est pas fait** — pas de test E2E dédié au drag lui-même dans cette passe (voir §2) |
| 9 | Main Courante : autosuggestion lieu (historique) | BLOQUÉ (P2.D) | E2E | `#lieu_suggestions` reste vide (0 `<option>`) |
| 10 | Main Courante : édition / suppression entrée | BLOQUÉ (P2.D) | E2E | Dépend de l'ajout (point 5) ; boutons `onclick="window.openEditModal(...)"`/`window.deleteLogEntry(...)` jamais définis |
| 11 | Main Courante : recherche/filtre | NON-RÉGRESSION | E2E + grep source | `#search_container`/`#searchInput`/`#addLogBtn` référencés par `UI.toggleSearchMode/filterLogs` (`ui.js:701-719`) **n'existent dans AUCUN DOM statique, ni l'ORIGINAL ni le porté**, et aucun élément n'invoque `toggleSearchMode()` dans `pctac2.html` — code déjà mort dans la source avant le portage. Test vert (`#search_container` absent des deux côtés, comme attendu) |
| 12 | Adversaires/Otages/Amis : CRUD fiche + photo + couleur + suppression | BLOQUÉ (P2.D) | E2E (3 tests dédiés) | Vue non atteignable (display:none), formulaire non soumis |
| 13 | Photos : upload + compression + catégorisation + titre + lightbox + filtre persistant | BLOQUÉ (P2.D) | E2E | Vue non atteignable ; `Utils.compressImage` (utils.ts, testé unitairement) jamais appelé |
| 14 | Plan : recherche adresse/GPS (Nominatim) | BLOQUÉ (P2.D) | E2E | `#plan_search_panel` ne s'ouvre jamais (`_toggleSearchPanel` jamais câblé) |
| 15 | Plan : plein écran | BLOQUÉ (P2.D) | REVUE DE CODE (logique présente) | `toggleFullscreen`/`updateFullscreenIcon` portés dans `ui.ts` ; pas de test E2E dédié (Fullscreen API peu fiable en headless CI) — voir §2 |
| 16 | Plan : bascule 2D/3D relief | BLOQUÉ (P2.D) | Non testé (voir §2) | `#plan_btn_3d` présent dans le DOM (test "toolbar unifiée"), pas de test comportemental dédié |
| 17 | Plan : capture haute qualité PNG (`captureToDataUrl`) | BLOQUÉ (P2.D) | E2E | `window.PlanMap` est `undefined` (module jamais monté) → `captureToDataUrl` inatteignable. Logique elle-même testée unitairement (`tests/unit/pctac/pm-capture.test.ts`, vert) |
| 18 | Plan : ping (entité existante OU point libre, 5 catégories OTAN, choix d'icône) | BLOQUÉ (P2.D) | E2E | `#pingModal` ne s'ouvre jamais |
| 19 | Plan : dessin trait/rectangle/cercle/texte, 5 couleurs, undo/redo, effacer tout | BLOQUÉ (P2.D) | E2E | `#plan_draw_dock` ne s'ouvre jamais |
| 20 | Plan : mesure distance/azimut | BLOQUÉ (P2.D) | E2E | Dépend de l'ouverture du dock dessin (point 19) |
| 21 | Plan : verrou global + verrou par-annotation | BLOQUÉ (P2.D) | E2E | `#plan_draw_lock` non cliquable (carte non initialisée / dock non ouvert) |
| 22 | Plan : diamètres cercle affichables/masquables | BLOQUÉ (P2.D) | E2E | Dépend de l'ouverture du dock dessin |
| 23 | Plan : overlay noms de rues togglable | BLOQUÉ (P2.D) | E2E | `#plan_btn_labels` clic sans effet observable |
| 24 | Plan : AOI hors-ligne (cadrage, quota, téléchargement, retry) | BLOQUÉ (P2.D) pour l'armement ; REVUE DE CODE pour le reste | E2E (armement) + revue | Armement du cadrage (`#plan_btn_aoi` → classe `.active`) bloqué. Le flux complet (estimation tuiles, `storage.estimate()`, téléchargement avec backoff/retry, barre de progression annulable) est HORS PÉRIMÈTRE E2E de toute façon (vrai téléchargement réseau de tuiles cartographiques) — vérifié par revue : logique présente et testée unitairement dans `tests/unit/pctac/pm-aoi.test.ts` (vert) |
| 25 | Plan : copier coordonnées (WGS84/DMS/MGRS) presse-papier | BLOQUÉ (P2.D) | E2E (permissions clipboard accordées) | Pin jamais placé (modale `#pingModal` inatteignable) → roue contextuelle et `_copyCoords` jamais atteints. Conversions elles-mêmes testées unitairement avec valeurs de référence croisées (`tests/unit/coords.test.ts`, vert) |
| 26 | Plan : légende repliable (statuts géoloc live) | BLOQUÉ (P2.D) | E2E | `<details id="plan_legend">` cliquable nativement (HTML natif, pas de JS requis) MAIS test resté rouge car englobé dans le même test que les diamètres/labels (dépendance `#plan_btn_draw`) — **à ISOLER dans un test dédié au prochain run, probablement VERT même sans câblage complet** (natif `<details>`) |
| 27 | Plan : géoloc équipe live (Tchap) — panneau, connexion ProConnect/token, liste opérateurs, suivi, trace, reprise offline | BLOQUÉ (P2.D) pour le panneau ; REVUE DE CODE pour la connexion réelle | E2E (ouverture panneau) + revue | `#tl_panel` inatteignable (module `tchap-live.ts` jamais importé). **Connexion réelle (OAuth device-code RFC 8628 ou token manuel) explicitement HORS PÉRIMÈTRE E2E** (nécessite un vrai compte ProConnect / homeserver Tchap réel) — vérifiée par revue de code ciblée : `src/apps/pctac/tchap-live.ts` (1277 LOC) expose `{startManual, startOidc, stop, wireUI}`, s'auto-câble sur `DOMContentLoaded` exactement comme l'original (`if (document.readyState==='loading') ... else wireUI()`, `tchapLive.js` même pattern), reprise auto après reload portée (`cfg.mode==='oidc' && cfg.oidc?.refreshToken` / `cfg.token`) — **logique fidèle à l'original, testée unitairement (`tests/unit/pctac/pc-tchaplive.test.ts`, vert)**. Note : PC-Tac n'utilise PAS `navigator.geolocation` (device GPS) — grep confirmé nul sur `modules/pctac/*.js` — donc pas d'item "géoloc matérielle" à proprement parler ici, uniquement la géoloc réseau Tchap |
| 28 | Liens : liens externes statiques (Google Maps, Google Earth, Tchap, WhatsApp) | VERT | E2E structurel | 4/4 liens : `href` + `target="_blank"` conformes, indépendant du câblage (ancre HTML pure) |
| 29 | Dock : export archive `.pctac.zip` | BLOQUÉ (P2.D) | E2E | `#exportJsonDockBtn` non cliquable (dock replié par défaut, `#dockToggleBtn` jamais câblé) |
| 30 | Dock : import archive `.pctac.zip` (+ legacy `.json`) | NON COUVERT (voir §2) | — | Pas de test E2E dédié à l'import dans cette passe (nécessite un fichier de test réaliste) ; `archive.ts` testé unitairement (`tests/unit/pctac/pc-archive.test.ts`, vert) |
| 31 | Dock : passerelle import OI → PC-Tac (`.oi.zip`) | NON COUVERT (voir §2) | — | Idem — dépend en plus de l'app OI (Phase 3, non portée) pour produire un `.oi.zip` réel |
| 32 | Dock : bascule thème clair/sombre | BLOQUÉ (P2.D) | E2E | `#darkModeToggle` non cliquable (dock replié) |
| 33 | Dock : plein écran | NON COUVERT (voir §2) | — | Doublon fonctionnel avec item 15 (même `toggleFullscreen`), pas retesté séparément |
| 34 | Dock : génération/téléchargement PDF | BLOQUÉ (P2.D) | E2E | `#previewPdfDockBtn` non cliquable. `pdf-export.ts` testé unitairement (`tests/unit/pctac/pc-pdfexport.test.ts`, vert) |
| 35 | Dock : réinitialisation totale (confirmation + purge) | BLOQUÉ (P2.D) | E2E | `#resetDataDockBtn` non cliquable |
| 36 | Dock : transfert par QR code | HORS-PORTAGE | Grep DOM + décision explicite | `qrSync.js` dans la liste du code mort exclu du portage (décision Phase 1, cf. contexte de mission). Aucun élément `id*="qr"` dans `pctac/index.html` porté — écart volontaire, pas une régression. Test vert (absence confirmée) |
| 37 | Tuto interactif pas-à-pas (bouton injecté dans le dock) | BLOQUÉ (P2.D) | E2E | `PocheTuto.mount({appId:'pctac',...})` jamais appelé (ni `tuto-data.ts` ni `tuto-engine.ts` importés par `main.ts`) → `.ptuto-dock` absent du DOM. Moteur et données testés unitairement (verts) |
| 38 | Persistance : localStorage relu et ré-affiché après rechargement | BLOQUÉ (P2.D) | E2E (seed direct localStorage + reload) | Journal et collections seedés directement en localStorage ne sont PAS ré-affichés après reload (`UI.renderLogTable`/`renderAdversaries` jamais appelés par `main.ts` au chargement) — confirme que même le chemin de LECTURE seule (indépendant des formulaires) est bloqué par l'absence de câblage, pas seulement l'écriture |
| 39 | Persistance : clés localStorage/IndexedDB inchangées | VERT (statique) | Revue de code | `src/apps/pctac/config.ts` déclare les mêmes clés (`pcTacLogData`, `pcTacAdversaries`, etc., cf. `docs/recon-pctac.md` §5) que l'original — vérifié par lecture directe, cohérent avec le protocole zéro régression §5 |
| 40 | PWA : installable, service worker offline-first | HORS-PHASE (P4.A) | E2E (manifest) + revue plan | `docs/PLAN.md` §6 place le SW/précache en **P4.A**, pas en Phase 2. Test E2E vérifie seulement la présence du `<link rel="manifest">` (vert) et de l'API `serviceWorker` du navigateur (vert) — aucun SW n'est enregistré côté TacSuite à ce stade (`public/` ne contient aucun `sw.js`), ce qui est CONFORME au plan, pas une régression |

## 2. Items non couverts par un test E2E dédié dans cette passe

À ajouter dans une itération suivante (idéalement juste après P2.D, en même
temps que le re-run du gate) :

- **#8 Drag&drop du journal** : simulation `mouse.down/move/up` fiable sur les
  lignes `<tr draggable="true">` — non tentée ici (complexité/fragilité
  headless), logique vérifiée par revue de code uniquement pour l'instant.
- **#15/#33 Plein écran** (Plan et Dock, même fonction `toggleFullscreen`) :
  la Fullscreen API est notoirement peu fiable en Chromium headless
  (nécessite un geste utilisateur "trusted" que Playwright simule
  correctement en théorie, mais non testé ici par prudence).
- **#16 Bascule 2D/3D relief** : bouton présent (`#plan_btn_3d`), bascule de
  pitch/relief MapLibre non vérifiée spécifiquement.
- **#30/#31 Import d'archive `.pctac.zip` et passerelle `.oi.zip`** :
  nécessitent un fichier `.zip` de test réaliste (structure
  `manifest.json + data.json + images/`) — non construit dans cette passe ;
  `archive.ts` est déjà couvert unitairement.
- **#26 Légende repliable isolée** : actuellement noyée dans le même test que
  diamètres/labels (dépend de `#plan_btn_draw`) ; `<details>` étant un
  élément HTML natif, un test isolé serait probablement déjà vert même sans
  câblage complet — à extraire.

Aucun de ces items n'est un signe de régression constatée : ce sont des trous
de couverture E2E assumés, listés pour transparence vis-à-vis du critère
d'acceptation §9.2 du plan ("Checklists fonctionnelles... 100% vérifiées en
E2E").

## 3. Comparaison visuelle (P2.E1 point 2)

Outil : `tests/visual/compare.mjs pctac` (réutilisable Phase 3 pour l'OI,
`node tests/visual/compare.mjs oi`). Capture les 10 états PC-Tac de
`tests/visual/README.md` sur 9678, masque le rectangle fixe du bouton BETA
(`docs/DECISIONS-DOM-ECARTS.md`) + le canvas MapLibre (mesuré en direct côté
porté) sur LES DEUX images (baseline 9679 figée + capture 9678 fraîche),
diff pixelmatch, seuil 0,1 %.

Résultat détaillé (run du 2026-08-01, `node tests/visual/compare.mjs pctac`) :

| État | Desktop | Mobile |
|---|---:|---:|
| `initial-main-courante` | 0,808 % **FAIL** | 1,903 % **FAIL** |
| `tab-adversaires` | 6,979 % **FAIL** | 13,609 % **FAIL** |
| `tab-otages` | 6,939 % **FAIL** | 12,433 % **FAIL** |
| `tab-amis` | 5,770 % **FAIL** | 9,151 % **FAIL** |
| `tab-photos` | 5,855 % **FAIL** | 12,002 % **FAIL** |
| `tab-plan` | 50,924 % **FAIL** (canvas absent, non masqué) | 66,095 % **FAIL** (idem) |
| `tab-liens` | 9,210 % **FAIL** | 13,889 % **FAIL** |
| `tab-plan-panneau-recherche` | **ERROR** (clic `#plan_btn_search` : élément non visible, timeout) | **ERROR** (idem) |
| `tab-plan-dock-dessin` | **ERROR** (clic `#plan_btn_draw` : idem) | **ERROR** (idem) |
| `tab-plan-panneau-tchap-live` | **ERROR** (clic `#tl_toggle` : idem) | **ERROR** (idem) |

10/10 états en échec (7 FAIL mesurés + 3 ERROR ni mesurables). Cohérent avec
§0 : les états nécessitant une bascule de vue affichent tous, en capture, la
vue par défaut **Main Courante** au lieu de la vue attendue (clic sans
effet) → diffs très au-dessus du seuil de 0,1 %. `tab-plan` a en plus un
avertissement `WARN` : `canvas.maplibregl-canvas` introuvable côté porté (la
carte MapLibre n'est jamais montée, `PlanMap` n'étant jamais importé), donc le
masque carte n'a pas pu être appliqué — le diff carte est comptabilisé tel
quel (explique le pic à 51-66 %).

**`initial-main-courante` (0,808 % / 1,903 %) mérite d'être noté séparément** :
c'est le SEUL état qui ne requiert AUCUN clic (vue par défaut, `.active` déjà
figée dans le DOM statique) et il échoue quand même, légèrement au-dessus du
seuil. Inspection du PNG de diff
(`tests/visual/diffs/pctac/initial-main-courante-desktop.diff.png`) : la
totalité du delta se concentre sur le bouton PAX « Adversaire » — surligné
(classe `.selected`, fond coloré) sur la baseline ORIGINALE, pas surligné sur
le porté. Cause : ce surlignage par défaut est posé par
`UI.initPaxModeAndColors()` (`ui.js:138-172`, port fidèle dans `ui.ts`) au
chargement, JAMAIS appelé puisque `main.ts` n'invoque aucun module — **même
cause racine que §0**, pas une régression visuelle distincte (pas de
divergence de police/CSS constatée par ailleurs sur cet état). À revalider une
fois P2.D fait : ce diff devrait alors retomber sous le seuil.

## 4. Chiffres

- Tests E2E : 26 au total, **3 verts / 23 rouges** (chromium-desktop,
  `npx playwright test tests/e2e/pctac.spec.ts --project=chromium-desktop`,
  ~24 s).
- Tests unitaires (Vitest, non refaits ici, rappel de contexte) : 839/839
  verts (`npm test`).
- `tsc --noEmit` : 0 erreur (inclut `tests/e2e/pctac.spec.ts` et
  `tests/visual/compare.mjs` — ce dernier est du JS pur, non typé par tsc,
  vérifié seulement à l'exécution).
- Comparaison visuelle : 10/10 états PC-Tac en échec (seuil 0,1 %), détail §3.
