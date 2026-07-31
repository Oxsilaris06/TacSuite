// Point d'entree PC-Tac. Placeholder scaffold (P0.A1) - sera remplace par le
// portage reel des modules de modules/pctac/ (voir docs/PLAN.md, phase 2).

// Polices auto-hebergees (Material Symbols Outlined + Oswald/Inter/JetBrains
// Mono) - voir src/shared/fonts.ts. Corrige P0.FIX : zero CDN Google Fonts.
import '@shared/fonts';

// CSS de MapLibre GL (vendore en HORS-cascade de styles/pctac.css, cf. P0.A5 point 4 :
// styles/pctac.css exclut volontairement vendor/maplibre-gl.css, remplace ici par
// l'import npm officiel du meme paquet epingle - voir docs/DECISIONS-DEPS.md).
import 'maplibre-gl/dist/maplibre-gl.css';

console.info('[pctac] scaffold main.ts charge');
