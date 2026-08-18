# SPEC — Aperçu PDF éditable + champs OI (2026-08-18)

Arbitrages rendus par Nico avant codage. Périmètre : **Générateur d'OI uniquement**
(PC-Tac conserve son export direct par pdf-lib, hors sujet).

## État des lieux (établi par lecture du code)

| Élément | Réalité | file:line |
|---|---|---|
| Moteur PDF OI | pdfmake 0.3.11, docDefinition assemblé page par page | `src/apps/oi/pdf/document-builder.ts:2517` |
| Assemblage | `const pages: Content[]` puis `pushPage`/`pushPages` successifs | `document-builder.ts:2542-2557` |
| Aperçu actuel | blob URL dans un `<iframe>`, modale `#presentationModal` / `#presentation-content` | `src/apps/oi/pdf-engine-v2.ts:171-180` |
| Garde existante | `canRenderInlinePdf()` (`navigator.pdfViewerEnabled`) → message de repli | `pdf-engine-v2.ts:135-147` |
| Présenter ici | `window.open(blobUrl)` dans un onglet | `pdf-engine-v2.ts:214-215` |
| Fiche adversaire | **une seule page**, ajustement de police jusqu'à 7 px puis **refus total** du PDF | `document-builder.ts:619-770`, `OiPdfFitRefusalError` |
| Photos transport | `photo_container_transport_pr_preview_container`, `photo_container_transport_domicile_preview_container` | `oi/index.html:336-352` |
| Rendu photos transport | `galleryPages('6. LOGISTIQUE & TRANSPORTS (Cheminement)', logisticsPhotos(...))`, après Mission/Exécution | `document-builder.ts:2547`, `1013` |
| Patron hypothèses | `addHypothesis()` + `#hypotheses_container` + sérialisation `data.hypotheses` | `formulaires.ts:608-625`, `:747` |
| Patron NO GO | textarea `#no_go` → `accentCard(..., p, 'danger')` dans `buildCatPage` | `oi/index.html:599`, `document-builder.ts:2248-2256` |
| UDA | **n'existe pas** comme champ : simple ligne dans le texte par défaut de `cat_generales` | `oi/index.html:596` |
| Place du Chef | libellé unique partagé MOICP+ZMSPCP dans `buildArticulationPage` | `document-builder.ts:1270` |

## 1. Aperçu PDF sans `blob:` — pdf.js intégré

**Décision** : rendu par **pdf.js embarqué**, en `<canvas>`, page par page. Plus aucun
`blob:`, `<iframe>`, ni dépendance au lecteur PDF natif du navigateur.

- Dépendance `pdfjs-dist` ajoutée au bundle (aucun CDN : le parc est hors ligne).
- Le worker pdf.js est servi localement par Vite, jamais depuis une URL externe.
- Le PDF est passé à pdf.js en `ArrayBuffer`/`Uint8Array` — jamais par une URL.
- La garde `canRenderInlinePdf()` disparaît : elle n'a plus d'objet.
- `openPresentInPlace` (nouvel onglet) : conserve un repli propre si `window.open`
  est bloqué, mais l'aperçu principal ne doit plus jamais en dépendre.
- Le téléchargement (`<a download>`) reste inchangé.

## 2. Aperçu éditable + réordonnancement des sections

**Décision** : l'édition modifie **la donnée source** (le formulaire), pas le PDF.
Le réordonnancement porte sur **les sections**, pas sur les pages physiques.

- Chaque bloc éditable de l'aperçu est relié à son champ de `Store.state.formData`
  (ou à son entrée dans `adversaries`, `patracdvr_rows`, etc.).
- Corriger une ligne écrit dans le store, déclenche la persistance normale, puis
  régénère le PDF affiché. Les corrections survivent à l'export et à l'archive.
- L'ordre des sections est un tableau ordonné persisté dans `formData`, consommé par
  `buildOiDocDefinition` au moment de composer `pages`. Ordre par défaut = ordre actuel.
- La numérotation des titres est **calculée depuis l'ordre effectif**, jamais codée en
  dur dans les libellés (voir §6).
- Réinitialisation possible à l'ordre par défaut.

## 3. Mode d'action adversaire (formulaire + PDF)

**Décision** : les modes d'action sortent sur **une page dédiée, juste après la fiche
de l'adversaire concerné** — la fiche restant verrouillée à une page avec refus de
génération, un bloc de texte libre long ne peut pas y être inséré sans risquer de
faire refuser tout le document.

- Formulaire : dans la fiche adversaire, en **dernier bloc**, une liste dynamique
  « Modes d'action » avec bouton `+`, sur le patron exact des hypothèses
  (`addHypothesis`), mais avec un `<textarea>` (plusieurs phrases) au lieu d'un `<input>`.
- Numérotation automatique MA1, MA2, … recalculée à l'affichage.
- Stockage : `ma_list: string[]` sur l'objet adversaire, sérialisé dans `syncDomToStore`
  au même endroit que `me_list`, restauré par `addAdversary`.
- PDF : page « MODES D'ACTION — <nom adversaire> » émise immédiatement après la fiche,
  omise si la liste est vide. Chaque MA en carte, texte intégral, pagination naturelle.
- L'archive `.oi.zip` embarque le champ sans migration (champ optionnel).

## 4. Champs de finalisation

1. **Place du chef de dispo** : nouveau champ texte dans l'étape Finalisation ;
   dans le PDF, rendu **après le bloc NO-GO** dans `buildCatPage`.
2. **UDA** : champ dédié (textarea) dans la Finalisation ; dans le PDF, bloc de même
   forme que le NO-GO, en **orange ambre** (nouvelle teinte de palette, déclinée
   clair/sombre — ne jamais réutiliser `p.danger` ni `p.warning` s'ils sont déjà pris
   par un autre sens). Bloc omis si vide.
3. Libellés « Place du Chef » différenciés :
   - bloc **MOICP** → « Place du chef inter : »
   - bloc **ZMSPCP** → « Place du chef AO : »
   - le libellé général de l'articulation (`#place_chef`, « Place du Chef (Générale) »)
     reste inchangé.
   - À corriger **dans le formulaire ET dans le PDF** (le PDF partage aujourd'hui un
     libellé unique dans `buildArticulationPage` : il devient un paramètre).

## 5. Photos de transport

- Les photos « Transport PSIG → PR » et « Transport PR → Domicile/LE » sont rendues
  **juste après la section Environnement et Amis**.
- Titre : **« TRANSPORT »**. Toute mention de « logistique » disparaît du titre PDF.
- Section omise si aucune photo (comportement actuel conservé).

## 6. Numérotation des sections

La numérotation actuelle est incohérente (deux sections « 7. », un « 6. » déplacé).
**Décision** : renuméroter en continu, la numérotation étant **dérivée de l'ordre
effectif** des sections et non écrite en dur dans les titres — condition nécessaire au
réordonnancement du §2.

## Contraintes transverses

- Gate obligatoire : `npx tsc --noEmit` 0, `npx eslint src tests` propre,
  `npx vitest run` intégralement vert.
- Serveur de dev déjà lancé sur http://127.0.0.1:9678 (ne pas le relancer).
- Aucun push sans validation explicite de Nico.
- Les tests existants qui assertent l'ordre ou les titres des sections PDF doivent être
  mis à jour, jamais contournés.
