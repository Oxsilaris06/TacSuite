# TacSuite

Outils tactiques qui fonctionnent sans connexion : conduite d'une intervention et rédaction de l'ordre initial.

**Ouvrir TacSuite : https://oxsilaris06.github.io/TacSuite/**

![Portail de TacSuite](docs/portail.webp)

## Les deux applications

**PC-Tac**, poste de commandement tactique :
- main courante horodatée, entrées importantes marquées d'une étoile ;
- fiches des personnes (adversaires, otages, victimes) avec photos annotées ;
- carte : dessin, mesures, carroyage, traces GPX, zones téléchargées pour le hors ligne, suivi d'équipe en temps réel ;
- rapport PDF et synthèse A3, archive `.pctac.zip`.

**Générateur d'OI**, rédaction de l'ordre initial pas à pas :
- huit étapes, de la situation à la finalisation, en version complète ou express ;
- cartographie avec carroyage et captures intégrées au document ;
- PDF prêt à présenter (A4 ou 16:9, clair ou sombre), archive `.oi.zip`.

Un OI exporté s'importe dans PC-Tac.

## Vos données restent sur l'appareil

Pas de compte : ce que vous saisissez reste dans le navigateur de l'appareil utilisé. Pour transmettre un travail, exportez son archive.

Passent par le réseau :
- les fonds de carte et la recherche d'adresse ;
- les lignes électriques : l'emprise de la zone affichée ou téléchargée est envoyée à OpenStreetMap (Overpass) et à Enedis ;
- la note de version du portail, lue sur GitHub ;
- si vous l'activez, le suivi d'équipe (Tchap ou relais OsmAnd).

## Hors ligne et sur téléphone

Ouvrez une fois en ligne chaque application (PC-Tac et Générateur d'OI) : elles s'ouvrent ensuite sans réseau. Téléchargez à l'avance les zones de carte utiles.

Pour installer TacSuite comme une application : sur Android et sur ordinateur, menu du navigateur puis « Installer » ou « Ajouter à l'écran d'accueil » ; sur iPhone, bouton Partager puis « Sur l'écran d'accueil ».

## Développement

```bash
npm install
npm run dev     # http://localhost:9678
npm run test
npm run build
```

Tests, déploiement et polices des PDF : [docs/DEVELOPPEMENT.md](docs/DEVELOPPEMENT.md).

## Crédits

Cartographie : MapLibre GL. Polices des PDF : Oswald, JetBrains Mono, Noto Sans et Noto Sans Arabic (SIL Open Font License 1.1).
