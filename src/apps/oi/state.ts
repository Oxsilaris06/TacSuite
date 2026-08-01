// src/apps/oi/state.ts
import type { OiAnnotation, OiAnnotationTool } from '@shared/types/contracts.js';

/**
 * État lexical partagé du Générateur d'OI.
 * Traduction ESM des `let`/`const` de premier niveau de `modules/init.js` qui,
 * en script classique, étaient réassignés depuis d'autres fichiers.
 * Voir docs/SPEC-OI-CONVERSION.md §3.
 */
export const oiState = {
	// --- PATRACDVR --- init.js:28
	activeMemberId: null as string | null,

	// --- Wizard / références DOM (affectées par main.ts, 4.html:4553-4590) ---
	steps: [] as HTMLElement[],                         // init.js:44
	progressSteps: [] as HTMLElement[],                 // init.js:45
	prevBtn: null as HTMLElement | null,                // init.js:46
	nextBtn: null as HTMLElement | null,
	previewBtn: null as HTMLElement | null,
	patracdvrContainer: null as HTMLElement | null,     // init.js:47
	unassignedContainer: null as HTMLElement | null,
	resetPatracdvrBtn: null as HTMLElement | null,
	presentationModal: null as HTMLDialogElement | null,// init.js:48
	downloadPdfBtn: null as HTMLElement | null,
	coherenceAlertsContainer: null as HTMLElement | null,
	recapFinalisation: null as HTMLElement | null,

	// --- Moteur d'annotation --- init.js:49, 69-78
	currentAnnotationColor: '#c0392b',
	annotationModal: null as HTMLDialogElement | null,
	canvas: null as HTMLCanvasElement | null,
	ctx: null as CanvasRenderingContext2D | null,
	rotationInput: null as HTMLInputElement | null,
	baseImage: new Image(),
	currentTool: 'move' as OiAnnotationTool,
	isDrawing: false,
	isDragging: false,
	startX: 0,
	startY: 0,
	currentAnnotation: null as OiAnnotation | null,
	selectedAnnotation: null as OiAnnotation | null,
	dragOffsetX: 0,
	dragOffsetY: 0,
	isMovingAnnotation: false,
};
