import { beforeEach, describe, expect, it, vi } from 'vitest';

function setupDom(): void {
    document.body.innerHTML = `
        <ul><li class="wizard-progress-step" data-step="5"><span class="material-symbols-outlined">route</span>6. Articulation</li></ul>
        <form id="oi-form"><div class="container">
            <div class="wizard-step" data-oi-section="articulation">
                <h2>6. Articulation (MOIPC/ZMSPCP)</h2>
                <div class="collapsible-container" data-oi-section="colonne">
                    <div class="collapsible-header"><h3><span class="material-symbols-outlined">trending_flat</span> Ordre de la colonne de progression</h3></div>
                    <div class="collapsible-content"><div id="colonne_progression_container"></div></div>
                </div>
            </div>
            <div class="wizard-step" data-oi-section="mission"><h2>4. Mission de l'unité</h2></div>
        </div></form>`;
}

describe('sections-ui — ×, Rétablir, crayon', () => {
    beforeEach(() => {
        setupDom();
        localStorage.clear();
        vi.resetModules();
    });

    it('× retire la section, la ligne Rétablir la rend, le Store suit', async () => {
        const { Store } = await import('@oi/init.js');
        const { initSectionControls } = await import('@oi/sections-ui.js');
        Store.state.formData = {};
        initSectionControls();

        const colonne = document.querySelector<HTMLElement>('[data-oi-section="colonne"]')!;
        colonne.querySelector<HTMLButtonElement>('.oi-section-remove')!.click();
        expect(colonne.classList.contains('oi-section-removed')).toBe(true);
        expect(Store.state.formData.oi_sections?.complete?.removed).toEqual(['colonne']);
        expect(colonne.querySelector('.oi-section-restore-text')?.textContent).toContain('Ordre de la colonne de progression');

        colonne.querySelector<HTMLButtonElement>('.oi-section-restore-btn')!.click();
        expect(colonne.classList.contains('oi-section-removed')).toBe(false);
        expect(Store.state.formData.oi_sections?.complete?.removed).toEqual([]);
    });

    it('un clic sur × ne replie/déplie pas la section repliable', async () => {
        const { Store } = await import('@oi/init.js');
        const { initSectionControls } = await import('@oi/sections-ui.js');
        Store.state.formData = {};
        initSectionControls();
        const toggle = vi.fn();
        document.querySelector('.container')!.addEventListener('click', toggle);
        document.querySelector<HTMLButtonElement>('[data-oi-section="colonne"] .oi-section-remove')!.click();
        expect(toggle).not.toHaveBeenCalled();
    });

    it('le socle n’a pas de ×, mais se renomme ; le numéro d’étape reste', async () => {
        const { Store } = await import('@oi/init.js');
        const { initSectionControls } = await import('@oi/sections-ui.js');
        Store.state.formData = {};
        initSectionControls();
        const mission = document.querySelector<HTMLElement>('[data-oi-section="mission"]')!;
        expect(mission.querySelector('.oi-section-remove')).toBeNull();

        mission.querySelector<HTMLButtonElement>('.oi-section-rename')!.click();
        const input = mission.querySelector<HTMLInputElement>('.oi-section-editor input')!;
        input.value = 'But';
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        expect(mission.querySelector('h2')!.textContent).toContain('4. But');
        expect(Store.state.formData.oi_sections?.complete?.titles).toEqual({ mission: 'But' });
    });

    it('titre vidé : retour au titre d’origine', async () => {
        const { Store } = await import('@oi/init.js');
        const { initSectionControls } = await import('@oi/sections-ui.js');
        Store.state.formData = { oi_sections: { complete: { removed: [], titles: { mission: 'But' } } } };
        initSectionControls();
        const mission = document.querySelector<HTMLElement>('[data-oi-section="mission"]')!;
        mission.querySelector<HTMLButtonElement>('.oi-section-rename')!.click();
        const input = mission.querySelector<HTMLInputElement>('.oi-section-editor input')!;
        input.value = '   ';
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        expect(mission.querySelector('.oi-section-label')!.textContent).toBe("Mission de l'unité");
    });

    it('étape retirée : sa pastille est marquée ; titre renommé : la pastille suit', async () => {
        const { Store } = await import('@oi/init.js');
        const { initSectionControls } = await import('@oi/sections-ui.js');
        Store.state.formData = { oi_sections: { complete: { removed: ['articulation'], titles: { articulation: 'Dispositif' } } } };
        initSectionControls();
        const chip = document.querySelector<HTMLElement>('.wizard-progress-step')!;
        expect(chip.classList.contains('is-removed')).toBe(true);
        expect(chip.textContent).toContain('6. Dispositif');
    });
});
