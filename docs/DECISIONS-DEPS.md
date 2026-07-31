# Decisions - dependances runtime epinglees (Phase 0 / P0.A1)

Releve effectue le 2026-07-31 par lecture des en-tetes `vendor/*.js` (GStart-main,
lecture seule) et des balises `<script>`/`<link>` CDN de `4.html` et `pctac2.html`,
puis verification croisee des versions publiees sur le registre npm.

| Lib | Version vendor/ (PC-Tac) | Version CDN (4.html / OI) | Version npm retenue | Ecart ? |
|---|---|---|---|---|
| maplibre-gl | 4.7.1 (en-tete fichier + LICENSE URL) | 4.7.1 (unpkg, pctac2.html ET 4.html) | **4.7.1** | Aucun |
| html2canvas | 1.4.1 (en-tete fichier) | 1.4.1 (cdnjs, 4.html) | **1.4.1** | Aucun |
| jszip | 3.10.1 (en-tete fichier) | 3.10.1 (cdnjs, 4.html) | **3.10.1** | Aucun |
| pdf-lib | Aucune version exploitable dans le build vendorise (seule mention trouvee: "Apache Version 2.0" = texte de licence, pas un numero de version - piste ecartee) | CDN `unpkg.com/pdf-lib/dist/pdf-lib.min.js` **sans version dans l'URL** (flotte vers "latest" au moment du fetch) | **1.17.1** (dernier stable publie sur npm au moment du scaffold) | **Oui** - aucune des deux sources n'est pinnee ; on fige sur le dernier stable npm et on le documente ici comme reference future. Utilise par les DEUX apps (`modules/patrac.js:1096-1114` cote OI, `modules/pctac/pdfExport.js` cote PC-Tac). |
| html5-qrcode | 2.3.8 (confirme via `graphify`/recon-pctac.md, PC-Tac uniquement) | non charge par 4.html | **2.3.8** | Aucun (lib PC-Tac uniquement) |
| qrcode (davidshimjs QRCode.js) | 1.0.0 (non versionne dans le header du fichier vendorise ; API `_htOption`/`makeCode`/`QRCode.prototype` confirmee identique au paquet npm `qrcodejs@1.0.0`) | non charge par 4.html | **qrcodejs@1.0.0** | Aucun (lib PC-Tac uniquement). Nom du paquet npm officiel du mirror = `qrcodejs`, pas `qrcode` (paquet npm distinct, incompatible API). |
| jspdf | non present dans vendor/ (PC-Tac n'utilise pas jsPDF, seulement pdf-lib) | 2.5.1 (cdnjs, 4.html:4511), usage confirme dans `modules/pdf_engine_v2.js` (moteur PDF actif de l'OI) | **2.5.1** | Aucun (lib OI uniquement). Ajoutee suite a la verification demandee par la mission P0.A1 (§3) : confirmee utilisee, donc incluse. |

## Polices (ajout P0.FIX, reprise 1 — correction du defaut "polices absentes")

Les deux originaux chargent, au `<head>`, DEUX feuilles Google Fonts distantes
(`pctac2.html:33-41`, `4.html:33-39`) : Material Symbols Outlined (icones) et
le trio Oswald/Inter/JetBrains Mono. `docs/PLAN.md` §2 impose "zero CDN a
l'execution" ; ces feuilles n'avaient pourtant pas ete reportees lors du
scaffold initial (P0.A5), laissant `document.fonts` vide en dev. Corrige en
auto-hebergeant des paquets npm epingles sur les MEMES familles/graisses que
les `<link>` d'origine, importes une seule fois depuis `src/shared/fonts.ts`
(charge par `src/apps/pctac/main.ts` ET `src/apps/oi/main.ts`).

| Lib | Graisses/axes demandes par les originaux | Version npm retenue | Ecart ? |
|---|---|---|---|
| `material-symbols` | `opsz,wght,FILL,GRAD@24,400,0..1,0` (pctac) / `@24,400,0,0` (oi) — meme famille "Material Symbols Outlined" dans les deux cas, difference uniquement sur la plage FILL exposee | **0.45.10** (derniere stable au moment du correctif) | Le paquet fournit une police variable wght 100..700 avec FILL/GRAD/opsz par defaut a 0 dans les deux apps (aucune n'anime l'axe FILL au runtime — verifie par grep `font-variation-settings`/`'FILL'` sur les deux sources, zero occurrence) : une seule police variable sert donc les deux apps sans perte fonctionnelle. |
| `@fontsource/oswald` | `wght@500;600;700` | **5.3.0** | Aucun (memes 3 graisses importees : `500.css`, `600.css`, `700.css`) |
| `@fontsource/inter` | `wght@400;500;600;700` | **5.3.0** | Aucun (4 graisses importees) |
| `@fontsource/jetbrains-mono` | `wght@500;600;700` | **5.3.0** | Aucun (3 graisses importees) |

Regle de base `.material-symbols-outlined` (font-family, taille par defaut,
ligatures) : absente du `<style>` inline des deux originaux (elle etait
fournie par la feuille Google elle-meme, jamais recopiee) donc absente aussi
de `styles/pctac.css`/`styles/oi.css` apres l'extraction verbatim P0.A5.
Rajoutee en tete de chacun des deux fichiers, copie conforme de
`node_modules/material-symbols/outlined.css` — voir commentaire "Source 0" en
tete de chaque fichier CSS.

## CDN charges par 4.html mais NON retenus (code mort verifie)

- `marked@4.0.10` (cdn.jsdelivr.net) - grep exhaustif (`marked(`) sur `modules/*.js` et
  `4.html` : **zero appel**. Balise `<script>` chargee mais jamais invoquee.
- `html2pdf.js@0.10.1` (cdnjs) - grep exhaustif (`html2pdf(`) : **zero appel**. Idem.

Conformement a la decision actee "Code mort exclu du portage" (docs/PLAN.md §2), ces
deux libs ne sont PAS ajoutees a `package.json`. A confirmer si un futur agent
decouvre un usage indirect (ex. appel dynamique) qui aurait echappe au grep statique.

## Alerte securite connue (npm audit) - non corrigee a dessein en P0.A1

`npm audit` remonte 2 vulnerabilites (1 critique, 1 moderee) sur `dompurify`, dependance
transitive de `jspdf@2.5.1` (pinnee volontairement sur la version CDN de l'original, cf.
tableau ci-dessus). `npm audit fix --force` proposerait de monter `jspdf` a `4.2.1`
(breaking change), ce qui casserait l'epinglage requis par la mission P0.A1 et risquerait
une regression sur le moteur PDF (`pdf_engine_v2.js`) avant meme d'avoir une baseline de
comparaison structurelle PDF (protocole §4.6 de `docs/PLAN.md`). **Decision : ne pas
toucher a la version en Phase 0.** A traiter explicitement en Phase 3 (P3.A0/P3.D) une
fois la comparaison PDF de reference en place, en arbitrant entre patch cible de
`dompurify` (resolutions/overrides npm) et montee de version controlee de `jspdf`.

## Methode de verification

```
npm view <pkg> version         # derniere version stable publiee
npm view <pkg> versions --json # historique complet, pour confirmer l'existence
                                 # d'un numero de version exact (ex: html5-qrcode 2.3.8)
grep -rn "PDFDocument\|PDFLib" modules/patrac.js      # confirme usage pdf-lib cote OI
grep -rln "jsPDF\|jspdf" modules/*.js                  # confirme usage jspdf (pdf_engine_v2.js)
grep -rn "marked\b" modules/*.js 4.html                # 0 resultat hors balise <script>
grep -rn "html2pdf" modules/*.js 4.html                # 0 resultat hors balise <script>
```
