/**
 * fiche.test.ts — Modèle des fiches adverse et protégée (décisions 16 à 20).
 *
 * QQOCQPC et PNAVSA ne sont plus des blocs : chaque question trouve sa réponse
 * dans une section nommée par son contenu. Ces tests fixent ce que l'écran et
 * le PDF liront : sections et ordre par situation, libellés adaptés, pastilles
 * stockées dans la clé historique, statuts par situation, compteurs.
 */
import { describe, expect, it } from 'vitest';
import type { PctacCollectionItem } from '../../../src/shared/types/contracts.js';
import {
    ageFromDob,
    defaultStatus,
    ficheCounters,
    ficheSections,
    ficheTitle,
    ficheVariant,
    filledSections,
    findDuplicatePerson,
    mergeFicheFields,
    parseChips,
    serializeChips,
    sortFichesByPriority,
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
        // Casse indifférente.
        expect(parseChips('arme de poing, ARME LONGUE', chips).selected).toEqual(['Arme de poing', 'Arme longue']);
    });

    it('une virgule dans la précision survit à l’aller-retour', () => {
        const stored = serializeChips(['Arme longue'], 'fusil cal. 12, 2 cartouches', chips);
        expect(stored).toBe('Arme longue, fusil cal. 12, 2 cartouches');
        expect(parseChips(stored, chips)).toEqual({ selected: ['Arme longue'], precision: 'fusil cal. 12, 2 cartouches' });
        expect(serializeChips([], '  ', chips)).toBe('');
    });

    it('revue : une virgule décimale de la précision reste intacte', () => {
        expect(parseChips('Arme longue, Fusil 7,62 mm', chips)).toEqual({ selected: ['Arme longue'], precision: 'Fusil 7,62 mm' });
        // Import OI : texte libre avec virgule décimale, aucune pastille en tête.
        expect(parseChips('Pistolet 7,65', chips)).toEqual({ selected: [], precision: 'Pistolet 7,65' });
    });

    it('revue : une précision qui porte le nom d’une pastille n’est pas absorbée', () => {
        // « Aucune connue » est exclusive : après « Arme de poing », c'est du texte.
        expect(parseChips('Arme de poing, aucune connue', chips, { exclusive: ['Aucune connue'] }))
            .toEqual({ selected: ['Arme de poing'], precision: 'aucune connue' });
        // Ordre des pastilles : serializeChips les écrit dans l'ordre de la liste.
        expect(parseChips('Arme longue, Arme de poing', chips)).toEqual({ selected: ['Arme longue'], precision: 'Arme de poing' });
        // Choix unique : une seule pastille lue.
        expect(parseChips('Arme de poing, Arme longue', chips, { single: true })).toEqual({ selected: ['Arme de poing'], precision: 'Arme longue' });
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

describe('findDuplicatePerson — doublons nom+prénom ou nom+date (décision 32)', () => {
    const item = (o: Record<string, unknown>): PctacCollectionItem => ({ id: String(o.id ?? 'x'), ...o });

    it('nom ET prénom égaux, comparaison normalisée (casse, accents, espaces)', () => {
        const existing = item({ id: 'a', nom: 'DUPONT', prenom: '  Éléonore ' });
        expect(findDuplicatePerson([existing], item({ id: 'b', nom: 'dupont', prenom: 'eleonore' })))
            .toBe(existing);
    });

    it('nom ET date de naissance égaux (prénom vide)', () => {
        const existing = item({ id: 'a', nom: 'Hélène', dob: '01/01/1980' });
        expect(findDuplicatePerson([existing], item({ id: 'b', nom: 'Helene', dob: '01/01/1980' })))
            .toBe(existing);
    });

    it('un seul des deux identifiants ne suffit pas', () => {
        const existing = item({ id: 'a', nom: 'Dupont', prenom: 'Jean' });
        // Même nom, prénom vide des deux côtés, pas de date : pas un doublon.
        expect(findDuplicatePerson([existing], item({ id: 'b', nom: 'Dupont' }))).toBeNull();
        // Même prénom seul.
        expect(findDuplicatePerson([existing], item({ id: 'b', prenom: 'Jean' }))).toBeNull();
    });

    it("ne se signale jamais lui-même (même id)", () => {
        const existing = item({ id: 'a', nom: 'Dupont', prenom: 'Jean' });
        expect(findDuplicatePerson([existing], item({ id: 'a', nom: 'Dupont', prenom: 'Jean' }))).toBeNull();
    });

    it('une fiche « Phénomène » n’est jamais un doublon, ni comme candidat ni comme existant', () => {
        const phenomene = item({ id: 'p', type_menace: 'Phénomène', nom: 'Dupont', prenom: 'Jean' });
        // Le phénomène existant ne matche pas une personne homonyme…
        expect(findDuplicatePerson([phenomene], item({ id: 'b', nom: 'Dupont', prenom: 'Jean' }))).toBeNull();
        // …et un candidat phénomène ne matche pas une fiche.
        const personne = item({ id: 'c', nom: 'Dupont', prenom: 'Jean' });
        expect(findDuplicatePerson([personne], item({ id: 'd', type_menace: 'Phénomène', nom: 'Dupont', prenom: 'Jean' }))).toBeNull();
    });

    it('rend null sans doublon', () => {
        expect(findDuplicatePerson([], item({ id: 'b', nom: 'Dupont', prenom: 'Jean' }))).toBeNull();
        expect(findDuplicatePerson([item({ id: 'a', nom: 'Martin' })], item({ id: 'b', nom: 'Dupont', prenom: 'Jean' }))).toBeNull();
    });
});

describe('mergeFicheFields — complète les champs vides sans écraser (décision 32)', () => {
    const item = (o: Record<string, unknown>): PctacCollectionItem => ({ id: String(o.id ?? 'x'), ...o });

    it('complète les champs absents, vides ou tableaux vides, et liste les clés', () => {
        const existing = item({ id: 'a', nom: 'Dupont', prenom: '', telephone: undefined, tags: [], updatedAt: 't1' });
        const incoming = item({ id: 'b', nom: 'Autre', prenom: 'Jean', telephone: '06', tags: ['x'], status: 'active', updatedAt: 't2' });
        const { merged, filled } = mergeFicheFields(existing, incoming);

        expect(merged.nom).toBe('Dupont');
        expect(merged.prenom).toBe('Jean');
        expect(merged.telephone).toBe('06');
        expect(merged.tags).toEqual(['x']);
        expect(merged.status).toBe('active');
        // id et updatedAt d'`existing` sont gardés.
        expect(merged.id).toBe('a');
        expect(merged.updatedAt).toBe('t1');
        expect([...filled].sort()).toEqual(['prenom', 'status', 'tags', 'telephone']);
    });

    it('n’écrase jamais un champ rempli', () => {
        const existing = item({ id: 'a', nom: 'Dupont', prenom: 'Jean' });
        const incoming = item({ id: 'b', nom: 'Autre', prenom: 'Paul' });
        const { merged, filled } = mergeFicheFields(existing, incoming);
        expect(merged.nom).toBe('Dupont');
        expect(merged.prenom).toBe('Jean');
        expect(filled).toEqual([]);
    });

    it('ne mute ni l’existant ni l’entrant', () => {
        const existing = item({ id: 'a', prenom: '' });
        const incoming = item({ id: 'b', prenom: 'Jean' });
        mergeFicheFields(existing, incoming);
        expect(existing.prenom).toBe('');
        expect(incoming.prenom).toBe('Jean');
    });
});

describe('sortFichesByPriority — tri par priorité (décision 33)', () => {
    const f = (id: string, status?: string): PctacCollectionItem => ({ id, ...(status ? { status } : {}) });

    it('protégés triage : Non triée → EU → UA → UR → Impliqué → DCD', () => {
        const items = ['dcd', 'impl', 'ur', 'ua', 'eu', 'nt'].map((s, i) => f(`p${i}`, s));
        const ordered = sortFichesByPriority('host', 'tp', items).map((i) => i.status);
        expect(ordered).toEqual(['nt', 'eu', 'ua', 'ur', 'impl', 'dcd']);
    });

    it('protégés Forcené (hors triage) : Blessé → Préoccupant → OK → DCD', () => {
        const items = ['dcd', 'ok', 'preoccupant', 'blesse'].map((s, i) => f(`p${i}`, s));
        const ordered = sortFichesByPriority('host', 'forcene', items).map((i) => i.status);
        expect(ordered).toEqual(['blesse', 'preoccupant', 'ok', 'dcd']);
    });

    it('adversaires : actifs d\'abord, puis l\'ordre de statusChoices', () => {
        const items = ['neutralized', 'located', 'active'].map((s, i) => f(`a${i}`, s));
        const ordered = sortFichesByPriority('adv', 'recherche', items).map((i) => i.status);
        expect(ordered).toEqual(['active', 'located', 'neutralized']);
    });

    it('à priorité égale, l\'ordre de création est conservé (tri stable)', () => {
        const items = [f('c1', 'ok'), f('c2', 'ok'), f('c3', 'blesse')];
        expect(sortFichesByPriority('host', 'forcene', items).map((i) => i.id)).toEqual(['c3', 'c1', 'c2']);
    });

    it('Témoins (Recherche, sans statut) : ordre inchangé', () => {
        const items = [f('t1'), f('t2'), f('t3')];
        expect(sortFichesByPriority('host', 'recherche', items).map((i) => i.id)).toEqual(['t1', 't2', 't3']);
    });

    it('ne mute pas la liste d\'entrée', () => {
        const items = [f('a', 'dcd'), f('b', 'nt')];
        sortFichesByPriority('host', 'tp', items);
        expect(items.map((i) => i.id)).toEqual(['a', 'b']);
    });
});

describe('DCD en noir (décision 33)', () => {
    it('le statut DCD est noir, les autres gardent leur couleur', () => {
        expect(statusMeta('host', 'tp', 'dcd').color).toBe('#000000');
        expect(statusMeta('host', 'tp', 'eu').color).not.toBe('#000000');
    });
});
