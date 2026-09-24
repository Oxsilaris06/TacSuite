/**
 * fiche.test.ts — Modèle des fiches adverse et protégée (décisions 16 à 20).
 *
 * QQOCQPC et PNAVSA ne sont plus des blocs : chaque question trouve sa réponse
 * dans une section nommée par son contenu. Ces tests fixent ce que l'écran et
 * le PDF liront : sections et ordre par situation, libellés adaptés, pastilles
 * stockées dans la clé historique, statuts par situation, compteurs.
 */
import { describe, expect, it } from 'vitest';
import {
    ageFromDob,
    defaultStatus,
    ficheCounters,
    ficheSections,
    ficheTitle,
    ficheVariant,
    filledSections,
    parseChips,
    serializeChips,
    statusChoices,
    statusMeta,
    summaryRows,
    toggleChip,
    type FicheField,
} from '@pctac/fiche.js';

const ids = (side: 'adv' | 'host', mode: Parameters<typeof ficheSections>[1], item: Record<string, unknown> = {}) =>
    ficheSections(side, mode, item).map((s) => s.id);
const field = (side: 'adv' | 'host', mode: Parameters<typeof ficheSections>[1], key: string, item: Record<string, unknown> = {}): FicheField | undefined =>
    ficheSections(side, mode, item).flatMap((s) => s.fields).find((f) => f.key === key);
const keys = (side: 'adv' | 'host', mode: Parameters<typeof ficheSections>[1], item: Record<string, unknown> = {}) =>
    ficheSections(side, mode, item).flatMap((s) => s.fields.map((f) => f.key));

describe('pastilles : stockées dans la clé historique, précision comprise', () => {
    const chips = ['Arme de poing', 'Arme longue', 'Aucune connue'];

    it('relit un ancien texte libre : le mot connu allume sa pastille, le reste devient la précision', () => {
        expect(parseChips('Calme, nerveux...', ['Calme', 'Agité'])).toEqual({ selected: ['Calme'], precision: 'nerveux...' });
        expect(parseChips('', chips)).toEqual({ selected: [], precision: '' });
        // Casse indifférente, ordre de la liste des pastilles.
        expect(parseChips('arme longue, ARME DE POING', chips).selected).toEqual(['Arme de poing', 'Arme longue']);
    });

    it('une virgule dans la précision survit à l’aller-retour', () => {
        const stored = serializeChips(['Arme longue'], 'fusil cal. 12, 2 cartouches', chips);
        expect(stored).toBe('Arme longue, fusil cal. 12, 2 cartouches');
        expect(parseChips(stored, chips)).toEqual({ selected: ['Arme longue'], precision: 'fusil cal. 12, 2 cartouches' });
        expect(serializeChips([], '  ', chips)).toBe('');
    });

    it('« Aucune connue » exclut les autres, et inversement ; choix unique remplace', () => {
        const armes = field('adv', 'forcene', 'armes')!;
        expect(toggleChip(['Arme longue'], 'Aucune connue', armes)).toEqual(['Aucune connue']);
        expect(toggleChip(['Aucune connue'], 'Arme longue', armes)).toEqual(['Arme longue']);
        expect(toggleChip(['Arme longue'], 'Arme longue', armes)).toEqual([]);
        const mouvement = field('adv', 'forcene', 'mouvement')!;
        expect(toggleChip(['Retranché'], 'En fuite', mouvement)).toEqual(['En fuite']);
    });
});

describe('fiche adverse : sections, ordre et libellés par situation', () => {
    it('ordre selon la situation, la plus vitale d’abord', () => {
        expect(ids('adv', 'forcene')).toEqual(['identite', 'position', 'armement', 'comportement', 'signalement', 'faits']);
        expect(ids('adv', 'tp')).toEqual(['position', 'armement', 'signalement', 'identite', 'comportement', 'faits']);
        expect(ids('adv', 'recherche')).toEqual(['identite', 'signalement', 'position', 'sante', 'comportement', 'armement', 'faits']);
        expect(ids('adv', 'evenement')).toEqual(['position', 'armement', 'identite', 'signalement', 'comportement', 'faits']);
    });

    it('QQOCQPC et PNAVSA fondus : aucune question posée, clés historiques gardées', () => {
        const all = keys('adv', 'tp');
        ['qui', 'ou', 'comment', 'combien'].forEach((k) => expect(all).not.toContain(k));
        ['nom', 'prenom', 'dob', 'lien', 'antecedents', 'attitude', 'substance', 'armes', 'position', 'nature', 'volume', 'quoi', 'quand', 'pourquoi']
            .forEach((k) => expect(all).toContain(k));
        const labels = ficheSections('adv', 'tp').flatMap((s) => s.fields.map((f) => f.label));
        ['Qui', 'Quoi', 'Où', 'Comment', 'Quand', 'Pourquoi', 'Combien'].forEach((q) => expect(labels).not.toContain(q));
    });

    it('Recherche : dernier lieu, dernière vue, téléphone, santé, requérant', () => {
        expect(field('adv', 'recherche', 'position')?.label).toBe('Dernier lieu connu');
        expect(field('adv', 'recherche', 'position_heure')?.label).toBe('Dernière vue certaine');
        expect(field('adv', 'recherche', 'telephone')?.kind).toBe('tel');
        expect(keys('adv', 'recherche')).toEqual(expect.arrayContaining(['sante', 'requerant']));
        // Ailleurs, ni téléphone ni santé.
        expect(keys('adv', 'forcene')).not.toContain('telephone');
        expect(keys('adv', 'tp')).not.toContain('sante');
    });

    it('Ampleur, Phénomène : désignation, épicentre, vecteur, risques évolutifs ; ni signalement ni comportement', () => {
        const item = { type_menace: 'Phénomène' };
        expect(ficheVariant('adv', 'evenement', item)).toBe('phenomene');
        expect(ficheVariant('adv', 'evenement', { type_menace: 'Groupe' })).toBe('evenement');
        expect(ficheVariant('adv', 'tp', item)).toBe('tp');
        expect(ids('adv', 'evenement', item)).toEqual(['position', 'armement', 'identite', 'faits']);
        expect(field('adv', 'evenement', 'nom', item)?.label).toBe('Désignation');
        expect(field('adv', 'evenement', 'position', item)?.label).toBe('Épicentre, emprise');
        expect(field('adv', 'evenement', 'armes', item)).toMatchObject({ label: 'Vecteur, agent', kind: 'long' });
        expect(keys('adv', 'evenement', item)).toContain('evolution');
        expect(keys('adv', 'evenement', item)).not.toContain('prenom');
        expect(keys('adv', 'evenement')).not.toContain('evolution');
    });
});

describe('fiche protégée : otage, victime, témoin', () => {
    it('ordre : Forcené identité d’abord, TP et Ampleur état d’abord', () => {
        expect(ids('host', 'forcene')).toEqual(['identite', 'etat', 'position', 'signalement']);
        expect(ids('host', 'tp')).toEqual(['etat', 'position', 'prise_en_charge', 'identite', 'signalement']);
        expect(ids('host', 'evenement')).toEqual(['etat', 'position', 'prise_en_charge', 'identite', 'signalement']);
    });

    it('Recherche : fiche témoin, sans état ni blessures ni vulnérabilité', () => {
        expect(ids('host', 'recherche')).toEqual(['identite', 'temoignage']);
        const k = keys('host', 'recherche');
        expect(k).toEqual(expect.arrayContaining(['telephone', 'temoignage', 'position', 'position_heure', 'fiabilite', 'lien']));
        ['etat', 'blessures', 'vulnerabilite'].forEach((x) => expect(k).not.toContain(x));
        expect(field('host', 'recherche', 'position')?.label).toBe('Lieu observé');
    });

    it('le lien protégé → adverse est un choix de fiche, libellé de la situation', () => {
        expect(field('host', 'forcene', 'lien')).toMatchObject({ kind: 'link', label: 'Lien adversaire' });
        expect(field('host', 'tp', 'lien')?.label).toBe('Lien ennemi');
    });
});

describe('statuts par situation', () => {
    it('adverse : vocabulaire de la situation, clés stables', () => {
        expect(statusChoices('adv', 'forcene').map((s) => s.label)).toEqual(['Actif', 'Neutralisé']);
        expect(statusChoices('adv', 'recherche').map((s) => [s.key, s.label])).toEqual([
            ['active', 'Recherchée'], ['located', 'Localisée'], ['neutralized', 'Retrouvée'],
        ]);
        expect(statusChoices('adv', 'evenement').map((s) => s.label)).toEqual(['Active', 'Contenue', 'Levée']);
    });

    it('TP et Ampleur : triage, « Non triée » par défaut ; Forcené : OK par défaut', () => {
        expect(statusChoices('host', 'tp').map((s) => s.key)).toEqual(['nt', 'eu', 'ua', 'ur', 'impl', 'dcd']);
        expect(defaultStatus('host', 'tp')).toBe('nt');
        expect(defaultStatus('host', 'evenement')).toBe('nt');
        expect(defaultStatus('host', 'forcene')).toBe('ok');
        expect(defaultStatus('adv', 'recherche')).toBe('active');
        expect(statusChoices('host', 'recherche')).toEqual([]);
    });

    it('une clé d’une autre situation reste lisible', () => {
        expect(statusMeta('host', 'tp', 'blesse').label).toBe('Blessé');
        expect(statusMeta('adv', 'forcene', 'located').label).toBe('Localisé');
        expect(statusMeta('host', 'forcene', 'inconnu').label).toBe('inconnu');
    });
});

describe('lecture : champs remplis, âge, résumé, compteurs', () => {
    const now = new Date(2026, 8, 24);

    it('âge calculé d’une date complète, jamais d’une estimation', () => {
        expect(ageFromDob('03/04/1981', now)).toBe(45);
        expect(ageFromDob('24/09/2000', now)).toBe(26);
        expect(ageFromDob('25/09/2000', now)).toBe(25);
        expect(ageFromDob('~40 ans', now)).toBeNull();
        expect(ageFromDob('31/02/1990', now)).toBeNull();
        expect(ageFromDob('01/01/2030', now)).toBeNull();
    });

    it('seuls les champs remplis et visibles dans la variante', () => {
        const item = { type_menace: 'Phénomène', nom: 'Fuite de chlore', signalement: 'reste d’une saisie précédente', evolution: 'Nuage vers le sud', dob: '' };
        const sections = filledSections('adv', 'evenement', item, now);
        const rows = sections.flatMap((s) => s.rows);
        expect(rows.map((r) => r.label)).toEqual(['Risques évolutifs', 'Désignation']);
        expect(sections.every((s) => s.rows.length > 0)).toBe(true);
        const dated = filledSections('adv', 'forcene', { dob: '03/04/1981' }, now).flatMap((s) => s.rows);
        expect(dated).toEqual([{ label: 'D.N. ou âge', value: '03/04/1981 (45 ans)' }]);
    });

    it('résumé : trois faits clés au plus, remplis seulement', () => {
        expect(summaryRows('adv', 'forcene', { position: 'Étage 2', armes: 'Arme longue', attitude: 'Agité', substance: 'Alcool' }).map((r) => r.value))
            .toEqual(['Étage 2', 'Arme longue', 'Agité']);
        expect(summaryRows('adv', 'forcene', { attitude: 'Calme' }).map((r) => r.label)).toEqual(['Attitude']);
        expect(summaryRows('host', 'recherche', { temoignage: 'Vu à la gare', fiabilite: 'Probable' }).map((r) => r.label))
            .toEqual(['Ce qu’il a vu', 'Fiabilité']);
    });

    it('titre : nom et prénom, désignation d’un phénomène, sinon « (sans nom) »', () => {
        expect(ficheTitle('adv', 'forcene', { nom: 'DUPONT', prenom: 'Jean' })).toBe('DUPONT Jean');
        expect(ficheTitle('adv', 'evenement', { type_menace: 'Phénomène', nom: 'Fuite de chlore', prenom: 'x' })).toBe('Fuite de chlore');
        expect(ficheTitle('host', 'tp', {})).toBe('(sans nom)');
    });

    it('compteurs calculés depuis les fiches, jamais saisis', () => {
        const c = ficheCounters('tp',
            [{ status: 'active' }, { status: 'active' }, { status: 'neutralized' }],
            [{ status: 'ua' }, { status: 'nt' }, { status: 'nt' }, {}]);
        expect(c.adv).toBe('Ennemis 3 · Actif 2 · Neutralisé 1');
        expect(c.host).toBe('Otages et victimes 4 · UA 1 · Non triée 3');
        expect(ficheCounters('forcene', [], []).adv).toBe('');
    });
});
