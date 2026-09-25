/**
 * Bilan des photos non intégrées (point 11, audit PDF du 2026-09-25, F25) :
 * une photo absente de la base était omise, une annotation qui ne se
 * fusionnait pas donnait la photo brute, une image illisible disparaissait à
 * la préparation — avec un simple `console.warn` chaque fois. Avant le
 * téléchargement, l'utilisateur voit maintenant « N photos non intégrées : … »
 * et choisit de télécharger quand même ou d'annuler.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const toastSpy = vi.hoisted(() => vi.fn());
const confirmSpy = vi.hoisted(() => vi.fn(async (): Promise<boolean> => true));
vi.mock('@shared/feedback.js', () => ({ toast: toastSpy, confirmDialog: confirmSpy }));

const annotateMock = vi.hoisted(() => vi.fn(async (blob: Blob): Promise<Blob> => blob));
vi.mock('@oi/dessin.js', () => ({ createAnnotatedImageBlob: annotateMock }));

import { dbManager, Store } from '@oi/init.js';
import { PDFEngineV2 } from '@oi/pdf-engine-v2.js';
import { confirmPhotoBilan, notePhotoIssue, photoBilanText, resetPhotoBilan } from '@oi/photo-bilan.js';
import type { OiFormData, OiPhotoMeta } from '@shared/types/contracts.js';

const meta = (id: string, customTitle = '', annotations = '[]'): OiPhotoMeta => ({ id, annotations, tools: '[]', other_tools: '', customTitle });
const ANNOT = JSON.stringify([{ id: 1, type: 'text', x: 0, y: 0, text: 'A', color: '#fff', rotation: 0, size: 10 }]);

function formData(): OiFormData {
    return {
        dynamic_photos: {
            photo_main_adv1: [meta('img_face', 'Face')],
            photo_itin_ext_b1: [meta('img_chemin', '', ANNOT)],
            photo_container_express_carte_preview_container: [meta('img_plan_1', 'Plan de masse')],
        },
    };
}

beforeEach(() => {
    resetPhotoBilan();
    confirmSpy.mockClear();
    confirmSpy.mockImplementation(async () => true);
});

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
});

describe('photoBilanText — ce que l’utilisateur lit', () => {
    it('rien à signaler : aucun bilan', () => {
        expect(photoBilanText(formData())).toBeNull();
    });

    it('compte les photos et dit, pour chacune, où elle est et ce qui lui manque', () => {
        notePhotoIssue('img_face', 'absente');
        notePhotoIssue('img_chemin', 'annotation');
        notePhotoIssue('custom_pdf_background', 'illisible');

        const text = photoBilanText(formData()) ?? '';

        expect(text).toMatch(/^3 photos non intégrées :/);
        expect(text).toMatch(/« Face » \(Adversaire\) : absente de la base/);
        expect(text).toMatch(/Photo sans légende \(Cheminement\) : annotations non fusionnées/);
        expect(text).toMatch(/Fond personnalisé : image illisible/);
    });

    it('une photo perdue ne compte qu’une fois, la perte l’emporte sur les annotations', () => {
        notePhotoIssue('img_chemin', 'annotation');
        notePhotoIssue('img_chemin', 'illisible');
        notePhotoIssue('img_chemin', 'annotation');

        expect(photoBilanText(formData())).toMatch(/^1 photo non intégrée :\n.*image illisible/);
    });

    it('une nouvelle génération repart d’un bilan vide', () => {
        notePhotoIssue('img_face', 'absente');
        resetPhotoBilan();
        expect(photoBilanText(formData())).toBeNull();
    });
});

describe('confirmPhotoBilan — avant le téléchargement', () => {
    it('sans problème : aucune question, on télécharge', async () => {
        expect(await confirmPhotoBilan(formData())).toBe(true);
        expect(confirmSpy).not.toHaveBeenCalled();
    });

    it('avec des photos manquantes : le bilan est montré, l’utilisateur tranche', async () => {
        notePhotoIssue('img_plan_1', 'illisible');
        confirmSpy.mockResolvedValueOnce(false);

        expect(await confirmPhotoBilan(formData())).toBe(false);
        expect(confirmSpy).toHaveBeenCalledWith(expect.objectContaining({
            message: expect.stringMatching(/1 photo non intégrée :\n.*« Plan de masse » \(OI Express\)/),
            confirmLabel: 'Télécharger quand même',
        }));
    });
});

describe('collecte réelle (collectAllData) : les pertes sont relevées', () => {
    it('photo absente de la base, annotations qui ne se fusionnent pas', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        vi.spyOn(dbManager, 'getItem').mockImplementation(async (key: string) => (key === 'img_chemin' || key === 'img_plan_1' ? new Blob(['x'], { type: 'image/jpeg' }) : undefined));
        annotateMock.mockRejectedValueOnce(new Error('canvas saturé'));
        Store.state.formData = formData();

        const data = await PDFEngineV2.collectAllData();

        const text = photoBilanText(data.formData) ?? '';
        expect(text).toMatch(/^2 photos non intégrées/);
        expect(text).toMatch(/« Face ».*absente de la base/);
        expect(text).toMatch(/Cheminement.*annotations non fusionnées/);
    });
});

describe('téléchargement réel (downloadOiPdfV3) : bilan avant, annulation possible', () => {
    const pdfMake = { addVirtualFileSystem: vi.fn(), addFonts: vi.fn(), createPdf: vi.fn(() => ({ getBlob: async () => new Blob(['%PDF'], { type: 'application/pdf' }) })) };

    async function loadEngine(): Promise<typeof import('@oi/pdf/engine-v3.js')> {
        vi.resetModules();
        vi.doMock('pdfmake', () => ({ default: pdfMake }));
        return import('@oi/pdf/engine-v3.js');
    }

    /** Collecte simulée : une photo que la préparation des images ne sait pas lire. */
    function collectWithUnreadable(): () => Promise<{ formData: OiFormData; photosBase64: Record<string, string>; isDark: boolean }> {
        return async () => ({ formData: formData(), photosBase64: { img_plan_1: 'data:image/jpeg;base64,AAAA' }, isDark: false });
    }

    beforeEach(() => {
        // Voie de repli de la préparation des images : décodage par <img>, ici toujours en échec.
        vi.stubGlobal('Image', class { src = ''; decode(): Promise<void> { return Promise.reject(new Error('illisible')); } });
        vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    it('l’utilisateur annule : aucun téléchargement', async () => {
        const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
        confirmSpy.mockResolvedValueOnce(false);
        const { downloadOiPdfV3 } = await loadEngine();

        await downloadOiPdfV3({ collect: collectWithUnreadable() });

        expect(confirmSpy).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringMatching(/« Plan de masse ».*image illisible/) }));
        expect(click).not.toHaveBeenCalled();
    });

    it('l’utilisateur télécharge quand même', async () => {
        const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
        URL.createObjectURL = vi.fn(() => 'blob:pdf');
        const { downloadOiPdfV3 } = await loadEngine();

        await downloadOiPdfV3({ collect: collectWithUnreadable() });

        expect(confirmSpy).toHaveBeenCalledTimes(1);
        expect(click).toHaveBeenCalledTimes(1);
    });
});
