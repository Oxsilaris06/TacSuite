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
} from '@pctac/modes.js';
import {
    applyLexicon,
    collectModeFields,
    renderModeBlocks,
    visibleModeFieldsFor,
} from '@pctac/mode-ui.js';

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
