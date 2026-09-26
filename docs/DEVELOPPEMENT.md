# Développer TacSuite

## Architecture

- Vite multipage : le portail (`/`), PC-Tac (`pctac/`) et le Générateur d'OI (`oi/`).
- TypeScript en mode strict, sans framework d'interface.
- Cartographie : MapLibre GL.
- Hors ligne : `vite-plugin-pwa` (stratégie `injectManifest`) et un service worker maison (`public/sw.ts`). Chaque page met en cache sa propre copie.
- PDF : pdfmake pour l'OI, pdf-lib pour PC-Tac.

## Commandes

```bash
npm install
npm run dev          # serveur de développement, http://localhost:9678
npm run build        # build de production dans dist/
npm run preview      # sert le build
npm run test         # tests unitaires (Vitest)
npm run typecheck    # tsc --noEmit
npm run lint         # ESLint
npm run test:e2e     # tests de bout en bout (Playwright)
npm run test:visual  # comparaison visuelle avec tests/visual/baseline/
```

Les tests de bout en bout et la comparaison visuelle visent un serveur déjà lancé (`baseURL` dans `playwright.config.ts` et `tests/visual/compare.mjs`) : lancez `npm run dev`, ou `npm run build` puis `npm run preview`, avant. Le test hors ligne (`tests/e2e/offline.spec.ts`) exige le serveur de preview, car le mode développement ne produit pas de `sw.js`.

La CI vérifie aussi la structure des PDF de l'OI : `tests/pdf/generate-from-fixture.mjs` génère un PDF à partir d'une fixture de `tests/pdf/fixtures/`, puis `tests/pdf/verify-structure.mjs` le contrôle (voir `.github/workflows/ci.yml`).

## Chemin de base et déploiement

Le chemin de base se règle par la variable `TACSUITE_BASE` (`vite.config.ts`) : `/` par défaut, `/TacSuite/` pour GitHub Pages. Les liens entre applications sont relatifs et restent justes quelle que soit la base.

`vite.config.ts` relit la variable à chaque lancement : il faut la donner aussi à `preview`. Sinon, le serveur de preview répond 200 sur toute adresse `/TacSuite/...` en renvoyant le portail, ce qui masque un déploiement cassé. Pour vérifier en local le build de GitHub Pages :

```bash
TACSUITE_BASE=/TacSuite/ npm run build
TACSUITE_BASE=/TacSuite/ npx vite preview --port 9678 --strictPort
```

Chaque push sur `main` reconstruit le site avec `TACSUITE_BASE=/TacSuite/` et le publie sur GitHub Pages (`.github/workflows/pages.yml`).

## Polices du PDF

Le PDF de l'OI embarque ses polices, pour un rendu entièrement hors ligne :

- Oswald 500 pour les titres ;
- JetBrains Mono 400 et 700 pour le texte.

Licence SIL Open Font License 1.1 (textes complets dans `src/apps/oi/pdf/fonts/OFL-*.txt`) : la redistribution est permise, y compris embarquée dans un PDF, sans contrainte sur le document produit.

Les fichiers TTF ne sont ni servis ni inclus tels quels : seul `src/apps/oi/pdf/fonts.generated.ts`, produit par `npm run gen:pdf-fonts`, contient leur encodage base64 et entre dans le bundle.
