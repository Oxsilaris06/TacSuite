# Inventaire complet - GStart (2026-07-31)

## Résumé exécutif
- **Fichiers totaux** : 3574 (hors graphify-out/, .git/, node_modules/)- **Taille totale** : 143 MB (176M - 33M graphify-out)- **LOC applicatifs** : ~59 000 LOC (.js) + ~141 LOC (.css)- **HTML d'entrée** : 17 fichiers principaux
---

## 1. Points d'entrée HTML (17 fichiers)

### Actifs (modernes)
- `./pctac.html` (2397 LOC) - **Version prod PC-Tac**
- `./pctac2.html` (2396 LOC) - Variante v2
- `./index.html` (566 LOC) - Index principal
- `./mhe.html` (1017 LOC) - MHE app
- `./mhe2.html` (866 LOC) - MHE v2
- `./qg.html` (1213 LOC) - QG app
- `./mrz.html` (980 LOC) - MRZ app
- `./synthese.html` (1033 LOC) - Synthèse
- `./patracdvr.html` (1809 LOC) - PatracDVR
- `./tchap_geoloc_test.html` (328 LOC) - Test géoloc Tchap
- `./tchap-live/index.html` (78 LOC) - Tchap live web

### Archives/Versions anciennes
- `./1.html` (5859 LOC) - Ancienne version volumineuse
- `./2.html` (1057 LOC)
- `./3.html` (791 LOC)
- `./4.html` (5097 LOC)
- `./old.html` (5859 LOC) - Copie/archivage
- `./oldpctac.html` (1760 LOC) - Ancienne PC-Tac

### node_modules (non comptabilisés dans inventory)
- `./tchap-live/node_modules/loglevel/demo/index.html` (139 LOC)
- `./tchap-live/node_modules/@mapbox/jsonlint-lines-primitives/web/jsonlint.html` (59 LOC)

**Total HTML: 33 304 LOC**
---

## 2. Code applicatif par langage

### JavaScript applicatif (hors vendor, hors node_modules)
**~59 000 LOC répartis sur 38 fichiers**
Top modules:
1. `./modules/pctac/planMap.js` (5596 LOC) - **Cœur carto MapLibre**
2. `./modules/presentation_legacy.js` (1735 LOC) - Ancienne présentation
3. `./modules/oi_cartographie.js` (1681 LOC) - OI carto
4. `./modules/dessin.js` (1348 LOC) - Module dessin
5. `./modules/formulaires.js` (1338 LOC) - Formulaires
6. `./modules/pctac/dashboard.js` (1232 LOC) - Dashboard PC-Tac
7. `./modules/patrac.js` (1201 LOC)
8. `./modules/pdf_engine_v2.js` (1156 LOC)
9. `./modules/articulation.js` (1011 LOC)
10. `./modules/pctac/tuto_data.js` (964 LOC)
11. `./modules/pctac/tchapLive.js` (961 LOC) - Intégration Tchap live
12. `./modules/tuto_oi_data.js` (894 LOC)
13. `./modules/pctac/ui.js` (890 LOC)

Autres modules clés:
- `./modules/tuto-engine.js` (755 LOC) - Moteur tutoriel réutilisable
- `./modules/pctac/pdfExport.js` (596 LOC) - Export PDF PC-Tac
- `./modules/pctac/main.js` (546 LOC)
- `./modules/pctac/archive.js` (459 LOC)
- `./shared/ui-platform.js` (319 LOC) - UI partagée
- `./sw.js`, `./fusion_nativ.js` - Service Worker et fusion native
**Dossiers applicatifs:**- `./modules/` : 1.3 MB
- `./modules/pctac/` : 652 KB (14 sous-modules)
- `./shared/` : ~20 KB
- `./modules/old modules/` : 320 KB (archive)

### CSS applicatif
- `./shared/ui-platform.css` (141 LOC) **CSS partagé applicatif**
- `./vendor/maplibre-gl.css` (854 LOC) - Vendor MapLibre

**Total CSS: ~1000 LOC**
### Fichiers de configuration/données
- `./modules/pctac/config.js` (17 KB) - Config PC-Tac
- `./modules/pctac/storage.js` (3.7 KB)
- `./icons.json` (11 KB)
- `./manifest.json` (1.6 KB)
- `./members_config.json` (4.3 KB)
- `./OI_Session_2026-04-13.json` - Session OI- `./test_tactical_data.json` - Test data
---

## 3. Libs tierces vendorées (dossier ./vendor/)

**Taille totale vendor/ : 2.1 MB**
1. `./vendor/maplibre-gl.js` (788 KB, 52k LOC) - **MapLibre GL dev non-minifié**
 - Aussi `./vendor/maplibre-gl.css` (64 KB)
 - Détection: libs carto (géoloc temps réel, markers, tiles)
2. `./vendor/html2canvas.min.js` (196 KB) - **Screenshot/capture HTML→canvas**
 - Minifié, utilisé pour export visuel
3. `./vendor/pdf-lib.min.js` (516 KB) - **PDF generation**
 - Minifié, utilisé dans pdfExport.js
4. `./vendor/jszip.min.js` (96 KB) - **ZIP compression JS**
 - Minifié, probablement pour export d'archives
5. `./vendor/html5-qrcode.min.js` (368 KB) - **QR code scanner/decoder**
 - Minifié, utilisé pour sync QR (qrSync.js)
6. `./vendor/qrcode.min.js` (?K) - **QR code generation**
 - Minifié, complément scanner
**Aucune sous-dépendance de vendor détectée dans vendor/ lui-même.**
---

## 4. node_modules (project local tchap-live/)

**Taille : ~96 KB structure, mais contient libs volumineuses**
Dépendances principales détectées:
- `@matrix-org/matrix-sdk-crypto-wasm` - Crypto E2E Matrix- `matrix-js-sdk` - SDK Matrix JS- `maplibre-gl` - MapLibre dev complet- `@matrix-org/olm` - Crypto Olm legacy- `vite` - Bundler dev- `rollup` - Rollup.js- `gl-matrix` - Math 3D/matrices- `oidc-client-ts` - OpenID Connect client- `matrix-widget-api` - API widget Matrix- `loglevel` - Logging- `uuid`, `earcut`, `supercluster`, `kdbush` - Utilitaires géo
---

## 5. Assets binaires

### Icônes PWA/Web (~/600 KB total)
- Apple touch icons: 10 fichiers (60x60 à 180x180px) - `apple-touch-icon-180x180.png` (37 KB)
 - `apple-touch-icon-180x180-2.png` (51 KB)
- Android launcher: 5 fichiers (48x48 à 512x512px) - `android-launchericon-512-512.png` (224 KB)
 - `android-chrome-512x512.png` (353 KB)
- Microsoft/maskable: `maskable_icon_x512.png` (276 KB), `ms-icon-144x144.png`
- Favicon: `favicon.ico` (15 KB)

### Images métier (grandes résolutions)
- `J.png` (2.7 MB) - **Orthophoto/imagerie**
- `N.png` (2.4 MB) - **Orthophoto/imagerie**
- `512x512.png` (294 KB) - Icône générique

### Documents
- `OI_2026-04-27_MHX-3.pdf` (11 MB) - **PDF opérationnel important**
- `Dossier Objectif - Brionne.pdf` (2.4 MB)

### SVG (maplibre-gl vendeur)
- ~7 SVG de contrôles MapLibre dans `./tchap-live/node_modules/maplibre-gl/src/css/svg/`

---

## 6. Doublons et archivage détecté

### Fichiers anciens (candidats suppression)
1. **`./old.html` (5859 LOC)** ≡ `./1.html` - Duplications en LOC - Probablement archivage d' ancienne version2. **`./oldpctac.html` (1760 LOC)** - Ancienne PC-Tac, remplacée par `pctac.html`
3. **`./modules/presentation_legacy.js` (1735 LOC)** - Legacy, nouveau = `presentation.js` (2.2 KB)
4. **`./modules/old modules/` (320 KB)** - Dossier entier de modules obsolètes
 - Contient 10 fichiers de versions anciennes
### Versions multiples modernes (intentionnelles?)
- `pctac.html` + `pctac2.html` - Variantes de PC-Tac (LOC identiques ~2396)- `mhe.html` + `mhe2.html` - Variantes MHE (1017 vs 866 LOC)- `1.html`, `2.html`, `3.html`, `4.html` - Numérotées, probablement test/expérimentation
### Aucun vrai doublon de CONTENU détecté
- fichiers anciens et modernes ne sont pas byte-par-byte identiques- variations de taille indiquent évolutions réelles, pas copier-coller
---

## 7. Structure répertoires clés

```
/home/nico/Bureau/Web/GStart-main/  [143 MB]
├── .agents/                           [Config agent]
├── .claude/                           [Settings Claude Code]
├── .continue/                         [VS Code Continue]
├── .cursor/                           [Cursor IDE]
├── docs/                              [5 audits]
├── modules/                 [1.3 MB]  [Code applicatif principal]
│   ├── pctac/              [652 KB]   [PC-Tac: planMap 259KB, autres modules]
│   ├── old modules/        [320 KB]   [Archive obsolète]
│   └── *.js                [autres modules core]
├── shared/                            [UI Platform partagée]
├── vendor/                  [2.1 MB]  [MapLibre, html2canvas, pdf-lib, jszip, qrcode]
├── tchap-live/              [96 KB]   [Web live Tchap + node_modules énormes]
├── HTML d'entrée/           [~33KB]   [16 .html à la racine]
├── Icônes PWA/              [~600KB]  [Apple, Android, maskable]
├── Images métier/           [~5.2MB]  [N.png, J.png, orthophotos]
├── PDF/                     [~13.4MB] [OI_2026-04-27, Dossier Objectif]
└── Config/                           [manifest.json, .mcp.json, package.json]
```

---

## 8. Métriques clés

| Métrique | Valeur |
|----------|--------|
| **Fichiers totaux** | 3574 |
| **Répertoires** | 320 |
| **LOC applicatif JS** | ~59 000 |
| **LOC applicatif CSS** | ~141 |
| **LOC HTML** | ~33 300 |
| **Taille sans graphify-out** | 143 MB |
| **Taille vendor/** | 2.1 MB |
| **Taille assets binaires** | ~19 MB (icônes + images + PDF) |
| **Points d'entrée HTML** | 17 (11 modernes, 6 archives) |
| **Modules pctac** | 14 sous-modules |

---

## 9. Observations & recommandations

### Code actif identifié
- **PC-Tac** : cœur application (pctac.html, modules/pctac/*, modules/presentation.js)- **OI** : modules cartographie et tutoriels (oi_cartographie.js, tuto*)- **Supports** : MHE, MRZ, QG, PatracDVR (separate HTML entry points)
### Candidats archivage
- `./old.html`, `./1.html`, `./4.html` (5859 LOC each - copies volumineuses)
- `./oldpctac.html` (1760 LOC)
- `./modules/old modules/` (320 KB dossier complet)
- `./modules/presentation_legacy.js` (1735 LOC)

### Dépendances critiques
- **MapLibre GL** (788 KB) - Pas de minification dev, chercher prod- **PDF-lib** (516 KB) - Minifié OK- **html5-qrcode** (368 KB) - Minifié OK
### Structure tchap-live
- Séparé avec propre node_modules (Vite build)- Contient intégration E2EE Tchap- À documenter: point d'entrée unique, build process
---

## Fichier rapport
`/tmp/claude-1000/-home-nico-Bureau-Web-GStart-main/2cbcdb7a-c9c3-4fb9-941a-a580d1158e46/scratchpad/recon-inventaire.md`

