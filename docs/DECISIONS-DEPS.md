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
