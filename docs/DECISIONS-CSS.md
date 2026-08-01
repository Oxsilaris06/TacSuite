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
   **Correctif (P2.FIX reprise 1)** : cette affirmation était fausse pour les
   3 occurrences de `--shadow-glow-accent` (`.add-btn:hover`,
   `.add-log-btn:hover`, `.custom-file-upload:hover`) — régression prouvée en
   mode clair, corrigée depuis ; voir §6 pour l'analyse complète et le
   correctif appliqué.
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
`--metal-sheen`), 14 variables actives (`--z-action` retirée après la purge
du point 5 ; comptage programmatique avant/après re-vérifié en P2.FIX
reprise 1, cf. §6 — le tableau ci-dessous en listait déjà 14, seul le texte
annonçait 13 par erreur) :

| Catégorie | Variables | Valeurs |
|---|---|---|
| Échelle z-index | `--z-raised`, `--z-overlay`, `--z-panel`, `--z-toolbar`, `--z-sticky`, `--z-scrim`, `--z-dialog`, `--z-top` | 5, 10, 11, 12, 1000, 2000, 2001, 3000 |
| Rayons (complètent `--radius-sm/md/lg/full`) | `--radius-badge`, `--radius-icon`, `--radius-pill` | 4px, 8px, 999px |
| Ombre/glow ponctuels | `--shadow-panel-float`, `--shadow-glow-accent` | `0 4px 15px rgba(0,0,0,.4)`, `0 0 15px var(--accent-glow)` |
| Transition | `--transition-quick` | 0.2s |

## 3. Bilan chiffré (avant / après)

| Mesure | Avant (P0.A5, verbatim) | Après (P2.F) |
|---|---|---|
| LOC `styles/pctac.css` | 1724 | 1748 (1738 à l'issue de P2.F ; +10 lignes par le correctif §6.2 — réaffectation de `--shadow-glow-accent` dans `body.light-mode` ; compte réel vérifié par `wc -l`, P2BIS.FIX) |
| Variables `:root` custom properties (thème pctac) | 62 | 76 (+14) |
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

- `node tests/visual/compare.mjs pctac` : **20/20 états PASS** — voir §4.1
  pour les pourcentages réellement mesurés et un correctif d'outillage
  ultérieur qui a invalidé rétroactivement les chiffres annoncés ici à
  l'origine.
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

### 4.1 Correctif d'outillage (P2BIS.FIX) — le masque carte était inerte

Les chiffres « 20/20 PASS, tous ≤ 0,077 % » annoncés en tête de §4 lors de
P2.F ont été obtenus avec un `tests/visual/compare.mjs` **dont le masque de
la carte (canvas MapLibre) ne peignait en réalité aucun pixel**, sans jamais
le signaler : `paintMask()` lisait `rect.w`/`rect.h`, mais pour les états
`canvas:true` le rectangle transmis est un `boundingBox()` Playwright — forme
`{x, y, width, height}`. `rect.w`/`rect.h` valaient donc `undefined`, les
bornes de boucle devenaient `NaN`, et la boucle de peinture ne s'exécutait
jamais (toute comparaison `y < NaN` est fausse) : 0 pixel peint, PASS/FAIL
calculé silencieusement sur l'image carte **non masquée**. Le PASS obtenu
n'était donc pas la preuve d'un diff CSS négligeable *hors carte* qu'il
prétendait être — la carte non masquée passait simplement, par coïncidence
(tuiles chargées identiquement aux deux captures), sous le seuil de 0,1 %.

**Correctif appliqué (`tests/visual/compare.mjs`)** :
`paintMask()` accepte désormais les deux formes de rectangle
(`w ?? width`, `h ?? height`) et retourne le nombre de pixels effectivement
peints ; pour tout état déclaré
`canvas: true`, si 0 pixel est peint côté baseline ou côté capture alors que
le canvas a été localisé (`canvasBox` non nul), l'outil sort désormais en
**ERROR** explicite plutôt que de laisser passer un PASS/FAIL calculé sur un
masque cassé.

**Résultats reproductibles obtenus avec l'outil corrigé** (deux exécutions
indépendantes de `node tests/visual/compare.mjs pctac`, serveur dev
`127.0.0.1:9678`, 1er août 2026) :

| État | Run 1 | Run 2 |
|---|---|---|
| initial-main-courante-desktop | 0,020 % | 0,022 % |
| tab-adversaires-desktop | 0,012 % | 0,012 % |
| tab-otages-desktop | 0,012 % | 0,012 % |
| tab-amis-desktop | 0,012 % | 0,012 % |
| tab-photos-desktop | 0,011 % | 0,011 % |
| tab-plan-desktop (canvas) | 0,012 % | 0,012 % |
| tab-liens-desktop | 0,021 % | 0,021 % |
| tab-plan-panneau-recherche-desktop (canvas) | 0,012 % | 0,012 % |
| tab-plan-dock-dessin-desktop (canvas) | 0,012 % | 0,012 % |
| tab-plan-panneau-tchap-live-desktop (canvas) | 0,000 % | 0,000 % |
| initial-main-courante-mobile | 0,076 % | 0,075 % |
| tab-adversaires-mobile | 0,043 % | 0,043 % |
| tab-otages-mobile | 0,042 % | 0,042 % |
| tab-amis-mobile | 0,042 % | 0,042 % |
| tab-photos-mobile | 0,041 % | 0,041 % |
| tab-plan-mobile (canvas) | 0,042 % | 0,042 % |
| tab-liens-mobile | 0,072 % | 0,072 % |
| tab-plan-panneau-recherche-mobile (canvas) | 0,042 % | 0,042 % |
| tab-plan-dock-dessin-mobile (canvas) | 0,042 % | 0,042 % |
| tab-plan-panneau-tchap-live-mobile (canvas) | 0,042 % | 0,042 % |

**20/20 PASS aux deux runs**, aucune sortie `ERROR` (masque carte désormais
actif sur les 8 états `canvas:true` — confirmé notamment par
`tab-plan-panneau-tchap-live-desktop` à 0,000 % exact, image intégralement
masquée des deux côtés), écarts stables d'un run à l'autre (± 1 à
3 pixels sur ~1,3 M ou ~0,33 M pixels selon le viewport — bruit
d'anti-aliasing de capture, sans rapport avec le CSS), tous très en-deçà du
seuil de 0,1 %. Cet outillage corrigé est celui utilisé pour la validation
CSS de ce document ; les valeurs 6× plus faibles côté desktop que côté
mobile pour les mêmes états s'expliquent par le rapport pixels-masqués/
pixels-totaux, plus favorable en haute résolution.

## 5. Fichier modifié

- `styles/pctac.css` (seul fichier touché par cette mission P2.F d'origine ;
  voir §6 pour les fichiers touchés par le correctif ultérieur).
- `tests/visual/compare.mjs` — correctif du masque carte inerte, cf. §4.1
  (P2BIS.FIX, hors mission P2.F d'origine, documenté ici car il invalide les
  chiffres §4 tels qu'annoncés à l'origine).

## 6. Correctif post-mission (P2.FIX reprise 1) — régression mode clair

### 6.1 Constat

`--shadow-glow-accent`, introduite au §2, est déclarée **une seule fois**,
dans le bloc `:root` du thème, avec un `var()` **imbriqué** :

```css
:root {
    --accent-glow: rgba(79, 141, 255, 0.28);        /* sombre */
    --shadow-glow-accent: 0 0 15px var(--accent-glow);
}
body.light-mode {
    --accent-glow: rgba(29, 99, 214, 0.16);         /* clair */
    /* --shadow-glow-accent n'était PAS réaffectée ici */
}
```

Par la spécification CSS Custom Properties, la valeur calculée d'une custom
property se substitue en résolvant les `var()` qu'elle contient avec la
valeur cascadée **au point de déclaration de cette custom property**, pas
par élément consommateur. `--shadow-glow-accent` n'étant déclarée qu'à
`:root`, son `var(--accent-glow)` s'y résolvait avec la valeur **sombre**,
et cette valeur déjà figée était ensuite héritée telle quelle par
`body.light-mode` — la redéfinition de `--accent-glow` à la ligne 342 n'avait
donc aucun effet sur `--shadow-glow-accent`.

Mesure empirique avant correctif, sur la page servie
(`127.0.0.1:9678/pctac/`, `getComputedStyle(document.body)` après
`document.body.classList.add('light-mode')`) :

| Variable | Attendu (clair) | Mesuré avant correctif |
|---|---|---|
| `--accent-glow` | `rgba(29, 99, 214, 0.16)` | `rgba(29, 99, 214, 0.16)` (correct — pas de `var()` imbriqué) |
| `--shadow-glow-accent` | `0 0 15px rgba(29, 99, 214, 0.16)` | `0 0 15px rgba(79, 141, 255, 0.28)` (valeur SOMBRE figée) |

3 sélecteurs affectés, valeur calculée changeant réellement en thème clair
(contrairement à l'affirmation "sans impact visuel possible" du §1.2/§3
d'origine) : `.add-btn:hover` (698-700), `.add-log-btn:hover` (724-726),
`.custom-file-upload:hover` (1015-1018). Les originaux verbatim
(`pctac2.html:555, 581, 869`, forme littérale `box-shadow: 0 0 15px
var(--accent-glow)` directement sur la règle) n'ont pas ce défaut : un `var()`
non imbriqué se résout par élément consommateur, donc correctement en clair
comme en sombre.

### 6.2 Correctif appliqué

Option retenue : réaffecter `--shadow-glow-accent` dans `body.light-mode`
avec la même forme (`0 0 15px var(--accent-glow)`), pour qu'elle se
résolve dans CE contexte de cascade (donc avec le `--accent-glow` clair) :

```css
body.light-mode {
    ...
    --shadow-glow-accent: 0 0 15px var(--accent-glow);
}
```

(Alternative non retenue : revenir à la forme littérale sur les 3 sélecteurs
et supprimer la variable. Écartée pour rester compatible avec le comptage de
variables au §2/§3, qui suppose son maintien, et parce que la réaffectation
ci-dessus est strictement plus courte tout en respectant "fidélité avant
élégance" — la substitution redevient, comme dans l'original, résolue par
contexte de cascade plutôt que figée.)

Vérification post-correctif (même relevé `getComputedStyle`, sombre puis
clair) :

| Variable | Sombre | Clair (après correctif) |
|---|---|---|
| `--accent-glow` | `rgba(79, 141, 255, 0.28)` | `rgba(29, 99, 214, 0.16)` |
| `--shadow-glow-accent` | `0 0 15px rgba(79, 141, 255, 0.28)` | `0 0 15px rgba(29, 99, 214, 0.16)` |

Les deux thèmes donnent désormais la valeur calculée attendue.

### 6.3 Trou de couverture du gate visuel — corrigé

Les 20 états de `node tests/visual/compare.mjs pctac` capturent tous en mode
sombre (`document.body.className` = `dark-mode`, valeur par défaut du DOM
statique) : aucune baseline ni assertion ne contrôlait le thème clair
au-delà du simple basculement de classe
(`tests/e2e/pctac.spec.ts`, test *"Dock global"*, étape "bascule thème
clair/sombre" — n'asserte que `not.toHaveClass(/dark-mode/)`). C'est
pourquoi la régression du §6.1 a franchi le gate P2.F "20/20 PASS" sans être
détectée.

Correctif : ajout d'une étape E2E ciblée juste après la bascule de thème
(`tests/e2e/pctac.spec.ts`, test *"Dock global — export/import archive,
import OI, thème, plein écran, PDF, reset"*), comparant en clair
`getComputedStyle(document.body).getPropertyValue('--shadow-glow-accent')`
à `0 0 15px ` + la valeur de `--accent-glow` du même contexte — sans capture
d'écran, donc sans baseline à maintenir. Vérifié dans les deux sens :
échoue sur le CSS d'avant correctif (`git stash` local, régression reproduite
puis restaurée), passe sur le CSS corrigé (2/2, chromium-desktop +
chromium-mobile).

### 6.4 Fichiers touchés par ce correctif

- `styles/pctac.css` — réaffectation de `--shadow-glow-accent` dans
  `body.light-mode` (§6.2).
- `tests/e2e/pctac.spec.ts` — étape E2E de non-régression (§6.3).
- `docs/DECISIONS-CSS.md` (ce document) — rectification des affirmations
  §1.2/§3 et des chiffres §2/§3 (13 → 14 variables, 62 → 76, +14).
- `docs/DECISIONS-DOM-ECARTS.md` — conséquence supplémentaire tracée au §1
  (texte du tutoriel décrivant `#version-toggle-btn`, absent du portage).

---

## 7. OI (`styles/oi.css`, P3B.E)

Mission : moderniser `styles/oi.css` (3928 lignes, verbatim P0.A5) sous
contrôle visuel strict, en suivant `.tacsuite-prep/plan-css-oi.md` (analyse
préparatoire en lecture seule, méthode identique à P2.F ci-dessus). Gate
fonctionnel déjà vert (P3.D, 130/130 e2e oi+pctac) — à ne pas casser.
Protocole zéro régression `docs/PLAN.md` §4 respecté à l'identique de
§1 ci-dessus : aucun renommage de sélecteur, aucune spécificité modifiée,
aucun réordonnancement de règle significative pour la cascade.

### 7.1 Lots exécutés

**Lot 1 — Dédoublonnage strict + purge CSS morte `#beta-button`.**
Suppression du mini-bloc `:root { --moicp-zmspcp-purple: #7c6ce0; }`
(redéclaration exacte de la valeur déjà posée dans le `:root` du thème
principal — la bannière de section qui le précédait est conservée comme
repère de navigation) et des 3 points de retouche `#beta-button`
(`docs/DECISIONS-DOM-ECARTS.md` §2 : sélecteur absent du DOM porté) :
règle entière (état desktop), entrée `#beta-button:hover` retirée de la
liste partagée avec `#log-button:hover` (`#log-button:hover` conservé seul),
règle entière en `@media (max-width: 600px)`. 0 règle strictement dupliquée
trouvée par ailleurs (même constat qu'en P2.F).

**Lot 2 — Substitution mécanique des espacements vers le barème `--space-N`
existant.** Recherche exhaustive par regex plein-texte (pas seulement
ligne-à-ligne, pour couvrir aussi les règles compactes sur une seule ligne
type `.adv-section { margin-block-end: 4px; }`) de toute déclaration
`padding*/margin*/gap` (formes physiques ET logiques —
`padding-inline(-start/-end)`, `margin-block(-start/-end)`, etc.) dont
**tous** les tokens de la valeur correspondent exactement à un cran du
barème `--space-1..8` (4/8/12/16/24/32/48/64px) déjà déclaré dans `:root`.
**78 occurrences substituées** (valeur calculée strictement identique par
construction, `!important` préservé où présent) — chaque remplacement
vérifié par diff ligne-à-ligne avant/après (156 lignes de diff = 78 paires
retrait/ajout, aucune ligne inattendue). Écart avec l'estimation
préparatoire (71, §b.5 du plan) : l'analyse préparatoire ne comptait que les
formes physiques sur leur propre ligne ; l'exécution réelle, plus
exhaustive, couvre en plus 6 déclarations en propriétés logiques
(`margin-block-end`/`-start`, `padding-inline`/`-block-end`) et 2 déclarations
compactes multi-règles sur une même ligne — mêmes garanties de sûreté
(substitution 1:1 valeur→variable), pas un changement de méthode. Valeurs
récurrentes hors barème (`10px`, `6px`, `20px`, `15px`, `5px`, `14px`,
`22px`, `30px`) volontairement **non touchées** — même principe qu'en P2.F
§1.6/§1.7 : forcer un arrondi dans `--space-N` romprait la fidélité visuelle
pour un gain cosmétique.

**Lot 3 — Nouveaux tokens à correspondance EXACTE avec `styles/pctac.css`
(même valeur, même rôle sémantique).** 7 tokens réutilisant le nom pctac,
déclarés dans le `:root` du thème OI : `--z-raised`(5), `--z-panel`(11),
`--z-toolbar`(12), `--z-sticky`(1000), `--z-scrim`(2000), `--radius-pill`
(999px), `--transition-quick`(0.2s). 12 occurrences substituées (6 z-index +
4× `border-radius:999px` + 2× `transition:all 0.2s` bare). Aucun de ces 7
tokens n'imbrique de `var()` themé (`--accent-*`/`--border-*`/etc.) — donc
aucun risque de la classe de bug `--shadow-glow-accent` (§6.1) : tous
déclarés uniquement dans le `:root` sombre, sans besoin de réaffectation en
`body.light-mode`.

**Lot 4 — Nouveaux tokens OI-exclusifs (z-index atelier d'annotation photo +
modales, substitution `border-radius:12px` → `--radius-md`).** 6 nouveaux
tokens propres à OI (échelle structurellement distincte de celle de pctac,
cf. plan §b.1) : `--z-drag-raised`(100, `.draggable.dragging` +
`.annotation-toolbar` + `#log-button`), `--z-annot-dock`(1100, `#dock-left`/
`#dock-bottom`), `--z-annot-header`(1200, en-tête collant
`#annotationModal .modal-header`), `--z-annot-panel`(1300, `#dock-right`),
`--z-modal-dialog`(9999, `#quickEditModal`/`#settingsModal`), `--z-modal-top`
(10000, `#annotationModal`/`#pdfLoadingModal`). 10 occurrences z-index
substituées + 7 occurrences `border-radius:12px`/`12px !important` →
`var(--radius-md)` (déjà présent en `:root`, aucun nouveau token requis).

**Portée volontairement NON exécutée dans ce lot** (le plan préparatoire
qualifie ces 2 valeurs de « à confirmer en séance », en dehors de la portée
explicitement chiffrée du Lot 4 — cf. plan §b.1/Lot 4) : z-index `10` (5
occurrences — `.modal-header`×2/`.modal-footer`×2/`.modal-actions-pdf`,
rôle « en-tête/pied sticky de modale », **distinct** du rôle pctac de
`--z-overlay`=10 malgré la valeur identique, cf. plan) et z-index `13` (1
occurrence, `#oi_carto_hint`, sans équivalent pctac). Laissés littéraux —
décision de nommage à trancher par l'utilisateur, pas par cette exécution
autonome. De même pour z-index `2`/`3`/`40` (occurrence unique chacune) et
`border-radius:10px`/`8px`/`4px`/`50%` (hors barème ou occurrence trop
faible) : non touchés, conformément au principe « ne variabiliser que les
valeurs réellement récurrentes ET porteuses de sens » (§1.6/§1.7).

**Lot 5 — Couleurs récurrentes (glass white, rouge corbeille) — NON
exécuté.** Le plan qualifie ce lot d'« optionnel, à valider en séance »,
« le plus cosmétique du plan », à faire « seulement si le gain de
lisibilité est jugé suffisant ». Aucune séance de validation utilisateur
n'a eu lieu pendant cette exécution autonome ; par cohérence avec le
principe « changements chirurgicaux » (n'éditer que le strict nécessaire),
ce lot n'a pas été exécuté. Les ~10 valeurs candidates restent documentées
dans `.tacsuite-prep/plan-css-oi.md` §b.6 si une exécution future est
souhaitée.

### 7.2 Bilan chiffré

| Mesure | Avant (P0.A5, verbatim) | Après (P3B.E) |
|---|---:|---:|
| LOC `styles/oi.css` | 3928 | 3918 |
| Noms de custom properties distincts (`:root` thème OI) | 57 | 70 (+13) |
| Occurrences littérales → `var(--token)` (Lot 2, espacement) | 0 | 78 |
| Occurrences littérales → `var(--token)` (Lot 3, correspondance exacte pctac) | 0 | 12 |
| Occurrences littérales → `var(--token)` (Lot 4, tokens OI-exclusifs) | 0 | 17 |
| **Total substitutions mécaniques** | **0** | **107** |
| Doublons de déclaration supprimés | — | 1 (`--moicp-zmspcp-purple`) |
| Points de purge CSS morte (`#beta-button`) | — | 3 (2 blocs + 1 entrée de liste) |
| Sélecteurs renommés | — | **0** (interdit respecté) |
| Règles réordonnées | — | **0** (interdit respecté) |
| Spécificité effective modifiée | — | **0** (interdit respecté) |

### 7.3 Validation

- `node tests/visual/compare.mjs oi` (mode sombre, 18 états) : **18/18 PASS**
  à chaque checkpoint de lot (1 à 4), pourcentages de diff **strictement
  identiques** d'un lot à l'autre (ex. `step0-situation-desktop` à 0,012 %
  aux 3 checkpoints intermédiaires) — preuve directe qu'aucune substitution
  n'a changé une seule valeur calculée. Détail du run final :
  0,001–0,047 % selon l'état (desktop 1296000 px, mobile 329160 px).
- `node tests/visual/compare.mjs oi-light` (mode clair, 18 états, baselines
  `.tacsuite-prep/oi-baseline-light/` intégrées en P3.D) : **18/18 PASS** à
  chaque checkpoint, mêmes constats de stabilité (0,001–0,052 %). Confirme
  qu'aucun des 7 tokens Lot 3 (theme-agnostiques, cf. §7.1) n'a introduit de
  divergence clair/sombre — vigilance dédiée du plan (piège
  `--shadow-glow-accent`, §6.1 ci-dessus) validée : aucun nouveau token créé
  ne contient de `var()` imbriqué référençant une variable elle-même thémée.
- Les 2 divergences clair/sombre pré-existantes documentées par le plan
  (`--focus-ring`, `--field-border`, non réaffectées dans `body.light-mode`
  — présentes dans l'original `4.html` avant tout portage) : **non
  corrigées**, conformément à la décision du plan (corriger changerait le
  rendu clair par rapport à la baseline figée, hors périmètre « fidélité
  avant élégance »).
- `npx tsc --noEmit` : 0 erreur. `npm run lint` (eslint) : 0 erreur.
- `npm run build` : succès (avertissement taille de chunk JS pré-existant,
  sans rapport avec ce CSS).
- `npx playwright test tests/e2e/oi.spec.ts tests/e2e/pctac.spec.ts` :
  **130/130 verts** (chromium-desktop + chromium-mobile), incluant les
  checklists fonctionnelles qui exercent l'atelier d'annotation photo
  (`#annotationModal`, `#dock-left/-right/-bottom`) et les modales
  `#quickEditModal`/`#settingsModal`/`#pdfLoadingModal` couvertes par les
  nouveaux tokens Lot 4 mais absentes des 9 états `compare.mjs oi` (cf.
  plan, ces états n'ont pas de capture pixel dédiée — gate fonctionnel
  plutôt que visuel, comme pour PC-Tac).

### 7.4 Fichier modifié

- `styles/oi.css` (seul fichier touché par cette mission P3B.E).

### 7.5 Quirks pré-existants supplémentaires portés verbatim (gate P3, remarque non bloquante #4)

Deux autres particularités de l'original `4.html`, distinctes des 2
divergences clair/sombre déjà documentées en §7.3 (`--focus-ring`,
`--field-border`), repérées en relisant `styles/oi.css` après la mission
P3B.E — non touchées, ni par cette mission (hors périmètre des 5 lots
§7.1) ni par aucune mission ultérieure :

- **`--noise-texture` déclarée uniquement en mode clair.** Le token n'existe
  que dans le bloc `body.light-mode { ... }` (`styles/oi.css:394`), pas dans
  le `:root` sombre (`styles/oi.css:69-217`) ni dans le second `:root`
  (`styles/oi.css:220-...`). Utilisée en `background-image` du `body`
  (`styles/oi.css:430`, avec `var(--canvas-glow)`) et en `background-image`
  composite d'un autre élément (`styles/oi.css:552`, avec
  `var(--metal-sheen)`) : dans les deux cas la déclaration `var()` est
  toujours présente en mode sombre, mais résout `--noise-texture` en chaîne
  vide (custom property non définie) — le grain de texture est donc absent
  en mode sombre, présent seulement en mode clair. Comportement de
  l'original, reproduit à l'identique par le portage verbatim P0.A5 (aucune
  substitution du Lot 3/4 ne touche ce token, cf. §7.1 : il n'a pas de
  correspondance pctac et n'entre dans aucun barème). Confirmé stable par
  les gates visuels `compare.mjs oi` (18/18) et `compare.mjs oi-light`
  (18/18, §7.3) : aucune baseline ne le contredit.
- **`--bg-card` avec repli littéral `#1a1a1a`.** Une unique occurrence,
  `background: var(--bg-card, #1a1a1a);` (`styles/oi.css:1204`,
  `.patrac-batch-bar`), diffère de toutes les autres consommations de
  `--bg-card` dans le fichier qui n'ont pas de valeur de repli. `--bg-card`
  est bien déclarée dans les deux `:root` (sombre et clair) — ce repli
  n'est donc jamais activé dans le rendu normal, c'est un vestige défensif
  de l'original (probablement une règle ajoutée avant que `--bg-card` ne
  soit garantie disponible partout). Porté verbatim, non nettoyé : changer
  ou retirer ce repli est une modification de source, pas une
  relocalisation, et sort du principe « changements chirurgicaux » comme du
  protocole zéro régression (`docs/PLAN.md` §4) qui encadre cette mission.
- **Conséquence visuelle** : aucune pour `--bg-card` (repli mort). Pour
  `--noise-texture`, le grain est un effet de 0,02 d'opacité sur un
  `feTurbulence` — sous le seuil de détection des gates `compare.mjs`
  (18/18 oi + 18/18 oi-light, seuils §7.3), cohérent avec l'absence de
  régression observée sur les 4 lots de la mission P3B.E.
- **Trouvé et documenté en réponse au gate P3, remarque non bloquante #4**
  (mission P4.A, solde des 4 remarques non bloquantes).
