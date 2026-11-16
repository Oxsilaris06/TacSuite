/**
 * oi-load-formdata-failure.test.ts — audit du 15/11 (A-LOAD-01) : un échec de
 * lecture IndexedDB pendant `loadFormData` ne doit pas laisser le `finally`
 * réécrire `tactical_oi_data` avec le DOM partiellement rempli.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const KEY = 'tactical_oi_data';

beforeEach(async () => {
    document.body.innerHTML = `
        <form id="oi-form"><input id="situation" type="text"></form>
        <div id="time_events_container"></div>
        <div id="adversaries_container"></div>
        <div id="hypotheses_container"></div>
        <div id="moicp_container"></div>
        <div id="zmspcp_container"></div>
        <div id="effraction_container"></div>
        <div id="rame_vl_container"></div>
        <div id="colonne_progression_container"></div>
        <div id="ordre_penetration_container"></div>
        <div id="unassigned_members_container"></div>
        <div id="patracdvr_container"></div>
        <div id="photo_situation" class="image-preview-container"></div>
    `;
    localStorage.clear();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await import('@oi/formulaires.js');
    window.initializePatracdvr = vi.fn();
    window.addMoicp = vi.fn();
    window.addZmspcp = vi.fn();
    window.addEffraction = vi.fn();
    window.refreshRameVL = vi.fn();
    window.refreshColonneProgression = vi.fn();
    window.refreshOrdrePenetration = vi.fn();
    window.updateArticulationDisplay = vi.fn();
    window.syncAllThumbnails = vi.fn();
    window.updateCustomBgPreview = vi.fn(async () => { /* stub */ });
});

afterEach(async () => {
    const { Store } = await import('@oi/init.js');
    Store.flush();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
});

describe('loadFormData — échec de lecture IndexedDB', () => {
    it('un getItem IndexedDB en échec ne remplace pas tactical_oi_data par un formulaire vide', async () => {
        const session = {
            situation: 'opération en cours',
            dynamic_photos: { photo_situation: [{ id: 'img_1', annotations: '[]', tools: '[]', other_tools: '', customTitle: '' }] },
        };
        localStorage.setItem(KEY, JSON.stringify(session));
        const { dbManager } = await import('@oi/init.js');
        Object.assign(dbManager, { db: {} });
        vi.spyOn(dbManager, 'getItem').mockRejectedValue(new Error('IndexedDB indisponible'));

        await window.loadFormData();
        await new Promise((resolve) => setTimeout(resolve, 900));

        expect(JSON.parse(localStorage.getItem(KEY) ?? '{}')).toEqual(session);
    });
});
