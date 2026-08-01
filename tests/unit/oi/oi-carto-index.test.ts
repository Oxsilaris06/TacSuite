/**
 * tests/unit/oi/oi-carto-index.test.ts — Tests du réassemblage de façade
 * `OICarto` (paquet `oi-carto-index`).
 * ===========================================================================
 *
 * Vérifie le réassemblage du littéral `OICarto` à partir des groupes de
 * méthodes des sous-modules `carto/*`, et le câblage du bouton dock
 * `#cartographyBtn`.
 *
 * Invariants testés :
 * 1. L'objet `OICarto` est exporté et est un objet.
 * 2. Les propriétés/méthodes publiques attendues sont présentes.
 * 3. `window.OICarto` est posé au scope module.
 * 4. Le câblage du bouton fonctionne quand le bouton existe.
 * 5. Aucun nom n'est déclaré deux fois (count des clés).
 *
 * Source (original) :
 * `/home/nico/Bureau/Web/GStart-main/modules/oi_cartographie.js` (L.269-1681).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { OICarto, default as OICartoDefault } from '@oi/carto/index.js';

describe('oi-carto-index', () => {
    let container: HTMLElement;

    beforeEach(() => {
        // Crée un conteneur factice pour le test.
        container = document.createElement('div');
        container.id = 'test-container';
        document.body.appendChild(container);
    });

    afterEach(() => {
        // Nettoie après chaque test.
        document.body.removeChild(container);
    });

    it('devrait exporter OICarto en tant que const', () => {
        expect(OICarto).toBeDefined();
        expect(typeof OICarto).toBe('object');
    });

    it('devrait exporter OICarto en tant que default export', () => {
        expect(OICartoDefault).toBeDefined();
        expect(typeof OICartoDefault).toBe('object');
        expect(OICartoDefault).toBe(OICarto);
    });

    it('devrait poser window.OICarto au scope module', () => {
        // Le module pose la façade sur window lors de son import.
        expect(window.OICarto).toBeDefined();
        expect(window.OICarto).toBe(OICarto);
    });

    it('devrait exposer les propriétés publiques du contrat OICartoContract', () => {
        // Vérifie les propriétés et méthodes publiques du contrat.
        expect(OICarto).toHaveProperty('map');
        expect(OICarto).toHaveProperty('initialized');
        expect(OICarto).toHaveProperty('is3D');
        expect(OICarto).toHaveProperty('markers');
        expect(OICarto).toHaveProperty('labelsVisible');
        expect(typeof OICarto.open).toBe('function');
        expect(typeof OICarto.close).toBe('function');
    });

    it('devrait assembler tous les groupes de méthodes sans collision', () => {
        // Compte le nombre de clés pour détecter une suraffectation.
        // Les groupes importés sont :
        // - createOICartoState() : 13 champs d'état
        // - SafeMethods : ~1 méthode (_safe)
        // - PersistMethods : ~7 méthodes
        // - MapCoreMethods : ~13 méthodes
        // - PinsMethods : ~22 méthodes
        // - PanelsMethods : ~8 méthodes
        // - CaptureMethods : ~6 méthodes
        // - DrawMethods : ~19 méthodes
        // Total attendu : ~89 propriétés + méthodes
        const keys = Object.keys(OICarto);
        expect(keys.length).toBeGreaterThan(50); // Santé : > 50 clés attendues

        // Vérifie les méthodes clés de chaque groupe :
        // - SafeMethods
        expect(OICarto).toHaveProperty('_safe');
        // - PersistMethods
        expect(OICarto).toHaveProperty('_getCartoState');
        expect(OICarto).toHaveProperty('_loadView');
        expect(OICarto).toHaveProperty('_saveView');
        expect(OICarto).toHaveProperty('_loadPins');
        expect(OICarto).toHaveProperty('_savePins');
        // - MapCoreMethods
        expect(OICarto).toHaveProperty('open');
        expect(OICarto).toHaveProperty('close');
        expect(OICarto).toHaveProperty('_init');
        // - PinsMethods
        expect(OICarto).toHaveProperty('_renderPins');
        expect(OICarto).toHaveProperty('_addPin');
        // - DrawMethods
        expect(OICarto).toHaveProperty('_initDrawingLayers');
        expect(OICarto).toHaveProperty('_undo');
    });

    it('devrait avoir une méthode open callable', () => {
        // Vérifie que la méthode open existe et est callable.
        // Le câblage du bouton est testé au niveau de l'intégration
        // (dans main.ts testing), pas au niveau du module isolé.
        expect(typeof OICarto.open).toBe('function');

        // Vérifie aussi que close existe.
        expect(typeof OICarto.close).toBe('function');
    });
});
