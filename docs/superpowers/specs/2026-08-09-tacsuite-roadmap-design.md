# Spec — Roadmap qualité TacSuite (design validé)

Date : 2026-08-09. Validé par Nico. Suivi opérationnel : `state.md` (racine).

## Objectifs

1. Interface pixel-perfect, qualité clinique de la plus petite modale à l'interface principale.
2. PDF d'output irréprochable quel que soit le volume (photos, lignes d'OI).
3. Architecture clean code SOLID.
4. Moteur cartographique commun OI / PC-Tac, chaque app gardant ses fonctionnalités utiles à son usage.

## Constats d'audit (synthèse)

Quatre audits en lecture seule (carto, PDF, architecture, UI/UX) ont établi :

- **Carto** : duplication réelle (Wheel, geo helpers, map-core, panels), incompatibilités de persistance et de modèle pin, OI privé des 8 correctifs double-tap mobile de PC-Tac, maturité très asymétrique (PC-Tac : 58 propriétés d'état, machine à gestes complète ; OI : 13 propriétés, click simple).
- **PDF** : triplication active des 14 sections (`pdf-engine-v2.ts` aperçu HTML, `print-view.ts` impression, `document-builder.ts` pdfmake), pagination par constantes physiques mesurées à la main, `unbreakable` résiduels = troncature silencieuse, aucun test volumétrique, aucun test exécuté en CI.
- **Architecture** : 6 god files (1065–1785 lignes), 679 accès DOM mêlés au métier, bus `window.*` (83 contrats), `contracts.ts` monolithe, `persist.ts` non utilisé côté OI. Pattern de découpage `XxxMethods` prouvé en interne (planmap, carto) mais non généralisé.
- **UI/UX** : trois vocabulaires de tokens, `pctac.css` sans usage des tokens d'espacement, 8 modales PC-Tac sans focus trap/Escape/aria alors que `makeDialog()` existe en shared, contraste 3.19:1 en thème sombre sur les boutons primaires, 62 `alert()`/`confirm()`, ~400 styles inline.

## Décisions d'architecture

### D1 — Moteur carto : PC-Tac généralisé

Le socle commun est extrait du moteur PC-Tac (le plus mûr), jamais l'inverse. OI est re-basé dessus progressivement. Ordre d'extraction : geo helpers purs → `esc` partagé → `Wheel` générique (découplé de MapLibre par interface minimale) → `MapPersistenceAdapter` (chaque app fournit son backend : `Persist`/localStorage côté PC-Tac, `Store.formData` côté OI) → machine à gestes (double-tap, drag, pinch, suppression zoom parasite) consommée par les deux apps. La résolution sémantique des pins (entités PC-Tac, membres PATRACDVR OI) reste par app, injectée comme fournisseur.

### D2 — PDF : une seule voie d'output

`document-builder.ts` (pdfmake) devient la source unique des 14 sections. Un seul bouton : téléchargement du PDF. L'aperçu in-app affiche le rendu du vrai blob pdfmake (iframe). Suppression de `print-view.ts` + `print-style.ts` (impression navigateur — on imprime le PDF téléchargé) et de `generateHTML()` de `pdf-engine-v2.ts` (aperçu HTML). Le collecteur `collectAllData()` est conservé et isolé.

### D3 — Ordre des phases

R0 (filet CI) → R1 (tokens) → R2 (composants) → R3 (carto) → R4 (PDF). R5 (SOLID) transversal : un god file est splitté quand une phase le touche, pattern `XxxMethods`, jamais de refactor à froid. Quick wins immédiats avant R1.

## Phases — contenu contractuel

- **QW** : contraste AA thème sombre sur boutons primaires ; OI carto importe `esc` de `@shared/ui-platform` (suppression du doublon) ; indicateurs de chargement PC-Tac (export PDF, archive, capture).
- **R0** : workflow CI (typecheck, lint, vitest, test:pdf ; e2e en nightly) ; fixture volumétrique (50 photos, textes longs) ajoutée à `tests/pdf/fixtures/`.
- **R1** : `styles/tacsuite-tokens.css` unique (modèle `portal.css`, 3 couches) ; migration `oi.css`/`pctac.css` ; purge styles inline ; z-index, breakpoints, durées tokenisés ; gate visuel Playwright à chaque lot.
- **R2** : `<dialog>` natif partout (8 modales PC-Tac migrées, `pdfLoadingModal` inclus) ; remplacement des `alert`/`confirm` par composants intégrés (undo pour le réversible) ; labels `for=`, `aria-label` boutons icône ; validation inline (blur + `aria-describedby`) ; états loading partout.
- **R3** : extractions D1 dans l'ordre, tests unitaires portés à chaque étape, réconciliation `_renderPins` OI, durcissements `capture.ts` OI.
- **R4** : D2, gardes `verify-structure` en CI, suppression des `unbreakable` non bornés + assertion anti-troncature, `normalizePhotos` hors thread principal, fixture 50 photos verte.

## Protocole

- Tranches verticales testables ; commit local atomique par tranche ; zéro régression (suites vitest/e2e/visuel avant-après).
- Cascade de délégation : Haiku pour le mécanique, Sonnet pour le standard, Opus high pour revue et zones à risque (machine à gestes, pagination PDF) ; orchestration et revue finale par le thread principal.
- Aucun push sans validation explicite.
- Vérification servie sur http://localhost:9678.
