/**
 * pc-plan-capture-pdf.test.ts — capture du plan pour les PDF de PC-Tac
 * (rapport complet et synthèse A3), extraite de pdf-export.ts : bascule
 * temporaire sur la vue Plan puis restauration, dimensions lues dans l'image,
 * échec jamais bloquant.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { capturePlanForPdf, imageSizeFromDataUrl } from '@pctac/plan-capture-for-pdf.js';

// PNG 3×2 px, fond transparent (IHDR lisible sans décodage).
const PNG_3x2 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAMAAAACCAYAAACddGYaAAAAEklEQVR4nGNgYGD4z8DAwMAAAAoAAtXcWr8AAAAASUVORK5CYII=';

afterEach(() => {
    Reflect.deleteProperty(window, 'PlanMap');
    Reflect.deleteProperty(window, 'UI');
    document.body.innerHTML = '';
    localStorage.clear();
    vi.useRealTimers();
});

describe('imageSizeFromDataUrl', () => {
    it('lit la taille d’un PNG sans le décoder', () => {
        expect(imageSizeFromDataUrl(PNG_3x2)).toEqual({ widthPx: 3, heightPx: 2 });
    });

    it('rend null pour une donnée illisible', () => {
        expect(imageSizeFromDataUrl('data:,')).toBeNull();
        expect(imageSizeFromDataUrl('data:image/png;base64,AAAA')).toBeNull();
    });
});

describe('capturePlanForPdf', () => {
    it('sans plan : null, sans erreur', async () => {
        await expect(capturePlanForPdf()).resolves.toBeNull();
    });

    it('bascule sur la vue Plan, capture, puis rend la vue de départ', async () => {
        const switchMainView = vi.fn();
        Reflect.set(window, 'UI', { switchMainView });
        Reflect.set(window, 'PlanMap', {
            captureToDataUrl: vi.fn(async () => PNG_3x2),
            map: { resize: vi.fn(), getBearing: () => 30 },
        });
        localStorage.setItem('lastView', 'view-main-courante');
        const cap = await capturePlanForPdf({ settleMs: 0 });
        expect(switchMainView).toHaveBeenNthCalledWith(1, 'view-plan', { keepFiche: true });
        expect(switchMainView).toHaveBeenLastCalledWith('view-main-courante', { keepFiche: true });
        expect(cap).toMatchObject({ widthPx: 3, heightPx: 2, bearingDeg: 30 });
        expect(cap?.dataUrl.startsWith('data:image/')).toBe(true);
    });

    it('une capture qui jette rend null et restaure quand même la vue', async () => {
        const switchMainView = vi.fn();
        Reflect.set(window, 'UI', { switchMainView });
        Reflect.set(window, 'PlanMap', { captureToDataUrl: vi.fn(async () => { throw new Error('WebGL perdu'); }) });
        localStorage.setItem('lastView', 'view-fiches');
        await expect(capturePlanForPdf({ settleMs: 0 })).resolves.toBeNull();
        expect(switchMainView).toHaveBeenLastCalledWith('view-fiches', { keepFiche: true });
    });

    it('une capture vide (« data:, ») rend null', async () => {
        Reflect.set(window, 'PlanMap', { captureToDataUrl: vi.fn(async () => 'data:,') });
        await expect(capturePlanForPdf({ settleMs: 0 })).resolves.toBeNull();
    });
});
