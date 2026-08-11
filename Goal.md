# Goal.md — TacSuite : état des lieux UI/UX & feuille de route d'améliorations

> **Révision 2 — 2026-08-11**, ré-audit complet après livraison intégrale de la roadmap R0→R6 (HEAD `0268d27`). Lecture seule, aucun code modifié.
> Méthode : 3 ré-audits délégués en parallèle (UI/UX PC-Tac, UI/UX OI + design system, carto/photos/persistance) avec vérification vrai/faux de chaque constat de la révision 1 contre le code réel, + recherche web des solutions intégrables (conservée, toujours valide). Croisés avec graphify et `state.md`.
> Cadre : applications tactiques à visée institutionnelle — chaque suggestion vise la vitesse et la précision du traitement de l'information, ou la robustesse d'usage. Rien de décoratif.

---

## 0. Ce que R1→R6 a réglé (acquis, ne plus y toucher)

- **R2** : 8 `<dialog>` natifs PC-Tac tous avec `aria-labelledby` ; 0 `alert()`/`confirm()` natif PC-Tac ; `confirm()` OI éradiqué ; `toast`/`confirmDialog` partagés (`src/shared/feedback.ts`) ; focus-visible ; cibles 40px en `pointer: coarse` ; stepper OI focusable au clavier (`role="tab"` + flèches, posé en JS).
- **R3** : `MapPersistenceAdapter` commun PC-Tac/OI (`src/shared/map-persistence.ts`) ; machine à gestes pins partagée (`pin-gestures.ts`) ; roue radiale générique (`radial-menu.ts`) ; **`_renderPins` réconcilié par id et idempotent** (`pins.ts:444-526`) — c'est l'acquis qui rend la carte multi-onglets réaliste.
- **R4/R6** : PDF voie unique, une page par usage, photos hors thread, compteurs calibrés `PAGE_CAPACITY`, 18/18 gardes.
- Portail : implémentation de référence (anti-flash, skip-link, `aria-live`, 190 tokens / 2 `!important`).

---

## 1. État des lieux UI/UX (post-R6)

### 1.1 PC-Tac — verdicts sur les constats de la révision 1

| Constat | Verdict | Preuve |
|---|---|---|
| `#pingModal` mort — impossible de poser un adversaire/otage nommé sur la carte | **TOUJOURS VRAI, aggravé** | `_openPingModal` (`ping-modal.ts:56`) a zéro appelant ; toute la chaîne entité→pin est injoignable : `pendingEntityPin` plus jamais posé (`ping-modal.ts:128` seul site d'écriture), branche `pins.ts:71-80` et résolution fiche→pin `pins.ts:127-146` mortes pour toute donnée nouvelle. Le libellé du FAB ment (« entité ou libre », `index.html:302`) |
| Recherche main courante : JS présent, markup absent | **TOUJOURS VRAI** | `ui.ts:875-896` ; aucun `#search_container`/`#searchInput` dans le HTML ; appeler `toggleSearchMode` jette un TypeError |
| Ordre du journal | **PIRE que décrit** | `saveLogData` **trie en place par heure ASC** (`storage.ts:41-49`) : le plus récent en bas, ET **le tri écrase le drag & drop sans re-render** (`ui.ts:378-392`) — le DOM affiche un ordre que le stockage ne contient pas. Toujours pas de date (`type="time"` seul, `contracts.ts:304-318`) : opération à cheval sur minuit = 00:15 classé avant 23:50 |
| Suppression log sans confirmation | **TOUJOURS VRAI** | `main.ts:394-397`, alors que les collections confirment (`main.ts:414-420`) |
| Statut porté par la photo, pas la fiche | **TOUJOURS VRAI, et cul-de-sac** | Sélecteurs uniquement dans les cartes photo (`ui.ts:690-703`), écrits sur l'objet photo ; heuristique blessures→statut ne tourne qu'à la création (`main.ts:312-319`), jamais recalculée à l'édition ; **statut absent du PDF** (0 occurrence dans `pdf-export.ts`) et absent des pins. Otage sans photo = statut inatteignable (`main.ts:311`) |
| Zéro raccourci clavier hors Plan | **TOUJOURS VRAI** | seuls Échap/Ctrl+Z/Y gardés à la vue Plan (`draw-layers.ts:380-386`) |
| Cibles/ARIA | **PARTIEL** | 40px en pointer coarse (`pctac.css:761-766`) mais base 32px et < 44px WCAG ; tablist flèches OK mais **0 `aria-selected`, 0 `tabpanel`, 0 `aria-controls`** dans le repo |
| États vides/chargement | **TOUJOURS VRAI** | 5 listes en `map().join('')` → chaîne vide (`ui.ts:285,569,602,632,677`) ; hydratation IndexedDB sans indicateur |
| `prompt()` renommage photo | **TOUJOURS VRAI** | `ui.ts:775` — dernier natif bloquant de PC-Tac |
| Reset indistinct dans le dock | **TOUJOURS VRAI** | `index.html:788`, même pastille 42px, seule la couleur du glyphe diffère (modale de confirmation en aval, pas en amont) |
| 8 FABs / dock 11 items scroll caché | **TOUJOURS VRAI** | `index.html:290-313` (commentaires disent encore « 6 FABs ») ; dock `overflow-x: auto; scrollbar-width: none` (`pctac.css:1317-1318`) |
| Erreurs compression photo muettes | **PARTIEL** | corrigé sur 1 chemin (formulaire Photo, toast `main.ts:386-389`) ; **toujours avalées sur 3 chemins** : création et édition adv/otage (`main.ts:357-359, 524-526, 544-546`) |

**Constats nouveaux du ré-audit** :
- **7 des 11 items du dock sont des `<div>` sans `role` ni `tabindex`** (`index.html:764-790` + tuto injecté `main.ts:65`) : export, import, passerelle OI, thème, plein écran, PDF et reset sont **inatteignables au clavier**.
- Fiche Ami **non éditable** (bouton Supprimer seul, `ui.ts:638`) : une faute de frappe impose de recréer la fiche.
- Aucun compteur global (« X adversaires · Y otages ») nulle part — le chiffre que le chef de dispositif énonce en boucle se compte à l'œil.
- Statut exposé uniquement par couleur de bordure (`pctac.css:854-940`) — illisible pour daltoniens rouge/vert.
- Aucun toast de succès (accusé de réception) à l'ajout de log/fiche ; injection non échappée persistante dans catalogue d'icônes/panneaux carte (`ping-modal.ts:96-106`, écart documenté ; `panels.ts:233-244`).
- La saisie d'événement elle-même est saine : heure auto+gel, LRU lieux, focus rendu — la boucle rapide fonctionne.

### 1.2 OI — verdicts

| Constat | Verdict | Preuve |
|---|---|---|
| `--bg-card` déclarée nulle part | **TOUJOURS VRAI** | menu contextuel transparent (`oi/index.html:746`, sans repli), 2 replis figés sombre (`oi.css:1221`, `notifications.ts:36`) ; `docs/DECISIONS-CSS.md:455-465` documente sans corriger |
| `feedback.ts` cassé côté OI | **TOUJOURS VRAI** | `--text-main` 3× sans repli (`feedback.ts:92,129,161`), jamais déclarée dans oi.css ; `--font-ui` absent aussi ; le JSDoc `feedback.ts:19` (« vérifiées dans les deux apps ») est **faux** |
| 3 mécaniques de thème, pas d'anti-flash apps | **TOUJOURS VRAI, pire** | OI applique le thème à l'étape 9 de son init asynchrone, après 2 `await` (`main.ts:430`) → flash sombre long garanti en mode clair |
| 2 systèmes de toast | **TOUJOURS VRAI, arbitrage inversé** | ~14 sites `if (window.toast) window.toast(...) else toast(...)` → **l'ancien système gagne toujours** (`patrac.ts:341,543,898,924,1382`, `medias.ts:223`, `pdf/engine-v3.ts:498-517`…) ; deux esthétiques dans la même session |
| Stepper | **MOITIÉ CORRIGÉ** | focusable + flèches (JS, `main.ts:386-394`) ; mais HTML statique nu, **0 `aria-current` dans le repo**, et **le vert ment toujours** : `visitedSteps` marque traversé (y compris en marche arrière, `navigation.ts:51-53`), jamais rempli |
| Validation 4 champs / cohérence tardive / autosave invisible | **TOUJOURS VRAI** | 4 `attachValidation` sur 41 champs ; `checkCoherence` seulement étape 8 + aperçu ; pastille « Enregistré » existe mais seulement dans la modale Édition rapide (`oi/index.html:496`, `patrac.ts:663-670`) |
| `prompt()`/`alert()` | **MOITIÉ VRAI** | `confirm()` 0 restant (R2 tenu) ; **8 `prompt()`** (`dessin.ts:1052,1642,1740`, `patrac.ts:161,237,248,293`, `pctac/ui.ts:775`) ; **1 `alert()` avec bug fonctionnel** : `presentation.ts:50` — bloquant, non annulable, **et le PDF se génère quand même après** (`:54-55`) |
| 11 `<dialog>` OI sans `aria-labelledby` | **TOUJOURS VRAI** | 0/11 (PC-Tac 8/8) ; les ids de titres existent déjà, rattrapage quasi gratuit |
| Médias : suppression sans confirmation, upload sans feedback, innerHTML inline | **TOUJOURS VRAI (3/3)** | `medias.ts:235-259` irréversible sans undo ; `handleFileChange` séquentiel muet (`:160-232`) ; gabarit 5 `style=` + 6 handlers inline (`:208-217`) |
| Dette CSS | **CONFIRMÉE au caractère près** | oi.css : 4185 l., **349 `!important`**, 63 hex, 16 `'Oswald'` ; pctac.css : 83/54/4 ; tokens typo (`--tac-font-*`) **consommés 0 fois par les apps** ; dock dupliqué **et déjà divergent** (surcharges light-mode côté OI seul, `oi.css:3346+`) |

**Constat nouveau** : OI n'a ni `<main>`, ni `<nav>`, ni skip-link — a11y à deux vitesses (portail exemplaire, PC-Tac à mi-chemin, OI à zéro).

### 1.3 Diagnostic d'ensemble

R1-R6 a livré l'infrastructure (primitives, feedback partagé, adapter carto, PDF). **La dette restante est concentrée sur le câblage et la couche métier** : le système existe, OI ne le consomme pas ; la validation existe, 4 champs sur 41 la branchent ; la résolution fiche→pin existe, rien ne l'appelle. Les corrections à plus fort ROI sont désormais majoritairement des branchements, pas des constructions.

---

## 2. Pistes d'amélioration UI/UX (triées effort × ROI)

Effort : **S** < ½ journée · **M** ½–2 jours · **L** > 2 jours.

### ROI fort / effort S — quick wins (ordre recommandé)

| # | Amélioration | Ancrage |
|---|---|---|
| U1 | **Lien fiche↔pin via la roue, pas la modale morte** : option « Entité » au 1er niveau de `_openCreatePingWheel` (`wheels.ts:96-120`) listant adv/otages/amis non placés — résolution (`pins.ts:127-146`), marquage « placé » (`ping-modal.ts:85`) et rendu existent déjà. Puis supprimer `#pingModal` + `ping-modal.ts` + CSS (`pctac.css:1194-1245`) | le pin porte le nom vivant ; fiche supprimée → `[supprimé]` |
| U2 | Réactiver la recherche du journal (~10 lignes de markup, JS écrit) — sinon supprimer les 3 méthodes et façades pour ôter le piège à TypeError | `ui.ts:875-896, 1071-1073` |
| U3 | `confirmDialog` sur suppression d'entrée de log | `main.ts:394-397` |
| U4 | **Réparer le conflit tri/drag** : soit ordre = tri chrono assumé (et drag supprimé), soit champ d'ordre explicite — aujourd'hui le DOM ment | `storage.ts:41-49` vs `ui.ts:378-392` |
| U5 | Déclarer `--bg-card`, `--text-main`, `--font-ui` dans les 2 blocs de thème d'oi.css (~6 lignes) + corriger le JSDoc `feedback.ts:19` — répare menu contextuel + tous les toasts/dialogs partagés côté OI | `oi/index.html:746`, `feedback.ts:92-161` |
| U6 | Remplacer l'`alert()` de `presentation.ts:50` par `confirmDialog` — **corrige aussi le bug** (le PDF part actuellement malgré les incohérences, sans possibilité d'annuler) | `presentation.ts:50-55` |
| U7 | `aria-labelledby` sur les 11 `<dialog>` OI (ids de titres déjà présents) | `oi/index.html:22-902` |
| U8 | **Dock PC-Tac au clavier** : les 7 `<div>` deviennent `<button>` | `index.html:764-790`, `main.ts:65` |
| U9 | `confirmDialog` avant suppression de photo OI (`toast` déjà importé dans le fichier) | `medias.ts:235` |
| U10 | `aria-selected`/`aria-controls`/`role="tabpanel"` sur onglets PC-Tac ; `aria-current="step"` sur le stepper OI | `main.ts:134`, `ui-platform.ts:466` |
| U11 | États vides explicites sur les 5 listes PC-Tac (« Aucun adversaire — utiliser le formulaire ci-dessus ») | `ui.ts:285,569,602,632,677` |
| U12 | Toasts d'erreur sur les 3 chemins de compression muets + toast de succès à l'ajout log/fiche | `main.ts:357,524,544` |
| U13 | Bouton Modifier sur les fiches Amis (parité avec adv/otages) | `ui.ts:632-640` |
| U14 | Aligner libellés/commentaires sur le réel (« 6 FABs », tooltip FAB Ping) | `index.html:288,302`, `chrome.ts:8,79` |

### ROI fort / effort M

| # | Amélioration | Ancrage |
|---|---|---|
| U15 | **Date d'opération** : champ `dateDebut` de mission + tri `(date, heure)` — sans ça toute opération nocturne (cas nominal) produit un journal inexploitable en relecture judiciaire ; propager au PDF | `storage.ts:43-46`, `contracts.ts:307`, `pdf-export.ts` |
| U16 | **Statut sur la fiche, pas la photo** : champ `status` adv/otage, sélecteur dans listes + modales d'édition, recalcul à chaque édition, **export PDF**, couleur + symbole (pas couleur seule) sur le pin | `ui.ts:569-624, 690-703, 1032-1057`, `pins.ts:127-146` |
| U17 | **Stepper honnête** : `.completed` dérivé de la complétude réelle des champs requis, pas de la traversée — seul point de l'audit qui fait prendre une décision fausse sur un document opérationnel | `navigation.ts:20,51-53` |
| U18 | Étendre `attachValidation` aux champs requis de chaque étape + `checkCoherence` à chaque changement d'étape (infra écrite et testée, 4/41 câblés) | `validation.ts`, `formulaires.ts:564` |
| U19 | **Toast unique** : retirer `import '@oi/notifications.js'`, aliaser `window.toast` sur `feedback.toast`, supprimer les ~14 gardes conditionnelles (−111 lignes, une esthétique) | `main.ts:209`, `notifications.ts` |
| U20 | Thème unifié : anti-flash inline copié du portail dans les 2 apps (7 lignes), pose du thème sortie de l'init async OI, converger vers `data-theme` + clé unique | `oi/main.ts:430`, `index.html:22-23` |
| U21 | Indicateur d'autosave global OI : réutiliser le composant `qe-autosave` existant au niveau app — app 100 % locale, l'utilisateur n'a aucune preuve que son travail est sauvé | `oi/index.html:496`, `patrac.ts:663-670` |
| U22 | Raccourcis clavier PC-Tac : `1..7` onglets, `Ctrl+Entrée` ajout log, `/` recherche, `P` ping — affichés dans les tooltips (Nielsen n°7) | socle `ui-platform.ts:466` |
| U23 | **En-tête de mission permanent** : « X ADV (n neutralisés) · Y OTG (n préoccupants/blessés) · N entrées · dernier évt il y a Xmin » au-dessus des onglets — données déjà calculables | `Storage.loadCollection` |
| U24 | Toolbar carte : 8 FABs → 4 primaires + tiroir « Plus » ; dock 11 items regroupé en 2 menus (« Données », « Affichage »), reset sorti du dock | `pctac.css:1374-1390`, `index.html:750-790` |
| U25 | `promptDialog` ajouté à `feedback.ts` (pattern `<dialog>` + repli jsdom déjà en place) → remplace les 8 `prompt()` natifs | `dessin.ts`, `patrac.ts`, `ui.ts:775` |
| U26 | État de chargement upload photos OI (progression par fichier, `aria-busy`, input désactivé) + squelettes sur hydratation IndexedDB PC-Tac | `medias.ts:160-232`, `ui.ts:566,599,658` |

### ROI moyen / effort M–L — structurel

| # | Amélioration |
|---|---|
| U27 | Feuille partagée `.tac-dock` (~110 lignes dédupliquées, dérive light-mode réconciliée) + `.tac-photo-tile` (élimine le gabarit innerHTML inline de `medias.ts:208-217`) |
| U28 | Consommer `--tac-font-title/ui/data` à la place des 20 `'Oswald'` littéraux ; tokens `--text-on-accent`, crans manquants (`--radius-xs: 4px`…) |
| U29 | Réduction de spécificité oi.css (349 `!important`) — pré-requis avant composants partagés |
| U30 | Landmarks OI (`<main>`, `<nav>`, skip-link) — aligner sur le portail |
| U31 | Réordonnancement accessible (boutons ↑/↓ en plus du drag) sur journal et photos |
| U32 | Échappement systématique des libellés dans panneaux carte (`panels.ts:233-244`) ; migration `onclick=` inline → `data-action` (annoncée `ui.ts:16-18`, non faite) |
| U33 | Nettoyage code mort et dette d'inventaire — détail chiffré en §8 (audit over-engineering) |

**Principes ergonomie poste de commandement appliqués** (MIL-STD-1472H, NN/g, Nielsen — cf. §6) : hiérarchie par exception (rouge = alarme uniquement) ; divulgation progressive (vue d'ensemble → détail au clic) ; cohérence spatiale et symbolique (mémoire musculaire sous stress) ; accélérateurs clavier invisibles au novice ; dark mode = choix opérationnel, thème clair pour plein jour. U16, U22, U23, U24 en découlent directement.

---

## 3. Améliorations contenu PC-Tac (adversaire-otage)

Fiches actuelles — Adversaire : photo + 8 champs (`index.html:118-145`, nom, prénom, D.N. texte libre, lien victimes, antécédents, attitude, substance, armes). Otage : photo + 6 champs (`index.html:166-189`, dont état et blessures). Ami : 5 champs, **non éditable**.

| # | Amélioration | Effort | ROI | Détail |
|---|---|---|---|---|
| C1 | **Statut porté par la fiche** (= U16) : le statut est aujourd'hui saisi dans l'onglet Photos, écrit sur l'objet photo, jamais recalculé après édition des blessures (`ui.ts:1032-1057`), **jamais exporté au PDF, jamais propagé aux pins** — du travail opérateur perdu. Un otage sans photo n'a aucun statut (`main.ts:311`) | M | **Fort** |
| C2 | **Pin d'entité nommé** (= U1) : la position de chaque adversaire/otage lisible d'un coup d'œil, nom vivant, `[supprimé]` automatique | S | **Fort** |
| C3 | Hiérarchiser la fiche adversaire : ARMES et SUBSTANCE (champs conditionnant l'engagement) en tête, pleine largeur, fond contrasté ; Nom/Prénom en titre de ligne — aujourd'hui même poids visuel que D.N. (`ui.ts:575-584`) | S | Fort |
| C4 | Compteurs synthèse en en-tête de mission (= U23) | S | Fort |
| C5 | **Journalisation automatique** : changement de statut, pose/suppression de pin d'entité → entrée main courante horodatée (« ADV Martin neutralisé 15:04 ») — traçabilité judiciaire, ferme la boucle carte↔log | M | Fort |
| C6 | Statut visible avec symbole + couleur (daltonisme) dans listes et pins | S | Moyen |
| C7 | D.N. en `type="date"` ou masque — formats homogènes exploitables au PDF | S | Moyen |
| C8 | Lien adversaire↔otage : `hostage_lien` texte libre → sélecteur sur fiches existantes, navigable dans les deux sens | M | Moyen |
| C9 | Fiche Ami éditable (= U13) | S | Moyen |
| C10 | Recalcul du statut proposé à l'édition des blessures (« État modifié — mettre à jour le statut ? ») au lieu du gel silencieux actuel | S | Moyen |

---

## 4. Système photo ↔ ping sur la carte

**Exigences** : sélection parmi les photos uploadées · affichage sur demande · lightbox plein écran au clic · remplacement à chaud · suppression.

### Design (validé contre le code post-R3, pièges vérifiés)

**Modèle** — `PlanPin` (`types.ts:44-61`) : ajouter `photoId?: string | undefined` (le `| undefined` explicite est obligatoire, `exactOptionalPropertyTypes`). Valeur = id d'item `pcTacPhotos` (= clé IndexedDB `pcTacImages`). **Jamais de base64 dans `pcTacPlanPins`** (quota). Déclarer les nouvelles méthodes dans `PlanMapInternal` (`types.ts:458-465`) — `tsc` échoue sinon (filet `index.ts:48`).

**Sélection** — 8ᵉ option `photo` dans `_openPingOptionsWheel` (`wheels.ts:175-232` ; pas de cap dur dans `radial-menu.ts`, l'angle est calculé depuis `options.length`). Nouveau `_openPinPhotoPanel(pinId)` dans `panels.ts`, calqué sur `_openIconCatalogPanelForEdit` (`panels.ts:503-568`, grille filtrable + `centerScreen:true` — le bon modèle pour choisir parmi N photos). Liste : `Storage.loadCollection('pcTacPhotos')` (sync) puis `ImageStore.getMany`/`hydrate` (async) dans le `onMount` du panneau (`panels.ts` est 100 % synchrone ; `onMount` est le point d'async propre). Nouvel import `@pctac/image-store.js` dans planmap à assumer.

**Badge sur le pin** — dans `_buildPinVisual` (`pins.ts:232-317`), motif `_makeLockBadge`. **4 pièges vérifiés** :
1. **`_pinSignature` (`pins.ts:157-169`)** : ajouter `pin.photoId || ''` — sinon la réconciliation ne redessine jamais le pin après ajout/retrait (branche no-op `pins.ts:506-510`), bug silencieux garanti.
2. **INVARIANT 1 (`pins.ts:227-231`)** : jamais de `position:`/`inset:` dans le cssText du wrap ; le cadenas occupe `top:-7px; right:-7px` → badge photo sur un **coin libre** (`bottom:-7px; left:-7px`).
3. **INVARIANT 2a (`pins.ts:202-225`)** : badge cliquable = les 3 `stopPropagation` (`pointerdown`/`mousedown`/`touchstart {passive:true}`) obligatoires, sinon drag du marker déclenché.
4. **`isExcluded` de `attachPinGestures` (`pins.ts:394`)** ne couvre que `.plan-lock-badge` : ajouter le sélecteur du badge photo, sinon le tap arme le double-tap du pin.

**Affichage à la demande + lightbox** — **ARBITRÉ (Nico, 2026-08-11) : fiable desktop ET mobile.**
- **Vignette** : rendue dans un `_openInlinePanel` (déjà enfant de `map.getContainer()` → **suit le fullscreen gratuitement**, zéro reparentage), lazy (`loading="lazy"`, miniature — jamais de pré-génération, piège perf MapLibre #5656).
- **Plein écran : PhotoSwipe v5** (MIT, ~15 kB gzip, offline via npm) — une seule solution couvrant les deux supports : desktop (clic, molette, clavier, Échap) et mobile/tablette (pinch-zoom de qualité native, seul du marché). Évite de maintenir deux lightbox. La `<dialog>` maison (`ui.ts:780-809`) reste pour la galerie Photos existante ; ne pas la réutiliser côté carte (piège vérifié : `_modalReparent` `types.ts:207-210` est un slot unique en fullscreen).
- PhotoSwipe s'ouvre hors fullscreen carte (sortir du fullscreen avant ouverture, ou monter son root dans `map.getContainer()`).

**Remplacement à chaud** — même panneau, motif exact des panneaux existants : `_loadPins()` → `find` → muter → `_savePins()` → `_renderPins()` → `_closeInlinePanel()`.

**Suppression** — `delete p.photoId` (pas `= undefined` ; précédent `panels.ts:48`). **Intégrité référentielle (piège vérifié)** : `deleteCollectionItem` (`main.ts:414-465`) purge photos, `_sync` et board (3 formes de clés) mais **aucune branche `pcTacPlanPins`** → photo supprimée = badge orphelin affiché jusqu'au reload (la signature ne change pas). Deux options : 4ᵉ purge dans `deleteCollectionItem` (couplage main.ts→pins assumé), ou tolérance + nettoyage du `photoId` orphelin **au rendu** avec re-save. Export/import : `pcTacPlanPins` et images `pcTacPhotos` voyagent ensemble, ids préservés (`archive.ts:113,152`) — un `photoId` vers `pcTacPhotos` **survit** à l'archive, rien à faire.

**Capture PDF** — décider si le badge photo rejoint la liste `toHide` (`capture.ts:76`, qui masque déjà `.plan-lock-badge`). `getPinsSummary` (`pins.ts:663-684`, contrat « ne jette jamais ») à étendre seulement si le PDF doit mentionner la photo.

**Effort : M (2-3 tranches verticales). ROI : fort** — photo de reconnaissance sur la position, zéro navigation inter-onglets. Synergie maximale avec U1/C2 (même zone de code).

---

## 5. Carte en onglet séparé, synchronisée en permanence

> **ARBITRÉ (Nico, 2026-08-11) : REPOUSSÉ.** Chantier différé, non planifié. Le design ci-dessous est conservé comme référence pour le jour où il sera repris. Les pré-requis dette (adapter view, undo/redo, verrou) restent valables indépendamment et peuvent être traités en R5 transversal.

### Design (validé contre le code post-R3)

**Acquis favorables** : `planmap/` n'importe ni `ui.ts` ni `main.ts` (couplage inversé via `window.PlanMap`) ; `_renderPins` idempotent et réconcilié (R3-e) → un appel sur message suffit, sans flash ; état 100 % JSON (POJO) ; photos IndexedDB **déjà partagées entre onglets** ; `pins.ts`/`wheels.ts`/`panels.ts`/`state.ts` ont **0 `getElementById`** (sous-ensemble portable).

**Canal** — `BroadcastChannel('pctac:map')` natif, zéro lib (cf. §6). Point d'insertion : `@shared/map-persistence.ts`, l'unique goulot pins/shapes des deux apps :
- `subscribe(cb): () => void` ajouté à l'interface (`map-persistence.ts:63-70`) ;
- décorateur `createBroadcastAdapter(inner, channel)` : `savePins` → `inner.savePins` puis `postMessage` — **zéro modification de `pins.ts`/`draw-tools.ts`** (ils passent déjà par `this.persistence.*`) ;
- réception → `_renderPins()` + `_renderShapes()` + décorations, flag `_applyingRemote` anti-boucle ;
- handshake obligatoire : le popout émet `hello` prêt, le parent répond snapshot complet (messages post-`window.open` sinon perdus) ; débouncer sur `moveend`.

**Pré-requis dette (bloquants, vérifiés)** :
1. `_loadView`/`_saveView` (`map-core.ts:180-207`) **hors adapter** — `persistence.loadView/saveView` câblés mais jamais consommés (`state.ts:98-101`). Migration = branchement, en préservant 2 écarts : repli Paris non-null, `_saveView` non gardé quota.
2. `_undo`/`_redo` (`draw-tools.ts:63,76`) écrivent localStorage en direct (divergence délibérée §5.8) → un undo dans A ne notifiera jamais B ; router via adapter (revient sur la décision) ou émettre le message aux 2 sites.
3. Verrou `pcTacPlanLocked` **lu une seule fois à l'init** (`map-core.ts:83`) → onglet B ouvert avant un toggle affiche un verrou faux et des markers `draggable` incohérents ; recharger sur message.

**Obstacles majeurs (nouveaux, vérifiés)** :

| Obstacle | Détail | Parade |
|---|---|---|
| **Boucle de rétroaction caméra** | A bouge → B `easeTo` → B émet `moveend` → B `_saveView` → A… (`map-core.ts:99-101`) | **Ne pas synchroniser la caméra** (recommandé — l'intérêt d'un 2ᵉ écran est un cadrage propre) ; clé de vue distincte ou `_saveView` désactivé côté secondaire |
| **Concurrence load→mutate→save** | Pattern non atomique (`pins.ts:98-100, 426-431`) : 2 onglets déplaçant 2 pings dans la même fenêtre → le dernier écrase, l'autre perd sa modif | Merge par id à la réception, ou onglet maître via Web Locks (~15 lignes) |
| **`tchap-live` double session** | Auto-câblage à l'import (`main.ts:83`, flag module `mapWired` `tchap-live.ts:435`) → 2ᵉ onglet = **2 sessions Matrix concurrentes**, doubles écritures | v1 : exclure `tchap-live` de la page carte (perte assumée : pas de marqueurs équipe sur l'écran déporté) ; v2 : élection d'onglet maître |
| **Capture PDF** | `capture.ts:41` exige `mapContainer.offsetWidth > 0` **dans la page qui exporte** — déporter la carte casserait `pdf-export.ts:498-513` | La page principale **garde** sa vue Plan ; l'onglet carte est un miroir additionnel, pas un remplacement |
| **61 ids DOM en dur** (125 `getElementById`, concentrés `chrome.ts` 32 / `ping-modal.ts` 26 / `text-modal.ts` 22) | La page carte doit répliquer tout le chrome (toolbar, dock dessin, recherche, légende, modales) ; gardes `if (el)` = dégradation silencieuse si un bloc manque | Coût dominant de la feature ; commencer par un miroir en consultation (chrome minimal), enrichir ensuite |
| `pctac:quota` window-local (`persist.ts:119`) | Ne traverse pas les onglets | Relayer sur le canal si nécessaire |
| Entrée Vite | 4ᵉ entrée `rollupOptions.input` **et** `injectManifest.globPatterns` (`vite.config.ts:16-24, 54-63`) — liste explicite : page oubliée = **pas d'offline**, le cas d'usage principal | Checklist de la tranche |
| Ordre d'import | `planmap` avant `tchap-live` (contrainte documentée `main.ts:82-83`) ; `window.PlanMap` au scope module, décision §6.1 — ne pas déplacer | Reproduire dans `main-carte.ts` |

**Ordre recommandé** : (1) migrer view vers l'adapter → (2) `subscribe` + décorateur BroadcastChannel → (3) `_undo`/`_redo` + verrou → (4) seulement ensuite la 4ᵉ entrée Vite. Les étapes 1-3 sont testables sans nouvelle page **et profitent aussi à OI** (même interface).

**Effort : L (4 tranches). ROI : fort** — PC de crise réel : carte grand écran, saisie poste opérateur. **v1 conseillée : miroir en consultation** (pins/formes/AOI visibles, pas d'édition) — élimine d'emblée la concurrence d'écriture et 80 % du chrome à répliquer.

---

## 6. Vérification marché — ce qui se branche directement

| Besoin | Solution retenue | Alternatives écartées | Se branche direct ? |
|---|---|---|---|
| Lightbox plein écran | **PhotoSwipe v5** (MIT, ~15 kB gzip) — **arbitré** : une solution fiable desktop + mobile (pinch natif, seul du marché) ; la `<dialog>` maison reste pour la galerie Photos | GLightbox (plan B si vidéo) ; Spotlight.js (pas de pinch) | **Oui** |
| Sync multi-onglets | **BroadcastChannel natif** (support universel depuis 2022) + Web Locks (~15 lignes) si élection d'onglet maître | lib `broadcast-channel` pubkey (fallbacks inutiles en 2026, ROI négatif) ; storage events (hack legacy) ; SharedWorker (surdimensionné, absent Chrome Android) | **Oui** — API DOM, typable TS (union discriminée) |
| Marker avec photo | **Marker DOM MapLibre natif** (élément custom + badge/thumbnail) — suffisant jusqu'à ~100-200 markers visibles ; popup/panneau **toujours lazy** (créé au clic, `loading="lazy"`, miniature) | Symbol layer GPU + clustering : seulement si 500+ points | **Oui** — API cœur 4.7, aucun plugin |
| Ergonomie COP | Principes MIL-STD-1472H / NN/g / Nielsen (§2) — règles de conception, pas de lib | — | s.o. |

**Aucune dépendance nouvelle obligatoire** (PhotoSwipe optionnel, différable). Tout le reste est API navigateur/MapLibre natif — conforme à la sobriété du projet.

---

## 7. Matrice récapitulative effort × ROI

### ROI fort / effort S — 14 quick wins
U1 pin d'entité via roue · U2 recherche journal · U3 confirm suppression log · U4 conflit tri/drag · U5 tokens OI cassés · U6 alert() presentation (bug) · U7 aria-labelledby OI · U8 dock clavier · U9 confirm photo OI · U10 aria onglets/stepper · U11 états vides · U12 toasts erreurs/succès · U13 fiche Ami éditable · U14 libellés exacts

### ROI fort / effort M
**Photo↔ping (§4)** · U15 date d'opération · U16/C1 statut sur fiche + PDF + pin · U17 stepper honnête · U18 validation généralisée · U19 toast unique · U20 thème unifié + anti-flash · U21 indicateur autosave · U22 raccourcis · U23 en-tête de mission · U24 toolbar/dock réorganisés · U25 promptDialog · U26 états de chargement · C5 journalisation auto · C8 lien adv↔otage

### ROI fort / effort L
**Carte onglet séparé (§5)** — **REPOUSSÉ (décision Nico 2026-08-11)** ; seuls ses pré-requis dette (adapter view, undo/redo, verrou) restent éligibles en R5 transversal

### ROI moyen (au fil de l'eau)
C6-C7, C9-C10 · U27-U33 (dock partagé, typo tokenisée, spécificité oi.css, landmarks, réordonnancement accessible, échappement, code mort)

---

## 8. Coupes nettes (audit over-engineering, 2026-08-11)

Suppressions pures — zéro risque fonctionnel sauf mention contraire, **~1 400 lignes et 2 dépendances** récupérables. Chaque coupe rend les chantiers §2-§5 moins chers (moins de code à migrer, thémer, auditer).

### Dépendances mortes (effort S, gain immédiat)
| Coupe | Preuve | Remplacement |
|---|---|---|
| dep `qrcodejs` | **0 référence** dans le code (un seul commentaire, `contracts.ts:528`) | `npm uninstall` |
| dep `html5-qrcode` | seul usage = import de **type** (`contracts.ts:38`), aucun runtime — `#transferModal`/`startQrScan` inexistants | `npm uninstall` + retirer le slot `html5QrCode` du contrat (`contracts.ts:541`) |
| `graphify-out/` (17M) non ignoré git | artefact généré | entrée `.gitignore` |

### Code mort (effort S — sauf premier item, lié à U1)
| Coupe | Lignes | Note |
|---|---|---|
| `#pingModal` + `ping-modal.ts` + CSS mobile dédié | ~350 | **Après U1** (option Entité dans la roue) — supprime `pctac/index.html:449-512`, `planmap/ping-modal.ts`, `styles/pctac.css:1194-1245`, `free_pin_is_vehicle` |
| `planmap/legacy.ts` | 327 | auto-déclaré « code mort interne », 10 méthodes orphelines mixées dans `PlanMap` — **ARBITRÉ (Nico, 2026-08-11) : supprimer** (historique conservé dans git et GStart-main) |
| `oi/notifications.ts` | 111 | = U19 (toast unique) — la coupe est le correctif |
| ~~recherche fantôme PC-Tac~~ | — | **ARBITRÉ (Nico, 2026-08-11) : rebrancher (U2)**, pas supprimer |
| `UI.setPaxMode` + refs DOM fantômes (`pax_select_wrapper_*`, `free_pax_input`, `pax_suggestions`, `free_color_palette`, `jsonImportInput`) | ~30 | DOM absent, confirmé mort depuis P2.FIX (`ui.ts:96-106, 201-212, 814-815`) |
| chapitres tuto « Tableau de bord » | ~140 | enseignent une feature débranchée (`main.ts:84-85` ; `tuto-data.ts:130-272`) |
| `fetchImageAndCompress` + `getAdversaryImageInfo` | ~70 | fonctions mortes assumées (`medias.ts:396, 435`) |

### Quasi-mort / doublons (effort S-M)
| Coupe | Note |
|---|---|
| `pdf-engine-v2.ts` (314 l.) | survit pour un seul membre (`collectAllData`, importé `engine-v3.ts:467`) + import side-effect `main.ts:212` — déplacer `collectAllData` dans engine-v3, supprimer le reste |
| doublon `.dock-menu` (~110 l. ×2, déjà divergent) | = U27 |
| bloc `prefers-reduced-motion` dupliqué à l'identique (`oi.css:117-129` ≡ `pctac.css:112-124`) | rejoint la feuille partagée U27 |
| 20 `'Oswald', sans-serif` littéraux | = U28 (`var(--tac-font-title)`) |
| commentaires/libellés mensongers (« 6 FABs », tooltip FAB Ping) | = U14 |

### Séquence suggérée
0. **Coupes §8 sans dépendance** (½ journée) — deps mortes, `.gitignore`, code mort hors pingModal : allège tout ce qui suit
1. **Quick wins S** (~2 jours cumulés) — U1 d'abord : débloque C2, le lien fiche↔carte, **et** la coupe pingModal (§8)
2. **Photo↔ping (§4) + U16/C1 + C5** — même zone de code, synergie forte : pin nommé + statut + photo + journal auto = le pin devient l'objet opérationnel central. Lightbox = PhotoSwipe v5 (arbitré desktop+mobile)
3. **Structurel M restant** (U15, U17-U26) par tranches verticales
4. *(différé)* Carte onglet séparé — reprendre le design §5 quand le chantier sera relancé
