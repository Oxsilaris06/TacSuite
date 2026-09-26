# Relais OsmAnd → PC-Tac

L'application **OsmAnd** (greffon « Enregistrement de trajet » → **Suivi en
ligne**) appelle une URL modèle en `GET`, **un point par requête**. Un
navigateur ne reçoit pas de requête HTTP entrante : ce petit relais Node reçoit
les points, les garde **en mémoire seulement**, et les rend à PC-Tac.

- **Zéro dépendance** : uniquement la bibliothèque standard de Node
  (`node:http`, `node:crypto`, `node:fs`).
- **Rien sur disque, jamais** : redémarrer le relais = tout oublier. C'est
  voulu (positions de gendarmes, relais exposé sur Internet).
- Placé **derrière Tailscale Funnel**, qui retire son préfixe : le relais reçoit
  donc des chemins **sans `/osmand`** (`/p`, `/positions`, `/health`).

## Démarrer

```sh
node tools/osmand-relay/relay.mjs
```

Écoute `127.0.0.1:9690` par défaut. Le fichier de jetons est créé à la demande
à côté du script (`tools/osmand-relay/tokens.json`, **hors dépôt**, mode
`0600`). Une **readKey** de 32 octets hex est générée au premier lancement.

Variables d'environnement reconnues :

| Variable | Défaut | Rôle |
|---|---|---|
| `PORT` | `9690` | port d'écoute (`127.0.0.1`) |
| `TOKENS_FILE` | `tools/osmand-relay/tokens.json` | chemin du fichier de jetons |
| `PUBLIC_BASE` | `https://nico-ai-series-1.tailed318a.ts.net/osmand` | base des URL OsmAnd affichées par `add` |
| `TTL_H` | `12` | purge des points reçus depuis plus de N heures |
| `ALLOWED_ORIGINS` | origine Funnel + `https://oxsilaris06.github.io` | origines CORS autorisées, séparées par des virgules |

## Opérateurs (CLI)

```sh
node relay.mjs add "Dupont" "Inter"   # crée un jeton et affiche l'URL OsmAnd
node relay.mjs revoke <jeton>          # révoque
node relay.mjs list                    # jetons tronqués à 6 caractères
node relay.mjs rotate <jeton>          # nouveau jeton, même opérateur (après une fuite)
node relay.mjs rotate-key              # nouvelle readKey (à recopier dans PC-Tac)
```

Le relais en marche relit le fichier de jetons dès qu'il change : un jeton
révoqué ou renouvelé cesse de valoir sans redémarrage.

`add` affiche une URL prête à coller dans OsmAnd :

```
<PUBLIC_BASE>/p?t=<jeton>&lat={0}&lon={1}&ts={2}&hdop={3}&alt={4}&speed={5}&bearing={6}
```

Le fichier `tokens.json` est **rechargé à chaud** sur `SIGHUP` ou à sa
modification : une révocation prend effet sans redémarrer.

## Routes

### `GET /p` — réception OsmAnd

- Jeton inconnu ou révoqué → `401`, rien n'est stocké.
- Coordonnées hors bornes (`lat` ∈ [-90, 90], `lon` ∈ [-180, 180]) ou
  horodatage aberrant (> 5 min dans le futur, > 24 h dans le passé) → `400`.
  Un `ts` < `1e12` est interprété comme des **secondes** et converti.
- Champs `hdop`, `alt`, `speed`, `bearing` facultatifs, conservés s'ils sont
  des nombres finis.
- Répond `200` **vide, immédiatement** : tant qu'OsmAnd n'a pas reçu son `200`,
  il garde le point en tampon. Rejouer un point déjà vu (même `ts`) répond
  `200` sans le restocker.
- Limite de débit **par jeton** : seau de 120 requêtes, recharge 2/s — il
  **tolère la vidange du tampon** OsmAnd au retour du réseau. Au-delà → `429`.
- Sans jeton valide : 30 requêtes/minute et par IP, puis `429` (freine la
  recherche de jetons). Derrière le Funnel, toutes les requêtes viennent de la
  boucle locale : l'IP retenue est alors la **première valeur de
  `X-Forwarded-For`** (que le Funnel remplace par l'IP réelle), bornée à 64
  caractères ; sinon l'adresse du socket. Cette IP n'est jamais journalisée.

### `GET /positions?since=<ms>` — lecture par PC-Tac

- Exige `Authorization: Bearer <readKey>` (comparaison à temps constant), sinon
  `401`.
- Rend `{ now, operators: [{ id, nom, fonction, points: [...] }] }`. `id` est un
  identifiant **stable** (`sha256(jeton)` tronqué à 12 hex) : **le jeton ne
  sort jamais du relais**. `points` = ceux reçus **depuis** `since` (borne
  incluse : un point reçu à la même milliseconde que le `now` rendu au sondage
  précédent ne doit pas être sauté), triés par `ts` croissant ; PC-Tac
  dédoublonne le point de bordure par `ts`.
- CORS : `Access-Control-Allow-Origin` uniquement pour les origines autorisées,
  avec `Vary: Origin` ; préflight `OPTIONS` géré (`Authorization` autorisé).

### `GET /health`

`200 ok`, sans données.

## Mémoire et purge

- 500 points au plus par opérateur (les plus anciens sortent).
- Un point **reçu** depuis plus de `TTL_H` heures (défaut 12) est purgé ; purge
  toutes les minutes. La rétention se compte à partir de la **réception** (`rx`),
  pas de l'horodatage du point : un point tamponné hors réseau survit au retour
  du réseau.
- Tout autre chemin → `404`, mauvaise méthode → `405`. Corps de requête ignorés.

## Journaux

Format : horodatage, route, code HTTP, `id` tronqué. **Aucun jeton, aucune
readKey, aucune coordonnée** n'apparaît dans un journal.
