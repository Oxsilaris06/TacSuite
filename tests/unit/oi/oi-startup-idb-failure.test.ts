/**
 * oi-startup-idb-failure.test.ts — audit du 15/11 (A-START-01) : une
 * IndexedDB bloquée ne doit pas annuler le chargement du formulaire ni le
 * câblage de l'interface.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

beforeEach(async () => {
    document.body.innerHTML = `
        <div id="appAutosave"></div>
        <form id="oi-form"><input id="situation" type="text"></form>
        <div class="wizard-progress"></div>
    `;
    localStorage.clear();
    vi.resetModules();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { dbManager } = await import('@oi/init.js');
    vi.spyOn(dbManager, 'init').mockRejectedValue(new Error('IndexedDB bloquée'));
    await import('@oi/main.js');
    window.loadFormData = vi.fn(async () => { /* remplacé par le test */ });
    window.showStep = vi.fn();
});

afterEach(async () => {
    const { dbManager } = await import('@oi/init.js');
    Object.assign(dbManager, { db: null });
    vi.restoreAllMocks();
    document.body.innerHTML = '';
});

describe('démarrage OI — IndexedDB indisponible', () => {
    it('si dbManager.init rejette, loadFormData et le câblage UI s’exécutent', async () => {
        document.dispatchEvent(new Event('DOMContentLoaded'));

        await vi.waitFor(() => expect(window.loadFormData).toHaveBeenCalled());
        await vi.waitFor(() => expect(window.showStep).toHaveBeenCalled());
    });
});
