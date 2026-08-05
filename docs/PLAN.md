# Plan maître TacSuite — portage GStart-main → TypeScript

> Document de référence pour TOUS sous-agents. Source : `/home/nico/Bureau/Web/GStart-main` (**LECTURE SEULE — ne jamais y écrire**). Cible : `/home/nico/Bureau/Web/TacSuite`. Rapports de reconnaissance : `recon-pctac.md`, `recon-oi.md`, `recon-inventaire.md` (même dossier que ce plan, copiés ensuite dans `TacSuite/docs/`).

## 1. Contexte et objectif

Deux applications web datées à porter en TypeScript sans AUCUNE régression (fonctionnelle, visuelle, données) :
- **PC-Tac** (`pctac2.html`, ~15 700 LOC exécutées) : carte tactique MapLibre, 18 modules ESM sous `modules/pctac/`, orchestrés par `main.js`. Monolithe `planMap.js` (5 596 LOC).
- **Générateur d'OI** (`4.html`, ~15 900 LOC) : 16 modules JS **non-ESM** + ~3 720 lignes CSS inline + ~350 lignes JS inline. Moteur PDF complexe, store réactif `Proxy`.
- **Partagé** : `shared/ui-platform.js(+css)`, `modules/tuto-engine.js` (`window.PocheTuto`), pont OI→PC-Tac (`.oi.zip` / clé `tactical_oi_data`).

Cible : déploiement GitHub Pages, architecture moderne (Clean Code / SOLID / TDD), Vite + TS strict.

## 2. Décisions actées (utilisateur, 2026-07-31)

| Sujet | Décision |
|---|---|
| Structure | ** seul projet Vite multi-pages** : `index.html` (portail), `pctac/index.html`, `oi/index.html`, `src/apps/pctac`, `src/apps/oi`, `src/shared` |
| Périmètre | **PC-Tac + OI uniquement** + portail minimal. Pages secondaires (mhe, mrz, qg, synthese, patracdvr, tchap_geoloc_test…) NON portées |
| CSS | **Modernisé** (variables CSS, découpage, dédoublonnage) MAIS validé par comparaison visuelle Playwright avant/après, seuil strict |
| Repo GitHub | **Public**, nommé `TacSuite`. Créé tôt, **push uniquement après validation utilisateur finale** || Source de vérité PC-Tac | `pctac2.html` (identique à `pctac.html` au toggle STABLE/BETA près). toggle disparaît ( seule version) |
| Framework | **Vanilla TS, aucun framework UI** ( DOM existant est conservé) |
| Dépendances | npm bundlées par Vite, versions épinglées sur celles originaux (vendor/ + CDN de 4.html). Zéro CDN à l'exécution |
| PWA | Conservée : manifest corrigé (`start_url` actuel pointe vers `1.html` legacy → bug), service worker reconstruit sur assets buildés |
| Compatibilité | Façades `window.*` conservées pendant portage ; `onclick` inline remplacés par délégation d'événements au fil phases |
| Code mort | Exclu portage : `dashboard.js` (jamais chargé), `modules/shared.js`/`SharedComponents` (à re-vérifier par grep avant exclusion), `presentation_legacy.js`, `old modules/`, `old.html`/`1.html`, `oldpctac.html` |

## 3. Architecture cible

```
TacSuite/
├── index.html                 # portail minimal (liens PC-Tac / OI)
├── pctac/index.html           # DOM verbatim de pctac2.html (sans scripts legacy, sans toggle)
├── oi/index.html              # DOM verbatim de 4.html (sans scripts legacy)
├── src/
│   ├── apps/pctac/            # main.ts + modules TS (dont sous-modules issus du split planMap)
│   ├── apps/oi/               # main.ts + 16 modules TS ESM
│   └── shared/                # persist.ts, coords.ts, tuto-engine.ts, ui-platform.ts, types/
├── styles/                    # pctac.css, oi.css, ui-platform.css (verbatim d'abord, modernisés ensuite)
├── public/                    # icônes PWA, manifest.webmanifest, images référencées
├── tests/
│   ├── unit/                  # Vitest (TDD des modules logiques)
│   ├── e2e/                   # Playwright (checklists fonctionnelles)
│   └── visual/                # baselines + comparaisons (pixelmatch / toHaveScreenshot)
├── scripts/                   # dev.sh, serve-original.sh, capture…
├── docs/                      # PLAN.md, recon-*.md, SPEC-PLANMAP-SPLIT.md, décisions
└── .github/workflows/pages.yml
```

Outillage : Vite (MPA, `base` paramétrable `/TacSuite/` pour Pages), TypeScript strict (`strict`, `noUncheckedIndexedAccess`…), Vitest (jsdom), Playwright (chromium desktop 1440×900 + mobile 390×844), ESLint (typescript-eslint), git dès Phase 0.

## 4. Protocole zéro régression (opposable à chaque gate)

1. **DOM** : ids/classes/attributs identiques aux originaux ; écarts autorisés documentés (scripts retirés, toggle STABLE/BETA, chemins d'assets réécrits en absolu).2. **Contrats `window.*`** (PlanMap, Persist, PocheTuto, UIPlatform, Archive, ImageStore, LogManager, PdfExport, QrSync…) : façades conservées, signatures identiques, tant qu' consommateur existe.3. **Visuel** : baselines Playwright capturées sur l'ORIGINAL (port 9679) AVANT tout changement ; toute modernisation CSS validée par diff (seuil ≤ 0,1 % de pixels hors zones masquées ; canvas carte est masqué car dépendant tuiles réseau).4. **Fonctionnel** : checklists §6 de `recon-pctac.md` et §8 de `recon-oi.md` sont critères d'acceptation, vérifiées point par point par agents Playwright aux gates de phase.
5. **Données** : clés localStorage/IndexedDB inchangées — données existantes d' utilisateur restent lisibles sans migration destructive.6. **PDF OI** : PDF de référence est généré sur l'original ; PDF TacSuite est comparé structurellement (nb pages, textes extraits, ordre sections).7. **Invariants documentés** (avec fichier:ligne dans recons) : jamais de `position` inline sur l'élément d' Marker MapLibre ; verrou par-annotation ; chaîne `captureToDataUrl` (épinglage px clone, aplatissement markers, verrou, attente tuiles) portée quasi verbatim — fidélité > élégance.
8. **Source** : GStart-main strictement en lecture seule.
## 5. Routage modèles (quota : Fable/Opus limités, Sonnet peu limité, Haiku illimité)

| Modèle | Usage |
|---|---|
| **Haiku** | Mécanique vérifiable : copies, extraction verbatim (CSS, données tuto), scripts shell, serveurs, assets, README, portail, modules < ~150 LOC |
| **Sonnet 5** | Gros travail : conversions TS, écriture tests (TDD), câblage événements, modernisation CSS, captures/diffs visuels |
| **Opus 5** | Contremaître : specs d'architecture (split planMap, conversion OI), gates de vérification indépendante de chaque phase, revue 5 modules critiques |
| **Fable** | Planification (fait), arbitrages, vérification finale uniquement |

Chaque gate Opus **ré-exécute lui-même** vérifications (build, tests, curl, diffs) — il ne croit pas rapports sur parole. Gate rouge → liste de reprises actionnables → agent correcteur Sonnet → re-gate (boucle).

## 6. Phases et tâches par sous-agent

### Phase 0 — Fondations (workflow `tacsuite-phase0-fondations`)
| ID | Modèle | Mission | Critères |
|---|---|---|---|
| P0.A1 | Sonnet | Scaffold : TacSuite/, git init, package.json (deps épinglées lues dans vendor/ et balises CDN de 4.html : maplibre-gl, html2canvas, jszip, pdf-lib, html5-qrcode, qrcode…), vite.config MPA, tsconfig strict, ESLint, Vitest, Playwright, arborescence, placeholders, npm install + playwright chromium, docs copiées | `build`, `typecheck`, `test` verts ; commit initial |
| P0.A2 | Haiku | Assets : copie de TOUS assets binaires réellement référencés (grep) par 2 apps → `public/` ; `manifest.webmanifest` corrigé | zéro référence orpheline |
| P0.A3 | Haiku | Serveurs : original sur **127.0.0.1:9679** (http.server, nohup+disown), TacSuite dev Vite sur **127.0.0.1:9678** ; scripts/dev.sh + serve-original.sh | curl 200 sur deux |
| P0.A4 | Sonnet | Baselines visuelles de l'ORIGINAL (9679) : OI vue initiale + chaque onglet ; PC-Tac carte chargée + chaque panneau ; 2 viewports ; README sélecteurs et zones à masquer | PNGs non triviaux dans tests/visual/baseline/ |
| P0.A5 | Sonnet | Squelettes : `pctac/index.html` + `oi/index.html` DOM verbatim (onclick conservés provisoirement, toggle retiré), CSS extrait VERBATIM → `styles/pctac.css` / `styles/oi.css` (ordre de cascade préservé), entrées `main.ts` | pages 200 sur 9678, zéro 404 CSS/assets |
| P0.A6 | **Opus** | GATE : ré-exécution indépendante de toutes vérifs + diff DOM squelettes vs originaux + boucle de reprises (max 2) | `go=true` |

### Phase 1 — Socle partagé (TDD d'abord)
| ID | Modèle | Mission |
|---|---|---|
| P1.A0 | **Opus** | Types contrats globaux : `src/shared/types/global.d.ts` (augmentations `Window`), interfaces modules partagés, note d'architecture |
| P1.A1 | Sonnet | `persist.ts` : tests Vitest écrits D'ABORD depuis comportement observé de l'original (clés, formats), puis port. Clés identiques |
| P1.A2 | Sonnet | `coords.ts` (WGS84/DMS/MGRS) : tests avec valeurs de référence croisées contre l'original exécuté en node |
| P1.A3 | Sonnet | `tuto-engine.ts` (moteur `PocheTuto`, API identique) |
| P1.A4 | Haiku | Données tuto verbatim : `tuto_oi_data` + `pctac/tuto_data` → const TS typées, contenu strictement identique (diff textuel) |
| P1.A5 | Sonnet | `ui-platform.ts` + `ui-platform.css` |
| P1.A6 | **Opus** | GATE : signatures vs originaux, tsc/lint/tests, commit |

### Phase 2 — PC-Tac
| ID | Modèle | Mission |
|---|---|---|
| P2.A0 | **Opus** | `docs/SPEC-PLANMAP-SPLIT.md` : découpage de planMap.js (5 596 LOC) en sous-modules (indicatif : map-core, layers, annotations, markers, measure, aoi-offline, capture, interactions, state) avec interfaces, ordre de migration, traitement invariants |
| P2.B* | Sonnet ∥ | Conversion sous-modules planMap selon spec ; `capture.ts` porté QUASI VERBATIM ; tests unitaires sur logique pure |
| P2.C* | Sonnet/Haiku ∥ | ~17 autres modules pctac (liste exhaustive dans recon-pctac.md) ; Haiku pour < 150 LOC |
| P2.D | Sonnet | Câblage : `onclick` inline → délégation d'événements dans main.ts ; façade `window.PlanMap` etc. maintenue |
| P2.E | **Opus** | GATE intégration : build/tests, smoke Playwright, diff visuel vs baseline (carte masquée), checklist fonctionnelle recon-pctac §6 point par point, revue invariants (capture, markers) |
| P2.F | Sonnet | Modernisation CSS pctac (variables, dédoublonnage) AVEC diff visuel avant/après ≤ seuil |

### Phase 3 — Générateur d'OI
| ID | Modèle | Mission |
|---|---|---|
| P3.A0 | **Opus** | Spec conversion : non-ESM → ESM TS, store `Proxy` typé (transparence Blob/File préservée), plan pdf_engine_v2, fusion règles dupliquées drag&drop (patrac.js/drag.js) en module unique iso-comportement |
| P3.B* | Sonnet ∥ | 16 modules ; tests dédiés : `_syncArticulationBlocks` (non destructif, hash), store Proxy, pdf_engine_v2 |
| P3.C | Sonnet | main.ts : câblage ~350 lignes de listeners inline de 4.html |
| P3.D | **Opus** | GATE : PDF réel généré et comparé au PDF de référence de l'original ; pont `.oi.zip` → PC-Tac bout en bout ; checklist recon-oi §8 ; diff visuel |
| P3.E | Sonnet | Modernisation CSS oi.css (3 720 lignes → variables/composants) avec diff visuel par état ≤ seuil |

### Phase 4 — Intégration, PWA, déploiement, graphe
| ID | Modèle | Mission |
|---|---|---|
| P4.A | Sonnet | PWA : précache build (vite-plugin-pwa ou sw manuel), manifest final, test offline Playwright (rechargement 2 apps) |
| P4.B | Haiku | Portail index définitif + README |
| P4.C | **Opus** | GATE FINAL : E2E complet, toutes checklists, diff visuel final, build Pages `base=/TacSuite/` + preview vérifié || P4.D | Haiku | `gh repo create TacSuite --public` (SANS push), `.github/workflows/pages.yml`, historique git propre |
| P4.E | Sonnet ∥ | `graphify --deep` sur TacSuite : ingestion + extraction sémantique par sous-agents eux-mêmes, GRAPH_REPORT généré (CLI = uv tool ; si wrapper échoue, voir mémoire « graphify venv cassé ») |
| P4.F | **Fable (moi)** | Vérification finale indépendante + rapport utilisateur. **Push après validation utilisateur uniquement** |

## 7. Registre risques

| Risque | Mitigation |
|---|---|
| planMap.js monolithe couplé DOM/MapLibre | Spec Opus AVANT découpe ; migration sous-module par sous-module ; gate E2E |
| Chaîne `captureToDataUrl` fragile (planMap.js:5054-5241) | Port quasi verbatim, revue Opus ligne à ligne, test E2E de capture |
| `onclick` inline + contrats `window.*` cassés par ES modules | Façades window explicites + remplacement progressif par délégation, testé au gate |
| pdf_engine_v2 (pagination dynamique, échelle adaptative) | PDF de référence + comparaison structurelle automatisée |
| Store `Proxy` (exclusions Blob/ArrayBuffer/File) | Tests unitaires dédiés avant port |
| Règles drag&drop dupliquées (patrac.js vs drag.js) | Fusion en module unique, iso-comportement prouvé par tests |
| Incohérences manifest/sw (`start_url`→1.html ; précache partiel) | Reconstruits proprement en Phase 4 |
| Code mort ambigu (dashboard.js, SharedComponents) | Grep de confirmation avant exclusion définitive, décision tracée dans docs/ |
| Tuiles carto réseau → diffs visuels flaky | Canvas carte masqué dans comparaisons ; zones documentées |
| Versions CDN (OI) ≠ vendor (PC-Tac) | Versions épinglées npm relevées sur DEUX sources, écarts arbitrés au scaffold |

## 8. Serveurs et repo

- **127.0.0.1:9679** : original GStart-main (référence pour baselines et comparaisons).- **127.0.0.1:9678** : TacSuite (Vite dev, `--strictPort`).
- Repo GitHub `TacSuite` public, créé en Phase 4, **aucun push avant validation utilisateur**. Commits locaux réguliers dès Phase 0 (trailer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`).

## 9. Critères d'acceptation finaux

1. `tsc` strict : 0 erreur ; ESLint : 0 erreur ; tous tests Vitest verts.
2. Checklists fonctionnelles PC-Tac et OI : 100 % vérifiées en E2E.3. Diffs visuels ≤ seuil sur tous états capturés (hors zones masquées).4. PDF OI structurellement identique à référence.5. Pont OI→PC-Tac fonctionnel bout en bout.6. PWA : deux apps rechargent offline après première visite.7. Build Pages (`base=/TacSuite/`) vérifié en preview.
8. `graphify --deep` généré sur TacSuite avec GRAPH_REPORT.
9. Zéro écriture dans GStart-main (vérifiable : mtimes/diff).