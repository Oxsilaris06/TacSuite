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
| QW | Quick wins : contraste dark, `esc` partagé côté OI carto, indicateurs de chargement PC-Tac | ✅ fait (e669585, a3f700a) |
| R0 | Filet CI local+workflow (typecheck, lint, vitest, test:pdf) + fixture volumétrique 50 photos | ✅ fait (a968dd9) |
| R1 | Design system unifié : `styles/tacsuite-tokens.css`, migration oi/pctac, purge styles inline, z-index/breakpoints/durées tokenisés | ⬜ à faire |
| R2 | Composants cliniques : `<dialog>` natif partout, remplacement des 62 alert/confirm, aria/labels, validation inline, états loading | ⬜ à faire |
| R3 | Socle carto commun : geo helpers → shared, Wheel générique, `MapPersistenceAdapter`, machine à gestes PC-Tac généralisée consommée par OI, réconciliation `_renderPins`, durcissements capture | ⬜ à faire |
| R4 | PDF : source unique document-builder, aperçu = vrai PDF, suppression print-view + generateHTML v2, gardes pagination mesurés en CI, photos hors thread principal, fixture 50 photos verte | ⬜ à faire |
| R5 | SOLID continu : split god files (pattern `XxxMethods`), split contracts.ts, persist côté OI, réduction bus `window.*` — au fil des phases | ⬜ transversal |

## Journal

### 2026-08-09
- Brainstorming complet (4 audits subagents : carto, PDF, architecture, UI/UX). Décisions 1-3 validées.
- Création state.md + spec. Lancement QW + R0 en délégation parallèle.
- **QW livrés** : `esc` partagé (doublon `_esc` supprimé de oi/carto, e669585) ; token `--accent-fill` AA dark 5.17:1 sur 23 sites boutons remplis + overlay busy PC-Tac aria-live (a3f700a). Hors périmètre signalé : `--inter-blue` (même hex fautif, sites Tchap-live/pax Inter) — à traiter en R1.
- **R0 livré** (a968dd9) : ci.yml (gate PDF long-case 19/19), e2e.yml nightly (build + vite preview), `npm run check`, fixture `volumetric-stress.json` (56 photos, textes 2000+ car.). Diagnostic R4 : PDF 70 pages, 13/19 gardes — B1/B7/B9/B10/B11 KO sur continuations tableau Hypothèses d'Effraction (16 pages en-tête orphelin, 8 pages sans « (suite) »).
- Vérification globale : typecheck 0, lint 0, vitest 62 fichiers / 1688 tests verts. Servi sur localhost:9678.
- Graphe graphify mis à jour incrémentalement (52 code + 27 docs, skills IDE et images exclus du corpus).
- Rien poussé sur GitHub.

## Blocages / questions ouvertes

- (aucun)
