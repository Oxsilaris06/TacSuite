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

## Déploiement

GitHub Pages via GitHub Actions (`.github/workflows/pages.yml`) : chaque
push sur `main` reconstruit (`TACSUITE_BASE=/TacSuite/`) et déploie
`dist/`.

## Documentation

Le dossier `docs/` regroupe le plan de portage (`PLAN.md`), les specs de
conversion (`SPEC-*.md`), les décisions d'architecture (`DECISIONS-*.md`)
et les checklists fonctionnelles (`CHECKLIST-*.md`) héritées de la recette
sur les originaux.
