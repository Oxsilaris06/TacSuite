/**
 * Worker de MapLibre 6 (distribution ESM seule).
 *
 * MapLibre cherche son worker à côté de son propre module
 * (`new URL('./maplibre-gl-worker.mjs', import.meta.url)`). Une fois regroupé
 * par Vite, ce fichier voisin n'existe plus : sans ce réglage, aucune tuile
 * ni couche GeoJSON ne se dessine. `?worker&url` fait construire le worker par
 * Vite (avec le code partagé qu'il importe) et en donne l'adresse, qui entre
 * aussi au précache du service worker (hors ligne).
 *
 * À importer avant toute création de carte.
 */
import { setWorkerUrl } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';

setWorkerUrl(workerUrl);
