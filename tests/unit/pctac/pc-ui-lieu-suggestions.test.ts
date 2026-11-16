/**
 * pc-ui-lieu-suggestions.test.ts — audit du 15/11 (C-05) :
 * les lieux saisis sont échappés en entier dans la datalist.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { LogManager } from '@pctac/log-manager.js';
import { UI } from '@pctac/ui.js';

beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = '<datalist id="lieu_suggestions"></datalist>';
});

describe('C-05 : suggestions de lieux', () => {
    it('un lieu contenant du HTML est échappé dans la valeur de l’option', () => {
        const payload = '"><img src=x onerror=alert(1)>';
        LogManager.addLieuToHistory(payload);

        let assigned = '';
        const desc = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML');
        const spy = vi.spyOn(Element.prototype, 'innerHTML', 'set').mockImplementation(function (this: Element, value: string) {
            if (this.id === 'lieu_suggestions') assigned = value;
            desc?.set?.call(this, value);
        });
        try {
            UI.refreshLieuSuggestions();
        } finally {
            spy.mockRestore();
        }

        expect(assigned).not.toContain('<img');
        expect(assigned).toContain('&lt;img');
        const dl = document.getElementById('lieu_suggestions') as HTMLDataListElement;
        expect(dl.querySelector('img')).toBeNull();
        expect(dl.querySelector('option')?.value).toBe(payload);
    });
});
