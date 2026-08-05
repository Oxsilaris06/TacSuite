# TacSuite

Suite d'outils tactiques Gendarmerie — portage TypeScript de PC-Tac et 
Générateur d'Ordre Initial, à partir prototypes vanilla JS de
[GStart-main](https://github.com/Oxsilaris06/GStart-main).

## Applications

- **Portail** (`/`) — page de garde : accès aux deux applications, thème
 clair/sombre, indicateur en ligne/hors ligne.
- **PC-Tac** (`/pctac/`) — poste de commandement tactique : main courante,
 cartographie MapLibre (dessin, mesure, zones hors-ligne), plan d'action,
 géolocalisation d'équipe (Tchap), export PDF, archive `.pctac.zip`.
- **Générateur d'OI** (`/oi/`) — assistant pas à pas de rédaction d'Ordre
 Initial : cartographie, PATRACDVR, génération et export document
 (PDF, HTML, `.oi.zip`).

 deux applications communiquent via pont d'archive : `.oi.zip`
exporté depuis Générateur d'OI est importable dans PC-Tac.

## Stack

- **Frontend** : Vite (multi-page : portail + `pctac/` + `oi/`) + TypeScript
 (mode strict), vanilla — sans framework UI.
- **Cartographie** : MapLibre GL.- **PWA** : `vite-plugin-pwa` (stratégie `injectManifest`), Service Worker
 maison (`public/sw.ts`) — chaque page précache sa propre copie hors ligne.
- **Tests** : Vitest (unitaire), Playwright (E2E), diff visuel maison (`tests/visual/compare.mjs`, pixelmatch).

## Démarrage

```bash
# Installation
npm install

# Serveur de développement (port 9678)
npm run dev

# Build de production
npm run build

# Prévisualisation du build
npm run preview
```

## Tests

```bash
npm run test         # Vitest (unitaire)
npm run test:e2e     # Playwright (E2E)
npm run test:visual  # Diff visuel vs baselines (tests/visual/baseline/)
npm run typecheck    # tsc --noEmit
npm run lint         # ESLint
```

 tests E2E et diff visuel ciblent serveur déjà démarré
(`baseURL` dans `playwright.config.ts` / `tests/visual/compare.mjs`) —
lancer `npm run dev` (ou `npm run build && npm run preview`) au préalable.
 test PWA offline (`tests/e2e/offline.spec.ts`) exige spécifiquement 
serveur de preview (build), pas `dev` : aucun `sw.js` n'est buildé en mode
développement.

## Base URL de déploiement

 chemin de base est paramétrable via variable d'environnement
`TACSUITE_BASE` (`vite.config.ts`) — `/` par défaut (dev, preview locale),
`/TacSuite/` pour GitHub Pages :

```bash
TACSUITE_BASE=/TacSuite/ npm run build
```

 ancres de navigation inter-apps (`<a href>` portail et docks
PC-Tac/OI) sont en chemins relatifs pour rester correctes quelle que soit
 base — voir `docs/DECISIONS-DOM-ECARTS.md`, point 11.

**Piège (P4.FIX, MINEUR R4)** : `vite.config.ts` relit `process.env.TACSUITE_BASE`
à CHAQUE lancement config — variable doit donc être positionnée pour
`preview` AUSSI, pas seulement pour `build`. `npm run build` avec
`TACSUITE_BASE=/TacSuite/` suivi d' `npm run preview` NU (sans variable)
repart en `base=/` : serveur de preview répond alors HTTP 200 sur TOUTES
 URL `/TacSuite/**` en renvoyant `dist/index.html` ( portail) — y compris
pour `/TacSuite/pctac/index.html` ou `/TacSuite/manifest.webmanifest`, qui
n'existent pourtant pas à cet emplacement dans `dist/`. Ce faux « zéro 404 »masque déploiement cassé. Commande correcte pour vérifier build Pages
en local :

```bash
TACSUITE_BASE=/TacSuite/ npm run build
TACSUITE_BASE=/TacSuite/ npx vite preview --port 9678 --strictPort
```

( workflow `.github/workflows/pages.yml` n'est pas concerné : il ne fait
qu' `build`, avec `TACSUITE_BASE: /TacSuite/` déjà positionné.)

## Déploiement

GitHub Pages via GitHub Actions (`.github/workflows/pages.yml`) : chaque
push sur `main` reconstruit (`TACSUITE_BASE=/TacSuite/`) et déploie
`dist/`.

## Documentation

 dossier `docs/` regroupe plan de portage (`PLAN.md`), specs de
conversion (`SPEC-*.md`), décisions d'architecture (`DECISIONS-*.md`)
et checklists fonctionnelles (`CHECKLIST-*.md`) héritées recette
sur originaux.

## Polices embarquées

 polices vectorielles suivantes sont embarquées dans PDF Générateur
d'OI (**100 % hors ligne**, aucun accès réseau au rendu) :

- **Oswald 500** (Medium) — titres et entêtes — 86 Ko- **JetBrains Mono 400** (Regular) — corps monospaced — 112 Ko- **JetBrains Mono 700** (Bold) — corps monospaced gras — 112 Ko
Licence : **SIL Open Font License 1.1** (textes complets dans
`src/apps/oi/pdf/fonts/OFL-*.txt`). Redistribution autorisée y compris
embarquée dans PDF, sans obligation de licence sur document produit.

 fichiers TTF ne sont jamais servis ni bundlés — seul module TypeScript
`src/apps/oi/pdf/fonts.generated.ts` (généré par `npm run gen:pdf-fonts`)
contient leur codage base64 et entre dans bundle.
