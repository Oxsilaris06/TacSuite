/**
 * oi-medias-single-replace.test.ts — audit du 15/11 (A-MEDIA-01) : en mode
 * photo unique, l'ancienne photo ne doit être supprimée qu'après validation
 * et enregistrement de la nouvelle.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { compressImageMock, confirmDialogMock, toastSpy } = vi.hoisted(() => ({
    compressImageMock: vi.fn(async (): Promise<ArrayBuffer> => new ArrayBuffer(8)),
    confirmDialogMock: vi.fn(async () => true),
    toastSpy: vi.fn(),
}));

vi.mock('@oi/outils.js', async (orig) => ({
    ...(await orig<typeof import('@oi/outils.js')>()),
    compressImage: compressImageMock,
    reencodeSansExif: vi.fn(async (b: Blob): Promise<Blob> => b),
}));
vi.mock('@shared/feedback.js', async (orig) => ({
    ...(await orig<typeof import('@shared/feedback.js')>()),
    confirmDialog: confirmDialogMock,
    toast: toastSpy,
}));

import { dbManager } from '@oi/init.js';
import { handleFileChange } from '@oi/medias.js';

const CONTAINER = 'adversary_photo_preview_container';
const dbStore = new Map<string, Blob>();

function makeFileInput(name: string, type = 'image/jpeg'): HTMLInputElement {
    const input = document.createElement('input');
    input.type = 'file';
    Object.defineProperty(input, 'files', { value: [new File(['bytes'], name, { type })], configurable: true });
    document.body.appendChild(input);
    return input;
}

beforeEach(() => {
    document.body.innerHTML = `<div id="${CONTAINER}"></div><div id="adversary_photo_display"></div>`;
    dbStore.clear();
    compressImageMock.mockClear();
    compressImageMock.mockImplementation(async () => new ArrayBuffer(8));
    confirmDialogMock.mockReset();
    confirmDialogMock.mockResolvedValue(true);
    toastSpy.mockClear();
    vi.spyOn(dbManager, 'putItem').mockImplementation(async (key: string, blob: Blob) => { dbStore.set(key, blob); });
    vi.spyOn(dbManager, 'getItem').mockImplementation(async (key: string) => dbStore.get(key));
    vi.spyOn(dbManager, 'deleteItem').mockImplementation(async (key: string) => { dbStore.delete(key); });
    window.syncDomToStore = vi.fn();
});

describe('handleFileChange — remplacement d’une photo unique', () => {
    it('un fichier HEIC illisible ne supprime pas la photo unique', async () => {
        const container = document.getElementById(CONTAINER)!;
        await handleFileChange(makeFileInput('a.jpg'), CONTAINER, true);
        const firstId = container.querySelector<HTMLImageElement>('img.image-preview')?.id;
        expect(firstId).toBeDefined();

        compressImageMock.mockRejectedValueOnce(Object.assign(new Error('HEIC non convertible'), { name: 'ImageDecodeError' }));
        const added = await handleFileChange(makeFileInput('b.heic', 'image/heic'), CONTAINER, true);

        expect(added).toBe(0);
        expect(container.querySelectorAll('.image-preview-item')).toHaveLength(1);
        expect(container.querySelector<HTMLImageElement>('img.image-preview')?.id).toBe(firstId);
        expect(dbStore.has(firstId as string)).toBe(true);
    });

    it('annuler la confirmation laisse la photo unique en place', async () => {
        const container = document.getElementById(CONTAINER)!;
        await handleFileChange(makeFileInput('a.jpg'), CONTAINER, true);
        const firstId = container.querySelector<HTMLImageElement>('img.image-preview')?.id;

        confirmDialogMock.mockResolvedValueOnce(false);
        const added = await handleFileChange(makeFileInput('b.jpg'), CONTAINER, true);

        expect(added).toBe(0);
        expect(container.querySelectorAll('.image-preview-item')).toHaveLength(1);
        expect(container.querySelector<HTMLImageElement>('img.image-preview')?.id).toBe(firstId);
        expect(dbStore.has(firstId as string)).toBe(true);
    });
});
