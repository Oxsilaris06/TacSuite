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

> **ROADMAP R0→R5 + R6 : INTÉGRALEMENT LIVRÉE (2026-08-10).** Poussée sur GitHub le 2026-08-10 (c9c2cb0..b30da1f, 39 commits + suivants) après validation Nico.

| Phase | Contenu | Statut |
|---|---|---|
| QW | Quick wins : contraste dark, `esc` partagé côté OI carto, indicateurs de chargement PC-Tac | ✅ fait (e669585, a3f700a) |
| R0 | Filet CI local+workflow (typecheck, lint, vitest, test:pdf) + fixture volumétrique 50 photos | ✅ fait (a968dd9) |
| R1 | Design system unifié : `styles/tacsuite-tokens.css`, migration oi/pctac, purge styles inline, z-index/breakpoints/durées tokenisés | ✅ noyau fait : T1 socle (e269c99), T2 (d19568b), T3 (04dde70), T4 (voir log), T5 (f0fc194), gate portail (c574e4f). Reste (tranches optionnelles à arbitrer) : normalisation des valeurs hors échelle (re-baseline volontaire), `--inter-blue` (attente décision AA), harmonisation breakpoints |
| R2 | Composants cliniques : `<dialog>` natif partout, remplacement des 62 alert/confirm, aria/labels, validation inline, états loading | ✅ fait : T1 dialogs pctac (2c7027d), T3a aria oi (fe90337), T3b aria pctac (4ed3705), T4 validation inline (f926bc7), T2a feedback pctac (43f323e), T2b feedback oi (62f19e7) |
| R3 | Socle carto commun : geo helpers → shared, Wheel générique, `MapPersistenceAdapter`, machine à gestes PC-Tac généralisée consommée par OI, réconciliation `_renderPins`, durcissements capture | ✅ fait : R3-a geo (23264ed), R3-b RadialMenu (0b6ebe2), R3-c persistance (5dc1e9f), R3-d gestes (5ec1e77), R3-e renderPins+capture (9edcd5c) |
| R4 | PDF : source unique document-builder, aperçu = vrai PDF, suppression print-view + generateHTML v2, gardes pagination mesurés en CI, photos hors thread principal, fixture 50 photos verte | ✅ fait : R4-a voie unique (132f71c), R4-b pagination (897ada6, remplacée en R6), R4-c photos hors thread (58f4e45) |
| R5 | SOLID continu : split god files (pattern `XxxMethods`), split contracts.ts, persist côté OI, réduction bus `window.*` — au fil des phases | ✅ appliqué au fil des tranches (extractions shared, adapters, splits opportunistes) |

## Journal

### 2026-08-09
- Brainstorming complet (4 audits subagents : carto, PDF, architecture, UI/UX). Décisions 1-3 validées.
- Création state.md + spec. Lancement QW + R0 en délégation parallèle.
- **QW livrés** : `esc` partagé (doublon `_esc` supprimé de oi/carto, e669585) ; token `--accent-fill` AA dark 5.17:1 sur 23 sites boutons remplis + overlay busy PC-Tac aria-live (a3f700a). Hors périmètre signalé : `--inter-blue` (même hex fautif, sites Tchap-live/pax Inter) — à traiter en R1.
- **R0 livré** (a968dd9) : ci.yml (gate PDF long-case 19/19), e2e.yml nightly (build + vite preview), `npm run check`, fixture `volumetric-stress.json` (56 photos, textes 2000+ car.). Diagnostic R4 : PDF 70 pages, 13/19 gardes — B1/B7/B9/B10/B11 KO sur continuations tableau Hypothèses d'Effraction (16 pages en-tête orphelin, 8 pages sans « (suite) »).
- Vérification globale : typecheck 0, lint 0, vitest 62 fichiers / 1688 tests verts. Servi sur localhost:9678.
- Graphe graphify mis à jour incrémentalement (52 code + 27 docs, skills IDE et images exclus du corpus).
- **R1 noyau livré** : T1 socle tokens (e269c99), T2 pctac (d19568b), T3 oi (04dde70), T4 purge inline pctac 195/230 (ea8d703), T5 purge inline oi 123/162 (f0fc194), gate portail + fix colorScheme Playwright (c574e4f). Re-baseline post-QW (a328231), bleu #4f8dff rétabli (3992fa5).
- **Remarques thème clair Nico livrées** : PC-Tac Liens pastel + copy « Liens Externes » + footer (c549cfe) ; OI modales (racine : rgba sombres en dur dans .modal-header → color-mix sur tokens), Créer Adversaire pastel, accents étape 6, bouton annotation photo (25913ad). Sombre bit-exact, baselines clairs re-promues.
- Rien poussé sur GitHub.

## R6 — Refonte mise en page PDF (directives Nico 2026-08-10)

Constat : tableaux coupés entre pages, fiches éclatées en « (SUITE) », pages à moitié vides, photos encadrées, puces outils jaunes datées.
Directives : **une page = un usage** (1 page/fiche adversaire, 1 page/bloc ZMSPCP ou MOICP, 1 page/cellule effraction, sections courtes regroupées) ; **interdiction absolue des « Titre (SUITE) »** (le mécanisme R4-b est remplacé) ; photos pleine largeur SANS encadré, 1/page ; outils d'effraction directement sous la photo, badges modernes (fini les cases jaunes) ; tout parfaitement lisible.
Arbitrages validés : réduction typographique adaptative avec plancher 7pt puis **refus de génération explicite** (liste des sections en dépassement) + compteurs de caractères UI calibrés ; découpage Standard ; photos qualité 0.92/2560px, budget PDF ~50 Mo à compression dégressive.
**✅ R6 LIVRÉ (2026-08-10)** : P1 moteur une-page-par-usage + solveur fit/refus, 3 itérations (a57b128) ; P2 photos pleine largeur + badges flow premium (a57b128) ; P3 compteurs calibrés PAGE_CAPACITY (d2b7cbb) ; P4 gardes C1-C5 + fixtures recalibrées (728ae59) ; titres galerie « — PHOTO i/N », zéro (suite) absolu (dernier commit).
Effraction : escalade de dispositions (colonnes adaptatives → densité → paliers police → asymétrie → pages autonomes nommées) avant tout refus, conformément à la directive.
Vérification finale : typecheck 0, lint 0, vitest 1857/1857, visuel 60 états 0 FAIL (5 modes), e2e 130/130, 3 fixtures PDF 18/18 strict.

### 2026-08-11
- **Goal.md rév. 2** : audit UI/UX complet post-R6 (3 ré-audits délégués + recherche web), arbitrages Nico actés : legacy.ts supprimé, recherche journal rebranchée, lightbox photo↔ping = PhotoSwipe v5 (desktop+mobile), carte onglet séparé REPOUSSÉE.
- **Quick wins Goal.md livrés** (5 commits d440d07→4bb0e95) : deps mortes purgées (qrcodejs, html5-qrcode) ; placement d'entités via la roue (U1, lien fiche↔carte restauré) + purge ping-modal/legacy/tuto-dashboard ; pctac U2-U14 (recherche journal, confirmations, dock clavier, aria, états vides, fiche Ami éditable, drag journal supprimé) ; oi U5-U10 (tokens --bg-card/--text-main/--font-ui réparés, alert→confirmDialog annulable avant PDF, aria dialogs/stepper, confirm photo).
- Gate : typecheck 0, lint 0, vitest 1835/1835 verts. `test:pdf` local sans arg = usage (comportement script, CI passe l'arg). Rien poussé sur GitHub.

### 2026-08-11 (suite — tranches M)
- Push GitHub validé et effectué (0268d27..3cb4931). Puis tranches M Goal.md livrées en 3 agents parallèles + passe transverse (commits 79e9f39→19ceb19, locaux, NON poussés) :
  - shared : promptDialog (socle confirmDialog), PhotoSwipe v5 installé, contrat OiNotificationGlobals purgé.
  - OI : U17 stepper honnête (coherence.ts, byStep), U18 validation par étape + points rouges stepper, U19 toast unique (notifications.ts supprimé, ~20 sites), U21 indicateur autosave, U25 (7 prompt), U26 upload avec progression.
  - PC-Tac : U15 date par entrée + séparateurs jour + PDF, U16/C1 statut sur fiche (source de vérité, badges, PDF, journal auto C5), C8 lien otage→adv en select, U22 raccourcis (1..7, Ctrl+Entrée, /), U23 en-tête mission, U25, U26.
  - Carto : photo↔ping complet (photoId, badge, panneau, viewer inline, PhotoSwipe import dynamique, capture toHide, orphelins tolérés), C5 journal pins d'entité.
  - Transverse : U20 anti-flash + pont clés thème portail↔apps ; U24 toolbar 4 FABs + tiroir « Plus », dock en wrap.
- Gate : typecheck 0, lint 0, vitest 1831/1831 verts. Restes actés dans Goal.md §7.

## Dérogations actées

- **AA boutons remplis, thème sombre** (2026-08-09, décision Nico) : `--accent-fill` sombre rétabli à `#4f8dff` (`--tac-blue-500`) — le correctif #2563eb changeait le bleu de l'interface. Ratio blanc/#4f8dff = 3.19:1, sous le seuil AA 4.5:1. Alternative conforme proposée (texte encre sombre sur #4f8dff, 6.6:1) — en attente de décision, non appliquée.

## Blocages / questions ouvertes

- ~~Portail sans gate visuel~~ → réglé (c574e4f) : états `portal`/`portal-light`, masque #net-status, colorScheme dark forcé.
- Décisions Nico (2026-08-09) : (1) alternative AA texte sombre — REFUSÉE, on ne touche à rien ; (2) `--inter-blue` — NE PAS MODIFIER ; (3) normalisation hors échelle — DIFFÉRÉE (explications jugées insuffisantes ; à représenter avec démonstration visuelle avant/après quand pertinent).
- Directive thème clair (Nico) : fond blanc, accentuations PASTELS, code couleur des éléments particuliers identique au mode sombre (hue conservée, saturation/luminosité adaptées).
