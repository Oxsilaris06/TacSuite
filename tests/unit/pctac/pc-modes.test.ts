/**
 * pc-modes.test.ts — Situations opérationnelles (`modes.ts` / `mode-ui.ts`).
 *
 * Ce qui est verrouillé ici est ce qui coûterait cher à casser en silence :
 *   - le vocabulaire est COMPLET pour les quatre situations (un libellé oublié
 *     laisserait « Adversaire » affiché en mode Tuerie planifiée) ;
 *   - les clés doctrinales ne collisionnent avec AUCUNE clé historique de
 *     fiche (`nom`, `attitude`, `armes`…) — une collision écraserait une
 *     donnée saisie, sans erreur visible ;
 *   - une fiche requalifiée continue d'afficher les renseignements saisis
 *     dans la situation précédente, au lieu de les faire disparaître ;
 *   - `applyLexicon` laisse le DOM intact sur un jeton inconnu, plutôt que de
 *     vider le libellé.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import {
    PCTAC_MODES,
    PCTAC_MODE_KEY,
    PCTAC_MODE_ORDER,
    allModeFieldKeys,
    currentMode,
    currentModeId,
    modeFieldsOf,
    paxChipKeys,
} from '@pctac/modes.js';
import {
    applyLexicon,
    collectModeFields,
    renderModeBlocks,
    syncSituationPaxChip,
    visibleModeFieldsFor,
} from '@pctac/mode-ui.js';
import { PDF_PAX_COLORS } from '@pctac/config.js';

/** Clés portées par les fiches AVANT l'arrivée des situations. */
const CLES_HISTORIQUES = [
    'id', 'nom', 'prenom', 'dob', 'lien', 'antecedents', 'attitude', 'substance',
    'armes', 'photo', 'hasImage', 'status', 'etat', 'blessures',
];

beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = '';
});

describe('vocabulaire des situations', () => {
    it('couvre les quatre situations sans libellé vide', () => {
        expect(PCTAC_MODE_ORDER).toHaveLength(4);
        PCTAC_MODE_ORDER.forEach((id) => {
            const mode = PCTAC_MODES[id];
            expect(mode.label.trim()).not.toBe('');
            expect(mode.short.trim()).not.toBe('');
            [mode.adv, mode.host].forEach((lex) => {
                Object.entries(lex).forEach(([prop, value]) => {
                    expect(value, `${id}.${prop}`).toBeTypeOf('string');
                    expect((value as string).trim(), `${id}.${prop}`).not.toBe('');
                });
            });
        });
    });

    it('n\'emploie aucune clé doctrinale qui écraserait un champ historique', () => {
        allModeFieldKeys().forEach((key) => {
            expect(CLES_HISTORIQUES, `clé doctrinale « ${key} »`).not.toContain(key);
        });
    });

    it('réemploie les mêmes clés QQOCQPC d\'une situation à l\'autre', () => {
        // C'est ce qui permet de requalifier un cas sans ressaisir : les sept
        // réponses suivent la fiche, seuls les intitulés changent.
        const cles = (id: keyof typeof PCTAC_MODES) => modeFieldsOf(PCTAC_MODES[id].advBlocks)
            .map((f) => f.key).filter((k) => ['qui', 'quoi', 'ou', 'comment', 'quand', 'pourquoi', 'combien'].includes(k));
        expect(cles('tp')).toEqual(cles('recherche'));
        expect(cles('tp')).toEqual(cles('evenement'));
        expect(cles('tp')).toHaveLength(7);
    });

    it('retombe sur Forcené quand le stockage porte une valeur inconnue', () => {
        localStorage.setItem(PCTAC_MODE_KEY, 'situation-inventée');
        expect(currentModeId()).toBe('forcene');
        expect(currentMode().adv.singular).toBe('Adversaire');
    });
});

describe('applyLexicon', () => {
    it('remplace le texte et les attributs depuis la situation courante', () => {
        localStorage.setItem(PCTAC_MODE_KEY, 'tp');
        document.body.innerHTML = `
            <span id="t" data-lex="adv.plural">Adversaires</span>
            <button id="b" data-lex-title="Modifier {adv.demonstrative}" title="Modifier cet adversaire"></button>
            <input id="i" data-lex-placeholder="host.singular" placeholder="Otage">
        `;
        applyLexicon();
        expect(document.getElementById('t')?.textContent).toBe('Ennemis');
        expect(document.getElementById('b')?.getAttribute('title')).toBe('Modifier cet ennemi');
        expect(document.getElementById('i')?.getAttribute('placeholder')).toBe('Otage / Victime');
    });

    it('laisse le libellé d\'origine sur un jeton inconnu', () => {
        document.body.innerHTML = '<span id="t" data-lex="adv.inexistant">Adversaires</span>';
        applyLexicon();
        expect(document.getElementById('t')?.textContent).toBe('Adversaires');
    });
});

describe('jetons de lien adversaire / otage', () => {
    // Verrouille le constat 2 de l'audit UI : les jetons des quatre libellés de
    // lien étaient croisés, `applyLexicon` affichait donc « Lien ennemi » sur la
    // fiche adversaire et « Lien victimes » sur la fiche otage. Si quelqu'un
    // réinverse les jetons, ce test repasse au rouge.
    it('lie la fiche adversaire aux VICTIMES et la fiche otage à l\'ENNEMI', () => {
        localStorage.setItem(PCTAC_MODE_KEY, 'tp');
        document.body.innerHTML = `
            <div><label for="adv_lien" data-lex="adv.linkLabel">Lien Victimes</label><input id="adv_lien"></div>
            <div><label for="edit_adv_lien" data-lex="adv.linkLabel">Lien Victimes</label><input id="edit_adv_lien"></div>
            <div><label for="hostage_lien" data-lex="host.linkLabel">Lien Adversaire</label><select id="hostage_lien"></select></div>
            <div><label for="edit_host_lien" data-lex="host.linkLabel">Lien Adversaire</label><select id="edit_host_lien"></select></div>
        `;
        applyLexicon();
        const libelle = (id: string): string =>
            document.querySelector<HTMLLabelElement>(`label[for="${id}"]`)?.textContent ?? '';
        // La fiche adversaire parle des victimes, et jamais de l'ennemi.
        expect(libelle('adv_lien')).toMatch(/victime/i);
        expect(libelle('edit_adv_lien')).toMatch(/victime/i);
        expect(libelle('adv_lien')).not.toMatch(/ennemi/i);
        expect(libelle('edit_adv_lien')).not.toMatch(/ennemi/i);
        // La fiche otage parle de l'ennemi, et jamais des victimes.
        expect(libelle('hostage_lien')).toMatch(/ennemi/i);
        expect(libelle('edit_host_lien')).toMatch(/ennemi/i);
        expect(libelle('hostage_lien')).not.toMatch(/victime/i);
        expect(libelle('edit_host_lien')).not.toMatch(/victime/i);
    });
});

describe('champs doctrinaux', () => {
    it('rend, relit et vide les blocs de la situation', () => {
        const host = document.createElement('div');
        document.body.appendChild(host);

        expect(renderModeBlocks(host, PCTAC_MODES.tp.advBlocks, 'adv')).toBe(true);
        expect(host.hidden).toBe(false);
        const position = document.getElementById('adv_m_position') as HTMLInputElement | null;
        expect(position).not.toBeNull();
        position!.value = 'Étage 2, escalier B';
        expect(collectModeFields(host).position).toBe('Étage 2, escalier B');

        // Forcené ne porte aucun bloc : le conteneur disparaît entièrement.
        expect(renderModeBlocks(host, PCTAC_MODES.forcene.advBlocks, 'adv')).toBe(false);
        expect(host.hidden).toBe(true);
        expect(host.innerHTML).toBe('');
    });

    it('pré-remplit depuis la fiche, y compris une clé vide', () => {
        const host = document.createElement('div');
        document.body.appendChild(host);
        renderModeBlocks(host, PCTAC_MODES.tp.advBlocks, 'adv', { position: 'Toit', nature: '' });
        expect((document.getElementById('adv_m_position') as HTMLInputElement).value).toBe('Toit');
        expect((document.getElementById('adv_m_nature') as HTMLInputElement).value).toBe('');
    });

    it('affiche encore les renseignements saisis dans une AUTRE situation', () => {
        // Fiche saisie en Recherche (signalement), relue en Tuerie planifiée.
        localStorage.setItem(PCTAC_MODE_KEY, 'tp');
        const rows = visibleModeFieldsFor(
            { position: 'Hall', signalement: '1m85, blouson rouge' },
            'adv',
        );
        const labels = rows.map((r) => r.label);
        expect(labels).toContain('Position');
        // Le champ d'une autre situation reste visible, avec son origine nommée.
        expect(labels.some((l) => l.startsWith('Physique ('))).toBe(true);
        expect(rows.find((r) => r.label.startsWith('Physique'))?.value).toBe('1m85, blouson rouge');
    });

    it('ignore les champs vides', () => {
        localStorage.setItem(PCTAC_MODE_KEY, 'tp');
        expect(visibleModeFieldsFor({ position: '   ', nature: '' }, 'adv')).toEqual([]);
    });
});

describe('pastilles Pax par situation', () => {
    /** Reproduit le gabarit des pastilles (index.html) pour un conteneur donné. */
    function buildPaxContainer(): void {
        document.body.innerHTML = `
            <div class="pax-select" id="pax_select_container" role="radiogroup" aria-label="Pax">
                <button type="button" role="radio" aria-checked="true" class="pax-select-option" data-pax="Adversaire">Adversaire</button>
                <button type="button" role="radio" aria-checked="false" class="pax-select-option" data-pax="Otage">Otage</button>
                <button type="button" role="radio" aria-checked="false" class="pax-select-option" data-pax="Inter" data-lex="chip.Inter">Inter</button>
                <button type="button" role="radio" aria-checked="false" class="pax-select-option" data-pax="Oscar" data-lex="chip.Oscar">Oscar</button>
                <button type="button" id="openCreatePaxBtn" class="pax-select-option pax-select-option--add" aria-label="Créer un nouvel intervenant">+</button>
            </div>`;
    }

    it('affiche « Recherches » et « PC » en Recherche de personnes, clés inchangées', () => {
        localStorage.setItem(PCTAC_MODE_KEY, 'recherche');
        buildPaxContainer();
        applyLexicon();
        const byPax = (k: string): HTMLButtonElement =>
            document.querySelector<HTMLButtonElement>(`.pax-select-option[data-pax="${k}"]`)!;
        expect(byPax('Inter').textContent).toBe('Recherches');
        expect(byPax('Oscar').textContent).toBe('PC');
        // Les clés stockées restent les valeurs historiques.
        expect(byPax('Inter').dataset.pax).toBe('Inter');
        expect(byPax('Oscar').dataset.pax).toBe('Oscar');
    });

    it('donne 4, 5, 4, 5 pastilles selon la situation', () => {
        // Ordre de PCTAC_MODE_ORDER : forcene, tp, recherche, evenement.
        expect(PCTAC_MODE_ORDER.map((id) => paxChipKeys(PCTAC_MODES[id]).length)).toEqual([4, 5, 4, 5]);
        expect(paxChipKeys(PCTAC_MODES.tp)).toContain('IS');
        expect(paxChipKeys(PCTAC_MODES.evenement)).toContain('Secours');
        expect(paxChipKeys(PCTAC_MODES.forcene)).toEqual(['Adversaire', 'Otage', 'Inter', 'Oscar']);
    });

    it('insère la cinquième pastille AVANT le bouton de création, absente en Forcené', () => {
        localStorage.setItem(PCTAC_MODE_KEY, 'tp');
        buildPaxContainer();
        syncSituationPaxChip();
        const options = Array.from(document.querySelectorAll<HTMLButtonElement>('#pax_select_container [role="radio"]'));
        expect(options).toHaveLength(5);
        expect(options.at(-1)?.dataset.pax).toBe('IS');
        // Placée immédiatement avant le bouton d'ajout.
        const add = document.getElementById('openCreatePaxBtn');
        expect(options.at(-1)?.nextElementSibling).toBe(add);

        // Forcené : quatre pastilles, aucune cinquième.
        localStorage.setItem(PCTAC_MODE_KEY, 'forcene');
        buildPaxContainer();
        syncSituationPaxChip();
        expect(document.querySelectorAll('#pax_select_container [role="radio"]')).toHaveLength(4);
    });

    it('cinquième pastille : neutre tant qu’elle n’est pas choisie, comme les quatre autres', () => {
        localStorage.setItem(PCTAC_MODE_KEY, 'tp');
        buildPaxContainer();
        syncSituationPaxChip();
        const chip = document.querySelector<HTMLButtonElement>('.pax-select-option[data-pax="IS"]')!;
        // Aucune peinture inline : un style inline battrait l'état neutre du CSS.
        expect(chip.style.background).toBe('');
        expect(chip.style.color).toBe('');
        // La couleur n'est qu'une variable, consommée par `.selected`.
        expect(chip.style.getPropertyValue('--pax-chip-bg')).toBe('#8b5cf6');
        expect(chip.style.getPropertyValue('--pax-chip-fg')).toBe('#ffffff');
    });

    it('déclare les couleurs PDF des cinquièmes pastilles', () => {
        expect(PDF_PAX_COLORS.IS).toEqual({ text: 'IS', color: '#8b5cf6', fontColor: '#ffffff' });
        expect(PDF_PAX_COLORS.Secours).toEqual({ text: 'Secours', color: '#f97316', fontColor: '#000000' });
    });
});
