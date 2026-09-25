/**
 * sw-update-banner.test.ts — Bandeau « Nouvelle version prête » (décision 28/A2).
 *
 * Le service worker ne prend plus la main à l'installation : la page propose
 * de recharger. On simule `navigator.serviceWorker` et l'enregistrement.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
    SW_UPDATE_BANNER_ID,
    wireServiceWorkerUpdate,
    type SwRegistrationLike,
    type WaitingWorkerLike,
} from '../../src/shared/register-sw.js';

class FakeTarget {
    private listeners = new Map<string, Array<() => void>>();
    addEventListener(type: string, listener: () => void): void {
        const list = this.listeners.get(type) ?? [];
        list.push(listener);
        this.listeners.set(type, list);
    }
    fire(type: string): void {
        (this.listeners.get(type) ?? []).forEach((cb) => cb());
    }
}

class FakeInstalling extends FakeTarget {
    state?: string;
}

class FakeRegistration extends FakeTarget implements SwRegistrationLike {
    waiting: WaitingWorkerLike | null = null;
    installing: FakeInstalling | null = null;
}

class FakeContainer extends FakeTarget {
    controller: unknown = {};
}

interface ShownBanner {
    id: string;
    message: string;
    actions: Array<{ label: string; onClick: () => void }>;
}

function setup(hasController: boolean, waiting: WaitingWorkerLike | null = null) {
    const registration = new FakeRegistration();
    const container = new FakeContainer();
    container.controller = hasController ? {} : null;
    registration.waiting = waiting;
    const shown: ShownBanner[] = [];
    const show = vi.fn((id: string, opts: { message: string; actions?: Array<{ label: string; onClick: () => void }> }) => {
        shown.push({ id, message: opts.message, actions: (opts.actions ?? []).map((a) => ({ label: a.label, onClick: a.onClick })) });
    });
    const reload = vi.fn();
    wireServiceWorkerUpdate(registration, container, { show: show as never, reload });
    return { registration, container, shown, show, reload };
}

beforeEach(() => {
    vi.clearAllMocks();
});

describe('worker en attente au chargement', () => {
    it('propose « Nouvelle version prête » quand la page est déjà contrôlée', () => {
        const { shown, reload } = setup(true, { postMessage: vi.fn() });
        expect(shown).toHaveLength(1);
        expect(shown[0]?.id).toBe(SW_UPDATE_BANNER_ID);
        expect(shown[0]?.message).toBe('Nouvelle version prête.');
        expect(shown[0]?.actions[0]?.label).toBe('Recharger');
        expect(reload).not.toHaveBeenCalled();
    });

    it('n’affiche rien pour le PREMIER enregistrement (aucun contrôleur)', () => {
        const { shown, show } = setup(false, { postMessage: vi.fn() });
        expect(show).not.toHaveBeenCalled();
        expect(shown).toHaveLength(0);
    });

    it('n’affiche rien sans worker en attente', () => {
        const { show } = setup(true, null);
        expect(show).not.toHaveBeenCalled();
    });
});

describe('détection après updatefound', () => {
    it('affiche la bannière quand le worker installé est en attente', () => {
        const { registration, shown, reload } = setup(true);
        const installing = new FakeInstalling();
        registration.installing = installing;
        registration.fire('updatefound');
        registration.waiting = { postMessage: vi.fn() };
        installing.state = 'installed';
        installing.fire('statechange');

        expect(shown).toHaveLength(1);
        expect(shown[0]?.id).toBe(SW_UPDATE_BANNER_ID);
        expect(shown[0]?.message).toBe('Nouvelle version prête.');
        expect(shown[0]?.actions[0]?.label).toBe('Recharger');
        expect(reload).not.toHaveBeenCalled();
    });

    it('n’affiche rien au premier enregistrement (aucun contrôleur)', () => {
        const { registration, shown } = setup(false);
        const installing = new FakeInstalling();
        registration.installing = installing;
        registration.fire('updatefound');
        registration.waiting = { postMessage: vi.fn() };
        installing.state = 'installed';
        installing.fire('statechange');
        expect(shown).toHaveLength(0);
    });
});

describe('action « Recharger »', () => {
    it('poste SKIP_WAITING puis recharge au controllerchange', () => {
        const { registration, container, shown, reload } = setup(true);
        const postMessage = vi.fn();
        registration.waiting = { postMessage };
        // Offre d'emblée : on repasse par updatefound pour capter le waiting.
        const installing = new FakeInstalling();
        registration.installing = installing;
        registration.fire('updatefound');
        installing.state = 'installed';
        installing.fire('statechange');

        expect(shown).toHaveLength(1);
        shown[0]?.actions[0]?.onClick();
        expect(postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' });
        expect(reload).not.toHaveBeenCalled();

        container.fire('controllerchange');
        expect(reload).toHaveBeenCalledTimes(1);
    });
});

describe('controllerchange sans clic', () => {
    it('n’affiche pas de « prête » et recharge à la demande', () => {
        const { container, shown, reload } = setup(true);
        container.fire('controllerchange');

        expect(shown).toHaveLength(1);
        expect(shown[0]?.message).toBe('Version mise à jour dans un autre onglet — Recharger.');
        expect(reload).not.toHaveBeenCalled();
        shown[0]?.actions[0]?.onClick();
        expect(reload).toHaveBeenCalledTimes(1);
    });

    it('ne fait rien au premier enregistrement', () => {
        const { container, shown, reload } = setup(false);
        container.fire('controllerchange');
        expect(shown).toHaveLength(0);
        expect(reload).not.toHaveBeenCalled();
    });
});
