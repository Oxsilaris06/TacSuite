# TacSuite — État de la roadmap qualité

> Fichier de suivi opérationnel. Toute décision, avancement ou blocage est acté ici.
> Règle : **aucun push GitHub sans validation explicite de Nico.** Commits locaux autorisés (atomiques, par tranche).
> Serveur de dev : `npm run dev` → http://localhost:9678 (strictPort).

## Décisions structurantes (2026-08-09, validées par Nico)

1. **Cartographie** : le moteur PC-Tac (`src/apps/pctac/planmap/`) est généralisé comme socle commun ; OI est re-basé dessus. Chaque app garde ses toolbars/fonctionnalités propres (pins métier + MGRS + AOI côté PC-Tac ; pins PATRACDVR côté OI).
2. **PDF** : un seul bouton d'output = téléchargement du PDF pdfmake (`document-builder.ts` source unique). L'aperçu devient le rendu du vrai blob PDF (iframe). La voie B « impression navigateur » (`print-view.ts`) et la voie C « aperçu HTML v2 » sont supprimées — on imprime le PDF téléchargé.
3. **Ordre** : R0 → R1 → R2 → R3 → R4, R5 transversal. R3 (carto) passe avant R4 (PDF).

Spec détaillée : `docs/superpowers/specs/2026-08-09-tacsuite-roadmap-design.md`.

## Phases

| Phase | Contenu | Statut |
|---|---|---|
| QW | Quick wins : contraste dark, `esc` partagé côté OI carto, indicateurs de chargement PC-Tac | 🔄 en cours |
| R0 | Filet CI local+workflow (typecheck, lint, vitest, test:pdf) + fixture volumétrique 50 photos | 🔄 en cours |
| R1 | Design system unifié : `styles/tacsuite-tokens.css`, migration oi/pctac, purge styles inline, z-index/breakpoints/durées tokenisés | ⬜ à faire |
| R2 | Composants cliniques : `<dialog>` natif partout, remplacement des 62 alert/confirm, aria/labels, validation inline, états loading | ⬜ à faire |
| R3 | Socle carto commun : geo helpers → shared, Wheel générique, `MapPersistenceAdapter`, machine à gestes PC-Tac généralisée consommée par OI, réconciliation `_renderPins`, durcissements capture | ⬜ à faire |
| R4 | PDF : source unique document-builder, aperçu = vrai PDF, suppression print-view + generateHTML v2, gardes pagination mesurés en CI, photos hors thread principal, fixture 50 photos verte | ⬜ à faire |
| R5 | SOLID continu : split god files (pattern `XxxMethods`), split contracts.ts, persist côté OI, réduction bus `window.*` — au fil des phases | ⬜ transversal |

## Journal

### 2026-08-09
- Brainstorming complet (4 audits subagents : carto, PDF, architecture, UI/UX). Décisions 1-3 validées.
- Création state.md + spec. Lancement QW + R0 en délégation parallèle.

## Blocages / questions ouvertes

- (aucun)
