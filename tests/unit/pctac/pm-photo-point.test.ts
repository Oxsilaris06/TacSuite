/**
 * pm-photo-point.test.ts — Point proposé par une photo (décision 34, C9).
 * ===========================================================================
 *
 * `pctac:add-point` `{ lat, lon, label }` → point du plan (icône photo), même
 * si la carte n'est pas ouverte (écriture directe dans le stockage du plan),
 * puis toast « Point ajouté au plan ». Coordonnées invalides ignorées.
 */
import { beforeEach, describe, expect, it } from 'vitest';

import { PlanMap } from '../../../src/apps/pctac/planmap/index.js';
import { addPhotoPoint, PHOTO_POINT_ICON } from '../../../src/apps/pctac/planmap/pins.js';

function emitAddPoint(detail: unknown): void {
    document.dispatchEvent(new CustomEvent('pctac:add-point', { detail }));
}

function toastCount(): number {
    return Array.from(document.querySelectorAll('.tac-toast')).filter((el) => (el.textContent ?? '') === 'Point ajouté au plan').length;
}

beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = '';
});

describe('addPhotoPoint — création directe', () => {
    it('coordonnées valides : point écrit même sans carte ouverte (PlanMap.map === null)', () => {
        expect(PlanMap.map).toBeNull();
        expect(PlanMap.initialized).toBe(false);
        expect(addPhotoPoint({ lat: 48.85, lon: 2.35, label: 'Vue sur objectif' })).toBe(true);
        const pins = PlanMap._loadPins();
        expect(pins).toHaveLength(1);
        expect(pins[0]?.lat).toBe(48.85);
        expect(pins[0]?.lng).toBe(2.35);
        expect(pins[0]?.label).toBe('Vue sur objectif');
        expect(pins[0]?.icon).toBe(PHOTO_POINT_ICON);
    });

    it('libellé absent : « Photo » par défaut', () => {
        addPhotoPoint({ lat: 1, lon: 2 });
        expect(PlanMap._loadPins()[0]?.label).toBe('Photo');
    });

    it('coordonnées invalides : ignorées (aucun point)', () => {
        expect(addPhotoPoint({ lat: 999, lon: 2 })).toBe(false);
        expect(addPhotoPoint({ lat: 'abc', lon: 2 })).toBe(false);
        expect(addPhotoPoint({ lat: Number.NaN, lon: Number.NaN })).toBe(false);
        expect(PlanMap._loadPins()).toHaveLength(0);
    });
});

describe('pctac:add-point — écoute de l’évènement (lot B)', () => {
    it('crée un point et pose le toast « Point ajouté au plan »', () => {
        emitAddPoint({ lat: 48.8566, lon: 2.3522, label: 'Photo GPS' });
        const pins = PlanMap._loadPins();
        expect(pins).toHaveLength(1);
        expect(pins[0]?.label).toBe('Photo GPS');
        expect(toastCount()).toBe(1);
    });

    it('un évènement aux coordonnées invalides ne crée rien et ne jette pas', () => {
        expect(() => emitAddPoint({ lat: 'x', lon: 'y' })).not.toThrow();
        expect(PlanMap._loadPins()).toHaveLength(0);
        expect(toastCount()).toBe(0);
    });
});
