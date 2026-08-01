# Checklist fonctionnelle OI — P3B.E

Source des critères : `docs/recon-oi.md` §9 (« Checklist fonctionnelle de
non-régression — Générateur d'OI »). Statuts vérifiés le 2026-08-01 contre
`http://127.0.0.1:9678/oi/` (TacSuite dev) via `tests/e2e/oi.spec.ts`
(35 tests, déposé depuis `.tacsuite-prep/draft-oi.spec.ts` puis relu/ajusté
post-câblage P3B.C — les 9 `TODO-CABLAGE` du brouillon résolus par lecture
directe du code câblé réel, cf. en-tête du fichier) et par certification PDF
structurelle / comparaison visuelle pour les items non exprimables en simple
assertion DOM.

## Run de référence (2026-08-01, mise à jour P3B.FIX reprise 2)

Cette section a été réécrite : la version précédente décrivait un protocole
(`--workers=2` manuel, `actionTimeout`/`expect.timeout` 2000ms) périmé depuis
les commits `b498e8b` (BLOQUANT R2 — `workers` figé à `1` **dans**
`playwright.config.ts`, plus besoin de flag manuel) et `3b1cc30` (timeouts
relevés à 3000ms) — et affirmait un `compare.mjs oi` **18/18 PASS** non
reproductible en l'état (non-déterminisme identifié et corrigé en reprise 2,
voir plus bas).

- **E2E** : `npx playwright test tests/e2e/oi.spec.ts` (35 tests ×
  2 projets `chromium-desktop`/`chromium-mobile` = 70 exécutions), commande
  **sans flag** — `playwright.config.ts` fixe désormais lui-même
  `workers: 1` et `expect.timeout`/`actionTimeout: 3000ms` (cf. commits
  ci-dessus) : **70/70 verts sur 3 exécutions consécutives** de cette
  commande par défaut (2min12, 2min18, 2min24). Aucun flake observé sur ces
  3 runs.
- **PDF** : recette `.tacsuite-prep/oi-reference/recipe.md` rejouée SANS le
  contournement du bug reload/flush (`.tacsuite-prep/replay-recipe-ported.mjs`,
  variante de `replay-recipe.mjs` sans interception de
  `Storage.prototype.setItem`) contre l'app PORTÉE — **succès sans
  contournement**, confirmant le bug corrigé côté portage (aucun écrasement
  de `tactical_oi_data` observé). `node compare-pdf.mjs oi-reference/reference.pdf
  oi-portage-run/candidate-ported.pdf --fingerprint oi-reference/fingerprint.md` :
  **VERDICT PASS** (exit 0), 14/14 pages, **0,00 % de diff pixel sur les
  14 pages**, **100 % de concordance OCR** titre/fingerprint. (Item non
  retouché par la reprise 2 — reporté tel quel depuis la version précédente
  de cette section.)
- **Visuel** : `node tests/visual/compare.mjs oi` : **18/18 PASS**
  (0,011-0,060 %, seuil 0,1 %). **Correctif reprise 2** : `cartography-modal-desktop`
  était NON DÉTERMINISTE (mesuré ~1 échec sur 4, alternant 332px/8036px selon
  que les tuiles MapLibre étaient chargées ou non au moment de la capture —
  cf. `tests/visual/README.md` § « Chrome au-dessus du canvas plein écran »
  pour le détail complet et la root cause) ; corrigé par démasquage PAR
  BOUTON (au lieu d'un rectangle englobant la toolbar) + attente explicite de
  l'état `idle` de la carte OI avant capture. Revérifié **8 exécutions
  consécutives à exit 0**, `cartography-modal-desktop` identique au pixel
  près (220px/0,017 %) à chaque run — plus aucune non-déterminisme observée.
  Baselines mode clair intégrées (`tests/visual/baseline/oi-light/`, depuis
  `.tacsuite-prep/oi-baseline-light/`) : `node tests/visual/compare.mjs
  oi-light` : **18/18 PASS** (0,012-0,052 %). Non-régression confirmée sur le
  gate existant : `node tests/visual/compare.mjs pctac` toujours **20/20
  PASS** (0,000-0,072 %, le correctif de masque `cartography-modal` est
  scopé à la clé `oi` de `APP_CONFIG`, sans effet sur `pctac`).

Légende statuts : **VERT** (E2E vert) · **PARTIEL** (couvert en partie,
nuance dans la colonne Résultat) · **NON COUVERT** (aucun test dédié, assumé
explicitement) · **REVUE DE CODE** (vérifié par lecture du code câblé, pas
par assertion E2E) · **HORS-SCOPE E2E** (testé unitairement ou nécessitant un
canal hors Playwright).

## Tableau — checklist §9 point par point

| # | Item (recon-oi.md §9) | Statut | Test / méthode | Résultat |
|---|---|---|---|---|
| 1 | Navigation : 8 étapes via puces cliquables + Précédent/Suivant | VERT | E2E | `Navigation — 8 étapes accessibles…` : 8 `.wizard-progress-step`/`.wizard-step` présents, chaque puce active l'étape correspondante, `#nextBtn`/`#prevBtn` avancent/reculent, masqués aux bornes (0 et dernière étape) |
| 2 | Navigation : étape et étapes visitées persistées (`oiWizardStep`/`oiVisitedSteps`), restaurées au rechargement | VERT | E2E | `Navigation — étape et étapes visitées persistées après rechargement…` |
| 3 | Navigation : contrôle de cohérence auto à la dernière étape | VERT | E2E | `Navigation — contrôle de cohérence déclenché automatiquement…` : `#coherence_alerts_container` peuplé en atteignant l'étape 8 |
| 4 | Étape 1 Situation : date_op, situation_generale, situation_particuliere (saisie + persistance) | VERT | E2E | `Étapes 1/3/4 — Situation/Environnement/Mission…` : 3 champs saisis, valeur relue après `page.reload()` |
| 5 | Étape 2 Adversaires : ajout/suppression fiche, titre dynamique, section collapsible, Moyens Employés max 3 | VERT | E2E | `Adversaires — création, titre dynamique, section collapsible, moyens employés (max 3), suppression` : `#createAdversaryBtn` → fiche créée, `updateAdvTitle` réactif à la saisie du nom, `.adv-section-toggle` bascule `aria-expanded`, 4 clics sur « Moyen employé » plafonnés à 3 `.me-input`, suppression via `.remove-btn[title="Supprimer cet adversaire"]` (confirm natif auto-accepté) → 0 fiche restante. Sélecteur de suppression résolu (`formulaires.ts:430`), ex-TODO-CABLAGE du brouillon |
| 6 | Étape 2 : photos (upload/compression/annotation) | PARTIEL | E2E indirect | Non testé directement à l'étape 2 (mêmes inputs que l'étape 5, structurellement identiques dans `medias.ts`) ; couvert indirectement par le test « Annotation photo » (étape 5) et par le rejeu recette PDF (upload `J.png` réel, compression + IndexedDB + preview vérifiés) |
| 7 | Étape 3 Environnement : 8 champs texte + photos cheminement transport (PR/domicile) | VERT (champs texte) ; PARTIEL (photos, cf. #6) | E2E | `Étapes 1/3/4 — …` couvre les champs texte ; photos cheminement exercées par la recette PDF (`#photo_container_transport_pr_input`) |
| 8 | Étape 4 Mission : `missions_psig` (texte pré-rempli modifiable) | VERT | E2E | `Étapes 1/3/4 — …` |
| 9 | Étape 5 Exécution : date/heure H, chronologie (ajout/suppression T0-T4), hypothèses (ajout/suppression), photos | VERT | E2E | `Exécution — chronologie (ajout/suppression), hypothèses (ajout/suppression), photos cheminement` |
| 10 | Étape 6 Articulation : 3 listes réordonnables (souris + tactile), blocs MOICP/ZMSPCP/Effraction, sync PATRACDVR | VERT (souris) ; NON COUVERT (tactile) | E2E | `Articulation — blocs MOICP/ZMSPCP/Effraction (création manuelle) + suppression` + `Articulation — rame VL réordonnable par glisser-déposer SOURIS…`. Tactile non testé : `chromium-mobile` (`playwright.config.ts`) n'active pas `hasTouch:true` — ajouter un 3e projet dédié serait nécessaire, non fait dans cette passe (assumé, cf. §2) |
| 11 | Étape 7 PATRACDVR : création VL/PAX manuels, cellule en lot, plafonds India(5)/AO(8) | VERT | E2E | `PATRACDVR — création VL/PAX manuels (prompt), cellule en lot, plafonds India(5)/AO(8)` : séparateurs virgule/espace/point-virgule confirmés interchangeables (`patrac.ts:286-297`), ex-TODO-CABLAGE résolu |
| 12 | Étape 7 : drag&drop souris ET tactile, confirmation de suppression | VERT (souris) ; NON COUVERT (tactile) | E2E | `PATRACDVR — drag&drop souris (non-affectés → véhicule → poubelle avec confirmation)` ; tactile non testé, même limite qu'item #10 |
| 13 | Étape 7 : panneau quick-edit (couplage cellule↔fonction) | VERT | E2E | `PATRACDVR — panneau quick-edit (sélection PAX, couplage cellule↔fonction)` |
| 14 | Étape 7 : mode batch (sélection multiple, déplacement/désaffectation/effacement en lot) | VERT | E2E | `PATRACDVR — mode batch (sélection multiple, désaffectation en lot)` : geste de sélection confirmé — même listener `click` que hors mode batch, branche `if (_patracBatchMode)` redirige (`patrac.ts:663-676`), ex-TODO-CABLAGE résolu |
| 15 | Étape 7 : menu contextuel clic-droit (cloner/supprimer un membre) | VERT | E2E | `PATRACDVR — menu contextuel (cloner/supprimer un membre)` |
| 16 | Étape 7 : configuration d'unité (`uniteConfigModal` éditant `memberConfig`) | VERT | E2E | `PATRACDVR — configuration d'unité (uniteConfigModal édite memberConfig)` |
| 17 | Étape 7 : génération PDF PATRACDVR autonome (pdf-lib) | VERT (déclenchement) | E2E | `PATRACDVR — génération PDF autonome (pdf-lib) déclenche un téléchargement` : déclenchement + fichier non vide vérifiés, pas de comparaison structurelle dédiée (hors scope de ce test, le PDF principal OI l'est via `compare-pdf.mjs`) |
| 18 | Étape 7 : réinitialisation isolée du reste des données | VERT | E2E | `PATRACDVR — réinitialisation isolée du reste des données (resetPatracdvrUI, confirm natif)` |
| 19 | Étape 8 Finalisation : fond PDF perso, infos rédacteur, CAT, récapitulatif, alertes de cohérence | VERT | E2E | `Finalisation — fond PDF perso, rédacteur, CAT, alertes de cohérence` |
| 20 | Cartographie OI : ouverture/fermeture, toolbar | VERT | E2E | `Cartographie — ouverture/fermeture modale + toolbar 7 boutons` |
| 21 | Cartographie OI : pins (menu radial, catégories/icônes) | VERT (1 catégorie sur 5) | E2E | `Cartographie — pin générique (Rassemblement) et dessin (rectangle), persistance synchrone` : pin « Rassemblement » posé via `#oi_carto_btn_ping` → `#oi_carto_ping_modal` → clic carte, persisté dans `cartography.pins` (`localStorage`). Les 4 autres catégories (membres/cyno/rame VL/VL target) non exercées séparément — mécanique commune, pas retestée par catégorie (cohérent avec la nuance équivalente `pctac.spec.ts` item #18) |
| 22 | Cartographie OI : dessin (trait/rectangle/cercle, undo/redo, couleurs) | VERT (rectangle + undo/redo) | E2E | Même test que #21 : rectangle tracé (glisser souris), persisté dans `cartography.shapes`, `Ctrl+Z` le retire, `Ctrl+Y` le restitue. Trait/cercle et palette de couleurs non ré-exercés isolément (même mécanique de dessin, revue de code) |
| 23 | Cartographie OI : recherche adresse (Nominatim) | NON COUVERT | — | Aucun test dédié dans cette passe (risque de dépendance réseau/flakiness, cf. §2) — assumé explicitement, même famille de limite que `pctac.spec.ts` pour la recherche carto |
| 24 | Cartographie OI : capture (PNG ou export direct vers un champ photo) | NON COUVERT | — | Aucun test dédié — assumé explicitement (cf. §2) |
| 25 | Cartographie OI : persistance dans `formData.cartography` (export/import) | VERT | E2E | Couvert transitivement par #21/#22 (assertions directes sur `tactical_oi_data.cartography.{pins,shapes}`) |
| 26 | Annotation photo : 5 types (location/arrow/box/text/member) | PARTIEL (1 type sur 5) | E2E | `Annotation photo — ouverture depuis une vignette, outil + dessin + undo + validation` : type `box` exercé (dessin + undo + validation) ; `location`/`arrow`/`text`/`member` non exercés séparément (même moteur `AnnotationEngine`, revue de code) |
| 27 | Annotation photo : poignées (déplacement/redimensionnement/rotation), appui long mobile | NON COUVERT | — | Poignées non testées (interaction fine, fragile en E2E) ; appui long mobile nécessite un contexte tactile (`hasTouch:true`), même limite que #10/#12 — assumé explicitement |
| 28 | Annotation photo : undo/redo (Ctrl+Z/Y), cohérence rendu interactif/export | VERT (undo/redo) ; HORS-SCOPE E2E (cohérence export) | E2E + unitaire | Undo/redo couverts par le test #26 ; la cohérence pixel-perfect entre rendu interactif et rendu export (`drawAnnotationOnContext`) relève d'un test unitaire par hash (mandaté par `SPEC-OI-CONVERSION.md` §11.6), pas de l'E2E |
| 29 | Génération : aperçu HTML vivant (`openPresentationMode` → `openPreview`) | VERT | E2E | `Génération — aperçu HTML vivant (previewBtn → openPresentationMode → openPreview)` |
| 30 | Génération : téléchargement PDF (`downloadOiPdf`), format A4/16:9, nom `OI_<date>_<trigramme>.pdf` | VERT (déclenchement) ; PASS (structure) | E2E + `compare-pdf.mjs` | `Génération — téléchargement PDF déclenche un download (downloadOiPdf)` (déclenchement + nom de fichier) ; conformité structurelle complète (14 pages, contenu, ordre des sections) certifiée séparément par le run de référence PDF ci-dessus — **VERDICT PASS** |
| 31 | Génération : mode présentation plein écran autonome (nouvel onglet) | VERT | E2E | `Génération — mode présentation plein écran autonome (openPresentInPlace, nouvel onglet)` |
| 32 | Génération : bascule format A4/16:9 persistée (`pdfOutputFormat`) | VERT | E2E | `Génération — bascule format A4/16:9 persistée (pdfOutputFormat)` |
| 33 | Persistance : auto-sauvegarde débouncée + flush forcé (`pagehide`/`beforeunload`/`visibilitychange`) | VERT | E2E | `Persistance — auto-sauvegarde débouncée + flush forcé sur pagehide/visibilitychange` |
| 34 | Persistance : export session JSON (`exportSession`) / import (`importSession`) | VERT (import) ; REVUE DE CODE (absence de bouton dédié) | E2E + revue | Ni `exportSession` ni `importSession` n'ont de déclencheur UI dédié dans l'ORIGINAL (`sessionFileInput`/`jsonConfigInput` déclarés mais jamais écoutés, vérifié par grep négatif) — seul chemin réel : `.json` via `#archiveFileInput` → `importArchive()` délègue à `importSession`. Couvert par l'item #36 (import session survit au reload), pas par un bouton dédié inexistant |
| 35 | Persistance : export/import archive `.oi.zip`, sélection catégorielle, fusion non destructive | VERT | E2E | `Persistance — export archive .oi.zip déclenche un téléchargement…` + `Persistance — import archive .oi.zip : sélection catégorielle, fusion non destructive` : fixture réel `buildOiZipFixture()` (JSZip : `manifest.json`+`data.json{tactical_oi_data}`+`images.json`), format confirmé par lecture de `exportArchive()`/`OI_ARCHIVE_KEYS` (`formulaires.ts:1219-1300`) — ex-TODO-CABLAGE (fixture bloquante dans le brouillon) résolu, catégorie « Adversaires » détectée et fusionnée sans écraser l'existant |
| 36 | Persistance : import de session `.json` survit au rechargement (bug reload/flush corrigé) | VERT | E2E + PDF | `Persistance — import de session .json SURVIT au rechargement (bug corrigé, SPEC-OI-CONVERSION §9)` ; **confirmé indépendamment** par le rejeu de la recette PDF SANS le contournement du harnais (`replay-recipe-ported.mjs`) — succès, aucun écrasement observé |
| 37 | Persistance : reset page active vs reset total (confirmation modale) | VERT | E2E | `Persistance — réinitialisation Page Active vs Tout (modale de confirmation)` |
| 38 | Persistance : restauration fidèle après rechargement (pas de perte/troncature) | VERT (cas simple) | E2E | `Persistance — restauration fidèle depuis localStorage après rechargement (formData complet)` ; non-troncature sur gros volumes hors scope E2E |
| 39 | UI transverse — Dock : réduire/agrandir (persisté), lien PC-Tac, dark mode (persisté) | VERT | E2E | `Dock — réduire/agrandir (persisté), lien PC-Tac, dark mode (persisté)` : `href` de `#pctacLink` corrigé (`pctac.html` → `/pctac/`), ex-TODO-CABLAGE résolu |
| 40 | UI transverse — Dock : lien retour vers le portail TacSuite (`#portalLink`) | VERT | E2E + visuel | `Lien retour vers le portail TacSuite (#portalLink)` : attaché, `href="/"`. Item HORS §9 (portail créé en P3B.C, absent de l'original — cf. `docs/DECISIONS-DOM-ECARTS.md` §6) ; impact visuel neutralisé (masque `PORTAL_LINK_MASK`, voir run de référence) |
| 41 | UI transverse : tuto interactif (`window.PocheTuto`, bouton auto-inséré) | VERT | E2E | `Tuto interactif — bouton injecté dans le dock + ouverture (PocheTuto, appId="oi")` |
| 42 | UI transverse : fenêtre de logs debug mobile (`window.openLogs`) | VERT | E2E | `Fenêtre de logs debug mobile (window.openLogs, résidu window §3.13)` : structure DOM confirmée (script inline `4.html:43-111` porté), ex-stub faible du brouillon renforcé |
| 43 | UI transverse : a11y — navigation clavier des puces d'étape | VERT | E2E | Couvert dans le test Navigation (#1) : puces `.wizard-progress-step` cliquables/activables indépendamment |
| 44 | UI transverse : a11y — focus trap modales, cible tactile ≥44px, anti-zoom iOS | NON COUVERT | — | Non testé — aucun précédent dans `pctac.spec.ts` (même corpus), mesure de taille de cible fragile en CI (dépend zoom/DPI) ; assumé explicitement, cohérent avec le gate PC-Tac équivalent (items #15/#33 `NON COUVERT`) |
| 45 | (hors §9) Pont `.oi.zip` → PC-Tac | VERT | E2E cross-app | `Pont OI → PC-Tac — un .oi.zip exporté depuis OI est importable dans PC-Tac (#importOiDockBtn)` : export depuis OI, import dans PC-Tac, bout en bout sur les deux apps portées |

## Items non couverts ou partiels — synthèse et justification

Aucun des points ci-dessous n'est un signe de régression constatée : ce sont
des trous de couverture E2E assumés, cohérents avec les limites déjà admises
côté PC-Tac (`docs/CHECKLIST-PCTAC.md` §2), listés pour transparence.

- **Tactile (items #10/#12/#27)** : `chromium-mobile` (`playwright.config.ts`)
  réduit seulement le viewport, sans `hasTouch:true`. Émuler fiablement le
  glisser tactile PATRACDVR/Articulation et l'appui long d'annotation
  nécessiterait soit un 3e projet Playwright dédié, soit `page.touchscreen.*`
  explicite — non fait dans cette passe pour ne pas modifier
  `playwright.config.ts` hors mandat.
- **Cartographie — recherche/capture (items #23/#24)** et **pins/dessin
  hors 1 catégorie/1 outil (items #21/#22)** : la séquence pin (modale →
  clic carte) et dessin (glisser souris → `localStorage`) SONT couvertes
  pour au moins un représentant de chaque famille (résolution du
  TODO-CABLAGE §5 point 8 du brouillon `.tacsuite-prep/draft-oi-spec-notes.md`,
  items #21/#22 du tableau ci-dessus) ; la recherche Nominatim et la capture
  PNG restent non testées (dépendance réseau/risque de flakiness, même
  famille de limite que `pctac.spec.ts` côté Plan).
- **Annotation — 4 types sur 5 (item #26)**, poignées de manipulation directe
  et cohérence rendu interactif/export (item #27/#28) : même moteur
  `AnnotationEngine` pour les 5 types (revue de code), poignées jugées trop
  fragiles en E2E, cohérence pixel mieux couverte par un test unitaire par
  hash (`SPEC-OI-CONVERSION.md` §11.6) que par de l'E2E.
- **A11y fine (item #44)** : focus trap et cible tactile ≥44px non testés —
  aucun précédent de style dans `pctac.spec.ts`, laissé de côté par
  cohérence avec le corpus existant plutôt que par oubli.
- **Photos étape 2/3 (items #6/#7)** : non ré-exercées séparément à ces
  étapes (mêmes inputs que l'étape 5, `medias.ts`), mais le flux
  upload+compression+IndexedDB+preview est exercé et confirmé fonctionnel
  par le rejeu de la recette PDF de certification (`J.png`, upload réel).

## Écart DOM documenté hors §9

`#portalLink` (item #40) est un ajout P3B.C absent de l'ORIGINAL (aucun
portail n'existait) — cf. `docs/DECISIONS-DOM-ECARTS.md` §6. Son impact sur
la comparaison visuelle (recentrage de `#dockMenu`, une barre flex centrée
SANS `collapsed` côté OI, contrairement à PC-Tac) a nécessité un masque
élargi à la bounding box entière du dock plutôt qu'au seul rectangle du
nouvel icône — détaillé dans `tests/visual/README.md` § « Écart volontaire :
lien portail ».
