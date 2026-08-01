# Décisions — modernisation `styles/pctac.css` (Phase 2 / P2.F)

Mission : moderniser `styles/pctac.css` (variables CSS, dédoublonnage,
organisation par sections) **sous contrôle visuel strict** — gate
fonctionnel/E2E déjà vert (P2.E), à ne pas casser. Protocole zéro régression
`docs/PLAN.md` §4 : aucun renommage de sélecteur, aucune spécificité
effective modifiée, aucun réordonnancement de règles dont l'ordre est
significatif pour la cascade.

## 1. Approche retenue

1. **Recensement avant modification** : recherche programmatique (script
   Python, comparaison AST-light par blocs `sélecteur { corps }` normalisés)
   de véritables règles dupliquées (même sélecteur, même corps, verbatim) sur
   l'ensemble du fichier. **Résultat : zéro duplicat de règle complète** — le
   fichier extrait en P0.A5 était déjà propre à ce niveau. Seule trouvaille :
   un commentaire de bannière recopié deux fois de suite (`/* --- THEME
   TACTICAL GLASS --- */`, sans effet sur le rendu) — supprimé.
2. **Dédoublonnage réel constaté à l'échelle des VALEURS** (pas des règles) :
   plusieurs propriétés (z-index, border-radius, box-shadow, transition)
   répètent la même valeur littérale sur 2 à 7 sélecteurs différents. Chaque
   groupe de valeurs strictement identiques a été extrait en une variable
   `:root` unique, puis chaque occurrence remplacée par `var(--nom)`
   — substitution **préservant la valeur calculée à l'identique** (donc sans
   impact visuel possible), vérifiée un par un avant application (comptage
   des occurrences, aucun remplacement à l'aveugle).
3. **Nouvelles variables ajoutées de façon strictement additive**, à
   l'intérieur du bloc `:root` du thème "Tactical Glass" déjà existant
   (`pctac2.html:58 → styles/pctac.css`), à la suite des variables
   d'élévation/voiles déjà présentes. Ajouter des propriétés personnalisées
   dans un bloc `:root` existant ne modifie ni l'ordre ni la spécificité
   d'aucune règle déjà présente — chaque `--xxx` est un nom unique, sans
   collision avec l'existant (vérifié par grep avant ajout).
4. **Organisation par sections** : ajout de bannières de commentaires
   (`SECTION : LAYOUT / PANNEAUX / ANNOTATIONS / MODALES / DOCK FLOTTANT /
   CARTE`) **en place**, sans déplacer une seule ligne de règle existante —
   aucun risque sur la cascade. Le fichier gardait déjà des repères
   `/* --- ... --- */` locaux (thème, dock, toolbar plan, etc.) ; les
   nouvelles bannières les complètent à un niveau plus large sans les
   remplacer.
5. **Suppression de code CSS mort confirmé** : `docs/DECISIONS-DOM-ECARTS.md`
   §1 note explicitement que `#version-toggle-btn` (bouton STABLE/BETA)
   est absent du DOM porté (écart assumé, décision utilisateur) et que "la
   purge [des règles CSS mortes associées] est prévue en P2.F, pas avant".
   Les 4 règles ciblant ce sélecteur (`#version-toggle-btn`,
   `#version-toggle-btn:hover`, l'override `@media (max-width: 600px)`, et
   l'entrée dans la liste partagée `:focus-visible`) ne correspondaient déjà
   à AUCUN élément du DOM porté — leur suppression est donc **sans aucun
   effet visuel possible** sur `pctac/index.html` (vérifié par diff visuel
   avant/après ci-dessous). La variable `--z-action` introduite au point 3,
   devenue sans consommateur après cette purge, a été retirée avec elle.
6. **Aucun remplacement de valeurs non identiques.** De nombreuses couleurs
   `rgba(0, 0, 0, X)` et box-shadows voisines mais NON strictement égales
   (opacités différentes selon le composant) ont été volontairement laissées
   telles quelles plutôt que forcées dans un token commun approximatif — un
   arrondi de valeur, même invisible à l'œil, contredirait le protocole
   "fidélité avant élégance" et gonflerait le risque de diff visuel pour un
   gain de lisibilité marginal.
7. **Espacements** : le fichier disposait déjà d'un barème `--space-1..8`
   (4/8/12/16/24/32/48/64px, hérité de la parité OI). Beaucoup de paddings/
   marges du thème "Tactical Glass" (10px, 15px, 30px…) ne correspondent à
   aucun cran de ce barème — les y forcer aurait exigé soit d'arrondir la
   valeur (risque visuel), soit d'ajouter un token par valeur ponctuelle
   (aucun gain de dédoublonnage, une seule occurrence chacune). Non
   modifiés : cohérent avec le principe "ne variabiliser que les valeurs
   réellement récurrentes" appliqué au reste de cette mission.

## 2. Variables créées

Ajoutées dans le bloc `:root` du thème (à la suite de `--inner-glow` /
`--metal-sheen`), 13 variables actives (`--z-action` retirée après la purge
du point 5) :

| Catégorie | Variables | Valeurs |
|---|---|---|
| Échelle z-index | `--z-raised`, `--z-overlay`, `--z-panel`, `--z-toolbar`, `--z-sticky`, `--z-scrim`, `--z-dialog`, `--z-top` | 5, 10, 11, 12, 1000, 2000, 2001, 3000 |
| Rayons (complètent `--radius-sm/md/lg/full`) | `--radius-badge`, `--radius-icon`, `--radius-pill` | 4px, 8px, 999px |
| Ombre/glow ponctuels | `--shadow-panel-float`, `--shadow-glow-accent` | `0 4px 15px rgba(0,0,0,.4)`, `0 0 15px var(--accent-glow)` |
| Transition | `--transition-quick` | 0.2s |

## 3. Bilan chiffré (avant / après)

| Mesure | Avant (P0.A5, verbatim) | Après (P2.F) |
|---|---|---|
| LOC `styles/pctac.css` | 1724 | 1738 |
| Variables `:root` custom properties (thème pctac) | ~55 | 68 (+13) |
| Occurrences littérales remplacées par `var(--token)` | 0 | 37 (7× transition, 6× `border-radius:4px`, 3× `border-radius:999px`, 2× `border-radius:8px`, 3× `box-shadow` glow, 3× `box-shadow` panel-float, 13× z-index restants après purge) |
| Règles strictement dupliquées trouvées | 0 (vérifié par script) | — |
| Commentaires dupliqués supprimés | 1 | — |
| Sélecteurs CSS morts supprimés (`#version-toggle-btn`, cf. §1.5) | 4 déclarations (3 blocs + 1 entrée de liste) | 0 |
| Sélecteurs renommés | — | **0** (interdit respecté) |
| Règles réordonnées | — | **0** (interdit respecté) |

La légère hausse de LOC malgré la suppression de code mort s'explique par les
bannières de sections et les commentaires de justification ajoutés (lisibilité
> compacité, conformément à l'esprit "organisation par sections commentées"
de la mission).

## 4. Validation

Exécuté après chaque lot de changements (variables + substitutions, sections,
purge du code mort), conformément au protocole :

- `node tests/visual/compare.mjs pctac` : **20/20 états PASS**, tous
  ≤ 0,077 % (seuil 0,1 %), y compris après la suppression du code mort
  `#version-toggle-btn` — écarts résiduels identiques à ceux mesurés AVANT
  toute modification CSS (bruit réseau des tuiles cartographiques, cf.
  `tests/visual/README.md`), aucune dégradation imputable au CSS.
- `npm run build` : succès (warning taille de chunk JS pré-existant, sans
  rapport avec ce CSS).
- `npx tsc --noEmit` : 0 erreur. `npm run lint` : 0 erreur.
- `npx playwright test tests/e2e/pctac.spec.ts` : 60/60 verts sur 3 des 4
  exécutions complètes effectuées ; 1 exécution a rencontré 1 échec isolé
  sur *"Plan — bascule 2D/3D relief"* (chromium-desktop). Investigation :
  ce même test, rejoué seul 3 fois (`--repeat-each=3`), passe
  systématiquement ; rejoué avec le CSS D'ORIGINE (non modifié, via
  `git stash`) sur l'intégralité de la suite, le même échec s'est également
  produit une fois sur plusieurs tentatives. Conclusion : flakiness
  préexistante liée à la contention de ressources (chargement WebGL de la
  carte) quand les 60 tests tournent en parallèle, **indépendante des
  changements CSS de cette mission** — pas une régression introduite par
  P2.F.

## 5. Fichier modifié

- `styles/pctac.css` (seul fichier touché par cette mission).
