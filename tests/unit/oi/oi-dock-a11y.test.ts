/**
 * oi-dock-a11y.test.ts — le dock de l'OI se pilote au clavier et se lit au
 * lecteur d'écran (atelier UI-2, 2026-09-26). Des `<div>` cliquables n'étaient
 * ni atteignables par Tab ni annoncés comme boutons, et le nom lu était la
 * ligature de l'icône (« folder_zip », « restart_alt »…).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';

const doc = new JSDOM(readFileSync(join(process.cwd(), 'oi', 'index.html'), 'utf8')).window.document;
const items = Array.from(doc.querySelectorAll('#dockMenu > .dock-menu-item'));

describe('dock de l’OI', () => {
    it('ne contient que des boutons et des liens', () => {
        expect(items.length).toBeGreaterThan(5);
        for (const el of items) {
            const ok = el.tagName === 'A' || (el.tagName === 'BUTTON' && el.getAttribute('type') === 'button');
            expect(ok, `#${el.id} est un <${el.tagName.toLowerCase()}>`).toBe(true);
        }
    });

    it('chaque entrée porte un nom en clair ; l’icône est masquée aux lecteurs d’écran', () => {
        for (const el of items) {
            expect(el.getAttribute('aria-label'), `#${el.id}`).toBeTruthy();
            for (const icon of el.querySelectorAll('.material-symbols-outlined')) {
                expect(icon.getAttribute('aria-hidden'), `#${el.id}`).toBe('true');
            }
        }
    });
});
