/**
 * oi-medias.test.ts — Tests unitaires de `medias.ts` (P3.CONV, paquet
 * `oi-medias`, port de `modules/medias.js`, GStart-main, 283 LOC intégral).
 * Cf. SPEC-OI-CONVERSION.md §11.8, PAQUETS-OI.json (`oi-medias`).
 *
 * `Store` RÉEL (pas de double) : importé depuis `@oi/init.js`, même précédent
 * que `oi-articulation.test.ts` / `oi-outils.test.ts` — `Store.state.formData`
 * et `Store.state.objectUrlsCache` réinitialisés avant chaque test.
 *
 * `dbManager` MOCKÉ (`vi.spyOn` sur l'objet réel exporté par `@oi/init.js` —
 * MÊME référence que celle consommée par `medias.ts`, un import nommé d'objet
 * n'est pas une liaison ESM à part) : `putItem`/`getItem`/`deleteItem`
 * redirigés vers une `Map` en mémoire, jamais de vraie IndexedDB ouverte
 * (absente sous jsdom, règle commune §13.5).
 *
 * `compressImage` (`@oi/outils.js`) MOCKÉ via `vi.mock` + `vi.hoisted` : c'est
 * un import NOMMÉ de FONCTION (pas un objet/méthode), impossible à intercepter
 * par un simple `vi.spyOn` — même précédent que `pc-pdfexport.test.ts` pour
 * `@pctac/image-store.js`. Permet d'observer les PARAMÈTRES RELEVÉS DANS LA
 * SOURCE (`file, 0.95, 2560`, medias.js:50) sans dépendre de `canvas`/`Image`
 * (inertes sous jsdom) ni de la vraie compression.
 *
 * `input.files` : `FileList` n'a pas de constructeur public et `DataTransfer`
 * est absent de jsdom (précédent `oi-carto-panels-capture.test.ts`, en-tête) —
 * un `Object.defineProperty(input, 'files', { value: File[] })` suffit :
 * `medias.ts` ne lit que `.length` et itère (`Array.from`), jamais
 * `instanceof FileList`.
 *
 * `window.syncDomToStore`/`window.toast` stubbés (`vi.fn()`) : modules
 * consommateurs (`formulaires.ts`, `notifications.ts`) non chargés dans ce
 * test unitaire — RÈGLE D'OR §2.2, mêmes gardes que l'original (aucune pour
 * `syncDomToStore`, `typeof … === 'function'` pour `toast`).
 *
 * `alert` : absent sous jsdom (règle commune §13.5) → `vi.stubGlobal`.
 * `URL.revokeObjectURL` : RÉELLEMENT implémenté sous jsdom 30 (même précédent
 * que `oi-outils.test.ts:142`) → `vi.spyOn` direct, pas de stub nécessaire.
 *
 * Tests obligatoires (PAQUETS-OI.json id="oi-medias") :
 *  (a) upload d'un File factice → compressImage appelée avec (file, 0.95, 2560)
 *      puis dbManager.putItem appelée avec une clé `img_*`.
 *  (b) isSingle=true remplace la preview existante (DOM + suppression IndexedDB
 *      de l'ancienne clé) ; isSingle=false l'ajoute à côté (2 previews).
 *  (c) removeImage supprime l'entrée IndexedDB (dbManager mocké) ET l'élément
 *      DOM, et révoque l'URL d'objet mise en cache.
 *  (d) handleCustomBackgroundChange écrit sous 'custom_pdf_background'.
 *  (e) removeCustomBackground le supprime.
 *  (f) syncAllThumbnails ne jette pas sur un DOM vide.
 *
 * Couverture supplémentaire (invariant central du paquet, cf. routage Sonnet
 * PAQUETS-OI.json : « une erreur y est une perte de données silencieuse ») :
 *  (a2) échec de compression → repli sur le Blob original (medias.js:54-57).
 *  (a3) échec IndexedDB → toast fail-loud (« OI3 », medias.js:88-93).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { compressImageMock } = vi.hoisted(() => ({
    // Signature volontairement non déclarée (params ignorés) : `vi.fn()`
    // capture les arguments d'appel réels indépendamment de l'arité de cette
    // implémentation, et un paramètre nommé mais inutilisé (même préfixé `_`)
    // est signalé par `@typescript-eslint/no-unused-vars` dès lors qu'AUCUN
    // paramètre suivant n'est utilisé (option par défaut `args: "after-used"`).
    compressImageMock: vi.fn(async (): Promise<ArrayBuffer> => new ArrayBuffer(8)),
}));

vi.mock('@oi/outils.js', () => ({
    compressImage: compressImageMock,
}));

import { dbManager, Store } from '@oi/init.js';
import {
    getAdversaryImageInfo,
    handleCustomBackgroundChange,
    handleFileChange,
    removeCustomBackground,
    removeImage,
    syncAllThumbnails,
    updateCustomBgPreview,
} from '@oi/medias.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function byId<T extends HTMLElement>(id: string): T {
    const el = document.getElementById(id);
    if (!el) throw new Error(`#${id} introuvable dans le test`);
    return el as T;
}

function makeFile(name = 'photo.jpg', type = 'image/jpeg', content = 'fake-bytes'): File {
    return new File([content], name, { type });
}

/** cf. en-tête : `Object.defineProperty` remplace `DataTransfer`/`FileList`, absents de jsdom. */
function makeFileInput(files: File[]): HTMLInputElement {
    const input = document.createElement('input');
    input.type = 'file';
    Object.defineProperty(input, 'files', {
        value: files,
        writable: false,
        configurable: true,
    });
    document.body.appendChild(input);
    return input;
}

/** Conteneurs statiques réels de `displayMap` (medias.js:13-26), pour exercer `syncAllThumbnails`. */
function setupContainers(): void {
    document.body.innerHTML = `
        <div id="adversary_photo_preview_container"></div>
        <div id="adversary_photo_display"></div>
        <div id="custom_bg_preview_container"></div>
    `;
}

/** Double IndexedDB en mémoire (règle commune §13.5 : pas de vraie IndexedDB sous jsdom). */
const dbStore = new Map<string, Blob>();

beforeEach(() => {
    setupContainers();
    Store.state.formData = {};
    Store.state.objectUrlsCache = {};
    dbStore.clear();
    compressImageMock.mockClear();
    compressImageMock.mockImplementation(async () => new ArrayBuffer(8));

    vi.spyOn(dbManager, 'putItem').mockImplementation(async (key: string, blob: Blob) => {
        dbStore.set(key, blob);
    });
    vi.spyOn(dbManager, 'getItem').mockImplementation(async (key: string) => dbStore.get(key));
    vi.spyOn(dbManager, 'deleteItem').mockImplementation(async (key: string) => {
        dbStore.delete(key);
    });

    window.syncDomToStore = vi.fn();
    window.toast = vi.fn();
    vi.stubGlobal('alert', vi.fn());
});

afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// (a) handleFileChange — upload, compression, stockage IndexedDB
// ---------------------------------------------------------------------------

describe('(a) handleFileChange — upload', () => {
    it('appelle compressImage(file, 0.95, 2560) puis dbManager.putItem avec une clé img_*', async () => {
        const file = makeFile();
        const input = makeFileInput([file]);

        await handleFileChange(input, 'adversary_photo_preview_container', false);

        expect(compressImageMock).toHaveBeenCalledTimes(1);
        expect(compressImageMock).toHaveBeenCalledWith(file, 0.95, 2560);

        expect(dbManager.putItem).toHaveBeenCalledTimes(1);
        const [key, blob] = vi.mocked(dbManager.putItem).mock.calls[0] as [string, Blob];
        expect(key).toMatch(/^img_/);
        expect(blob).toBeInstanceOf(Blob);
    });

    it('ajoute une .image-preview-item dans le conteneur, réinitialise l’input et synchronise le Store', async () => {
        const input = makeFileInput([makeFile()]);

        await handleFileChange(input, 'adversary_photo_preview_container', false);

        const container = byId('adversary_photo_preview_container');
        const items = container.querySelectorAll('.image-preview-item');
        expect(items).toHaveLength(1);
        const img = items[0]?.querySelector<HTMLImageElement>('img.image-preview');
        expect(img).not.toBeNull();
        expect(img?.id).toMatch(/^img_/);
        expect(img?.src.startsWith('data:')).toBe(true);

        expect(input.value).toBe('');
        expect(window.syncDomToStore).toHaveBeenCalled();
    });

    it('(a2) repli sur le Blob original si compressImage échoue (medias.js:54-57)', async () => {
        const file = makeFile('boom.png', 'image/png');
        compressImageMock.mockRejectedValueOnce(new Error('compression échouée'));
        const input = makeFileInput([file]);

        await handleFileChange(input, 'adversary_photo_preview_container', false);

        expect(dbManager.putItem).toHaveBeenCalledTimes(1);
        const [, storedBlob] = vi.mocked(dbManager.putItem).mock.calls[0] as [string, Blob];
        // medias.js:56 : `blobToStore = file;` — le Blob stocké est l'objet
        // File d'origine (même référence), pas une recompression de repli.
        expect(storedBlob).toBe(file);
    });

    it('(a3) échec IndexedDB → toast fail-loud, sans jeter (medias.js:88-93, invariant « OI3 »)', async () => {
        vi.mocked(dbManager.putItem).mockRejectedValueOnce(new Error('quota dépassé'));
        const input = makeFileInput([makeFile()]);

        await expect(handleFileChange(input, 'adversary_photo_preview_container', false)).resolves.toBeUndefined();

        expect(window.toast).toHaveBeenCalledWith(
            "Échec d'enregistrement d'une photo (stockage saturé/indisponible). Exportez votre session puis réessayez.",
            'error',
        );
        // Aucune vignette ajoutée pour ce fichier en échec.
        const container = byId('adversary_photo_preview_container');
        expect(container.querySelectorAll('.image-preview-item')).toHaveLength(0);
    });
});

// ---------------------------------------------------------------------------
// (b) isSingle : remplace vs ajoute
// ---------------------------------------------------------------------------

describe('(b) handleFileChange — isSingle remplace au lieu d’ajouter', () => {
    it('isSingle=true : la 2e sélection remplace la 1re (DOM à 1 item, ancienne clé supprimée d’IndexedDB)', async () => {
        const container = byId('adversary_photo_preview_container');

        await handleFileChange(makeFileInput([makeFile('a.jpg')]), 'adversary_photo_preview_container', true);
        expect(container.querySelectorAll('.image-preview-item')).toHaveLength(1);
        const firstId = container.querySelector<HTMLImageElement>('img.image-preview')?.id;
        expect(firstId).toBeDefined();

        await handleFileChange(makeFileInput([makeFile('b.jpg')]), 'adversary_photo_preview_container', true);

        const items = container.querySelectorAll('.image-preview-item');
        expect(items).toHaveLength(1);
        const secondId = container.querySelector<HTMLImageElement>('img.image-preview')?.id;
        expect(secondId).toBeDefined();
        expect(secondId).not.toBe(firstId);

        // L'ancienne image a bien été retirée d'IndexedDB via removeImage.
        expect(dbManager.deleteItem).toHaveBeenCalledWith(firstId);
        expect(dbStore.has(firstId as string)).toBe(false);
    });

    it('isSingle=false : la 2e sélection s’ajoute à côté (DOM à 2 items)', async () => {
        const container = byId('adversary_photo_preview_container');

        await handleFileChange(makeFileInput([makeFile('a.jpg')]), 'adversary_photo_preview_container', false);
        await handleFileChange(makeFileInput([makeFile('b.jpg')]), 'adversary_photo_preview_container', false);

        expect(container.querySelectorAll('.image-preview-item')).toHaveLength(2);
        expect(dbManager.deleteItem).not.toHaveBeenCalled();
    });
});

// ---------------------------------------------------------------------------
// (c) removeImage
// ---------------------------------------------------------------------------

describe('(c) removeImage', () => {
    it('supprime l’entrée IndexedDB, l’élément DOM, et révoque l’URL d’objet mise en cache', async () => {
        dbStore.set('img_del_1', new Blob(['x']));
        Store.state.objectUrlsCache['img_del_1'] = 'blob:mock-url-1';

        const container = byId('adversary_photo_preview_container');
        const item = document.createElement('div');
        item.className = 'image-preview-item';
        item.innerHTML = '<img id="img_del_1" class="image-preview">';
        container.appendChild(item);

        const revokeSpy = vi.spyOn(URL, 'revokeObjectURL');

        await removeImage('img_del_1', item);

        expect(dbManager.deleteItem).toHaveBeenCalledWith('img_del_1');
        expect(dbStore.has('img_del_1')).toBe(false);
        expect(document.getElementById('img_del_1')).toBeNull();
        expect(container.contains(item)).toBe(false);
        expect(revokeSpy).toHaveBeenCalledWith('blob:mock-url-1');
        expect(Store.state.objectUrlsCache['img_del_1']).toBeUndefined();
        expect(window.syncDomToStore).toHaveBeenCalled();
    });

    it('itemElement=null (medias.js:35, .closest peut renvoyer null) : ne jette pas, supprime quand même d’IndexedDB', async () => {
        dbStore.set('img_del_2', new Blob(['x']));

        await expect(removeImage('img_del_2', null)).resolves.toBeUndefined();

        expect(dbManager.deleteItem).toHaveBeenCalledWith('img_del_2');
        expect(dbStore.has('img_del_2')).toBe(false);
    });

    it('échec dbManager.deleteItem : retire quand même l’élément DOM (medias.js:119-126, catch)', async () => {
        vi.mocked(dbManager.deleteItem).mockRejectedValueOnce(new Error('IDB indisponible'));
        const container = byId('adversary_photo_preview_container');
        const item = document.createElement('div');
        item.className = 'image-preview-item';
        container.appendChild(item);

        await expect(removeImage('img_missing', item)).resolves.toBeUndefined();

        expect(container.contains(item)).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// (d)/(e) fond PDF personnalisé
// ---------------------------------------------------------------------------

describe('(d) handleCustomBackgroundChange', () => {
    it('écrit le fichier sous la clé custom_pdf_background et rafraîchit l’aperçu', async () => {
        const file = makeFile('fond.png', 'image/png');
        const input = makeFileInput([file]);

        await handleCustomBackgroundChange(input);

        expect(dbManager.putItem).toHaveBeenCalledWith('custom_pdf_background', file);
        expect(dbStore.get('custom_pdf_background')).toBe(file);
        expect(input.value).toBe('');

        // medias.js:164 — `updateCustomBgPreview()` est appelée SANS `await`
        // (fire-and-forget, iso-comportement) : sa propre lecture IndexedDB +
        // FileReader peut encore être en vol quand `handleCustomBackgroundChange`
        // résout déjà — `vi.waitFor` attend la mise à jour DOM asynchrone
        // (même précédent que `pm-geo.test.ts`), sans changer le comportement
        // testé.
        const preview = byId('custom_bg_preview_container');
        await vi.waitFor(() => {
            if (!preview.querySelector('img.image-preview')) {
                throw new Error('aperçu du fond personnalisé pas encore rendu');
            }
        });
    });

    it('aucun fichier sélectionné : n’écrit rien dans IndexedDB', async () => {
        const input = makeFileInput([]);

        await handleCustomBackgroundChange(input);

        expect(dbManager.putItem).not.toHaveBeenCalled();
    });
});

describe('(e) removeCustomBackground', () => {
    it('supprime la clé custom_pdf_background et rafraîchit l’aperçu (message par défaut)', async () => {
        dbStore.set('custom_pdf_background', new Blob(['bg']));

        await removeCustomBackground();

        expect(dbManager.deleteItem).toHaveBeenCalledWith('custom_pdf_background');
        expect(dbStore.has('custom_pdf_background')).toBe(false);

        // medias.js:177 — même fire-and-forget que (d) : `vi.waitFor` attend le
        // rendu asynchrone du message par défaut.
        const preview = byId('custom_bg_preview_container');
        await vi.waitFor(() => {
            if (!preview.textContent?.includes('Aucun fond personnalisé')) {
                throw new Error('message par défaut pas encore rendu');
            }
        });
    });
});

describe('updateCustomBgPreview', () => {
    it('conteneur absent du DOM : ne jette pas (retour anticipé, medias.js:186)', async () => {
        document.body.innerHTML = '';
        await expect(updateCustomBgPreview()).resolves.toBeUndefined();
    });
});

// ---------------------------------------------------------------------------
// (f) syncAllThumbnails
// ---------------------------------------------------------------------------

describe('(f) syncAllThumbnails', () => {
    it('ne jette pas sur un DOM vide (aucun conteneur de displayMap présent)', () => {
        document.body.innerHTML = '';
        expect(() => syncAllThumbnails()).not.toThrow();
    });

    it('mire les vignettes du conteneur preview vers son conteneur display (medias.js:139-156)', async () => {
        await handleFileChange(makeFileInput([makeFile()]), 'adversary_photo_preview_container', false);

        const display = byId('adversary_photo_display');
        const previewImg = byId('adversary_photo_preview_container').querySelector<HTMLImageElement>(
            'img.image-preview',
        );
        expect(previewImg).not.toBeNull();

        const mirrored = display.querySelector<HTMLImageElement>('img.image-preview');
        expect(mirrored).not.toBeNull();
        expect(mirrored?.dataset.refId).toBe(previewImg?.id);
        expect(mirrored?.src).toBe(previewImg?.src);
    });
});

// ---------------------------------------------------------------------------
// Code mort porté par fidélité (medias.js:235-282, cf. en-tête de medias.ts) —
// non appelé par le graphe porté, mais exporté (noUnusedLocals) et donc
// testable. `getAdversaryImageInfo` est pur (synchrone) : exercé ici.
// `fetchImageAndCompress` s'appuie sur `new Image()` (repli DOM) dont le cycle
// de charge n'est pas simulé sous jsdom par défaut (pas de `resources: "usable"`,
// même famille de limitation que `canvas.getContext('2d')`/`maplibre-gl`,
// règle commune §13.5) : non exercé ici pour éviter un test fragile sur du
// code mort — signalé au gate plutôt qu'un stub `Image` improvisé.
// ---------------------------------------------------------------------------

describe('code mort porté par fidélité — getAdversaryImageInfo', () => {
    it('null si aucune photo pour ce conteneur', () => {
        Store.state.formData.dynamic_photos = {};
        expect(getAdversaryImageInfo(undefined, 1)).toBeNull();
    });

    it('renvoie id + annotationsJson de la 1re photo (index 1), ignore le paramètre formData', () => {
        Store.state.formData.dynamic_photos = {
            adversary_photo_preview_container: [
                { id: 'img_x', annotations: '[{"type":"text"}]', tools: '[]', other_tools: '', customTitle: '' },
            ],
        };
        // medias.js:270 — le paramètre `formData` n'est jamais lu (écart signalé
        // au gate, cf. en-tête de medias.ts) : un argument non lié n'a aucune
        // influence sur le résultat, qui provient de `Store.state.formData`.
        expect(getAdversaryImageInfo({ nimporte: 'quoi' }, 1)).toEqual({
            id: 'img_x',
            annotationsJson: '[{"type":"text"}]',
        });
    });
});
