# Protocole de non-régression structurel — PDF de l'OI (`verify-structure.mjs`)

Outil : `tests/pdf/verify-structure.mjs` — script Node ESM autonome, **aucune
dépendance npm**. Il appelle directement binaires système `poppler-utils`
(`pdfinfo`, `pdftotext`, `pdffonts`, `pdfimages`) pour vérifier invariants
**structurels** sur PDF de l'OI (nombre/dimensions de pages, volume detexte réel, ordre sections, polices embarquées, absence de
rastérisation, poids fichier, présence données saisies).

Contexte complet : `docs/SPEC-PDF-V3.md` §7 (« Protocole de non-régression
STRUCTUREL ») et `../../.tacsuite-prep/etude-pdf-strategica.md`.

## Rôle — pourquoi PAS diff pixel

L'ancien moteur (`src/apps/oi/pdf-engine-v2.ts`, html2canvas + jsPDF)
produisait PDF **100 % rastérisé** : seule image JPEG par page,
**aucun calque texte** (constat n°1 de`../../.tacsuite-prep/oi-reference/fingerprint.md`). voie A (pdfmake,
`docs/SPEC-PDF-V3.md` §1-§3) produit à place PDF **vectoriel** — texte
réel sélectionnable, polices embarquées, images limitées aux vraies photos.
 rendu pixel change donc **de nature**, ce qui est l'**objet chantier**,
pas régression.

`fingerprint.md` documente explicitement dans sa note sur hashes par
page :

> « ces hashes ne seront quasi certainement **pas reproductibles** à
> l'identique... Ne pas utiliser comme critère d'égalité stricte pour 
> non-régression Phase 3 ; fournir seulement comme référence "avant" »

 diff pixel/perceptuel de l'étalon `oi-reference/reference.pdf` est donc
**structurellement inopérant** pour voie A : comparer rendu`html2canvas` (1750×1389 px JPEG par page) à rendu vectoriel `pdfmake`
mesurerait changement voulu, pas régression. `verify-structure.mjs`
vérifie à place **invariants indépendants rendu pixel**.

## Commande

```bash
node tests/pdf/verify-structure.mjs <fichier.pdf> \
    [--format=a4|16:9] [--photos=N] [--sample=<fichier.json>] [--json] [--lenient] [--voie=a|b]
```

| Option | Défaut | Effet |
|---|---|---|
| `--format=a4\|16:9` | `a4` | Dimensions de page attendues pour A1 (voir tableau ci-dessous). |
| `--photos=N` | `0` | Limite haute nombre d'images embarquées pour A6. |
| `--sample=<fichier.json>` | (aucun) | Active A8 : vérifie que chaque chaîne de `expect[]` apparaît dans texte extrait. Sans cette option, A8 est SKIP (non applicable). |
| `--json` | — | Émet **en plus** lignes lisibles (pas à place) objet `{ ok, file, assertions: [{ code, ok, detail }] }` sur stdout, en dernière ligne. |
| `--lenient` | mode strict | marqueur **conditionnel** (A3, indices 4/8/10/11/12/13) absent devient `SKIP` au lieu de faire échouer A3 — l'ordre marqueurs **présents** reste asserté. |
| `--voie=a\|b` | `a` | Calibrage gardes pagination **B1/B2/B6/B8/B9** (cf. tableau B ci-dessous) : `a` (pdfmake, INCHANGÉ) suppose page dense multi-sections — déficit de contenu y signale vrai débordement. `b` (`print-view.ts`/navigateur) suppose page DÉDIÉE par section (conception assumée, pas bug) — seuils B1 nettement abaissés, B2 exige en plus l'absence d'autre token sur ligne « head » (distingue vraie césure d' empilement fortuit de 2 mots complets), B6 et B9 deviennent SKIP, B8 s'active (SKIP en voie A). B7/B10/B11 restent actives dans DEUX voies (SPEC-PDF-DEFINITIF §8). |

**Prérequis** : paquet système `poppler-utils` (fournit `pdfinfo`,
`pdftotext`, `pdffonts`, `pdfimages`). Si binaire est absent `PATH`,
 script sort en **code 2** avec message nommant explicitement 
paquet à installer, plutôt qu' trace d'erreur obscure. Même code de
sortie si fichier PDF passé en argument n'existe pas, ou si 
arguments CLI sont invalides.

**Codes de sortie** : `0` si 19 assertions (A1-A8 + B1-B11, cf. tableau B
ci-dessous) passent, `1` si au moins échoue, `2` en cas de garde
d'exécution (aucune assertion n'a pu tourner).

## 8 assertions

Seuils littéraux — source : `docs/SPEC-PDF-V3.md` §7, tableau « Assertions
exactes ».

| Code | Assertion | Seuil |
|---|---|---|
| **A1** | Géométrie | `pdfinfo` : Pages ≥ **12** ; dimensions identiques sur toutes pages, égales à **841,89 × 595,28 pts** (`a4`) ou **958,11 × 539,01 pts** (`16:9`), tolérance **±0,5 pt**. |
| **A2** | Texte réel | `pdftotext -layout` : ≥ **1 500** caractères non blancs. |
| **A3** | Ordre sections | **15 marqueurs** (liste ci-dessous) présents, index de leur **première** occurrence strictement croissant. Normalisation avant recherche : NFC, espaces consécutifs réduits à , apostrophes `’`→`'` (tirets `–`/`—` conservés tels quels). |
| **A4** | Défaut hérité préservé | Exactement **2** occurrences distinctes d' titre commençant par `7. ` (`7. ARTICULATION…` et `7. RÉCAPITULATIF…`). |
| **A5** | Polices vectorielles | `pdffonts` : ≥ 3 lignes ; **toutes** `emb=yes` **et** `sub=yes` ; au moins famille contenant `Oswald` et contenant `JetBrainsMono`. || **A6** | Absence de rastérisation | `pdfimages -list` : nombre d'images ≤ `--photos` (défaut 0). FAIL supplémentaire si `nb_images == nb_pages` **et** qu'au moins image couvre ≥ **80 %** surface de sa page (signature html2canvas+jsPDF). || **A7** | Poids | Taille fichier ≤ **1 048 576 o** (1 Mio) — vérifié **inconditionnellement**, quel que soit `--photos` (voir note ci-dessous). |
| **A8** | Données saisies | Si `--sample=<json>` fourni : chaque chaîne de `expect[]` apparaît dans `pdftotext`. Sans `--sample`, assertion SKIP. |

**Note sur A7 (inconditionnel)** : SPEC formule cette assertion « avec`--photos=0` », ce qui décrit **scénario nominal** pour lequel seuil de
1 Mio a été calibré ( PDF v3 sans photo embarquée), pas garded'exécution qui désactiverait contrôle dès que `--photos` est non nul —
confirmé par l'exécution obligatoire de cette mission (voir « Démonstration »
ci-dessous : `--photos=14` sur l'étalon raster de 2,53 Mo, résultat attendu
et mesuré `FAIL A7`, pas SKIP). vrai PDF v3 avec photos réellement
embarquées dépassera donc légitimement 1 Mio et fera échouer A7 pour 
raison **sans rapport avec rastérisation** (poids photos, pas 
retour à html2canvas) : run avec photos doit interpréter `FAIL A7`
isolé (A2/A5/A6 restant verts) comme dépassement de poids assumé, pas 
régression.

## 11 gardes pagination (B1-B11)

Guardrails additionnels (hors SPEC-PDF-V3.md §7 d'origine), toujours
évaluées indépendamment de `--lenient` — seul `--voie` change calibrage
de B1/B2/B6/B8/B9 (cf. tableau options ci-dessus).

| Code | Garde | Seuil (voie A, défaut) | Mode `--voie=b` |
|---|---|---|---|
| **B1** | Anti-page-orpheline | ≥ 120 caractères non blancs par page (hors garde/finale/photo) | Seuil abaissé à 20 (pages dédiées courtes par conception). |
| **B2** | Anti-césure verticale (PATRACDVR) | Aucun mot capitalisé scindé sur 2 lignes adjacentes même colonne | + exige l'absence d'autre token sur ligne « head » (élimine faux positif « deux mots complets empilés », ex. « KODIAQ »/« BANA »). |
| **B3** | Anti-page-titre-seul | ≥ 40 caractères de contenu hors titre | Pages-galerie (≥ 1 image) exemptées. |
| **B4** | Anti-queue-nue (ZMSPCP/MOICP) | 1re ligne à tiret d' page jamais sans titre « (suite) » précédent | Inchangé. |
| **B5** | Anti-page-libellés-vides | < 4 champs `LABEL : -` ou < 250 car. de tels libellés par page | Inchangé. |
| **B6** | Anti-page-clairsemée | Ratio remplissage vertical ≥ 35 % (hors finale) | SKIP (pages dédiées légitimement peu remplies par conception). |
| **B7** | Anti-table-hypothèses-orpheline | Toute page portant l'en-tête LITTÉRAL table Hypothèses d'Effraction (« Technique / Moyen », répété par `headerRows:1`) porte aussi « ARTICULATION : EFFRACTION » ou « (SUITE) » | Inchangé (active). |
| **B8** | Anti-carte-kv-orpheline | SKIP (motif propre aux pages dédiées voie B) | ≥ 2 lignes `LABEL : valeur` sans aucun marqueur ni « (suite) » et ≤ 200 car. ⇒ FAIL. |
| **B9** | Anti-titre-orphelin-en-bas-de-page | DERNIÈRE ligne non blanche d' page (hors finale, pied de page retiré) ne matche jamais signature statique de titre/en-tête (« Hypothèses d'Effraction », « DANGEROSITÉ », « LOCALISATION », en-tête de table…) | SKIP ( page dédiée peut légitimement se clore sur titre court). |
| **B10** | Anti-continuation-de-bloc-titré-sans-« (suite) » (généralise B7) | Toute page portant contenu de bloc titré (ligne ATCD `AAAA :`, description `HEn —`, en-tête de table répété) porte aussi 15 marqueurs ou « (suite) » | Inchangé (active). |
| **B11** | Anti-page-de-continuation-sous-remplie (renforce B1/B6) | Aucune page (hors garde/finale/photo) ne cumule : aucun marqueur, aucun « (suite) », < 300 car. non blancs hors pied de page | Inchangé (active). |

### B7 (corrigée) et B9-B11 — mission GD.GUARDS, protocole de contre-épreuve

Source : `../../.tacsuite-prep/pdf-goal-final/SPEC-PDF-DEFINITIF.md` §7
(gardes écrites et contre-éprouvées AVANT correctifs D1-D4 — garde
qui ne FAIL pas sur PDF fautif ne prouve rien). Preuves détaillées :
`../../.tacsuite-prep/pdf-goal-final/gardes-preuves.md` (hors repo, PDF
fautif contenant données opérationnelles réelles).

- **B7 corrigée** : version d'origine cherchait LIGNE `Hypothese N` —
 libellé de REPLI qui n'existe que si l'utilisateur n'a pas nommé ses
 hypothèses ; sur PDF fautif réel (hypothèses nommées), garde était
 AVEUGLE (PASS sur défaut avéré). Elle cherche désormais l'EN-TÊTE
 STATIQUE table (« Technique / Moyen »), présent sur chaque fragment
 via `headerRows:1`, nommé ou pas.
- **B9 resserrée par balayage anti-faux-positifs** (§7.5 SPEC) :  formulation initiale (fenêtre 2 dernières lignes) remontait 26 faux
 positifs sur 34 fixtures d'audit (toute table d'hypothèses VIDE se
 termine par en-tête + « Aucune hypothèse saisie » — l'en-tête entrait dans
 fenêtre alors qu'il est SUIVI de sa ligne de repli). Critère retenu :
 seule DERNIÈRE ligne — couvre deux motifs réels (titre seul en
 dernière ligne ; titre + en-tête de table, l'en-tête étant alors 
 dernière ligne) sans faux positif. Après resserrage : 0 hit sur 68
 rendus (34 fixtures × 2 thèmes), FAIL conservé sur PDF fautif.
- **Balayage** : seules occurrences restantes sur 34 fixtures sont `effrac-n6` (B7/B10/B11 p11 — VRAI défaut préexistant de type D2 : en-tête
 répété + ligne « Hypothese 6 » sans titre ni « (SUITE) », à corriger par
 lots correctifs) et `empty-partial` (B1 p3 — garde B1 PRÉEXISTANTE,
 inchangée par cette mission, sur page de section légitimement
 minimale ; aucune nouvelles gardes B7'/B9/B10/B11 n'y remonte).

## 15 marqueurs (ordre imposé)

Verbatim `docs/SPEC-PDF-V3.md` §7 — même liste que
`../../.tacsuite-prep/oi-reference/fingerprint.md` § « Ordre sections »
(empreinte OCR de l'étalon raster) et `tests/unit/oi/oi-pdf-engine-v2.test.ts:343-359`
(assertion HTML équivalente sur `PDFEngineV2.generateHTML()`).

```
1.  ORDRE INITIAL
2.  1. SITUATION GLOBALE
3.  CIBLES(S)
4.  2.1 FICHE ADVERSAIRE                          (conditionnel)
5.  3. ENVIRONNEMENT ET AMIS
6.  4. MISSION DE L'UNITÉ
7.  5. EXÉCUTION
8.  6. LOGISTIQUE & TRANSPORTS                    (conditionnel)
9.  7. ARTICULATION & ORDRES DE MOUVEMENT
10. ARTICULATION : ZMSPCP                         (conditionnel)
11. ARTICULATION : MOICP                          (conditionnel)
12. ARTICULATION : EFFRACTION                     (conditionnel)
13. 8. CONDUITES À TENIR GÉNÉRALES                (conditionnel)
14. 7. RÉCAPITULATIF PATRACDVR
15. AVEZ-VOUS DES QUESTIONS ?
```

Marqueurs conditionnels (4, 8, 10, 11, 12, 13) : jeu de rejeu
`../../.tacsuite-prep/oi-reference/recipe-data.json` produit tous — mode
strict (défaut) donc satisfaisable sans `--lenient` sur ce jeu de données.
`--lenient` existe pour jeux de données **partiels** (ex. aucun
adversaire saisi ⇒ marqueur #4 légitimement absent).

**BLIND.FIX (point 6) — bloc logistique complété** : `recipe-data.json`
(historiquement dump BRUT `OiFormData`, cf. `recipe.md` — « Aucune photo,
l'export de session ne sérialise jamais Blobs IndexedDB ») ne portait
AUCUNE donnée logistique : marqueur #8 (« 6. LOGISTIQUE & TRANSPORTS »,
conditionné par au moins photo dans
`dynamic_photos['photo_container_transport_pr_preview_container']` ou son
homologue `_domicile_`, cf. `logisticsPhotos()` deux voies) ne pouvait
donc JAMAIS apparaître via harnais offline (`generate-from-fixture.mjs`)
— mode STRICT structurellement insatisfaisable, indépendamment de tout bug
de pagination. fichier est désormais l'enveloppe `{ formData,
photosBase64, isDark }` attendue par le harnais (au lieu du seul `OiFormData`
brut) et porte entrée `dynamic_photos` minimale pour ce conteneur, avec
 image `photosBase64` associée (PNG valide 320×240, gris uni — asset
minimal mais RÉEL, pas id orphelin : deux voies omettent
silencieusement toute photo dont l'id n'a pas de `photosBase64`
correspondant, cf. `blocks.ts::galleryPages`/`print-view.ts::galleryPages`).
Vérifié : A3 passe désormais 15/15 en mode STRICT (sans `--lenient`), voie A
comme voie B, thème clair comme sombre. `recipe.md` (étape 3, upload manuel
de `J.png` sur ce même conteneur lors d' rejeu navigateur réel) reste
inchangé — cette complétion ne concerne que rejeu OFFLINE via 
fixtures JSON, pas protocole de capture Playwright historique.

**CORRECTIF PDF.INTEG (casse marqueurs #10-#12)** : `SPEC-PDF-V3.md` §7
 recopiait dans casse SOURCE gabarit `pdf-engine-v2.ts`
(`Articulation : ZMSPCP`), qui n'était mise en capitales que par CSS
`text-transform` de l'ANCIEN moteur (effet purement visuel, sans calque
texte puisqu'il rastérisait). `blocks.h2()` voie A (pdfmake) n'a pas
de CSS : elle réplique ce même rendu visuel via `.toUpperCase()` en JS —
cette fois calque texte RÉEL est en capitales. Vérifié contre PDF réel
(recette `recipe.md`, moteur `downloadOiPdfV3()`) : `pdftotext -layout`
extrait bien `ARTICULATION : ZMSPCP - …`. 3 marqueurs ci-dessus sontalignés sur ce texte réellement extractible (cf. commentaire au même endroit
dans `verify-structure.mjs`).

## Ce que protocole NE fait PLUS

- **Pas de comparaison pixel pages** : rendu vectoriel est  changement **voulu** (voir « Rôle » ci-dessus) — l'étalon raster
 `oi-reference/reference.pdf` est **caduc pour voie A**.
- **Pas d'égalité stricte à 14 pages** : pagination devient automatique (dépendante volume de données). Seuls **plancher de 12 pages** (A1)
 et l'**ordre sections** (A3) font foi — pas compte exact.
- diff pixel reste pertinent **uniquement sur images extraites** (`pdfimages`) — photos et cartographie restant raster par nature — mais
 n'est **pas automatisé** par cet outil (constat manuel si besoin).

## Écarts visuels ASSUMÉS (à ne pas confondre avec régressions)

Recopiés de `docs/SPEC-PDF-V3.md` §7. Si contrôle visuel manuel révèle
l' de ces écarts, **ce n'est pas bug** :

| Réf | Écart | Justification |
|---|---|---|
| **E1** | Perte coins arrondis (16 px) et ombres portées `.card` | pdfmake n'a ni `border-radius` ni `box-shadow` ; cadres nets 1 px à place. |
| **E2** | Bande de pied de page + pagination `n / N` sur **toutes** pages (sauf garde) au lieu seule page finale | pagination automatique rend gratuite et utile. |
| **E3** | Suppression pagination manuelle PATRACDVR (`MAX_MEMBERS_PER_PAGE` 12/8) | `headerRows:1` répète l'en-tête, pdfmake coupe au bon endroit ; titre `(Partie n)` disparaît. |
| **E4** | Galeries à **2 photos** par page (au lieu d') | Langage strategica (`OrderHtmlPhotos.kt:70-82`). |
| **E5** | Suppression filigrane sur pages intermédiaires et de `_fitPageToBudget` | Pagination automatique. |
| **E6** | Palette : accents `#2563eb`/`#dc2626` → `#0033a0`/`#c0392b` (clair), `#3b82f6` → `#5b9bd5` (sombre) | Langage visuel strategica (`OrderPdfStyle.kt:30-56`). |

## FAIL ATTENDUS fixtures dégénérées (à ne pas confondre avec régressions)

Gate ROUND0/ROUND1 (mineur reconduit, tranché ici par DOCUMENTATION — 
gardes ne sont **pas** exemptées, leur verdict est l'attendu) :

- **`empty-partial.json`** (fixture d'audit hors dépôt, volontairement dégénérée : quasi tous champs vides) — **FAIL B1 p3 en voie A** (
 deux thèmes) et **FAIL B3 p3 en voie B** sont **ATTENDUS et stables**
 (identiques avant/après lot D1-D4, baseline `f29796f`). page
 portant titre de section dont TOUT contenu saisi est vide descend
 mécaniquement sous planchers de densité (B1 : 62 car. ; B3) ; c'est 
 comportement **voulu** gardes face à document sans données, pas 
 défaut de pagination. Toute autre fixture qui remonte B1/B3 reste 
 vraie alerte à instruire.

## Démonstration — l'étalon raster ÉCHOUE (c'est voulu)

Commande exécutée (mission P8, vérification obligatoire) :

```bash
node tests/pdf/verify-structure.mjs ../../.tacsuite-prep/oi-reference/reference.pdf --photos=14
```

`--photos=14` désactive limite simple de comptage de A6 (14 = nombre de
pages de l'étalon) pour forcer passage par sous-contrôle « signature
html2canvas+jsPDF » (`nb_images == nb_pages` + couverture ≥ 80 %) —exactement l'anti-pattern que v3 supprime.

Sortie mesurée (reproductible, poppler `26.07.0`) :

```
PASS A1 — 14 pages, 841.89 x 595.28 pts (« a4 »), dimensions homogènes ±0.5pt
FAIL A2 — 0 caractère(s) non blanc(s) extrait(s) par pdftotext -layout (seuil 1500)
FAIL A3 — marqueur(s) manquant(s) : #1 « ORDRE INITIAL », #2 « 1. SITUATION GLOBALE », #3 « CIBLES(S) », #4 « 2.1 FICHE ADVERSAIRE », #5 « 3. ENVIRONNEMENT ET AMIS », #6 « 4. MISSION DE L'UNITÉ », #7 « 5. EXÉCUTION », #8 « 6. LOGISTIQUE & TRANSPORTS », #9 « 7. ARTICULATION & ORDRES DE MOUVEMENT », #10 « ARTICULATION : ZMSPCP », #11 « ARTICULATION : MOICP », #12 « ARTICULATION : EFFRACTION », #13 « 8. CONDUITES À TENIR GÉNÉRALES », #14 « 7. RÉCAPITULATIF PATRACDVR », #15 « AVEZ-VOUS DES QUESTIONS ? »
FAIL A4 — 0 titre(s) « 7. XXX » détecté(s) (attendu exactement 2 : « 7. ARTICULATION & ORDRES DE MOUVEMENT » et « 7. RÉCAPITULATIF PATRACDVR » — défaut hérité reproduit tel quel, SPEC §7 A4)
FAIL A5 — 14/14 police(s) non intégralement embarquée(s)/sous-ensemblée(s) : Helvetica (emb=no sub=no), Helvetica-Bold (emb=no sub=no), Helvetica-Oblique (emb=no sub=no), Helvetica-BoldOblique (emb=no sub=no), Courier (emb=no sub=no), Courier-Bold (emb=no sub=no), Courier-Oblique (emb=no sub=no), Courier-BoldOblique (emb=no sub=no), Times-Roman (emb=no sub=no), Times-Bold (emb=no sub=no), Times-Italic (emb=no sub=no), Times-BoldItalic (emb=no sub=no), ZapfDingbats (emb=no sub=no), Symbol (emb=no sub=no)
FAIL A6 — 14 image(s) intégrée(s) (limite --photos=14) ; nb_images == nb_pages (14) ; signature de rastérisation html2canvas+jsPDF détectée : page 1 : 1750x1389px @ 150x168ppi ≈ 99.8% de la surface de sa page
FAIL A7 — 2530347 octet(s) (limite 1048576 o = 1 Mio — scénario nominal --photos=0, vérifié inconditionnellement)
PASS A8 — SKIP — --sample non fourni, assertion non applicable
2/8 assertions
```

Code de sortie : `1`.

Lecture : **A1 passe** (14 pages, 841,89 × 595,28 pts — géométrie de page
n'a jamais été problème de l'ancien moteur). **A2, A3, A4, A5, A6, A7
échouent** — exactement faisceau de symptômes d' PDF 100 % rastérisé
(constat n°1 de `fingerprint.md`) : aucun texte réel (A2 → donc aucun
marqueur trouvable, A3 et A4 échouent en cascade), aucune police vectorielle
embarquée — seulement 14 polices standard PDF que jsPDF déclare par
défaut, jamais invoquées pour texte réel (A5), image JPEG par page
couvrant 99,8 % de sa surface (A6, signature html2canvas+jsPDF), et poids
de 2,53 Mo très supérieur au 1 Mio attendu d' PDF vectoriel sans photo
(A7). **A8 est SKIP** (aucun `--sample` fourni dans cette commande). C'est
précisément cet anti-pattern — texte absent, polices non vectorielles, 
image plein cadre par page, poids conséquent — que moteur v3 (pdfmake,
`docs/SPEC-PDF-V3.md` §1-§3) supprime ; PDF v3 conforme doit au contraire
faire passer A1 à A6 (et A7 en l'absence de photos embarquées).
