# TacSuite

Suite d'outils tactiques Gendarmerie — portage TypeScript de PC-Tac et du
Générateur d'Ordre Initial, à partir des prototypes vanilla JS de
[GStart-main](https://github.com/Oxsilaris06/GStart-main).

## Applications

- **Portail** (`/`) — page de garde : accès aux deux applications, thème
  clair/sombre, indicateur en ligne/hors ligne.
- **PC-Tac** (`/pctac/`) — poste de commandement tactique : main courante,
  cartographie MapLibre (dessin, mesure, zones hors-ligne), plan d'action,
  géolocalisation d'équipe (Tchap), export PDF, archive `.pctac.zip`.
- **Générateur d'OI** (`/oi/`) — assistant pas à pas de rédaction d'Ordre
  Initial : cartographie, PATRACDVR, génération et export du document
  (PDF, HTML, `.oi.zip`).

Les deux applications communiquent via un pont d'archive : un `.oi.zip`
exporté depuis le Générateur d'OI est importable dans PC-Tac.

## Stack

- **Frontend** : Vite (multi-page : portail + `pctac/` + `oi/`) + TypeScript
  (mode strict), vanilla — sans framework UI.
- **Cartographie** : MapLibre GL.
- **PWA** : `vite-plugin-pwa` (stratégie `injectManifest`), Service Worker
  maison (`public/sw.ts`) — chaque page précache sa propre copie hors ligne.
- **Tests** : Vitest (unitaire), Playwright (E2E), diff visuel maison
  (`tests/visual/compare.mjs`, pixelmatch).

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

Les tests E2E et le diff visuel ciblent un serveur déjà démarré
(`baseURL` dans `playwright.config.ts` / `tests/visual/compare.mjs`) —
lancer `npm run dev` (ou `npm run build && npm run preview`) au préalable.
Le test PWA offline (`tests/e2e/offline.spec.ts`) exige spécifiquement le
serveur de preview (build), pas `dev` : aucun `sw.js` n'est buildé en mode
développement.

## Base URL de déploiement

Le chemin de base est paramétrable via la variable d'environnement
`TACSUITE_BASE` (`vite.config.ts`) — `/` par défaut (dev, preview locale),
`/TacSuite/` pour GitHub Pages :

```bash
TACSUITE_BASE=/TacSuite/ npm run build
```

Les ancres de navigation inter-apps (`<a href>` du portail et des docks
PC-Tac/OI) sont en chemins relatifs pour rester correctes quelle que soit
la base — voir `docs/DECISIONS-DOM-ECARTS.md`, point 11.

**Piège (P4.FIX, MINEUR R4)** : `vite.config.ts` relit `process.env.TACSUITE_BASE`
à CHAQUE lancement de la config — la variable doit donc être positionnée pour
`preview` AUSSI, pas seulement pour `build`. Un `npm run build` avec
`TACSUITE_BASE=/TacSuite/` suivi d'un `npm run preview` NU (sans la variable)
repart en `base=/` : le serveur de preview répond alors HTTP 200 sur TOUTES
les URL `/TacSuite/**` en renvoyant `dist/index.html` (le portail) — y compris
pour `/TacSuite/pctac/index.html` ou `/TacSuite/manifest.webmanifest`, qui
n'existent pourtant pas à cet emplacement dans `dist/`. Ce faux « zéro 404 »
masque un déploiement cassé. Commande correcte pour vérifier un build Pages
en local :

```bash
TACSUITE_BASE=/TacSuite/ npm run build
TACSUITE_BASE=/TacSuite/ npx vite preview --port 9678 --strictPort
```

(Le workflow `.github/workflows/pages.yml` n'est pas concerné : il ne fait
qu'un `build`, avec `TACSUITE_BASE: /TacSuite/` déjà positionné.)

## Déploiement

GitHub Pages via GitHub Actions (`.github/workflows/pages.yml`) : chaque
push sur `main` reconstruit (`TACSUITE_BASE=/TacSuite/`) et déploie
`dist/`.

## Documentation

Le dossier `docs/` regroupe le plan de portage (`PLAN.md`), les specs de
conversion (`SPEC-*.md`), les décisions d'architecture (`DECISIONS-*.md`)
et les checklists fonctionnelles (`CHECKLIST-*.md`) héritées de la recette
sur les originaux.

## Polices embarquées

Les polices vectorielles suivantes sont embarquées dans le PDF du Générateur
d'OI (**100 % hors ligne**, aucun accès réseau au rendu) :

- **Oswald 500** (Medium) — titres et entêtes — 86 Ko
- **JetBrains Mono 400** (Regular) — corps monospaced — 112 Ko
- **JetBrains Mono 700** (Bold) — corps monospaced gras — 112 Ko

Licence : **SIL Open Font License 1.1** (textes complets dans
`src/apps/oi/pdf/fonts/OFL-*.txt`). Redistribution autorisée y compris
embarquée dans un PDF, sans obligation de licence sur le document produit.

Les fichiers TTF ne sont jamais servis ni bundlés — seul le module TypeScript
`src/apps/oi/pdf/fonts.generated.ts` (généré par `npm run gen:pdf-fonts`)
contient leur codage base64 et entre dans le bundle.
