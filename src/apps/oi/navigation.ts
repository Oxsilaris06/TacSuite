/**
 * navigation.ts — Navigation de l'assistant (wizard) : affichage et changement d'étape.
 * Port from: modules/navigation.js (49 LOC, intégral).
 * Fonctions principales : showStep, goToStep, changeStep.
 *
 * Implémente OiWizardGlobals (@shared/types/contracts.js).
 */

import { oiState } from '@oi/state.js';
import { Store, visitedSteps } from '@oi/init.js';
import { coherenceIssuesByStep } from '@oi/coherence.js';
import { isStepVisible, nearestVisibleStep } from '@oi/sections.js';

// navigation.js:9-32
function showStep(n: number): void {
	// navigation.js:10
	oiState.steps.forEach((step, index) => step.classList.toggle('active', index === n));

	// U17/U18 — flush (dernière frappe dans la fenêtre de débounce) puis
	// incohérences réelles par étape : `.completed` honnête + point d'erreur.
	if (typeof window.flushFormData === 'function') window.flushFormData();
	const issues = coherenceIssuesByStep();

	// navigation.js:11-15
	oiState.progressSteps.forEach((pStep, index) => {
		pStep.classList.toggle('active', index === n);
		// U10 (a11y) — l'étape courante est annoncée aux lecteurs d'écran.
		if (index === n) pStep.setAttribute('aria-current', 'step');
		else pStep.removeAttribute('aria-current');
		// U17 — « complétée » = visitée ET sans incohérence réelle (plus
		// seulement visitée) ; U18 — point rouge discret si incohérence.
		const complete = visitedSteps.has(index) && !issues.has(index);
		pStep.classList.toggle('completed', complete && index !== n);
		pStep.classList.toggle('step-error', issues.has(index));
	});

	// navigation.js:16 — Masque prevBtn sur la première étape VISIBLE (l'OI
	// express masque des étapes, `sections.ts`).
	const fd = Store.state.formData;
	const count = oiState.steps.length;
	const isFirstStep = nearestVisibleStep(fd, n - 1, -1, count) === null;
	if (oiState.prevBtn) oiState.prevBtn.style.display = isFirstStep ? 'none' : 'inline-block';

	// navigation.js:17-19 — dernière étape VISIBLE (complète : steps.length - 1).
	const isLastStep = nearestVisibleStep(fd, n + 1, 1, count) === null;
	// OI express : l'aperçu vit dans l'étape Finalisation, masquée ; son
	// double de la barre de navigation prend le relais sur la dernière étape.
	const expressPreview = document.getElementById('expressPreviewBtn');
	if (expressPreview) expressPreview.style.display = isLastStep && !isStepVisible(fd, count - 1) ? 'inline-block' : 'none';
	if (oiState.nextBtn) oiState.nextBtn.style.display = isLastStep ? 'none' : 'inline-block';

	// navigation.js:21-28
	if (isLastStep) {
		if (oiState.previewBtn) oiState.previewBtn.style.display = 'inline-block';
		// OI1 — le flush immédiat a déjà eu lieu en tête de showStep (U17/U18) :
		// checkCoherence lit bien la dernière frappe.
		if (typeof window.checkCoherence === 'function') window.checkCoherence();
	} else {
		if (oiState.previewBtn) oiState.previewBtn.style.display = 'none';
	}

	// navigation.js:30-31 — Repositionne en haut à chaque changement d'étape.
	try { window.scrollTo({ top: 0, behavior: 'instant' }); } catch { window.scrollTo(0, 0); }
}

// navigation.js:34-46
function goToStep(n: number): void {
	// OI express : une étape masquée renvoie à la visible suivante (ou, en fin
	// de parcours, à la précédente) — jamais d'écran vide.
	if (n >= 0 && n < oiState.steps.length && !isStepVisible(Store.state.formData, n)) {
		n = nearestVisibleStep(Store.state.formData, n, 1, oiState.steps.length)
			?? nearestVisibleStep(Store.state.formData, n, -1, oiState.steps.length)
			?? 0;
	}
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
function changeStep(n: number): void {
	// Suivant / Précédent sautent les étapes masquées (OI express).
	const dir: 1 | -1 = n >= 0 ? 1 : -1;
	const target = nearestVisibleStep(Store.state.formData, Store.state.currentStep + n, dir, oiState.steps.length);
	if (target !== null) goToStep(target);
}

// Poser les 3 noms sur window AU SCOPE MODULE. (navigation.js:implicite, résolus par le scope global du script)
// Le contrat OiWizardGlobals est déjà fusionné dans Window par global.d.ts.
window.showStep = showStep;
window.goToStep = goToStep;
window.changeStep = changeStep;
