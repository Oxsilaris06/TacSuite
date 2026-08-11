import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { oiState } from '@oi/state.js';
import { Store, visitedSteps } from '@oi/init.js';

// Import fonctions du module — seront testées au scope window après l'import.
// Le module les expose via window au scope module.
import '@oi/navigation.js';

/**
 * Rétrécit un élément potentiellement `undefined` (noUncheckedIndexedAccess)
 * en levant si absent — les tests savent par construction (8 étapes créées
 * dans beforeEach) que les index utilisés existent toujours.
 */
function must<T>(value: T | undefined, label: string): T {
	if (value === undefined) throw new Error(`valeur attendue absente : ${label}`);
	return value;
}

describe('oi-navigation', () => {
	beforeEach(() => {
		// Réinitialiser l'état global
		localStorage.clear();
		oiState.steps = [];
		oiState.progressSteps = [];
		oiState.prevBtn = null;
		oiState.nextBtn = null;
		oiState.previewBtn = null;
		visitedSteps.clear();
		Store.state.currentStep = 0;

		// Créer des éléments DOM factices pour les étapes
		for (let i = 0; i < 8; i++) {
			const step = document.createElement('div');
			step.className = 'step';
			step.id = `step-${i}`;
			oiState.steps.push(step);

			const pStep = document.createElement('div');
			pStep.className = 'progress-step';
			pStep.id = `progress-step-${i}`;
			oiState.progressSteps.push(pStep);
		}

		// Créer les 3 boutons
		oiState.prevBtn = document.createElement('button');
		oiState.prevBtn.id = 'prevBtn';
		oiState.nextBtn = document.createElement('button');
		oiState.nextBtn.id = 'nextBtn';
		oiState.previewBtn = document.createElement('button');
		oiState.previewBtn.id = 'previewBtn';

		document.body.appendChild(oiState.prevBtn);
		document.body.appendChild(oiState.nextBtn);
		document.body.appendChild(oiState.previewBtn);
	});

	afterEach(() => {
		// Nettoyer le DOM
		document.body.innerHTML = '';
	});

	describe('showStep(n)', () => {
		it('devrait basculer la classe "active" sur l\'étape actuele', () => {
			expect(typeof window.showStep).toBe('function');
			window.showStep(0);
			expect(must(oiState.steps[0], 'steps[0]').classList.contains('active')).toBe(true);
			expect(must(oiState.steps[1], 'steps[1]').classList.contains('active')).toBe(false);

			window.showStep(3);
			expect(must(oiState.steps[0], 'steps[0]').classList.contains('active')).toBe(false);
			expect(must(oiState.steps[3], 'steps[3]').classList.contains('active')).toBe(true);
		});

		it('devrait basculer la classe "active" sur la puce correspondante', () => {
			window.showStep(2);
			expect(must(oiState.progressSteps[2], 'progressSteps[2]').classList.contains('active')).toBe(true);
			expect(must(oiState.progressSteps[1], 'progressSteps[1]').classList.contains('active')).toBe(false);
		});

		// U17 — `.completed` honnête : visitée ET sans incohérence réelle.
		it('devrait ajouter "completed" aux puces visitées SANS incohérence (sauf celle courante)', () => {
			// Données satisfaisant les règles des étapes 0 et 1 (coherence.ts).
			localStorage.setItem('tactical_oi_data', JSON.stringify({
				date_op: '2026-08-11',
				adversaries: [{ nom_adversaire: 'X', domicile_adversaire: 'Y' }],
			}));
			visitedSteps.add(0);
			visitedSteps.add(1);
			window.showStep(2);

			expect(must(oiState.progressSteps[0], 'progressSteps[0]').classList.contains('completed')).toBe(true);
			expect(must(oiState.progressSteps[1], 'progressSteps[1]').classList.contains('completed')).toBe(true);
			expect(must(oiState.progressSteps[2], 'progressSteps[2]').classList.contains('completed')).toBe(false); // pas soi-même
		});

		// U17/U18 — étape visitée mais incohérente : pas de "completed", point d'erreur.
		it('ne marque PAS "completed" une puce visitée incohérente et pose "step-error"', () => {
			// localStorage vide : date_op manquante (étape 0), aucun adversaire (étape 1).
			// NB : le proxy Store re-persiste formData à chaque assignation du
			// beforeEach — on purge explicitement l'état résiduel du test précédent.
			Store.state.formData = {};
			localStorage.clear();
			visitedSteps.add(0);
			visitedSteps.add(1);
			window.showStep(2);

			expect(must(oiState.progressSteps[0], 'progressSteps[0]').classList.contains('completed')).toBe(false);
			expect(must(oiState.progressSteps[0], 'progressSteps[0]').classList.contains('step-error')).toBe(true);
			expect(must(oiState.progressSteps[1], 'progressSteps[1]').classList.contains('step-error')).toBe(true);
			// Étape sans règle de cohérence : jamais de point d'erreur.
			expect(must(oiState.progressSteps[2], 'progressSteps[2]').classList.contains('step-error')).toBe(false);
		});

		it('devrait masquer prevBtn à l\'étape 0, afficher aux autres', () => {
			window.showStep(0);
			expect(oiState.prevBtn?.style.display).toBe('none');

			window.showStep(2);
			expect(oiState.prevBtn?.style.display).toBe('inline-block');

			window.showStep(1);
			expect(oiState.prevBtn?.style.display).toBe('inline-block');
		});

		it('devrait masquer nextBtn à la dernière étape, afficher aux autres', () => {
			const lastStep = oiState.steps.length - 1; // 7

			window.showStep(0);
			expect(oiState.nextBtn?.style.display).toBe('inline-block');

			window.showStep(3);
			expect(oiState.nextBtn?.style.display).toBe('inline-block');

			window.showStep(lastStep);
			expect(oiState.nextBtn?.style.display).toBe('none');
		});

		it('devrait afficher previewBtn UNIQUEMENT à la dernière étape', () => {
			const lastStep = oiState.steps.length - 1; // 7

			window.showStep(0);
			expect(oiState.previewBtn?.style.display).toBe('none');

			window.showStep(3);
			expect(oiState.previewBtn?.style.display).toBe('none');

			window.showStep(lastStep);
			expect(oiState.previewBtn?.style.display).toBe('inline-block');
		});

		it('devrait appeler window.flushFormData et window.checkCoherence à la dernière étape, dans cet ordre', () => {
			const lastStep = oiState.steps.length - 1;
			let callOrder: string[] = [];

			window.flushFormData = vi.fn(() => {
				callOrder.push('flush');
			});
			window.checkCoherence = vi.fn(() => {
				callOrder.push('check');
			});

			// U17/U18 — flush désormais À CHAQUE étape (fraîcheur des points
			// d'erreur du stepper) ; checkCoherence seulement à la dernière.
			window.showStep(0);
			expect(window.flushFormData).toHaveBeenCalled();
			expect(window.checkCoherence).not.toHaveBeenCalled();

			// À la dernière étape, appeler dans l'ordre
			callOrder = [];
			window.showStep(lastStep);
			expect(callOrder).toEqual(['flush', 'check']);
		});

		it('devrait appeler window.flushFormData et window.checkCoherence même si absent, sans erreur', () => {
			const lastStep = oiState.steps.length - 1;
			// `flushFormData`/`checkCoherence` sont requis sur `Window` (OiFormGlobals) :
			// `Reflect.deleteProperty` contourne la garde TS du `delete` sans `any`.
			Reflect.deleteProperty(window, 'flushFormData');
			Reflect.deleteProperty(window, 'checkCoherence');

			// Ne pas lever
			expect(() => window.showStep(lastStep)).not.toThrow();
		});

		it('devrait remounter en haut avec scrollTo', () => {
			const scrollSpy = vi.spyOn(window, 'scrollTo');

			window.showStep(3);

			expect(scrollSpy).toHaveBeenCalled();
			const callArgs = must(scrollSpy.mock.calls[0], 'scrollSpy.mock.calls[0]');
			// Cast ciblé documenté : `Parameters<typeof window.scrollTo>` (utilisé par le typage
			// de `mock.calls`) ne retient que la DERNIÈRE surcharge déclarée de `scrollTo`
			// (`(x: number, y: number)`), alors que le code testé appelle aussi la forme objet
			// (`{ top, behavior }`). Le cast restaure l'union réellement possible en exécution.
			const firstArg = callArgs[0] as number | ScrollToOptions;
			// Soit un objet {top:0, behavior:'instant'}, soit (0, 0) du catch
			const isScrollOptionsWithTop0 =
				typeof firstArg === 'object' && firstArg !== null && firstArg.top === 0;
			expect(firstArg === 0 || isScrollOptionsWithTop0).toBe(true);

			scrollSpy.mockRestore();
		});
	});

	describe('goToStep(n)', () => {
		it('devrait ignorer un n hors limites', () => {
			window.goToStep(-1);
			expect(Store.state.currentStep).toBe(0);

			window.goToStep(100);
			expect(Store.state.currentStep).toBe(0);
		});

		it('devrait marquer visitée l\'étape actuelle avant le saut', () => {
			Store.state.currentStep = 1;
			visitedSteps.clear();

			window.goToStep(5);

			expect(visitedSteps.has(1)).toBe(true); // étape actuelle avant le saut
		});

		it('devrait marquer visitées les étapes de l\'intervalle parcouru [from, n)', () => {
			// Note: le code original marque visitedSteps.add(from), puis [lo, hi) avec la boucle.
			// Cela ne marque PAS la destination n elle-même — c'est le comportement VERBATIM.
			// navigation.js:36-40 — for (let i = lo; i < hi; i++) visitedSteps.add(i);
			Store.state.currentStep = 1;
			visitedSteps.clear();

			window.goToStep(5); // saut de 1 à 5 → marque 1, 2, 3, 4 (pas 5)

			expect(visitedSteps.has(1)).toBe(true);
			expect(visitedSteps.has(2)).toBe(true);
			expect(visitedSteps.has(3)).toBe(true);
			expect(visitedSteps.has(4)).toBe(true);
			// Note: 5 n'est pas marquée au goToStep — elle le sera au PROCHAIN saut
		});

		it('devrait marquer visitées les étapes en sens inverse [n, from)', () => {
			Store.state.currentStep = 5;
			visitedSteps.clear();

			window.goToStep(1); // saut de 5 à 1 → marque 1, 2, 3, 4 (pas 5, qui était from)
			// Mais visitedSteps.add(from) a ajouté 5 d'abord, donc {5, 1, 2, 3, 4}

			expect(visitedSteps.has(5)).toBe(true);
			expect(visitedSteps.has(4)).toBe(true);
			expect(visitedSteps.has(3)).toBe(true);
			expect(visitedSteps.has(2)).toBe(true);
			expect(visitedSteps.has(1)).toBe(true);
		});

		it('devrait écrire Store.state.currentStep', () => {
			window.goToStep(3);
			expect(Store.state.currentStep).toBe(3);
		});

		it('devrait persister "oiWizardStep" dans localStorage', () => {
			window.goToStep(4);
			expect(localStorage.getItem('oiWizardStep')).toBe('4');
		});

		it('devrait persister "oiVisitedSteps" dans localStorage', () => {
			visitedSteps.add(0);
			visitedSteps.add(2);
			visitedSteps.add(4);

			window.goToStep(5);

			const saved = localStorage.getItem('oiVisitedSteps');
			expect(saved).toBeTruthy();
			const parsed = JSON.parse(saved!);
			// Après goToStep(5) depuis currentStep=0 : marque 0, puis [0,5) = {0,1,2,3,4}
			// Mais on avait pré-ajouté 0, 2, 4 → final {0, 2, 4, 1, 3}
			expect(parsed).toEqual(expect.arrayContaining([0, 2, 4, 1, 3]));
		});

		it('devrait capturer une erreur localStorage (quota)', () => {
			const setItemSpy = vi.spyOn(Storage.prototype, 'setItem');
			setItemSpy.mockImplementationOnce(() => {
				throw new Error('QuotaExceededError');
			});

			// Ne pas lever, accepter le quota
			expect(() => window.goToStep(3)).not.toThrow();

			setItemSpy.mockRestore();
		});

		it('devrait changer l\'affichage des étapes (effet observable de showStep)', () => {
			window.goToStep(2);
			expect(Store.state.currentStep).toBe(2);
			expect(must(oiState.steps[2], 'steps[2]').classList.contains('active')).toBe(true);
		});
	});

	describe('changeStep(n)', () => {
		it('devrait augmenter l\'étape courante de n (dans les limites)', () => {
			Store.state.currentStep = 3;
			window.changeStep(1);
			expect(Store.state.currentStep).toBe(4);

			window.changeStep(1);
			expect(Store.state.currentStep).toBe(5);
		});

		it('devrait diminuer l\'étape courante de n', () => {
			Store.state.currentStep = 5;
			window.changeStep(-1);
			expect(Store.state.currentStep).toBe(4);

			window.changeStep(-2);
			expect(Store.state.currentStep).toBe(2);
		});

		it('devrait respecter les limites (pas dépasser 0 ou max)', () => {
			Store.state.currentStep = 0;
			window.changeStep(-1); // 0 + (-1) = -1, rejeté par goToStep
			expect(Store.state.currentStep).toBe(0);

			Store.state.currentStep = 7;
			window.changeStep(5); // 7 + 5 = 12, rejeté par goToStep
			expect(Store.state.currentStep).toBe(7);
		});
	});

	describe('contrat OiWizardGlobals', () => {
		it('devrait exposer les 3 noms sur window', () => {
			expect(typeof window.showStep).toBe('function');
			expect(typeof window.goToStep).toBe('function');
			expect(typeof window.changeStep).toBe('function');
		});
	});

	describe('écart assumé: gardes sur buttons', () => {
		it('ne devrait pas lever si un bouton est null', () => {
			oiState.prevBtn = null;
			oiState.nextBtn = null;
			oiState.previewBtn = null;

			// Code attendu : if (oiState.prevBtn) oiState.prevBtn.style.display = ...
			// Ne pas lever d'erreur
			expect(() => window.showStep(0)).not.toThrow();
		});
	});
});
