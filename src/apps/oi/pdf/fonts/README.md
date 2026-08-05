# Polices embarquées pour PDF OI

## Provenance

 trois fichiers TrueType `.ttf` sont copiés depuis **Praxis-Rust** (usage interne) :

```
Praxis-Rust/android/app/src/main/assets/fonts/
├── oswald_500.ttf              (86 428 octets)
├── jetbrains_mono_400.ttf      (112 172 octets)
└── jetbrains_mono_700.ttf      (112 092 octets)
```

## Tailles et empreintes SHA-256

| Fichier | Taille (octets) | SHA-256 |
|---------|---|---|
| `oswald_500.ttf` | 86 428 | `edca7f2098242ead25675251ac9c35ecd2a9d001e4bcb641e07471148b6c365b` |
| `jetbrains_mono_400.ttf` | 112 172 | `44ce4a84f20d60f24539bd0cef11f79c29e38609e0f8adf18551c9794a5d9dc3` |
| `jetbrains_mono_700.ttf` | 112 092 | `a1d92abc6b02a87faed23d98067ab1027e8e95242fd7c9978a072ea383b89d1a` |

## Licence

 deux familles de polices sont distribuées sous **SIL Open Font License 1.1** (textes complets : `OFL-Oswald.txt`, `OFL-JetBrainsMono.txt`).

**Redistribution autorisée** y compris embarquée dans PDF, **sans obligation de licence sur document produit**. Seules polices elles-mêmes restent régies par SIL OFL.
## Utilisation

Ces `.ttf` **ne sont jamais servis ni bundlés** — seul module TypeScript `fonts.generated.ts` (généré par `npm run gen:pdf-fonts`) contient leur codage base64 et entre dans bundle de distribution.

### Régénération VFS base64

```bash
npm run gen:pdf-fonts
```

Cela relit trois `.ttf` et produit `../fonts.generated.ts` avec données base64 encodées.
