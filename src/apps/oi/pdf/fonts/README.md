# Polices embarquées pour PDF OI

## Provenance

Trois fichiers TrueType `.ttf` sont versionnés ici :

```
src/apps/oi/pdf/fonts/
├── oswald_500.ttf              (86 428 octets)  copie historique de Praxis-Rust
├── jetbrains_mono_400.ttf      (109 564 octets) JetBrains Mono NL Regular, release v2.210
└── jetbrains_mono_700.ttf      (111 008 octets) JetBrains Mono NL Bold,    release v2.210
```

Les deux fichiers JetBrains viennent de la release officielle **v2.210** du dépôt
<https://github.com/JetBrains/JetBrainsMono> (`JetBrainsMono-2.210.zip`), fichiers
`fonts/ttf/JetBrainsMonoNL-Regular.ttf` et `fonts/ttf/JetBrainsMonoNL-Bold.ttf`.

### Pourquoi la variante NL (No Ligature)

Incident du 2026-08-02 au 2026-09-25 : les deux fichiers JetBrains précédents étaient des
copies d'un build de la lignée Google Fonts dont la table `GSUB` (`calt`, ligatures)
renvoyait vers des glyphes de ligature **absents du fichier** (`glyf` tronqué par le
sous-ensemblage). Tout texte contenant une suite de ponctuation de programmeur faisait
jeter le moteur de rendu :

```
...   ??   ->   =>   ---   ::   !=   <=   >=   ###   ||   &&   <->   <=>
```

Conséquence : **l'OI ne sortait plus du tout en production** depuis le 02/08 (un seul
« RAS... » dans la situation générale suffisait ; l'utilisateur voyait « Erreur de
génération » pendant 4 s), et PC-Tac partageait le défaut depuis qu'il a reçu cette
police (décision 34). Mesures du 2026-09-25 : désactiver les ligatures par option répare
pdf-lib mais **pas** pdfmake. La variante NL ne porte plus aucune ligature : la panne est
impossible par construction. Le rendu reste celui de la famille — une suite de
ponctuation s'imprime caractère par caractère.

### Pourquoi la v2.210 et pas la dernière release

Mesuré le 2026-09-25 sur la couverture des fichiers précédents (976 points de code) :

| Source | Taille | Glyphes | Points de code absents | Glyphes au dessin modifié |
|---|---|---|---|---|
| **v2.210 NL (retenue)** | 109 564 o | 1 037 | 3 (`U+27F5` `U+27F6` `U+27F7`, longues flèches) | 141, écart ≤ 60/1000 em |
| v2.304 NL (dernière) | 208 576 o | 1 590 | 0 | 371, écart jusqu'à 620/1000 em |

La v2.210 garde le dessin en production (écarts sur les blocs et traits de cadre) et reste
plus légère que les fichiers qu'elle remplace (110 Ko contre 112 Ko par graisse, donc
légèrement moins lourde dans le PDF comme dans le bundle).

### Garde

`tests/unit/oi/pdf/oi-pdf-fonts-ponctuation.test.ts` — rouge avant ce correctif — rejoue
toutes les suites de ponctuation sur les octets **réellement embarqués** (`PDF_FONT_VFS`),
avec fontkit (la couche que traverse pdfmake) et pdf-lib (le chemin de PC-Tac). Ne jamais
réintroduire une police à ligatures : elle n'abîme pas un PDF exotique, elle empêche toute
génération.

⚠️ Praxis-Rust porte encore les deux fichiers fautifs
(`android/app/src/main/assets/fonts/jetbrains_mono_*.ttf`). Son usage de ces polices pour un
PDF n'a pas été exercé depuis ce dépôt : à vérifier côté Praxis-Rust.

## Tailles et empreintes SHA-256

| Fichier | Taille (octets) | SHA-256 |
|---|---|---|
| `oswald_500.ttf` | 86 428 | `edca7f2098242ead25675251ac9c35ecd2a9d001e4bcb641e07471148b6c365b` |
| `jetbrains_mono_400.ttf` | 109 564 | `9569c2a8620991b9ab444d4bd56e99ed1e60a7d9fe5402e30564b57ba267272a` |
| `jetbrains_mono_700.ttf` | 111 008 | `477f50258c3a1ed745efa7b09146f95cc6ee5bc09328759b7e7cf7ab0f418012` |

## Licence

Les deux familles de polices sont distribuées sous **SIL Open Font License 1.1** (textes
complets : `OFL-Oswald.txt`, `OFL-JetBrainsMono.txt`).

**Redistribution autorisée** y compris embarquée dans PDF, **sans obligation de licence sur
le document produit**. Seules les polices elles-mêmes restent régies par SIL OFL.

## Utilisation

Ces `.ttf` **ne sont jamais servis ni bundlés** — seul le module TypeScript
`fonts.generated.ts` (généré par `npm run gen:pdf-fonts`) contient leur codage base64 et
entre dans le bundle de distribution.

### Régénération VFS base64

```bash
npm run gen:pdf-fonts
```

Cela relit les trois `.ttf` et produit `../fonts.generated.ts` avec les données base64.
