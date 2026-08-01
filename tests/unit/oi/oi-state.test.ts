import { describe, it, expect } from 'vitest';
import { oiState } from '@oi/state.js';

describe('oi-state — État lexical partagé du Générateur d\'OI', () => {
	it('initialise currentAnnotationColor à "#c0392b"', () => {
		expect(oiState.currentAnnotationColor).toBe('#c0392b');
	});

	it('initialise currentTool à "move"', () => {
		expect(oiState.currentTool).toBe('move');
	});

	it('initialise steps comme tableau vide', () => {
		expect(Array.isArray(oiState.steps)).toBe(true);
		expect(oiState.steps.length).toBe(0);
	});

	it('initialise progressSteps comme tableau vide', () => {
		expect(Array.isArray(oiState.progressSteps)).toBe(true);
		expect(oiState.progressSteps.length).toBe(0);
	});

	it('initialise baseImage comme instance Image', () => {
		expect(oiState.baseImage).toBeInstanceOf(Image);
	});

	it('initialise activeMemberId à null', () => {
		expect(oiState.activeMemberId).toBeNull();
	});

	it('initialise prevBtn à null', () => {
		expect(oiState.prevBtn).toBeNull();
	});

	it('initialise nextBtn à null', () => {
		expect(oiState.nextBtn).toBeNull();
	});

	it('initialise previewBtn à null', () => {
		expect(oiState.previewBtn).toBeNull();
	});

	it('initialise patracdvrContainer à null', () => {
		expect(oiState.patracdvrContainer).toBeNull();
	});

	it('initialise unassignedContainer à null', () => {
		expect(oiState.unassignedContainer).toBeNull();
	});

	it('initialise resetPatracdvrBtn à null', () => {
		expect(oiState.resetPatracdvrBtn).toBeNull();
	});

	it('initialise presentationModal à null', () => {
		expect(oiState.presentationModal).toBeNull();
	});

	it('initialise downloadPdfBtn à null', () => {
		expect(oiState.downloadPdfBtn).toBeNull();
	});

	it('initialise coherenceAlertsContainer à null', () => {
		expect(oiState.coherenceAlertsContainer).toBeNull();
	});

	it('initialise recapFinalisation à null', () => {
		expect(oiState.recapFinalisation).toBeNull();
	});

	it('initialise annotationModal à null', () => {
		expect(oiState.annotationModal).toBeNull();
	});

	it('initialise canvas à null', () => {
		expect(oiState.canvas).toBeNull();
	});

	it('initialise ctx à null', () => {
		expect(oiState.ctx).toBeNull();
	});

	it('initialise rotationInput à null', () => {
		expect(oiState.rotationInput).toBeNull();
	});

	it('initialise isDrawing à false', () => {
		expect(oiState.isDrawing).toBe(false);
	});

	it('initialise isDragging à false', () => {
		expect(oiState.isDragging).toBe(false);
	});

	it('initialise startX à 0', () => {
		expect(oiState.startX).toBe(0);
	});

	it('initialise startY à 0', () => {
		expect(oiState.startY).toBe(0);
	});

	it('initialise currentAnnotation à null', () => {
		expect(oiState.currentAnnotation).toBeNull();
	});

	it('initialise selectedAnnotation à null', () => {
		expect(oiState.selectedAnnotation).toBeNull();
	});

	it('initialise dragOffsetX à 0', () => {
		expect(oiState.dragOffsetX).toBe(0);
	});

	it('initialise dragOffsetY à 0', () => {
		expect(oiState.dragOffsetY).toBe(0);
	});

	it('initialise isMovingAnnotation à false', () => {
		expect(oiState.isMovingAnnotation).toBe(false);
	});

	it('permet la mutation d\'une propriété et la rend visible aux autres modules', () => {
		// Valeur initiale
		expect(oiState.activeMemberId).toBeNull();

		// Mutation d'une propriété (simule l'affectation depuis un autre module)
		oiState.activeMemberId = 'MBR001';

		// Vérifier que la mutation est visible
		expect(oiState.activeMemberId).toBe('MBR001');

		// Réinitialiser pour ne pas affecter les autres tests
		oiState.activeMemberId = null;
	});

	it('permet la mutation des éléments d\'un tableau', () => {
		// Tableau initial vide
		expect(oiState.steps.length).toBe(0);

		// Ajout d'un élément (simule l'affectation depuis un autre module)
		const mockStep = document.createElement('div');
		oiState.steps.push(mockStep);

		// Vérifier que la mutation est visible
		expect(oiState.steps.length).toBe(1);
		expect(oiState.steps[0]).toBe(mockStep);

		// Nettoyer
		oiState.steps.pop();
	});
});
