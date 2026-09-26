/**
 * oi-dessin-session.test.ts — Une séance d'annotation de bout en bout, sur la
 * vraie fenêtre (`mountAnnotationModal`) : texte de la Zone et « Annuler »
 * (décision 26). Fichier à part : `initAnnotationWorkspace` ne câble les
 * boutons d'outil qu'une fois par module, et `oi-dessin.test.ts` l'appelle
 * sans eux.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const promptSpy = vi.hoisted(() => vi.fn<(o: { message: string; initial?: string }) => Promise<string | null>>(async () => null));
const confirmSpy = vi.hoisted(() => vi.fn(async (): Promise<boolean> => true));
vi.mock('@shared/feedback.js', () => ({ promptDialog: promptSpy, confirmDialog: confirmSpy, toast: vi.fn() }));

import { setAnnotationHost, type AnnotationHost } from '@shared/annotation-host.js';
import { mountAnnotationModal } from '@shared/annotation-modal.js';
import { oiState } from '@oi/state.js';
import '@oi/dessin.js';
import { flush, installDialog } from '../pctac/fiche-helpers.js';

const host: AnnotationHost = {
    annotations: [],
    objectUrlsCache: {},
    async getImage() { return null; },
    save: vi.fn(),
    syncDom() {},
};

let canvas: HTMLCanvasElement;
let modal: HTMLDialogElement;

beforeAll(() => {
    installDialog();
    modal = mountAnnotationModal({ memberTool: true });
    canvas = document.getElementById('annotationCanvas') as HTMLCanvasElement;
    canvas.width = 1000;
    canvas.height = 1000;
    canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1000, height: 1000, right: 1000, bottom: 1000, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    oiState.canvas = canvas;
    // redrawCanvas s'arrête avant le contexte tant que l'image de fond n'est pas chargée.
    oiState.ctx = {} as CanvasRenderingContext2D;
    oiState.annotationModal = modal;
    setAnnotationHost(host);
    window.initAnnotationWorkspace();
});

beforeEach(() => {
    promptSpy.mockReset();
    confirmSpy.mockReset();
    confirmSpy.mockResolvedValue(true);
    host.annotations = [];
    oiState.selectedAnnotation = null;
    oiState.currentTool = 'move';
});

function mouse(type: string, x: number, y: number): void {
    canvas.dispatchEvent(new MouseEvent(type, { clientX: x, clientY: y, bubbles: true, cancelable: true }));
}

async function drawZone(): Promise<void> {
    document.getElementById('tool_location')!.click();
    await flush();
    mouse('mousedown', 400, 400);
    mouse('mousemove', 500, 400);
    mouse('mouseup', 500, 400);
}

describe('marqueur de Zone', () => {
    it('prend le texte saisi à la sélection de l’outil', async () => {
        promptSpy.mockResolvedValue('PC');
        await drawZone();
        expect(host.annotations).toHaveLength(1);
        expect((host.annotations[0] as unknown as { text: string }).text).toBe('PC');
    });

    it('garde le dernier texte pour la zone suivante, et le propose à la saisie', async () => {
        promptSpy.mockResolvedValue('Z1');
        await drawZone();
        promptSpy.mockResolvedValue(null); // saisie abandonnée : texte précédent gardé
        await drawZone();
        expect(promptSpy.mock.calls[1]?.[0]).toMatchObject({ initial: 'Z1' });
        expect((host.annotations[1] as unknown as { text: string }).text).toBe('Z1');
    });
});

// ---------------------------------------------------------------------------
// « Annuler » jette ce qui a été tracé depuis l'ouverture (décision 26).
// ---------------------------------------------------------------------------
class FakeImage {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    naturalWidth = 640;
    naturalHeight = 480;
    complete = false; // redrawCanvas s'arrête avant le contexte
    set src(_v: string) { queueMicrotask(() => this.onload?.()); }
}

const ZONE = { id: 1, type: 'location', startX: 0, startY: 0, endX: 0, endY: 0, x: 10, y: 10, radius: 20, text: 'A', color: '#c0392b', opacity: 0.5, rotation: 0 };
const OPENED = JSON.stringify([ZONE]);

async function openSession(): Promise<HTMLImageElement> {
    document.getElementById('prev')?.remove();
    const img = document.createElement('img');
    img.id = 'prev';
    img.dataset.annotations = OPENED;
    document.body.append(img);
    host.objectUrlsCache = { prev: 'blob:prev' };
    await window.openAnnotationModal('prev');
    await flush();
    expect(modal.open).toBe(true);
    (host.save as ReturnType<typeof vi.fn>).mockClear();
    return img;
}

function scribble(): void {
    host.annotations.push({ ...ZONE, id: 2 } as unknown as (typeof host.annotations)[number]);
}

describe('Annuler', () => {
    beforeAll(() => {
        vi.stubGlobal('Image', FakeImage);
        vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0));
        host.renderPreview = false; // pas de canvas.toBlob sous jsdom
    });

    it('après un tracé : une confirmation, puis la photo revient à l’ouverture', async () => {
        const img = await openSession();
        scribble();
        document.getElementById('annotation_cancel_header')!.click();
        await flush();
        expect(confirmSpy).toHaveBeenCalledTimes(1);
        expect(modal.open).toBe(false);
        expect(host.annotations).toEqual([ZONE]);
        expect(img.dataset.annotations).toBe(OPENED);
        expect(host.save).toHaveBeenCalled(); // l'OI réécrit son état restauré
    });

    it('sans rien tracer : fermeture directe, sans question', async () => {
        await openSession();
        document.getElementById('annotation_cancel_header')!.click();
        await flush();
        expect(confirmSpy).not.toHaveBeenCalled();
        expect(modal.open).toBe(false);
    });

    it('« Continuer » à la confirmation : la séance reste ouverte, le tracé aussi', async () => {
        confirmSpy.mockResolvedValue(false);
        await openSession();
        scribble();
        document.getElementById('annotation_cancel_header')!.click();
        await flush();
        expect(modal.open).toBe(true);
        expect(host.annotations).toHaveLength(2);
        modal.close();
    });

    it('Enregistrer garde le tracé, sans question', async () => {
        const img = await openSession();
        scribble();
        document.getElementById('annotation_save_header')!.click();
        await flush();
        expect(confirmSpy).not.toHaveBeenCalled();
        expect(modal.open).toBe(false);
        expect(JSON.parse(img.dataset.annotations ?? '[]')).toHaveLength(2);
    });

    it('Échap vaut Annuler', async () => {
        const img = await openSession();
        scribble();
        const esc = new Event('cancel', { cancelable: true });
        modal.dispatchEvent(esc);
        await flush();
        expect(esc.defaultPrevented).toBe(true);
        expect(confirmSpy).toHaveBeenCalledTimes(1);
        expect(modal.open).toBe(false);
        expect(img.dataset.annotations).toBe(OPENED);
    });

    it('Échap forcé par le navigateur (non annulable) : le tracé est jeté avant la fermeture', async () => {
        const img = await openSession();
        scribble();
        modal.dispatchEvent(new Event('cancel', { cancelable: false }));
        expect(confirmSpy).not.toHaveBeenCalled();
        expect(host.annotations).toEqual([ZONE]);
        expect(img.dataset.annotations).toBe(OPENED);
        modal.close();
    });
});

// ---------------------------------------------------------------------------
// Revue : le verrou de défilement d'un geste rend la valeur d'avant.
// ---------------------------------------------------------------------------
describe('défilement de la page pendant un geste', () => {
    it('la souris qui sort de la toile ne lève pas le verrou d’une visionneuse ouverte dessous', () => {
        document.body.style.overflow = 'hidden'; // visionneuse du PC-Tac
        mouse('mouseout', 10, 10);
        expect(document.body.style.overflow).toBe('hidden');
    });

    it('un déplacement verrouille, puis rend la valeur d’avant', () => {
        canvas.width = 1000; // une séance ouverte plus haut l'a mise à la taille de l'image
        canvas.height = 1000;
        host.annotations = [{ ...ZONE, x: 500, y: 500, radius: 50 } as unknown as (typeof host.annotations)[number]];
        for (const before of ['', 'hidden']) {
            document.body.style.overflow = before;
            mouse('mousedown', 500, 500);
            expect(document.body.style.overflow).toBe('hidden');
            mouse('mouseup', 500, 500);
            expect(document.body.style.overflow).toBe(before);
        }
    });
});
