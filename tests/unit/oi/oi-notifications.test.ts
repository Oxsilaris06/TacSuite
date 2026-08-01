import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { showNotification, toast } from '@oi/notifications.js';

describe('oi-notifications — Toasts non bloquants', () => {
	beforeEach(() => {
		// Nettoyer le DOM avant chaque test
		const container = document.getElementById('toast-container');
		if (container) {
			container.innerHTML = '';
		}
	});

	afterEach(() => {
		// Nettoyer après chaque test
		vi.useRealTimers();
		const container = document.getElementById('toast-container');
		if (container) {
			container.innerHTML = '';
		}
		// NB: les styles ne sont pas nettoyés car ils sont injectés une seule fois
		// et persistent pour tous les tests (ce qui est voulu)
	});

	it('toast est LA MÊME RÉFÉRENCE que showNotification', () => {
		expect(toast === showNotification).toBe(true);
	});

	it('crée le conteneur toast au premier appel', () => {
		expect(document.getElementById('toast-container')).toBeNull();

		showNotification('Message');

		const container = document.getElementById('toast-container');
		expect(container).not.toBeNull();
		expect(container?.id).toBe('toast-container');
	});

	it('injecte les styles CSS une seule fois', () => {
		showNotification('Message 1');
		const stylesAfterFirst = document.getElementById('toast-styles');
		expect(stylesAfterFirst).not.toBeNull();

		showNotification('Message 2');
		const stylesAfterSecond = document.getElementById('toast-styles');

		// Vérifier que c'est le même élément (pas recréé)
		expect(stylesAfterFirst).toBe(stylesAfterSecond);
	});

	it('utilise le type "info" par défaut', () => {
		vi.useFakeTimers();

		showNotification('Message sans type');

		const toastEl = document.querySelector('.toast');
		expect(toastEl?.classList.contains('info')).toBe(true);

		vi.useRealTimers();
	});

	it('crée un toast avec le type spécifié', () => {
		vi.useFakeTimers();

		showNotification('Success message', 'success');

		const toastEl = document.querySelector('.toast');
		expect(toastEl?.classList.contains('success')).toBe(true);

		vi.useRealTimers();
	});

	it('crée un toast avec le type "error"', () => {
		vi.useFakeTimers();

		showNotification('Error message', 'error');

		const toastEl = document.querySelector('.toast');
		expect(toastEl?.classList.contains('error')).toBe(true);

		vi.useRealTimers();
	});

	it('crée un toast avec le type "warning"', () => {
		vi.useFakeTimers();

		showNotification('Warning message', 'warning');

		const toastEl = document.querySelector('.toast');
		expect(toastEl?.classList.contains('warning')).toBe(true);

		vi.useRealTimers();
	});

	it('affiche le message correct dans le toast', () => {
		vi.useFakeTimers();

		const message = 'Test message content';
		showNotification(message);

		const toastMessage = document.querySelector('.toast-message');
		expect(toastMessage?.textContent).toBe(message);

		vi.useRealTimers();
	});

	it('utilise la durée par défaut de 4000 ms et disparaît après', () => {
		vi.useFakeTimers();

		showNotification('Temporary message');

		let toastEl = document.querySelector('.toast');
		expect(toastEl).not.toBeNull();

		// Avancer de 3999 ms — le toast est encore visible
		vi.advanceTimersByTime(3999);
		toastEl = document.querySelector('.toast');
		expect(toastEl).not.toBeNull();

		// Avancer au moment exact du timeout
		vi.advanceTimersByTime(1);
		// À ce stade, l'animation de sortie commence (300 ms)

		// Avancer après l'animation
		vi.advanceTimersByTime(300);
		toastEl = document.querySelector('.toast');
		expect(toastEl).toBeNull();

		vi.useRealTimers();
	});

	it('utilise une durée personnalisée', () => {
		vi.useFakeTimers();

		showNotification('Quick message', 'info', 1000);

		let toastEl = document.querySelector('.toast');
		expect(toastEl).not.toBeNull();

		// Avancer de 999 ms
		vi.advanceTimersByTime(999);
		toastEl = document.querySelector('.toast');
		expect(toastEl).not.toBeNull();

		// Avancer au moment du timeout
		vi.advanceTimersByTime(1);
		// Animation commence

		// Avancer après l'animation
		vi.advanceTimersByTime(300);
		toastEl = document.querySelector('.toast');
		expect(toastEl).toBeNull();

		vi.useRealTimers();
	});

	it('gère plusieurs toasts simultanément', () => {
		vi.useFakeTimers();

		showNotification('Message 1', 'info', 4000);
		showNotification('Message 2', 'success', 4000);
		showNotification('Message 3', 'error', 4000);

		const toasts = document.querySelectorAll('.toast');
		expect(toasts.length).toBe(3);

		// Vérifier les types
		expect(toasts[0]?.classList.contains('info')).toBe(true);
		expect(toasts[1]?.classList.contains('success')).toBe(true);
		expect(toasts[2]?.classList.contains('error')).toBe(true);

		vi.useRealTimers();
	});

	it('ajoute des toasts au conteneur', () => {
		vi.useFakeTimers();

		showNotification('Toast 1');
		showNotification('Toast 2');

		const container = document.getElementById('toast-container');
		expect(container?.children.length).toBe(2);

		vi.useRealTimers();
	});

	it('applique le style d\'animation au toast', () => {
		vi.useFakeTimers();

		showNotification('Animated message');

		const toastEl = document.querySelector('.toast') as HTMLElement | null;
		// L'animation initiale est définie dans le CSS (toast-in est dans .toast),
		// donc elle n'est pas visible via style.animation, mais on peut vérifier
		// que la classe 'toast' est appliquée (ce qui déclenche l'animation CSS)
		expect(toastEl?.classList.contains('toast')).toBe(true);

		// Avancer le temps jusqu'au timeout
		vi.advanceTimersByTime(4000);
		// Après le timeout, l'animation de sortie est appliquée directement
		expect(toastEl?.style.animation).toBe('toast-out 0.3s ease forwards');

		vi.useRealTimers();
	});

	it('appelle correctement avec l\'alias toast', () => {
		vi.useFakeTimers();

		toast('Message via alias', 'warning');

		const toastEl = document.querySelector('.toast');
		expect(toastEl?.classList.contains('warning')).toBe(true);
		expect(toastEl?.textContent).toContain('Message via alias');

		vi.useRealTimers();
	});

	it('contient les bonnes classes sur le conteneur', () => {
		showNotification('Test');

		const container = document.getElementById('toast-container');
		expect(container).not.toBeNull();

		// Vérifier le positionnement fixed
		expect(container?.style.position).toBe('fixed');
		expect(container?.style.bottom).toBe('20px');
		expect(container?.style.right).toBe('20px');
	});

	it('affiche l\'icône appropriée selon le type', () => {
		vi.useFakeTimers();

		// 'info' → 'info'
		showNotification('Info', 'info');
		let icon = document.querySelector('.toast .material-symbols-outlined');
		expect(icon?.textContent).toBe('info');

		// Nettoyer
		let toasts = document.querySelectorAll('.toast');
		toasts.forEach(t => t.remove());

		// 'success' → 'check_circle'
		showNotification('Success', 'success');
		icon = document.querySelector('.toast .material-symbols-outlined');
		expect(icon?.textContent).toBe('check_circle');

		// Nettoyer
		toasts = document.querySelectorAll('.toast');
		toasts.forEach(t => t.remove());

		// 'error' → 'error'
		showNotification('Error', 'error');
		icon = document.querySelector('.toast .material-symbols-outlined');
		expect(icon?.textContent).toBe('error');

		// Nettoyer
		toasts = document.querySelectorAll('.toast');
		toasts.forEach(t => t.remove());

		// 'warning' → 'warning'
		showNotification('Warning', 'warning');
		icon = document.querySelector('.toast .material-symbols-outlined');
		expect(icon?.textContent).toBe('warning');

		vi.useRealTimers();
	});

	it('ne crée pas plusieurs conteneurs', () => {
		showNotification('Message 1');
		const container1 = document.getElementById('toast-container');

		showNotification('Message 2');
		const container2 = document.getElementById('toast-container');

		expect(container1).toBe(container2);
	});

	it('window.showNotification est exposé au scope module', () => {
		expect(typeof (window as unknown as Record<string, unknown>).showNotification).toBe('function');
	});

	it('window.toast est exposé au scope module', () => {
		expect(typeof (window as unknown as Record<string, unknown>).toast).toBe('function');
	});

	it('window.toast est la même référence que window.showNotification', () => {
		const w = window as unknown as Record<string, unknown>;
		expect(w.toast === w.showNotification).toBe(true);
	});
});
