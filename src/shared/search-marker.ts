/**
 * Pointeur précis sur l'adresse cherchée, partagé par PC-Tac (`planmap/chrome.ts`)
 * et la cartographie de l'OI (`oi/carto/map-core.ts`). Extrait tel quel de
 * PC-Tac (planMap.js:894-943) : pulse animé pour attirer l'œil, popup du
 * libellé au clic. Le marker reste jusqu'à la prochaine recherche.
 */
import * as maplibregl from 'maplibre-gl';
import type { Map as MapLibreMap, Marker } from 'maplibre-gl';
import { esc } from './ui-platform.js';

/** Retire `previous` puis pose un nouveau pointeur ; rend le marker posé.
 *  `excludeFromCapture` : pointeur et popup ignorés par html2canvas (la
 *  capture de carte de l'OI part dans le PDF, le pointeur n'y a pas sa place). */
export function placeSearchMarker(
    map: MapLibreMap,
    previous: Marker | null,
    lng: number,
    lat: number,
    label?: string | null,
    excludeFromCapture = false,
): Marker {
    previous?.remove();
    const el = document.createElement('div');
    el.className = 'tac-search-marker';
    // MapLibre pose `tabindex="0"` dès qu'un popup est lié : sans role ni nom,
    // la tabulation tombe sur une div muette. Nommée par l'adresse cherchée.
    el.setAttribute('role', 'button');
    el.setAttribute('aria-label', label ? `Pointeur d'adresse : ${label}` : "Pointeur d'adresse");
    el.style.cssText = `
        position: relative; width: 32px; height: 32px; cursor: pointer;
    `;
    el.innerHTML = `
        <div style="
            position: absolute; inset: 0;
            border-radius: 50%;
            background: rgba(59,130,246,0.35);
            animation: pctacPulse 1.6s ease-out infinite;
        "></div>
        <div style="
            position: absolute; left: 50%; top: 50%;
            transform: translate(-50%, -50%);
            width: 14px; height: 14px;
            background: #3b82f6;
            border: 3px solid #fff;
            border-radius: 50%;
            box-shadow: 0 0 6px rgba(0,0,0,0.6);
        "></div>
    `;
    // Injecte le keyframe une seule fois
    if (!document.getElementById('pctac-pulse-style')) {
        const s = document.createElement('style');
        s.id = 'pctac-pulse-style';
        s.textContent = `@keyframes pctacPulse {
            0% { transform: scale(0.6); opacity: 0.9; }
            100% { transform: scale(2.2); opacity: 0; }
        }`;
        document.head.appendChild(s);
    }
    const popup = label
        ? new maplibregl.Popup({ offset: 18, closeButton: true }).setHTML(
            `<div style="font-family: var(--font-ui); font-size: 0.9em; max-width: 260px;">${esc(label)}</div>`)
        : null;
    if (excludeFromCapture) {
        el.setAttribute('data-html2canvas-ignore', '');
        popup?.on('open', () => popup.getElement()?.setAttribute('data-html2canvas-ignore', ''));
    }
    const m = new maplibregl.Marker({ element: el, anchor: 'center' }).setLngLat([lng, lat]);
    if (popup) m.setPopup(popup);
    m.addTo(map);
    // stopPropagation garde le clic hors des gestionnaires de la carte (roue,
    // pose de pin), donc aussi hors de la bascule native de `setPopup` : on bascule ici.
    el.onclick = (ev) => {
        ev.stopPropagation();
        m.togglePopup();
    };
    return m;
}
