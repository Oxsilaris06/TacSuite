import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { OIWheel } from '../../../src/apps/oi/carto/wheel';

interface MockMap {
    getContainer(): HTMLElement;
    project(lngLat?: { lng: number; lat: number }): { x: number; y: number };
    on(event: string, handler: () => void): void;
    off(event: string, handler: () => void): void;
}

function createMockMap(containerRef: HTMLElement): MockMap {
    return {
        getContainer: () => containerRef,
        project: () => ({ x: 100, y: 100 }),
        on: vi.fn(),
        off: vi.fn(),
    };
}

describe('OIWheel', () => {
    let container: HTMLElement;

    beforeEach(() => {
        // Créer un conteneur pour les tests
        container = document.createElement('div');
        container.id = 'test-container';
        container.style.width = '1024px';
        container.style.height = '768px';
        document.body.appendChild(container);
    });

    afterEach(() => {
        // Nettoyer après chaque test
        if (container && container.parentNode) {
            container.parentNode.removeChild(container);
        }
    });

    it('devrait instancier OIWheel avec les options par défaut', () => {
        const mockMap = createMockMap(container);

        const wheel = new OIWheel({ map: mockMap as never });

        expect(wheel.map).toBe(mockMap);
        expect(wheel.element).toBeNull();
        expect(wheel.radius).toBe(80);
        expect(wheel.centerIcon).toBe('close');
        expect(wheel.options).toEqual([]);
    });

    it('open() devrait insérer l\'élément dans le DOM et ajouter les écouteurs', () => {
        const mockMap = createMockMap(container);

        const wheel = new OIWheel({
            map: mockMap as never,
            options: [
                { label: 'Option 1', icon: 'add', action: vi.fn() },
                { label: 'Option 2', icon: 'delete', action: vi.fn() },
            ],
        });

        wheel.open();

        expect(wheel.element).not.toBeNull();
        expect(container.contains(wheel.element)).toBe(true);
        expect(mockMap.on).toHaveBeenCalledWith('move', expect.any(Function));
        expect(mockMap.on).toHaveBeenCalledWith('zoom', expect.any(Function));
    });

    it('open() devrait créer les boutons des options', () => {
        const mockMap = createMockMap(container);

        const wheel = new OIWheel({
            map: mockMap as never,
            options: [
                { label: 'Option 1', icon: 'add', action: vi.fn() },
                { label: 'Option 2', icon: 'delete', action: vi.fn() },
            ],
        });

        wheel.open();

        const buttons = wheel.element!.querySelectorAll('button');
        // 1 bouton central + 2 boutons d'options
        expect(buttons.length).toBe(3);
    });

    it('le clic sur une option devrait appeler son action et détruire la roue', () => {
        const mockMap = createMockMap(container);

        const actionFn = vi.fn();
        const wheel = new OIWheel({
            map: mockMap as never,
            options: [
                { label: 'Option 1', icon: 'add', action: actionFn },
            ],
        });

        wheel.open();

        const buttons = wheel.element!.querySelectorAll('button');
        const optionButton = buttons[1]; // Le premier est le bouton central

        if (optionButton instanceof HTMLElement) {
            const clickEvent = new MouseEvent('click', { bubbles: true });
            optionButton.dispatchEvent(clickEvent);

            expect(actionFn).toHaveBeenCalledWith(wheel);
            expect(wheel.element).toBeNull();
        }
    });

    it('destroy() devrait nettoyer le DOM et les écouteurs', () => {
        const mockMap = createMockMap(container);

        const onCloseFn = vi.fn();
        const wheel = new OIWheel({
            map: mockMap as never,
            onClose: onCloseFn,
        });

        wheel.open();
        const elementBefore = wheel.element;

        wheel.destroy();

        expect(wheel.element).toBeNull();
        expect(elementBefore && container.contains(elementBefore)).toBe(false);
        expect(mockMap.off).toHaveBeenCalledWith('move', expect.any(Function));
        expect(mockMap.off).toHaveBeenCalledWith('zoom', expect.any(Function));
        expect(onCloseFn).toHaveBeenCalled();
    });

    it('_onOutside devrait ignorer les événements dans les 120 premières millisecondes', () => {
        const mockMap: MockMap = {
            getContainer: () => container,
            project: () => ({ x: 100, y: 100 }),
            on: vi.fn(),
            off: vi.fn(),
        };

        const wheel = new OIWheel({ map: mockMap as never });
        wheel.open();

        // Créer un événement pointer en dehors du wrapper
        const outsideElement = document.createElement('div');
        document.body.appendChild(outsideElement);

        const event = new PointerEvent('pointerdown', { bubbles: true });
        Object.defineProperty(event, 'target', { value: outsideElement, enumerable: true });

        if (wheel._onOutsideHandler) {
            wheel._onOutsideHandler(event as never);
        }

        // La roue ne devrait pas être détruite car elle a été ouverte à l'instant
        expect(wheel.element).not.toBeNull();

        document.body.removeChild(outsideElement);
        wheel.destroy();
    });

    it('_onOutside devrait détruire la roue après 120ms si le clic est en dehors', async () => {
        const mockMap: MockMap = {
            getContainer: () => container,
            project: () => ({ x: 100, y: 100 }),
            on: vi.fn(),
            off: vi.fn(),
        };

        const wheel = new OIWheel({ map: mockMap as never });
        wheel.open();

        // Créer un événement pointer en dehors du wrapper
        const outsideElement = document.createElement('div');
        document.body.appendChild(outsideElement);

        // Attendre 130ms
        await new Promise(resolve => setTimeout(resolve, 130));

        const event = new PointerEvent('pointerdown', { bubbles: true });
        Object.defineProperty(event, 'target', { value: outsideElement, enumerable: true });

        if (wheel._onOutsideHandler) {
            wheel._onOutsideHandler(event as never);
        }

        // La roue devrait être détruite
        expect(wheel.element).toBeNull();

        document.body.removeChild(outsideElement);
    });

    it('le style #oi-wheel-style devrait être présent dans le DOM', () => {
        const mockMap = createMockMap(container);

        new OIWheel({ map: mockMap as never });
        new OIWheel({ map: mockMap as never });

        // Le style devrait avoir été injecté au module load (une seule fois)
        const styles = document.querySelectorAll('#oi-wheel-style');
        expect(styles.length).toBe(1);

        // Vérifier que le contenu du style contient les règles CSS attendues
        const styleElement = document.getElementById('oi-wheel-style');
        expect(styleElement).not.toBeNull();
        if (styleElement) {
            expect(styleElement.textContent).toContain('.oi-wheel.open');
            expect(styleElement.textContent).toContain('.oi-carto-inline-panel');
        }
    });

    it('open() sans map devrait utiliser document.body comme parent', () => {
        const wheel = new OIWheel({
            options: [{ label: 'Option', icon: 'add' }],
        });

        wheel.open();

        expect(wheel.element).not.toBeNull();
        expect(document.body.contains(wheel.element)).toBe(true);

        wheel.destroy();
    });

    it('_position() devrait poser les coordonnées correctes via map.project()', () => {
        const mockMap = {
            getContainer: () => container,
            project: () => ({ x: 250, y: 350 }),
            on: vi.fn(),
            off: vi.fn(),
        };

        const wheel = new OIWheel({
            map: mockMap as never,
            lngLat: { lng: 2.3522, lat: 48.8566 },
        });

        wheel.open();

        expect(wheel.element!.style.left).toBe('250px');
        expect(wheel.element!.style.top).toBe('350px');

        wheel.destroy();
    });

    it('keydown Escape devrait détruire la roue', () => {
        const mockMap: MockMap = {
            getContainer: () => container,
            project: () => ({ x: 100, y: 100 }),
            on: vi.fn(),
            off: vi.fn(),
        };

        const wheel = new OIWheel({ map: mockMap as never });
        wheel.open();

        const keyEvent = new KeyboardEvent('keydown', { key: 'Escape' });
        if (wheel._onKey) {
            wheel._onKey(keyEvent);
        }

        expect(wheel.element).toBeNull();
    });

    it('keepOpen devrait empêcher la destruction après un clic d\'option', () => {
        const mockMap = createMockMap(container);

        const actionFn = vi.fn();
        const wheel = new OIWheel({
            map: mockMap as never,
            options: [
                { label: 'Garder ouvert', icon: 'add', action: actionFn, keepOpen: true },
            ],
        });

        wheel.open();

        const buttons = wheel.element!.querySelectorAll('button');
        const optionButton = buttons[1];

        if (optionButton instanceof HTMLElement) {
            const clickEvent = new MouseEvent('click', { bubbles: true });
            optionButton.dispatchEvent(clickEvent);

            expect(actionFn).toHaveBeenCalled();
            expect(wheel.element).not.toBeNull();
        }

        wheel.destroy();
    });

    it('le bouton central devrait fermer la roue', () => {
        const mockMap: MockMap = {
            getContainer: () => container,
            project: () => ({ x: 100, y: 100 }),
            on: vi.fn(),
            off: vi.fn(),
        };

        const wheel = new OIWheel({ map: mockMap as never });
        wheel.open();

        const buttons = wheel.element!.querySelectorAll('button');
        const centerButton = buttons[0]; // Le premier est le bouton central

        if (centerButton instanceof HTMLElement) {
            const clickEvent = new MouseEvent('click', { bubbles: true });
            centerButton.dispatchEvent(clickEvent);

            expect(wheel.element).toBeNull();
        }
    });
});
