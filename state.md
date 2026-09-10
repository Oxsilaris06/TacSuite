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

### 2026-08-12
- **Enquête photos exports** (déléguée, 2 verdicts) :
  - OI : théorie **CONFIRMÉE** — `exportArchive` dumpait tout le store IndexedDB `OI_GeneratorLiteDB/images` (`getAllKeys`, `formulaires.ts:1263`) au lieu des images référencées ; orphelins garantis par suppression DOM pure des blocs MOICP/ZMSPCP/Effraction (`articulation.ts:140,241,956`) ; import sans purge si « Photos HD » décoché. Corrigé (749fe07) : filtre export `dataStr.includes(String(k))` + `removeBlockEl` purge IDB + PC-Tac purge `photoId` des pins à la suppression de photo.
  - PC-Tac : théorie **INFIRMÉE** — export borné aux collections localStorage (pull ciblé `archive.ts:149-177`) ; seule fuite = référence `photoId` morte dans `pcTacPlanPins` (corrigée).
- **Carto OI — parité PC-Tac** (arbitrage Nico 2026-08-12 : parité ciblée + mesure/gestes/texte, entités PATRACDVR conservées ; stratégie hybride retenue) :
  - Vagues 1-2 (1191cca) : couche IGN BD ORTHO + labels rues openfreemap togglables/persistés ; toolbar 4 FABs + tiroir « Plus » + légende ; roue de création ping au clic/appui long (modale dormante), quick-place, panneaux membre/véhicule PATRACDVR ; roue options pin enrichie (verrou, copie coords MGRS+GPS) ; extraction de la machine à gestes formes vers `src/shared/shape-gestures.ts` (injection, adaptateur PC-Tac mince, API intacte) ; tuto 57 steps.
  - Vague 3 (f6c9946) : formes éditables (sélection/poignées/drag/resize/pinch via shared), précision de tracé (réticule), mesure (distance+azimut+anneaux d'engagement), texte libre (roue → `promptDialog`, persisté `cartography.texts`), photo↔ping complet (badge, panneau vignettes formulaire, viewer PhotoSwipe, orphelins nettoyés, auto-embarqué à l'export).
- Gate final : typecheck 0, lint 0, vitest 1884/1884.
- **Rectification décision structurante 1** (ligne 9, 2026-08-09) : la formulation « le moteur PC-Tac est généralisé comme socle commun ; OI est re-basé dessus » était trompeuse — l'enquête n'avait livré que 5 primitives partagées, pas un re-basage. L'écart carto OI/PC-Tac a été comblé ce jour par parité ciblée ; `oi/carto/` reste une implémentation propre consommant `@shared`, pas un re-basage sur le moteur PC-Tac.
- Commits locaux 749fe07, 1191cca, f6c9946 — NON poussés.

### 2026-08-12 (suite — recette Nico, alignement strict)
- Retours recette carto OI corrigés (c7e9ab7, 2 agents parallèles + intégration) :
  - clic simple carte redevenu neutre (parité `_onMapClick` PC-Tac : mesure → drawTool → pending), la roue ne s'ouvre plus au clic ; FAB ping → roue centrée vue.
  - roue restructurée : « Ajouter entité » unifié (membres PATRACDVR/cyno/véhicules-rames/rassemblement), « Catalogue » à 2 onglets — Génériques (`PIN_ICONS` extrait vers `src/shared/pin-icons.ts`, PC-Tac re-exporte à l'identique) et Personnalisés (pins OI) ; option Texte retirée de la roue.
  - texte = outil du dock dessin, modèle shape `type:'text'` (rendu nu avec halo, sans cadre, couleur palette), sélection/drag/édition via shape-edit, migration des anciens `cartography.texts`.
  - mesure = outil du dock (dblclic termine) ; mesures commitées sélectionnables/supprimables au clic (écart assumé : PC-Tac ne le permet pas, demande explicite Nico).
  - légende supprimée (décision Nico : code couleur libre).
- Gate : typecheck 0, lint 0, vitest 1896/1896. Commit local c7e9ab7 — NON poussé.

### 2026-09-08 (carte PC-Tac : 4 évolutions + 2 correctifs)

Chemin architectural suivi : analyse parallèle du socle carto, questions arbitrées avec Nico, design validé section par section, puis six tranches committées séparément. Périmètre arbitré : **PC-Tac uniquement** (OI a déjà la ligne droite et n'a pas de nom de forme à déplacer) ; les 3 icônes atterrissent aussi dans OI par ricochet, la banque `src/shared/pin-icons.ts` étant commune.

- **Icônes** (6814879) : `PIN_ICONS` 51 → 54 (`person_pin_circle` Dernière position connue, `local_parking` Parking, `groups` Point de rassemblement des forces) ; `OI_ICON_CATALOG` 27 → 29 (`groups` y figurait déjà). Voie catalogue avec `kind:'generic'`, pas de nouveau kind métier.
- **Ligne droite** (59caa61) : nouvel outil `straight`, MÊME type de forme `line` à deux points. Bouton `data-tool` dans le dock — aucun JavaScript de câblage, `_bindDrawUi` branche automatiquement. Le trait existant devient explicitement « à main levée ».
- **Nom de dessin déplaçable et rotatif** (cc8185f, 68ad1a8) : champs optionnels `labelT` (abscisse curviligne 0..1) et `labelRot`. `labelT` absent = milieu de la corde, comportement historique au mot près, donc aucune migration. Le rail suit la LONGUEUR PARCOURUE, ce qui corrige au passage un cheminement à main levée dont le nom tombait hors du tracé. Rail réservé aux polylignes, rotation pour tout. Poignées décalées de part et d'autre du nom : posées dessus, le texte interceptait l'appui. Le marker porte un conteneur nu et le texte descend d'un cran, pour que la rotation survive au `transform:'none'` de la capture PDF sans toucher à ce durcissement.
- **Import GPX** (cdcae2f) : panneau dédié dans le tiroir « Plus ». Zéro dépendance, `DOMParser`. Coordonnées en IndexedDB (magasin `gpx`, base pcTacImages v2), index léger en localStorage — jamais dans `pcTacPlanShapes`, que la pile d'annulation recopie en entier. Couches GL insérées sous `plan-shapes-fill`, donc capturées gratuitement dans le PDF.
- **Modale RESET COMPLET** (64b5d64) : titre noir en thème sombre (1,11:1) et « ANNULER » blanc sur blanc en clair (1,01:1). Racine : depuis la migration R2-T1 vers `<dialog>` natif, la feuille UA impose `color: CanvasText` à l'élément et `.modal` ne déclarait aucun `color` ; et `.add-btn` pose `color: white` que les classes de variante ne défaisaient pas. Correctifs à la racine, les 7 modales et les 7 boutons Annuler réparés d'un coup. Nouveau token `--danger-fill` pour les fonds d'action destructrice (`--danger-red` ne tient que 3,4:1 avec du blanc en sombre).
- **Coordonnées fantômes Tchap** (146ed1c) : aucune borne d'âge sur les positions réhydratées depuis IndexedDB, et `sweepStates` exempte les marqueurs `stale` à vie. Après une fermeture d'onglet sans Stop, `cfg.connected` reste vrai et le curseur `since` persisté fait passer la reprise en mode incrémental, sans la purge du sync initial. Constante `STALE_MAX_MS` (30 min) appliquée à la lecture disque ET au balayage. **Seul réglage, à calibrer avec l'opérationnel.**

Gate : typecheck 0, lint 0, vitest 2158/2158, Playwright pctac 35/35 (chromium-desktop). Vérifications navigateur mesurées, pas déduites : contrastes de la modale dans les deux thèmes, parcours GPX complet (import, masquage, rechargement, suppression), ligne droite et poignées de label.

### 2026-09-10 (traces GPX : 4 évolutions)

Arbitrages Nico : timelapse en DEUX modes (temps réel partagé et progression normalisée, en bascule) ; coloration par heure ABANDONNÉE, restent par jour et libre ; découpage du jour RÉGLABLE, 06h par défaut, 0 redonnant le jour civil ; traces non datées conservées et signalées, jamais supprimées silencieusement ; archive en FUSION, jamais d'effacement ; suppression groupée par jour plutôt que par heure ; pas de sélection libre, seulement des groupes prédéfinis ; panneau en sous-menus transitoires.

Prototype jetable exécuté AVANT toute spec, mesuré dans le navigateur : `line-gradient` écrase `line-color` (une ligne rouge passe au bleu), refuse les expressions pilotées par la donnée, et 120 changements de dégradé coûtent 2 ms. C'est ce qui impose une couche par trace pendant la lecture.

- **Horodatage** (e19ed13) : `<time>` lu par point, en structure PARALLÈLE aux coordonnées — la 3e composante d'une position GeoJSON signifie l'altitude et n'atteint jamais le style. Stockage en enveloppe versionnée reconnaissant le tableau nu de la version précédente : sans quoi une trace importée avant ce changement était lue comme absente puis retirée de l'index, une perte de données. Bornes de temps dans l'index, recalculées au chargement. Journée opérationnelle basculant à 06h locales.
- **Archive** (5aa1b6a) : dossier `gpx/` dans le zip, comme `images/`. Fusion sans effacement. Deux défauts corrigés : `refresh()` ne rechargeait pas les traces (la première action du panneau écrasait l'index fraîchement importé), et la réinitialisation totale ne les supprimait pas.
- **Panneau** (7a934af) : groupes de jour repliables, tri chronologique inversable, sous-menus transitoires sur le mécanisme `_openInlinePanel`. Actions : tout afficher/masquer, colorer (une couleur par jour ou une couleur unique), supprimer tout ou un jour, régler tri et bascule. Suppressions via la confirmation destructrice du socle.
- **Timelapse** (9e6fedd) : géométrie posée une fois, révélation par `line-gradient`, tête de lecture en marqueur. Tronçons raboutés en une ligne (`line-progress` est par feature). Barre de lecture PERSISTANTE, pas transitoire. Pause à l'occultation de l'onglet. Défaut trouvé au navigateur : une règle d'auteur `display: flex` sur un identifiant bat le `[hidden]` du navigateur, la barre était visible en permanence.

**Conséquence assumée du mode temps réel** : avec des traces éloignées dans le temps, l'essentiel de la lecture est du temps mort. C'est la chronologie honnête ; le mode progression couvre l'autre besoin.

Gate : typecheck 0, lint 0, vitest 2212/2212, Playwright pctac 37/37, gate visuel 0,000 % sur les 4 états de carte. `tab-otages` et `tab-liens` échouent toujours, chiffres identiques avant/après (1426 px et 44924 px) — préexistants.

**À TRAITER, indépendant de ce chantier** : `tests/e2e/oi.spec.ts` compte **17 échecs sur 35** (formulaire OI : puces d'étape en `step-error`, glisser-déposer PATRACDVR, quick-edit, mode batch, menu contextuel). Vérifié en repassant le dépôt à `5c0bfea` puis à `918b889` : **exactement 17 échecs / 18 réussites dans les trois cas**, donc antérieurs à toute la session du 2026-09-08 et du 2026-09-10. Personne ne les avait relevés jusqu'ici.

**Piège de méthode à retenir** : le rapporteur `line` de Playwright imprime la LISTE des échecs juste avant les compteurs. Lire `tail` et n'y voir que « 18 passed » fait manquer la ligne « 17 failed » qui la précède. Toujours filtrer sur `^  [0-9]+ (passed|failed)`.

**Second piège** : ne JAMAIS lancer le gate visuel et une suite Playwright en parallèle. Un seul serveur de développement les sert, et `playwright.config.ts` fige `workers: 1` précisément pour cette raison (contention non bornée, commentaire de la config).

### 2026-09-10 (tutoriel, documentation, thème des sous-menus)

- **Sous-menus GPX accordés au thème** : `_openInlinePanel` peint son conteneur en dur, en sombre, par style INLINE — style historique des roues posées sur la carte. Les contenus GPX étant écrits avec les variables de thème, un titre en `--text-muted` (encre sombre) tombait en thème clair sur ce fond quasi noir : **3,04:1 mesuré**. Correctif ciblé, les trois propriétés reposées en variables sur les quatre sous-menus GPX ; aucun autre panneau inline touché. Test E2E dans les deux thèmes, prouvé échouant sans le correctif.
- **Tutoriel** (`src/apps/pctac/tuto-data.ts`) : 7 → 8 chapitres, 61 → 72 étapes. Nouveau chapitre « Traces GPX » (10 étapes : ouverture du panneau, import, lecture de la liste, actions par trace, par jour, barre d'actions, coloration en lot, réglages de tri et de journée opérationnelle, timelapse, archive). Chapitre Dessin : outil « Tracer une ligne droite », renommage verbatim du trait en « Tracer un trait à main levée », nouvelle étape sur le nom déplaçable et rotatif. Catalogue d'icônes : les trois nouvelles entrées. Archive : le dossier `gpx/`.
- **Documentation** : `docs/SPEC-PLANMAP-SPLIT.md` gagne `gpx.ts` et `gpx-play.ts` au tableau des sous-modules, avec une note disant que le contrôle des 189 membres reste figé sur le périmètre du PORTAGE — ces deux modules sont des ajouts postérieurs, absents de l'original. `README.md` mentionne les traces GPX et le rejeu timelapse.

Gate : typecheck 0, lint 0, vitest 2212/2212, Playwright pctac 39/39, gate visuel inchangé (tous les états de carte à 0,000 %, les 7 échecs mesurés à l'identique avec et sans les modifications).

## Dérogations actées

- **AA boutons remplis, thème sombre** (2026-08-09, décision Nico) : `--accent-fill` sombre rétabli à `#4f8dff` (`--tac-blue-500`) — le correctif #2563eb changeait le bleu de l'interface. Ratio blanc/#4f8dff = 3.19:1, sous le seuil AA 4.5:1. Alternative conforme proposée (texte encre sombre sur #4f8dff, 6.6:1) — en attente de décision, non appliquée.

## Blocages / questions ouvertes

- ~~Portail sans gate visuel~~ → réglé (c574e4f) : états `portal`/`portal-light`, masque #net-status, colorScheme dark forcé.
- Décisions Nico (2026-08-09) : (1) alternative AA texte sombre — REFUSÉE, on ne touche à rien ; (2) `--inter-blue` — NE PAS MODIFIER ; (3) normalisation hors échelle — DIFFÉRÉE (explications jugées insuffisantes ; à représenter avec démonstration visuelle avant/après quand pertinent).
- Directive thème clair (Nico) : fond blanc, accentuations PASTELS, code couleur des éléments particuliers identique au mode sombre (hue conservée, saturation/luminosité adaptées).
