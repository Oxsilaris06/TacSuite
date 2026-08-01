/**
 * oi-dessin.test.ts — Comportement OBSERVÉ de `modules/dessin.js`
 * (GStart-main, 1348 LOC, lecture seule) pour le paquet `oi-dessin` :
 * `src/apps/oi/dessin.ts`. Références `dessin.js:<ligne>` en commentaire,
 * cf. SPEC-OI-CONVERSION.md §11.6/§3, PAQUETS-OI.json (`oi-dessin`).
 *
 * Module DOM (canvas/souris/tactile) : tests écrits APRÈS le port, en fumée
 * ciblée sur les invariants métier (§13.4). `getSelectionBBox`/
 * `getSelectionHandles`/`hitSelectionHandle`/`getAnnotationMetric` ne sont
 * PAS exportées (fonctions internes, jamais consommées hors de ce fichier
 * dans l'original) : elles sont exercées INDIRECTEMENT via
 * `handleDrawStart`/`handleDrawMove` (également internes), en simulant de
 * vrais évènements souris sur le canvas après `window.initAnnotationWorkspace()`
 * — seule façade publique qui les câble. Les coordonnées de référence
 * ci-dessous sont calculées à la main à partir des formules `dessin.js:88-146`
 * pour chacun des 5 types d'annotation (location/box/arrow/text/member).
 *
 * Environnement (règle commune §13.5) :
 *  - `canvas.getContext('2d')` renvoie `null` sous jsdom : `oiState.ctx` est
 *    peuplé avec un objet non-`null` MINIMAL (aucune méthode requise) car
 *    `redrawCanvas()` s'arrête toujours avant de l'utiliser tant que
 *    `oiState.baseImage.complete` reste `false` (valeur par défaut d'un
 *    `Image()` jamais chargé sous jsdom) — invariant vérifié en lisant
 *    `redrawCanvas` (dessin.js:452-465).
 *  - `HTMLDialogElement.showModal`/`.close` n'existent pas sous jsdom :
 *    stubbés `vi.fn()` sur chaque élément `<dialog>` de test.
 *  - `new Image()` : `FakeImage` (stub global) pour `createAnnotatedImageBlob`.
 *  - `HTMLCanvasElement.prototype.toBlob` mocké synchrone.
 *  - `alert`/`navigator.vibrate` : `vi.stubGlobal`.
 *
 * ÉCART DE CONTRAT (voir l'en-tête de `dessin.ts`) : les fixtures
 * 'location'/'box' sont construites via des interfaces locales élargissant
 * `OiShapeAnnotation` (x/y/radius, x/y/width/height) — même écart signalé au
 * gate que `@oi/outils.js`/`@oi/dessin.ts`, `contracts.ts` non modifié.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Store } from '@oi/init.js';
import { oiState } from '@oi/state.js';
import type { OiAnnotation, OiPointAnnotation, OiShapeAnnotation } from '@shared/types/contracts.js';

// createAnnotatedImageBlob est la SEULE fonction exportée par dessin.ts (les
// autres passent par window ou restent internes) : import nommé dédié. Cet
// import déclenche aussi les affectations `window.X = …` du module (effet de
// bord attendu, cf. dessin.ts) — pas besoin d'un import '@oi/dessin.js' séparé.
import { createAnnotatedImageBlob as createAnnotatedImageBlobUnderTest } from '@oi/dessin.js';

// ---------------------------------------------------------------------------
// Fixtures d'annotation — même écart de contrat que outils.ts/dessin.ts.
// ---------------------------------------------------------------------------
interface LocationFixture extends OiShapeAnnotation {
    x: number;
    y: number;
    radius: number;
}
interface BoxFixture extends OiShapeAnnotation {
    x: number;
    y: number;
    width: number;
    height: number;
}

// ---------------------------------------------------------------------------
// FakeImage — stub global de `Image` (jsdom ne charge jamais réellement une
// source), même précédent que `oi-outils.test.ts`.
// ---------------------------------------------------------------------------
const fakeImageState = { naturalWidth: 64, naturalHeight: 32, shouldError: false };

class FakeImage {
    onload: (() => void) | null = null;
    onerror: ((event: Event) => void) | null = null;
    naturalWidth = fakeImageState.naturalWidth;
    naturalHeight = fakeImageState.naturalHeight;
    complete = true;
    private _src = '';

    get src(): string {
        return this._src;
    }

    set src(value: string) {
        this._src = value;
        queueMicrotask(() => {
            if (fakeImageState.shouldError) {
                this.onerror?.(new Event('error'));
            } else {
                this.onload?.();
            }
        });
    }
}

function makeFakeCtx(): CanvasRenderingContext2D {
    // dessin.js — surface minimale requise par drawAnnotation/drawAnnotationOnContext.
    return {
        save: vi.fn(),
        restore: vi.fn(),
        clearRect: vi.fn(),
        drawImage: vi.fn(),
        translate: vi.fn(),
        rotate: vi.fn(),
        setLineDash: vi.fn(),
        beginPath: vi.fn(),
        moveTo: vi.fn(),
        lineTo: vi.fn(),
        quadraticCurveTo: vi.fn(),
        closePath: vi.fn(),
        arc: vi.fn(),
        rect: vi.fn(),
        fill: vi.fn(),
        stroke: vi.fn(),
        strokeRect: vi.fn(),
        fillRect: vi.fn(),
        fillText: vi.fn(),
        strokeText: vi.fn(),
        measureText: (text: string) => ({ width: text.length * 6 }) as TextMetrics,
        font: '',
        fillStyle: '',
        strokeStyle: '',
        lineWidth: 1,
        textAlign: 'start' as CanvasTextAlign,
        textBaseline: 'alphabetic' as CanvasTextBaseline,
        shadowColor: '',
        shadowBlur: 0,
    } as unknown as CanvasRenderingContext2D;
}

beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = '';
    Store.state.annotations = [];
    Store.state.objectUrlsCache = {};
    oiState.canvas = null;
    oiState.ctx = null;
    oiState.annotationModal = null;
    oiState.selectedAnnotation = null;
    oiState.currentAnnotation = null;
    oiState.isDrawing = false;
    oiState.isMovingAnnotation = false;
    oiState.currentTool = 'move';
    oiState.currentAnnotationColor = '#c0392b';
    fakeImageState.naturalWidth = 64;
    fakeImageState.naturalHeight = 32;
    fakeImageState.shouldError = false;
    vi.stubGlobal('Image', FakeImage as unknown as typeof Image);
    vi.stubGlobal('alert', vi.fn());
    window.saveToStorage = vi.fn();
    window.syncDomToStore = vi.fn();
});

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// Contrat OiAnnotationGlobals — les 17 noms exposés sur window.
// ---------------------------------------------------------------------------
describe('contrat OiAnnotationGlobals', () => {
    it('expose les 17 noms attendus sur window', () => {
        const names = [
            'openAnnotationModal',
            'closeAnnotationModal',
            'initAnnotationWorkspace',
            'setActiveTool',
            'updateStrokeWidth',
            'updateTextSize',
            'updateZoneText',
            'updateZoneOpacity',
            'updateAnnotationRotation',
            'setAnnotationColor',
            'undoAnnotation',
            'redoAnnotation',
            'changeZoom',
            'resetZoom',
            'toggleMobileDock',
            'closeMobileSheet',
            'populateMemberCanvasModal',
        ] as const;
        for (const name of names) {
            expect(typeof window[name]).toBe('function');
        }
    });
});

// ---------------------------------------------------------------------------
// Undo / Redo — cycle hash-identité + plafond ANNOTATION_HISTORY_MAX = 50
// (dessin.js:14, :23-72). Exercé via window.setAnnotationColor (pushe
// l'historique AVANT toute mutation de couleur, dessin.js:281-291).
// ---------------------------------------------------------------------------
describe('undo / redo — historique des annotations', () => {
    function makeBoxAnnotation(color: string): BoxFixture {
        return {
            id: 1,
            type: 'box',
            startX: 0, startY: 0, endX: 0, endY: 0,
            rotation: 0,
            color,
            thickness: 5,
            x: 10, y: 10, width: 20, height: 20,
        };
    }

    it('un cycle undo → redo restitue un état structurellement identique (hash JSON)', () => {
        const ann = makeBoxAnnotation('#111111');
        Store.state.annotations = [ann];
        oiState.selectedAnnotation = ann;
        const beforeJson = JSON.stringify(Store.state.annotations);

        const fakeEl = document.createElement('div');
        window.setAnnotationColor('#222222', fakeEl);
        const afterChangeJson = JSON.stringify(Store.state.annotations);
        expect(afterChangeJson).not.toBe(beforeJson);
        expect(Store.state.annotations[0]?.color).toBe('#222222');

        window.undoAnnotation();
        expect(JSON.stringify(Store.state.annotations)).toBe(beforeJson);

        window.redoAnnotation();
        expect(JSON.stringify(Store.state.annotations)).toBe(afterChangeJson);
    });

    it('plafonne l\'historique à 50 entrées (dessin.js:14)', () => {
        const ann = makeBoxAnnotation('#000000');
        Store.state.annotations = [ann];
        oiState.selectedAnnotation = ann;

        const fakeEl = document.createElement('div');
        // 55 changements de couleur distincts → 55 push, seuls les 50 derniers
        // sont conservés (shift() sur dépassement, dessin.js:25).
        for (let i = 1; i <= 55; i++) {
            const hex = `#${String(i).padStart(6, '0')}`;
            window.setAnnotationColor(hex, fakeEl);
        }
        expect(Store.state.annotations[0]?.color).toBe('#000055');

        // 50 undo doivent tous réussir (état change à chaque fois).
        for (let i = 0; i < 50; i++) {
            window.undoAnnotation();
        }
        // La plus ancienne entrée conservée restitue l'état "avant #000006"
        // (les push 1..5 ont été évincés par le plafond de 50).
        expect(Store.state.annotations[0]?.color).toBe('#000005');

        // Un 51e undo est un no-op : l'historique est vide.
        window.undoAnnotation();
        expect(Store.state.annotations[0]?.color).toBe('#000005');
    });

    it('setAnnotationColor ne pushe l\'historique QUE si la couleur change réellement', () => {
        const ann = makeBoxAnnotation('#333333');
        Store.state.annotations = [ann];
        oiState.selectedAnnotation = ann;
        const fakeEl = document.createElement('div');

        window.setAnnotationColor('#333333', fakeEl); // même couleur : pas de push
        // Un undo() ne doit rien changer (aucune entrée à dépiler).
        const before = JSON.stringify(Store.state.annotations);
        window.undoAnnotation();
        expect(JSON.stringify(Store.state.annotations)).toBe(before);
    });
});

// ---------------------------------------------------------------------------
// updateAnnotationRotation — conversion degrés (#rotation_input) → radians
// (dessin.js:243-253).
// ---------------------------------------------------------------------------
describe('updateAnnotationRotation', () => {
    it('convertit la valeur en degrés de #rotation_input en radians', () => {
        const ann: OiPointAnnotation = { id: 1, type: 'text', x: 0, y: 0, text: 'A', color: '#fff', rotation: 0, size: 20 };
        oiState.selectedAnnotation = ann;
        document.body.innerHTML = '<input id="rotation_input" value="90">';

        window.updateAnnotationRotation();

        expect(ann.rotation).toBeCloseTo(Math.PI / 2);
    });

    it('repli 0° si #rotation_input est absent', () => {
        const ann: OiPointAnnotation = { id: 1, type: 'text', x: 0, y: 0, text: 'A', color: '#fff', rotation: 1, size: 20 };
        oiState.selectedAnnotation = ann;

        window.updateAnnotationRotation();

        expect(ann.rotation).toBe(0);
    });

    it('ne fait rien si aucune annotation sélectionnée', () => {
        oiState.selectedAnnotation = null;
        expect(() => window.updateAnnotationRotation()).not.toThrow();
    });
});

// ---------------------------------------------------------------------------
// setActiveTool (dessin.js:256-279)
// ---------------------------------------------------------------------------
describe('setActiveTool', () => {
    it('bascule oiState.currentTool et le curseur du canvas', () => {
        const canvas = document.createElement('canvas');
        oiState.canvas = canvas;

        window.setActiveTool('box');

        expect(oiState.currentTool).toBe('box');
        expect(canvas.style.cursor).toBe('crosshair');
    });

    it("l'outil 'move' pose un curseur 'grab'", () => {
        const canvas = document.createElement('canvas');
        oiState.canvas = canvas;

        window.setActiveTool('move');

        expect(canvas.style.cursor).toBe('grab');
    });

    it('active la classe active sur le bouton #tool_<id> correspondant', () => {
        document.body.innerHTML = '<button id="tool_box" class="tool-btn"></button><button id="tool_move" class="tool-btn active"></button>';

        window.setActiveTool('box');

        expect(document.getElementById('tool_box')?.classList.contains('active')).toBe(true);
        expect(document.getElementById('tool_move')?.classList.contains('active')).toBe(false);
    });

    it('désélectionne l\'annotation courante', () => {
        oiState.selectedAnnotation = { id: 1, type: 'text', x: 0, y: 0, text: 'A', color: '#fff', rotation: 0, size: 20 };
        window.setActiveTool('move');
        expect(oiState.selectedAnnotation).toBeNull();
    });
});

// ---------------------------------------------------------------------------
// updateStrokeWidth / updateTextSize / updateZoneText / updateZoneOpacity —
// gardes de type (dessin.js:207-241).
// ---------------------------------------------------------------------------
describe('setters contextuels — gardes de type', () => {
    it('updateStrokeWidth écrit .thickness sans discriminer le type (dessin.js:207-209)', () => {
        const ann: OiShapeAnnotation = { id: 1, type: 'arrow', startX: 0, startY: 0, endX: 10, endY: 10, rotation: 0, color: '#fff' };
        oiState.selectedAnnotation = ann;

        window.updateStrokeWidth('9');

        expect(ann.thickness).toBe(9);
        expect(window.saveToStorage).toHaveBeenCalled();
    });

    it('updateTextSize ne modifie RIEN si le type sélectionné n\'est pas text/member', () => {
        const ann: OiShapeAnnotation = { id: 1, type: 'box', startX: 0, startY: 0, endX: 0, endY: 0, rotation: 0, color: '#fff' };
        oiState.selectedAnnotation = ann;

        window.updateTextSize('40');

        expect(window.saveToStorage).not.toHaveBeenCalled();
    });

    it('updateTextSize modifie .size pour un type text', () => {
        const ann: OiPointAnnotation = { id: 1, type: 'text', x: 0, y: 0, text: 'A', color: '#fff', rotation: 0, size: 20 };
        oiState.selectedAnnotation = ann;

        window.updateTextSize('40');

        expect(ann.size).toBe(40);
    });

    it('updateZoneText/updateZoneOpacity ne modifient rien hors type location', () => {
        const ann: OiPointAnnotation = { id: 1, type: 'text', x: 0, y: 0, text: 'A', color: '#fff', rotation: 0, size: 20 };
        oiState.selectedAnnotation = ann;

        window.updateZoneText('nouveau texte');
        window.updateZoneOpacity('0.9');

        expect(window.saveToStorage).not.toHaveBeenCalled();
    });

    it('updateZoneText/updateZoneOpacity modifient .text/.opacity pour type location', () => {
        const ann: LocationFixture = {
            id: 1, type: 'location', startX: 0, startY: 0, endX: 0, endY: 0, rotation: 0, color: '#fff',
            x: 0, y: 0, radius: 10,
        };
        oiState.selectedAnnotation = ann;

        window.updateZoneText('Zone A');
        window.updateZoneOpacity('0.25');

        expect(ann.text).toBe('Zone A');
        expect(ann.opacity).toBe(0.25);
    });
});

// ---------------------------------------------------------------------------
// Géométrie de sélection (getSelectionBBox / getSelectionHandles /
// hitSelectionHandle / getAnnotationMetric) — exercée via des évènements
// souris réels sur le canvas, après window.initAnnotationWorkspace().
// ---------------------------------------------------------------------------
describe('géométrie des poignées (resize/rotate) — via handleDrawStart/handleDrawMove', () => {
    const testCanvas = document.createElement('canvas');
    testCanvas.width = 1000;
    testCanvas.height = 1000;

    beforeEach(() => {
        document.body.appendChild(testCanvas);
        // Le mock est réappliqué à CHAQUE test : le `afterEach` global du
        // fichier (`vi.restoreAllMocks()`) le désinstalle après chaque `it`.
        vi.spyOn(testCanvas, 'getBoundingClientRect').mockReturnValue({
            left: 0, top: 0, width: 1000, height: 1000, right: 1000, bottom: 1000, x: 0, y: 0, toJSON: () => ({}),
        } as DOMRect);
        oiState.canvas = testCanvas;
        // dessin.js:452-454 — redrawCanvas() s'arrête toujours avant d'utiliser
        // le contexte tant que baseImage.complete === false (valeur par défaut
        // d'un Image() jamais chargé sous jsdom) : la surface minimale requise
        // ici est celle lue par getSelectionBBox pour 'text'/'member'
        // (dessin.js:103-106 : save/font/measureText/restore).
        oiState.ctx = makeFakeCtx();
        oiState.annotationModal = document.createElement('dialog');
        oiState.annotationModal.showModal = vi.fn();
        oiState.annotationModal.close = vi.fn();

        // Zoom déterministe : changeZoom clampe à 0.1 après un delta très
        // négatif — indépendant de l'état laissé par un test précédent.
        window.changeZoom(-1000);

        window.initAnnotationWorkspace(); // idempotent après le 1er appel réussi (annotationWorkspaceInitialized)
    });

    function dispatchMouse(type: string, x: number, y: number): void {
        testCanvas.dispatchEvent(new MouseEvent(type, { clientX: x, clientY: y, bubbles: true, cancelable: true }));
    }

    it("redimensionne une annotation 'box' via la poignée resize (coin bas-droit)", () => {
        // bbox: x=100,y=100,w=40,h=20 → center=(120,110) ; poignée resize=(140,120)
        const ann: BoxFixture = {
            id: 1, type: 'box', startX: 0, startY: 0, endX: 0, endY: 0, rotation: 0, color: '#fff', thickness: 5,
            x: 100, y: 100, width: 40, height: 20,
        };
        Store.state.annotations = [ann];
        oiState.selectedAnnotation = ann;

        dispatchMouse('mousedown', 140, 120);
        // point à distance 2x du centre dans la même direction que la poignée
        dispatchMouse('mousemove', 160, 130);

        expect(ann.width).toBeCloseTo(80);
        expect(ann.height).toBeCloseTo(40);
        expect(ann.x).toBeCloseTo(80);
        expect(ann.y).toBeCloseTo(90);
    });

    it("redimensionne une annotation 'location' via la poignée resize (rayon)", () => {
        // bbox: x=170,y=170,w=60,h=60 → center=(200,200) ; poignée resize=(230,230)
        const ann: LocationFixture = {
            id: 2, type: 'location', startX: 0, startY: 0, endX: 0, endY: 0, rotation: 0, color: '#fff',
            x: 200, y: 200, radius: 30, text: 'Z', opacity: 0.5,
        };
        Store.state.annotations = [ann];
        oiState.selectedAnnotation = ann;

        dispatchMouse('mousedown', 230, 230);
        // point à distance 3x du centre dans la même direction
        dispatchMouse('mousemove', 290, 290);

        expect(ann.radius).toBeCloseTo(90);
    });

    it("redimensionne une annotation 'arrow' via la poignée resize (startX/Y, endX/Y)", () => {
        // bbox: minX=50,maxX=150,minY=50,maxY=50 → x=40,y=40,w=120,h=20, center=(100,50) ; poignée resize=(160,60)
        const ann: OiShapeAnnotation = {
            id: 3, type: 'arrow', startX: 50, startY: 50, endX: 150, endY: 50, rotation: 0, color: '#fff', thickness: 5,
        };
        Store.state.annotations = [ann];
        oiState.selectedAnnotation = ann;

        dispatchMouse('mousedown', 160, 60);
        // point à distance 2x du centre dans la même direction
        dispatchMouse('mousemove', 220, 70);

        expect(ann.startX).toBeCloseTo(0);
        expect(ann.startY).toBeCloseTo(50);
        expect(ann.endX).toBeCloseTo(200);
        expect(ann.endY).toBeCloseTo(50);
    });

    it("redimensionne une annotation 'member' via la poignée resize (.size, ctx absent → tw=0)", () => {
        // ctx factice sans measureText → getSelectionBBox retombe sur tw=0
        // (dessin.js:103-106, garde ajoutée au portage) : padX=16,padY=8,
        // width=32,height=36, x=284,y=282 → center=(300,300) ; poignée=(316,318)
        const ann: OiPointAnnotation = { id: 4, type: 'member', x: 300, y: 300, text: 'ABC', color: '#fff', rotation: 0, size: 20 };
        Store.state.annotations = [ann];
        oiState.selectedAnnotation = ann;

        dispatchMouse('mousedown', 316, 318);
        // point à distance 2.5x du centre dans la même direction
        dispatchMouse('mousemove', 340, 345);

        expect(ann.size).toBeCloseTo(50);
    });

    it("pivote une annotation 'text' via la poignée rotate", () => {
        // ctx absent → tw=0 : width=20,height=30,x=390,y=380 → center=(400,395)
        const ann: OiPointAnnotation = { id: 5, type: 'text', x: 400, y: 400, text: 'Hi', color: '#fff', rotation: 0, size: 20 };
        Store.state.annotations = [ann];
        oiState.selectedAnnotation = ann;

        // rotOffset = 34/zoom(0.1) = 340 → poignée rotate = (centerX, bb.y - 340) = (400, 40)
        dispatchMouse('mousedown', 400, 40);
        // déplacement horizontal pur depuis le centre (400,395) → angle nul + PI/2
        dispatchMouse('mousemove', 500, 395);

        expect(ann.rotation).toBeCloseTo(Math.PI / 2);
    });

    it('un mousedown hors de toute poignée ne modifie pas la sélection (chemin move/hit-test)', () => {
        const ann: BoxFixture = {
            id: 6, type: 'box', startX: 0, startY: 0, endX: 0, endY: 0, rotation: 0, color: '#fff',
            x: 100, y: 100, width: 40, height: 20,
        };
        Store.state.annotations = [ann];
        oiState.selectedAnnotation = ann;
        oiState.currentTool = 'move';

        // Loin de toute poignée (tolérance 180px avec zoom=0.1) et hors de la
        // zone de l'annotation elle-même : getAnnotationAtPosition renvoie null.
        dispatchMouse('mousedown', 900, 900);

        expect(ann.width).toBe(40); // inchangé : pas de redimensionnement déclenché
    });
});

// ---------------------------------------------------------------------------
// createAnnotatedImageBlob (dessin.js:947-990) — aplatissement, partage
// drawAnnotationOnContext avec le rendu interactif (recon-oi.md §9).
// ---------------------------------------------------------------------------
describe('createAnnotatedImageBlob', () => {
    it('contourne le traitement si le Blob est vide (size === 0)', async () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => { /* no-op */ });
        const emptyBlob = new Blob([], { type: 'image/png' });

        const result = await createAnnotatedImageBlobUnderTest(emptyBlob, []);

        expect(result).toBe(emptyBlob);
        expect(warnSpy).toHaveBeenCalled();
    });

    it('produit un Blob et applique chaque annotation via le contexte local (drawAnnotationOnContext)', async () => {
        const fakeCtx = makeFakeCtx();
        vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(fakeCtx);
        const producedBlob = new Blob(['png'], { type: 'image/png' });
        vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((cb: BlobCallback) => cb(producedBlob));

        const locationAnn: LocationFixture = {
            id: 1, type: 'location', startX: 0, startY: 0, endX: 0, endY: 0, rotation: 0, color: '#fff',
            x: 20, y: 20, radius: 10,
        };
        const textAnn: OiPointAnnotation = { id: 2, type: 'text', x: 5, y: 5, text: 'Hi', color: '#000', rotation: 0, size: 12 };
        const annotations: OiAnnotation[] = [locationAnn, textAnn];
        const sourceBlob = new Blob(['source'], { type: 'image/png' });

        const result = await createAnnotatedImageBlobUnderTest(sourceBlob, annotations);

        expect(result).toBe(producedBlob);
        // drawAnnotationOnContext : 'location' appelle ctx.arc, 'text' appelle ctx.fillText.
        expect(fakeCtx.arc).toHaveBeenCalledTimes(1);
        expect(fakeCtx.fillText).toHaveBeenCalled();
    });

    it('rejette avec un message dédié si le contexte 2D local est indisponible', async () => {
        vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
        const sourceBlob = new Blob(['source'], { type: 'image/png' });

        await expect(createAnnotatedImageBlobUnderTest(sourceBlob, [])).rejects.toThrow(
            "Impossible d'obtenir le contexte 2D du canvas local.",
        );
    });

    it("résout le Blob original si le chargement de l'image échoue (onerror)", async () => {
        fakeImageState.shouldError = true;
        const sourceBlob = new Blob(['source'], { type: 'image/png' });

        const result = await createAnnotatedImageBlobUnderTest(sourceBlob, []);

        expect(result).toBe(sourceBlob);
    });
});

// ---------------------------------------------------------------------------
// populateMemberCanvasModal (dessin.js:1103-1139, expression assignée à window)
// ---------------------------------------------------------------------------
describe('populateMemberCanvasModal', () => {
    function makeModals(): void {
        document.body.innerHTML = `
            <div id="member_canvas_list"></div>
            <dialog id="memberSelectionModalCanvas"></dialog>
        `;
        const modal = document.getElementById('memberSelectionModalCanvas') as HTMLDialogElement;
        modal.showModal = vi.fn();
        modal.close = vi.fn();
    }

    it("affiche un message si aucun membre PATRACDVR valide n'est configuré", () => {
        makeModals();

        window.populateMemberCanvasModal(10, 20);

        expect(document.getElementById('member_canvas_list')?.innerHTML).toContain('Aucun membre configuré');
        expect((document.getElementById('memberSelectionModalCanvas') as HTMLDialogElement).showModal).toHaveBeenCalled();
    });

    it('liste les boutons membres PATRACDVR valides (trigramme renseigné, ≠ N/A)', () => {
        makeModals();
        document.body.insertAdjacentHTML(
            'beforeend',
            `<button class="patracdvr-member-btn" data-trigramme="ABC" data-fonction="Cyno"></button>
             <button class="patracdvr-member-btn" data-trigramme="N/A"></button>
             <button class="patracdvr-member-btn"></button>`,
        );

        window.populateMemberCanvasModal(10, 20);

        const buttons = document.querySelectorAll('#member_canvas_list button');
        expect(buttons.length).toBe(1);
        expect(buttons[0]?.textContent).toBe('ABC - Cyno');
    });

    it('un clic sur un membre ajoute une annotation "member" et ferme la modale', () => {
        makeModals();
        document.body.insertAdjacentHTML('beforeend', '<button class="patracdvr-member-btn" data-trigramme="XYZ"></button>');

        window.populateMemberCanvasModal(42, 84);
        const btn = document.querySelector('#member_canvas_list button') as HTMLButtonElement;
        btn.click();

        expect(Store.state.annotations).toHaveLength(1);
        const added = Store.state.annotations[0] as OiPointAnnotation;
        expect(added.type).toBe('member');
        expect(added.text).toBe('XYZ');
        expect(added.x).toBe(42);
        expect(added.y).toBe(84);
        expect((document.getElementById('memberSelectionModalCanvas') as HTMLDialogElement).close).toHaveBeenCalled();
        expect(window.syncDomToStore).toHaveBeenCalled();
    });
});

// ---------------------------------------------------------------------------
// closeAnnotationModal / closeMobileSheet / toggleMobileDock — bascules DOM.
// ---------------------------------------------------------------------------
describe('closeAnnotationModal', () => {
    it('appelle .close() de la modale et persiste les annotations', async () => {
        const modal = document.createElement('dialog');
        modal.close = vi.fn();
        modal.dataset.targetPreviewId = 'preview1';
        document.body.innerHTML = '<img id="preview1">';
        document.body.appendChild(modal);
        oiState.annotationModal = modal;
        Store.state.annotations = [{ id: 1, type: 'text', x: 0, y: 0, text: 'A', color: '#fff', rotation: 0, size: 10 }];

        await window.closeAnnotationModal();

        expect(modal.close).toHaveBeenCalled();
        expect(document.getElementById('preview1')?.dataset.annotations).toBe(JSON.stringify(Store.state.annotations));
    });

    it("est posée sur window (écart ESM nécessaire, absente d'une pose explicite dans l'original)", () => {
        expect(typeof window.closeAnnotationModal).toBe('function');
    });
});

describe('closeMobileSheet / toggleMobileDock', () => {
    it('closeMobileSheet désélectionne l\'annotation courante', () => {
        oiState.selectedAnnotation = { id: 1, type: 'text', x: 0, y: 0, text: 'A', color: '#fff', rotation: 0, size: 10 };
        window.closeMobileSheet();
        expect(oiState.selectedAnnotation).toBeNull();
    });

    it('toggleMobileDock bascule la classe show-triple-dock et le FAB', () => {
        document.body.innerHTML = `
            <div id="mobile-dock-fab"></div>
            <div id="annotation-toolbar-panel"></div>
            <div class="annotation-wrapper"></div>
        `;

        window.toggleMobileDock();
        expect(document.querySelector('.annotation-wrapper')?.classList.contains('show-triple-dock')).toBe(true);
        expect((document.getElementById('mobile-dock-fab') as HTMLElement).style.display).toBe('none');

        window.toggleMobileDock();
        expect(document.querySelector('.annotation-wrapper')?.classList.contains('show-triple-dock')).toBe(false);
        expect((document.getElementById('mobile-dock-fab') as HTMLElement).style.display).toBe('flex');
    });

    it('toggleMobileDock ne lève pas si les éléments sont absents', () => {
        expect(() => window.toggleMobileDock()).not.toThrow();
    });
});

// ---------------------------------------------------------------------------
// changeZoom / resetZoom (dessin.js:412-450)
// ---------------------------------------------------------------------------
describe('changeZoom / resetZoom', () => {
    it('changeZoom clampe entre 0.1 et 5 et applique le transform CSS', () => {
        const canvas = document.createElement('canvas');
        oiState.canvas = canvas;

        window.changeZoom(-1000);
        expect(canvas.style.transform).toBe('scale(0.1)');

        window.changeZoom(1000);
        expect(canvas.style.transform).toBe('scale(5)');
    });

    it('resetZoom ne lève pas sans conteneur .annotation-canvas-container', () => {
        oiState.canvas = document.createElement('canvas');
        expect(() => window.resetZoom()).not.toThrow();
    });
});
