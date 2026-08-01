/**
 * navigation.ts — Navigation de l'assistant (wizard) : affichage et changement d'étape.
 * Port from: modules/navigation.js (49 LOC, intégral).
 * Fonctions principales : showStep, goToStep, changeStep.
 *
 * Implémente OiWizardGlobals (@shared/types/contracts.js).
 */

import { oiState } from '@oi/state.js';
import { Store, visitedSteps } from '@oi/init.js';

// navigation.js:9-32
function showStep(n: number): void {
	// navigation.js:10
	oiState.steps.forEach((step, index) => step.classList.toggle('active', index === n));

	// navigation.js:11-15
	oiState.progressSteps.forEach((pStep, index) => {
		pStep.classList.toggle('active', index === n);
		if (visitedSteps.has(index) && index !== n) pStep.classList.add('completed');
		else pStep.classList.remove('completed');
	});

	// navigation.js:16 — Masque prevBtn à l'étape 0
	if (oiState.prevBtn) oiState.prevBtn.style.display = n === 0 ? 'none' : 'inline-block';

	// navigation.js:17-19 — La dernière étape est l'index steps.length - 1.
	const isLastStep = n === (oiState.steps.length - 1);
	if (oiState.nextBtn) oiState.nextBtn.style.display = isLastStep ? 'none' : 'inline-block';

	// navigation.js:21-28
	if (isLastStep) {
		if (oiState.previewBtn) oiState.previewBtn.style.display = 'inline-block';
		// OI1 — flush immédiat pour que checkCoherence lise la dernière frappe.
		if (typeof window.flushFormData === 'function') window.flushFormData();
		if (typeof window.checkCoherence === 'function') window.checkCoherence();
	} else {
		if (oiState.previewBtn) oiState.previewBtn.style.display = 'none';
	}

	// navigation.js:30-31 — Repositionne en haut à chaque changement d'étape.
	try { window.scrollTo({ top: 0, behavior: 'instant' }); } catch { window.scrollTo(0, 0); }
}

// navigation.js:34-46
function goToStep(n: number): void {
	// navigation.js:35
	if (n >= 0 && n < oiState.steps.length) {
		// navigation.js:36-40 — Saut via une puce : marque visitées toutes les étapes de l'intervalle parcouru.
		const from = Store.state.currentStep;
		visitedSteps.add(from);
		const lo = Math.min(from, n), hi = Math.max(from, n);
		for (let i = lo; i < hi; i++) visitedSteps.add(i);

		// navigation.js:41-43
		Store.state.currentStep = n;
		localStorage.setItem('oiWizardStep', String(n));
		try { localStorage.setItem('oiVisitedSteps', JSON.stringify(Array.from(visitedSteps))); } catch { /* quota */ }

		// navigation.js:44
		showStep(n);
	}
}

// navigation.js:48
function changeStep(n: number): void { goToStep(Store.state.currentStep + n); }

// Poser les 3 noms sur window AU SCOPE MODULE. (navigation.js:implicite, résolus par le scope global du script)
// Le contrat OiWizardGlobals est déjà fusionné dans Window par global.d.ts.
window.showStep = showStep;
window.goToStep = goToStep;
window.changeStep = changeStep;
