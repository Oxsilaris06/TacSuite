# Reconnaissance — Générateur d'OI (4.html) — GStart-main → TacSuite

Repo non-git. Aucun fichier n'a été modifié pendant cette reco. Sources : `graphify-out/GRAPH_REPORT.md` (pas de `wiki/index.md` dans ce projet — navigation graphe indisponible, lecture directe fichiers utilisée), lecture directe de `4.html`, modules, et 4 sous-agents Explore parallèles.

---

## 1. Point d'entrée `4.html` (5097 lignes)

Structure globale :
- **L.1-42** : `<head>` — meta, `shared/ui-platform.css`, `shared/ui-platform.js` (L.27-28), Google Fonts (Oswald/Inter/JetBrains Mono), Material Symbols, MapLibre GL 4.7.1 (CDN CSS+JS, L.41-42).
- **L.5-13, 15-23** : 2 scripts inline courts — lien manifest dynamique (évite CORS en `file://`), filet global `error`/`unhandledrejection`.
- **L.43-111** (69 lignes) : script inline — intercepteur de logs console avec persistance `localStorage` débouncée (`gstart_captured_logs`) et fenêtre de debug `window.openLogs()`.
- **L.112-3831** (**3720 lignes**) : `<style>` inline unique — thème "tactical/OLED" complet (variables CSS, wizard, dock, modales, canvas d'annotation, cartographie). Pas de logique, CSS pur.
- **L.3832-4501** : DOM body principal — dialogs système + `.container` app (voir §3).
- **L.4502-4534** : chargement scripts — CDN (pdf-lib, marked, html2canvas, jsPDF, html2pdf.js, JSZip) puis 16 modules `modules/*.js` classiques dans l'ordre : `notifications → init → outils → pdf_engine_v2 → presentation → navigation → medias → formulaires → patrac → articulation → drag → dessin → shared → oi_cartographie → tuto-engine → tuto_oi_data`.
- **L.4536-4814** (278 lignes) : script inline — handler unique `DOMContentLoaded` (séquence d'init + tous `addEventListener` reliant boutons DOM ↔ fonctions modules). seule fonction métier y est définie en dur : `window.setPdfFormat(fmt)` (L.4795-4806, bascule A4/16:9, persiste `pdfOutputFormat`).
- **L.4815-5093** : DOM supplémentaire (modales placées après `<script>` : effraction, sélection membre canvas, cartographie, capture carto, loader PDF).
- **L.5094-5097** : fermeture.
**Bilan inline vs modules** : sur 5097 lignes de `4.html`, ~3720 sont CSS pur et ~350 JS inline (dont ~280 = câblage d'event listeners, pas de logique métier propre). **Aucune règle métier significative n'est écrite dans fichier HTML lui-même** — tout (calculs, PDF, drag&drop, validation) est délégué aux modules. `4.html` est gabarit DOM + CSS + orchestration d'événements.

---

## 2. Inventaire modules JS (chargés par 4.html, ordre de chargement)

Système de modules **classique** (pas d'ESM, pas de `import`/`export`) : tous partagent l'espace global `window`, communiquent via variables globales définies par `init.js` (`Store`, `dbManager`, `memberConfig`, etc.) et conventions de nommage de callback (`onclick="fn(...)"` résolu dans scope global).

| Module | LOC | Responsabilité | API publique clé | Storage direct |
|---|---|---|---|---|
| `modules/notifications.js` | 89 | Toasts non bloquants | `window.showNotification`, `window.toast` | — |
| `modules/init.js` | 394 | Socle : constantes, `Store` (Proxy réactif profond), `dbManager` (IndexedDB) | `window.LOCAL_STORAGE_KEY='tactical_oi_data'`, `window.Store.{state,subscribe,notify,saveToStorage,loadFromStorage,checkIntegrity}`, `window.dbManager.{init,putItem,getItem,getAllKeys,deleteItem,clearAllImages}`, `window.DEFAULTS`, `window.memberConfig` | localStorage `tactical_oi_data` ; IndexedDB `OI_GeneratorLiteDB`/`images` |
| `modules/outils.js` | 430 | Géométrie canvas, compression image, embed pdf-lib (⚠ inutilisé), thème/fullscreen/dock | `hexToRgb`, `getEventPos/getRotatedPoint/getAnnotationAtPosition`, `compressImage`, `embedPdfImageFromBytes` (mort), `handleThemeToggle`, `toggleDock`, `toggleFullscreen` | localStorage `theme`, `dockCollapsed` |
| `modules/pdf_engine_v2.js` | 1156 | **Moteur PDF actif** (html2canvas+jsPDF) | `window.PDFEngineV2.{openPreview,openPresentInPlace,downloadOiPdf,collectAllData,generateHTML}`, `window.downloadOiPdf`, `window.openPresentInPlace` | lit IndexedDB (photos), lit `Store` |
| `modules/presentation.js` | 53 | Ouverture modale d'aperçu (délègue à PDFEngineV2) | `window.openPresentationMode`, `sanitizePdfText` (définie mais orpheline, non appelée) | — |
| `modules/navigation.js` | 49 | Pilotage wizard 8 étapes | `showStep`, `goToStep`, `changeStep` | localStorage `oiWizardStep`, `oiVisitedSteps` |
| `modules/medias.js` | 283 | Upload/preview/suppression photos, fond PDF perso | `handleFileChange`, `removeImage`, `syncAllThumbnails`, `handleCustomBackgroundChange` | IndexedDB `images` (clés `img_*`, `custom_pdf_background`) |
| `modules/formulaires.js` | 1338 | **Cœur persistance** : sync DOM⇄Store⇄localStorage, champs dynamiques, cohérence, sessions/archives | `syncDomToStore`(débouncée)/`syncDomToStoreImmediate`, `loadFormData`, `checkCoherence`, `exportSession/importSession`, `exportArchive/importArchive`, `addDynamicField/addMeField/addTimeEvent/addAdversary/addHypothesis`, `resetActivePage/resetAllData` | localStorage `tactical_oi_data` (écriture) |
| `modules/patrac.js` | 1201 | Tableau PATRACDVR (véhicules/personnel), quick-edit, batch, config unité, PDF PATRACDVR dédié | `addManualVehicle/addManualMember/addCellBatch`, `initializePatracdvr`, `populateQuickEditPanel/saveQuickEditChanges`, `togglePatracBatchMode` + `patracBatch*`, `openUniteConfigModal/saveUniteConfig`, `generatePatracdvrPdf` (pdf-lib) | aucun direct (via Store) |
| `modules/articulation.js` | 1011 | MOICP/ZMSPCP/Effraction dérivés PATRACDVR + 3 listes ordonnables | `addMoicp/addZmspcp/addEffraction`, `refreshRameVL/refreshColonneProgression/refreshOrdrePenetration`, `refreshArticulationFromPatracdvr`, `openEffractionToolsModal/saveEffractionTools` | aucun direct (via Store) |
| `modules/drag.js` | 370 | Drag&drop natif (souris) + émulation tactile pour PATRACDVR/photos | `initializeDragDropListeners`, `initDocumentDragTransfer`, `persistAfterDrag` (interne) | aucun (délègue) |
| `modules/dessin.js` | 1348 | Moteur d'annotation canvas (5 types), undo/redo, manipulation directe | `openAnnotationModal/closeAnnotationModal`, `setActiveTool`, `undoAnnotation/redoAnnotation`, `createAnnotatedImageBlob` | dataset DOM + IndexedDB via dbManager |
| `modules/shared.js` | 288 | Composants Adversaire/Pax/Photo réutilisables — **chargé mais non invoqué par DOM/UI de 4.html actuel** (dead-code probable, cf. §7) | `window.SharedComponents.{Adversaire,Pax,Photo}` | localStorage `gstart_shared_data` |
| `modules/oi_cartographie.js` | 1681 | Cartographie MapLibre intégrée (pins, dessin, capture) — réécriture indépendante système pctac, pas de partage de code | `window.OICarto.{open,close,...}` | aucun direct — persiste dans `Store.state.formData.cartography` |
| `modules/tuto-engine.js` | 755 | **Moteur de tuto partagé** (voir §5) | `window.PocheTuto.mount(cfg)` | localStorage `ptuto_<appId>_seen/_pos/_greeted` |
| `modules/tuto_oi_data.js` | 894 | Données verbatim tuto OI (voir §5) | — (appelle `PocheTuto.mount`) | — |

Plus **`shared/ui-platform.js`** (319 LOC, chargé en tête, voir §6).
**Total app OI (4.html + tous ses modules + shared/ui-platform)** ≈ **15 886 lignes** (5097 + 10 329 modules classiques + 319 shared.js + 141 shared.css).
---

## 3. DOM principal de 4.html (détail)

**Dialogs "système" avant `.container`** (L.3836-4072) : inputs fichiers cachés (`sessionFileInput`, `archiveFileInput`, `jsonConfigInput`), `presentationModal` (aperçu + toggle format A4/16:9), `resetOptionsModal`, `quickEditModal`, `uniteConfigModal`, `importSelectModal`, `annotationModal` (canvas d'annotation avec triple dock d'outils).

**`.container` / `#oi-form`** (L.4074-4470) : header, `wizard-progress` (barre 8 étapes cliquables), 8 `<div class="wizard-step">` :
1. **Situation** (date_op, situation générale/particulière)2. **Adversaire(s)** (conteneur dynamique, `createAdversaryBtn`)
3. **Environnement** (amies, terrain, éclairage, population, accès, cadre juridique...)4. **Mission** (`missions_psig`)
5. **Exécution** (date/heure H, chronologie T0-T4, hypothèses, photos cheminement)6. **Articulation MOICP/ZMSPCP** (rame VL / colonne progression / ordre pénétration en drag&drop, blocs MOICP/ZMSPCP/Effraction)7. **PATRACDVR** ( plus riche : toolbar config/PDF/reset, mode batch, quick-edit panel, création véhicules/membres/cellules, conteneurs véhicules + non-affectés + poubelle)8. **Finalisation** (fond PDF perso, rédacteur, CAT générales/NO-GO/liaison, alertes de cohérence, récap, bouton `previewBtn`)

**Dock menu flottant** (`#dockMenu`, L.4472-4499) : toggle réduire/agrandir, lien vers pctac, cartographie, export/import archive, reset, dark mode. bouton tuto s'y insère dynamiquement (`insertAfter: '#dockToggleBtn'`).

**Modales additionnelles après scripts** (L.4815-5093) : `effractionToolsModal`, `memberSelectionModalCanvas`, `memberContextMenu` (clone/supprimer), `cartographyModal` (carte + toolbar dessin), `oi_carto_ping_modal`, `oi_carto_capture_modal` (export PNG ou vers champ photo OI), `pdfLoadingModal` (overlay génération).

---

## 4. Logique métier / document généré

**Entrée** : formulaire multi-étapes (8 étapes) capturant situation, adversaires (fiches complètes + photos), environnement, mission, exécution (chronologie + hypothèses), articulation tactique (MOICP/ZMSPCP/Effraction dérivés automatiquement PATRACDVR), tableau PATRACDVR (personnel/véhicules avec armes/équipements/fonctions), cartographie (pins + dessins MapLibre), et infos de finalisation.
**Sortie** : document **"Ordre Initial"** — PDF paysage (A4 ou 16:9 configurable) généré par `PDFEngineV2` (`modules/pdf_engine_v2.js`), via **html2canvas + jsPDF** (pas pdf-lib côté OI, contrairement à PATRACDVR qui utilise pdf-lib). 3 chemins de sortie :
1. **Aperçu HTML vivant** (`openPreview`) dans `#presentationModal`.
2. **Téléchargement PDF** (`downloadOiPdf`) : rendu HTML → rastérisation page par page (échelle adaptative 1.5-2× selon nombre de pages) → assemblage jsPDF → fichier `OI_<date_op>_<trigramme_redacteur>.pdf`.
3. **Mode présentation plein écran autonome** (`openPresentInPlace`) : nouvel onglet, document Blob 100% autonome (diaporama ou liste, navigation clavier/tactile).

Structure pages PDF : garde → fiche par adversaire (+ galeries) → environnement/amis → mission → exécution (chronologie/hypothèses) → transports → articulation & ordres de mouvement → boucle ZMSPCP/MOICP/Effraction par cellule (avec galeries photo) → CAT générales (conditionnelle) → récapitulatif PATRACDVR paginé (12 ou 8 membres/page selon densité) → page de fin. **Numérotation titres incohérente** (deux sections "7.").

**PDF secondaire indépendant** : `generatePatracdvrPdf()` (`modules/patrac.js`) génère tableau paysage A4 dédié au PATRACDVR seul, via **pdf-lib** (police Helvetica standard → neutralisation caractères non-WinAnsi par `?`).

**Règles de calcul/formatage notables** :- Pas de formatage de dates : valeurs saisies insérées telles quelles dans PDF (aucune logique de date/heure dans moteur).- Pas d'échappement HTML systématique dans `pdf_engine_v2.js` (contrairement à `formulaires.js` qui échappe à restauration) — risque XSS théorique si données ne sont pas nettoyées en amont.
- Auto-peuplement MOICP/ZMSPCP/Effraction depuis PATRACDVR (cellule India→MOICP, AO→ZMSPCP, "effrac"→Effraction) uniquement à création manuelle, jamais au rechargement (fidélité de restauration).- Cellules India (max 5) / AO (max 8) avec numérotation auto et équipement par défaut (Effraction : 1er PAX→Bélier, 2e→Lot 5.11).- `checkCoherence()` (formulaires.js) : alertes multiples avant génération (date manquante, adversaire incomplet, arme manquante, chronologie <3 étapes ou T4 absent, membres non affectés...).

---

## 5. Persistance

**localStorage** (clés confirmées par grep) :| Clé | Écrite par | Contenu |
|---|---|---|
| `tactical_oi_data` (= `LOCAL_STORAGE_KEY`) | `Store.saveToStorage` (init.js), via `syncDomToStore` (formulaires.js) | **Tout `formData`** : champs, adversaires, patracdvr_rows/unassigned, articulation, cartography, chronologie, hypothèses || `theme` | `outils.js` (`handleThemeToggle`) | `light`/`dark` |
| `dockCollapsed` | `outils.js` (`toggleDock`) | état replié dock |
| `oiWizardStep` | `navigation.js` (`goToStep`) | étape courante wizard |
| `oiVisitedSteps` | `navigation.js` (`goToStep`) | étapes déjà visitées |
| `pdfOutputFormat` | inline `4.html` (`setPdfFormat`) | `a4` / `16:9` |
| `gstart_captured_logs` | inline `4.html` (log interceptor) | logs console débogage mobile |
| `gstart_shared_data` | `modules/shared.js` (`SharedData`) | **probablement mort** — aucun appel UI de `SharedComponents.*.renderForm/renderList` détecté dans 4.html |

**IndexedDB** : base `OI_GeneratorLiteDB`, store `images` (clé→Blob) — toutes photos + `custom_pdf_background`. Wrapper `dbManager` (init.js).

**Import/export** :- `exportSession()` / `importSession(file)` — dump JSON brut de `localStorage['tactical_oi_data']` uniquement (pas photos).
- `exportArchive()` / `importArchive(file)` — archive **`.oi.zip`** (JSZip) complète : champs + photos HD (IndexedDB) + cartographie ; import avec sélection catégorielle (`importSelectModal`), fusion non destructive, rollback si quota localStorage dépassé, garde-fou `manifest.appName === 'OI'`.

---

## 6. Tuto interactif — `window.PocheTuto` (`modules/tuto-engine.js`, 755 LOC)

Moteur **autonome, partagé à l'identique** entre deux apps (aucune dépendance, IIFE idempotent `if (window.PocheTuto) return`).

**API** :```js
PocheTuto.mount({
  appId: 'oi' | 'pctac',      // préfixe localStorage : ptuto_<appId>_seen/_pos/_greeted
  appName: 'OI - ADI' | 'PC Tac',
  accent: '#4f8dff',
  buttonLabel: 'Tuto',
  dock: { selector:'#dockMenu', itemTag:'div', itemClass:'dock-menu-item', icon:'menu_book', title, insertAfter:'#dockToggleBtn' },
  data: { intro:{title,text}, chapters:[ {id,icon,title,summary,steps:[ {title,body,terms:[...],selector,tip} ]} ] }
})
```
- `body` supporte mini-markdown (`**gras**`).
- `selector` optionnel surligne l'élément réel page (overlay).
- Génère lui-même son bouton FAB flottant, **injecté dynamiquement dans `#dockMenu` après `#dockToggleBtn`** — aucun point d'ancrage statique dans DOM deux apps.- Suivi de progression par chapitre/étape (`Set` d'étapes vues), reprise à dernière position, message d'accueil au premier lancement ( fois par `appId`).

**Utilisation par deux apps** — pattern identique, seules données changent :- **4.html** charge `modules/tuto-engine.js` puis `modules/tuto_oi_data.js` (894 LOC) → `appId:'oi'`, contenu verbatim sur wizard OI (dock, étapes, PATRACDVR, cartographie OI, export...).
- **pctac2.html/pctac.html** chargent `modules/tuto-engine.js` (même fichier, chemin identique) puis `modules/pctac/tuto_data.js` (964 LOC) → `appId:'pctac'`, contenu verbatim sur 7 onglets PC Tac.
- fichiers de données sont explicitement marqués **"généré, ne pas éditer à main"** et **"VERBATIM (repris exactement de l'interface)"** — à traiter comme fixtures de contenu, pas logique, lors portage (mais leur fidélité texte est contrat à préserver si tuto est repris).
---

## 7. CODE PARTAGÉ entre 4.html et pctac2.html/pctac.html

Confirmé par grep `<script>`/`<link>` 3 fichiers :
| Fichier partagé | Rôle |
|---|---|
| **`shared/ui-platform.js`** (319 LOC) | Socle transverse "native-quality" : `window.UIPlatform` = `esc/escAttr` (anti-XSS), `loadState/saveState/persistState` (wrapper localStorage), `lockScroll/unlockScroll` (réf-compté), `clampToViewport`, `onLongPress/onDoubleTap`, `sortable()` (drag tactile unifié Pointer Events), `makeDialog()` (modale accessible, focus trap), `makeTablist()` (nav clavier onglets), suivi clavier virtuel mobile. **Aucun composant visuel** — uniquement comportements/accessibilité/tactile bas niveau. |
| **`shared/ui-platform.css`** (141 LOC) | CSS associé : variables safe-area, anti-zoom iOS, `:focus-visible`, neutralisation hover figé mobile (liste de classes 2 apps), `prefers-reduced-motion`, classes `.up-scroll-locked/.up-no-callout/.up-tap-target/.up-sort-*`. || **`modules/tuto-engine.js`** (755 LOC) | Moteur de tuto (§6) — code identique, seules données diffèrent (`tuto_oi_data.js` vs `pctac/tuto_data.js`). |

**Pas d'autre partage de code applicatif** : 4.html est étanche vis-à-vis de `modules/pctac/` (0 référence, incompatible de toute façon — ESM vs classique), et pctac2.html/pctac.html ne chargent aucun autre module "classique" que `tuto-engine.js`.

**Divergence notable pour portage** : 4.html charge ses libs tierces (pdf-lib, marked, html2canvas, jsPDF, html2pdf.js, JSZip, maplibre-gl) **via CDN** (unpkg/cdnjs), alors que pctac2.html/pctac.html chargent **mêmes libs vendorées localement** (`vendor/*.min.js`, ~2 Mo, offline-first, cohérent avec service worker `sw.js`). Dette technique à corriger dans TacSuite (unifier sur dépendances npm/bundlées, pas de CDN runtime).

`oi_cartographie.js` (OI) et `modules/pctac/{coords,planMap,config}.js` (PC Tac) sont **UX-similaires mais 100% réécrits indépendamment** (aucune fonction partagée, confirmé par grep croisé) — c'est portage conceptuel volontairement allégé côté OI (pas de conversion MGRS/UTM/DMS, catalogue d'icônes statique de 28 entrées vs catalogue complet PC Tac), documenté comme tel dans son commentaire d'en-tête.

---

## 8. Autres éléments de GStart-main — porter ou ignorer

### À porter
- `shared/ui-platform.js` + `.css` — socle commun (§7)
- `modules/tuto-engine.js` + `tuto_oi_data.js` + `pctac/tuto_data.js` — tuto interactif
- Tous modules `modules/*.js` chargés par 4.html (§2) + tout `modules/pctac/*` (ESM, actif côté PC Tac)
- `vendor/*` (libs vendorées) — à généraliser aux deux apps
- `sw.js`, `manifest.json` (⚠ `start_url` pointe vers `./1.html`, legacy — à corriger), icônes PWA
- `tests/pctac/*.mjs` (5 fichiers, seuls tests existants repo)

### Legacy / mort — à ignorer
- `1.html` (ancêtre direct pré-4.html) et `old.html` (**byte-identique à 1.html**, doublon exact confirmé par diff)
- `oldpctac.html` (ancêtre de pctac2.html/pctac.html)
- `2.html`, `3.html` (pages de présentation/pitch marketing OI et PC-TAC, pas l'outil)
- `tchap_geoloc_test.html` (prototype Phase 1, absorbé depuis dans `modules/pctac/tchapLive.js`)
- `modules/presentation_legacy.js` (1735 LOC, commentaire explicite "conservé pour compatibilité/repli", **chargé par aucun HTML**)
- dossier `old modules/` (11 fichiers, versions antérieures modules actuels, **chargé par aucun HTML**)
- `fusion_nativ.js` (script Node one-shot de réécriture HTML, déjà exécuté, valeur archéologique seulement)
- `tchap-live/` (mini-projet Vite séparé, code déjà absorbé en prod)
- `.rules/` (vide), `check_syntax*.log` (résidus de debug)
- Données d'exemple à racine (PDF/JSON/PNG réels) — utiles en fixtures de test manuel, pas code à porter
### À examiner/clarifier avec l'utilisateur avant décision
- `index.html` — landing, mais `manifest.json.start_url` pointe vers `1.html`, pas `index.html` : rôle réel incertain
- `mhe.html` / `mhe2.html` — "Dossier de Reconnaissance d'Objectif" (fiche cible), fonctionnalité satellite non intégrée à 4.html
- `mrz.html` — scanner MRZ (passeport/CNI), outil indépendant
- `patracdvr.html` — écran PATRACDVR dédié, potentiellement lié fonctionnellement à 4.html
- `qg.html` — "Centre de commandement Praxis", nom de code distinct, périmètre à clarifier
- `synthese.html` — vue de synthèse/dashboard ADI
- `présentation.md` — doc produit/pitch (contexte, pas code)

**Doublon confirmé `modules/shared.js`** : successeur quasi-identique (juste accessibilité + cosmétique) de `old modules/shared_components.js` — ce dernier legacy, `modules/shared.js` actif mais lui-même probablement non invoqué par l'UI de 4.html (voir §2/§7 dead-code).

---

## 9. Checklist fonctionnelle de non-régression — Générateur d'OI

**Navigation / wizard**- [ ] 8 étapes accessibles via barre de progression cliquable et via Précédent/Suivant- [ ] Étape courante et étapes visitées persistées (`oiWizardStep`, `oiVisitedSteps`) et restaurées au rechargement
- [ ] Contrôle de cohérence déclenché automatiquement à dernière étape (alertes affichées dans `coherence_alerts_container`)

**Étape 1 — Situation** : date_op, situation_generale, situation_particuliere (saisie + persistance)
**Étape 2 — Adversaires** : ajout/suppression d' fiche adversaire complète, titre dynamique, section collapsible, champs identité/dangerosité/localisation/mobilité, photos (upload, compression, annotation), "Moyens Employés" (max 3 en saisie interactive, illimité en restauration)
**Étape 3 — Environnement** : tous champs texte (amies, terrain, éclairage, lever soleil, population, faune, accès, cheminement, cadre juridique) + photos cheminement transport (PR/domicile)
**Étape 4 — Mission** : `missions_psig` (texte pré-rempli modifiable)

**Étape 5 — Exécution** : date/heure H, chronologie (ajout/suppression événements T0-T4 avec préremplissage séquentiel en création manuelle), hypothèses (ajout/suppression), photos
**Étape 6 — Articulation MOICP/ZMSPCP** : place chef, 3 listes réordonnables par drag (souris) et tactile (rame VL, colonne progression, ordre pénétration), blocs MOICP/ZMSPCP/Effraction (ajout manuel + auto-peuplement depuis PATRACDVR), synchronisation incrémentale non destructive à toute mutation PATRACDVR, modale outils d'effraction par photo
**Étape 7 — PATRACDVR** ( plus riche fonctionnellement)- [ ] Création véhicule manuel, membre manuel, cellule en lot (India/AO/Effrac) avec règles de plafond (5/8) et équipement auto Effraction- [ ] Drag&drop souris ET tactile (véhicule↔non-affectés↔poubelle), avec confirmation de suppression- [ ] Panneau quick-edit (accordéon, couplage cellule↔fonction, attributs multi-select vs mono-option)- [ ] Mode batch (sélection multiple, déplacement/désaffectation/effacement en lot), désactivé en tactile pour éviter conflit de geste- [ ] Menu contextuel clic-droit (cloner/supprimer membre)- [ ] Configuration d'unité (`uniteConfigModal`) éditant listes d'options (`memberConfig`)
- [ ] Génération PDF PATRACDVR autonome (pdf-lib, tableau paysage, neutralisation caractères non-WinAnsi)- [ ] Réinitialisation PATRACDVR isolée reste données
**Étape 8 — Finalisation** : fond PDF personnalisé (upload/suppression), infos rédacteur, CAT générales/NO-GO/liaison, récapitulatif, alertes de cohérence bloquantes/informatives, bouton Aperçu
**Cartographie OI** (`cartographyModal`) : ouverture/fermeture, carte satellite+relief 3D, placement de pins (menu radial `OIWheel`, 5 types + icônes/couleurs/renommage), dessin (trait/rectangle/cercle, undo/redo, couleurs), recherche adresse (Nominatim), capture (téléchargement PNG ou export direct vers champ photo de l'OI), persistance dans `formData.cartography` (incluse dans export/import)

**Annotation photo** (canvas) : 5 types (location/arrow/box/text/member), déplacement/redimensionnement/rotation par poignées, undo/redo (Ctrl+Z/Y), appui long mobile (500ms + vibration), zoom, couleurs, épaisseur, aplatissement final pour export PDF — cohérence entre rendu interactif et rendu export
**Génération document**- [ ] Aperçu HTML vivant (`openPresentationMode` → `PDFEngineV2.openPreview`)
- [ ] Téléchargement PDF (`downloadOiPdf`) — format A4 paysage ou 16:9 (persisté), toutes sections dans l'ordre attendu, échelle adaptative selon nombre de pages, nom de fichier `OI_<date>_<trigramme>.pdf`, détection de pages vides
- [ ] Mode présentation plein écran autonome (`openPresentInPlace`, nouvel onglet, diaporama/liste, navigation clavier/tactile/plein écran)
- [ ] Bascule format A4/16:9 persistée (`pdfOutputFormat`)

**Persistance / sessions**- [ ] Auto-sauvegarde continue (debounce 500ms) + flush forcé sur `pagehide`/`beforeunload`/`visibilitychange`
- [ ] Export session JSON (`exportSession`) / import (`importSession`)
- [ ] Export archive complète `.oi.zip` (champs+photos+carto) / import avec sélection catégorielle et fusion non destructive
- [ ] Reset page active vs reset total (avec confirmation modale)- [ ] Restauration fidèle après rechargement (aucune perte de données ni troncature liée aux limites UX de saisie)
**UI transverse**- [ ] Dock flottant : réduire/agrandir (persisté), lien PC Tac, cartographie, export/import, reset, dark mode (persisté)- [ ] Tuto interactif (`window.PocheTuto`, bouton auto-inséré dans dock) — progression et accueil persistés séparément par app
- [ ] Fenêtre de logs debug mobile (`window.openLogs`, vidage logs)
- [ ] Accessibilité : navigation clavier puces d'étape (rôle tab), focus trap modales, cible tactile ≥44px, anti-zoom iOS sur inputs
---

## Notes méthodologiques
- Pas de `graphify-out/wiki/index.md` dans ce projet (uniquement `GRAPH_REPORT.md` + `graph.json`/`graph.html`) — recours à lecture directe conformément aux instructions.
- God nodes bruyants ignorés (`_()`, `$()`, `de`, `ts`, `f`, `ta`, `e()`, `Ut()`, `va()` — tous issus de MapLibre GL minifié).
- Rapport produit par 4 sous-agents Explore en parallèle (DOM/inline 4.html ; modules formulaires/patrac/articulation/drag/dessin ; modules init/outils/medias/navigation/notifications/shared/oi_cartographie/pdf_engine_v2/presentation ; code partagé + reste dépôt) + vérifications directes (tuto-engine API, clés localStorage croisées, `SharedComponents` dead-code).
