/**
 * oi-articulation.test.ts — Tests unitaires de `articulation.ts` (P3.CONV,
 * paquet `oi-articulation`, port de `modules/articulation.js`, 1011 LOC).
 *
 * `Store` RÉEL (pas de double) : importé depuis `@oi/init.js`, même précédent
 * que `oi-navigation.test.ts` / `oi-carto-state.test.ts` — `Store.state.formData`
 * est réinitialisé avant chaque test ; `Store.subscribe` (articulation.js:756)
 * étant câblé au chargement du module, la réactivité est exercée EN VRAI (pas
 * mockée) par les mutations directes de `Store.state.formData.*`.
 *
 * Tests obligatoires (PAQUETS-OI.json id="oi-articulation") :
 *  (a) cycle PATRACDVR → refreshArticulationFromPatracdvr fait apparaître les
 *      membres/véhicules dans les bons conteneurs. NB : l'énoncé du paquet cite
 *      littéralement « poser un membre cellule India ... vérifier son apparition
 *      dans rame_vl_container » — `rame_vl_container` ne contient QUE des
 *      véhicules (articulation.js:385-434, dataset.vehicleName), jamais des
 *      membres ; un membre India apparaît dans colonne_progression_container /
 *      ordre_penetration_container (articulation.js:493-563,
 *      `_getIndiaMembersOrdered`). Le test ci-dessous vérifie les DEUX
 *      apparitions (véhicule → rame_vl_container, membre India →
 *      colonne/pénétration) pour couvrir la lettre ET l'esprit de l'énoncé —
 *      écart documenté dans le compte-rendu du paquet.
 *  (b) NON-DESTRUCTION : un bloc MOICP créé manuellement et édité (titre)
 *      survit à un refresh ultérieur (hash JSON avant/après).
 *  (c) addEffraction(data) en restauration NE déclenche PAS l'auto-peuplement.
 *  (d) chaque nom de OiArticulationGlobals est posé sur window avec la BONNE
 *      référence de fonction (piège addEffractionHypothesis, SPEC §11.3).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Store } from '@oi/init.js';
import type { OiPatracMember } from '@shared/types/contracts.js';

import {
    addEffraction,
    addEffractionHypothesis,
    addMoicp,
    addZmspcp,
    openEffractionToolsModal,
    refreshArticulationFromPatracdvr,
    refreshColonneProgression,
    refreshOrdrePenetration,
    refreshRameVL,
    saveEffractionTools,
} from '@oi/articulation.js';

// ---------------------------------------------------------------------------
// Fixtures DOM / Store
// ---------------------------------------------------------------------------

/** Récupère un élément requis dans le test (jamais `!`, échec explicite sinon). */
function byId<T extends HTMLElement>(id: string): T {
    const el = document.getElementById(id);
    if (!el) throw new Error(`#${id} introuvable dans le test`);
    return el as T;
}

function query<T extends HTMLElement>(selector: string, root: ParentNode = document): T {
    const el = root.querySelector<T>(selector);
    if (!el) throw new Error(`sélecteur introuvable dans le test: ${selector}`);
    return el;
}

function queryAll<T extends HTMLElement>(selector: string, root: ParentNode = document): T[] {
    return Array.from(root.querySelectorAll<T>(selector));
}

/** Pose les conteneurs statiques présents dans `oi/index.html` (jamais absents en pratique). */
function setupStaticContainers(): void {
    document.body.innerHTML = `
        <div id="moicp_container"></div>
        <div id="zmspcp_container"></div>
        <div id="effraction_container"></div>
        <div id="rame_vl_container"></div>
        <div id="colonne_progression_container"></div>
        <div id="ordre_penetration_container"></div>
        <div id="patracdvr_container"></div>
        <dialog id="effractionToolsModal">
            <button type="button" class="effrac-tool-btn" data-tool="pied_de_biche"></button>
            <button type="button" class="effrac-tool-btn" data-tool="belier"></button>
            <input type="text" id="effrac_other_tools" />
        </dialog>
    `;
    // jsdom n'implémente pas HTMLDialogElement.showModal/close (précédent
    // oi-presentation.test.ts) : stubs neutres.
    const modal = byId<HTMLDialogElement>('effractionToolsModal');
    modal.showModal = vi.fn();
    modal.close = vi.fn();
}

/** Bouton `.patracdvr-member-btn` (lu directement par _getIndiaMembersOrdered / _addArticulationMemberChip). */
function addMemberButton(trigramme: string, cellule: string, fonction: string): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.className = 'patracdvr-member-btn';
    btn.dataset.trigramme = trigramme;
    btn.dataset.cellule = cellule;
    btn.dataset.fonction = fonction;
    document.body.appendChild(btn);
    return btn;
}

/** Ligne `.patracdvr-vehicle-row` (lue directement par refreshRameVL). */
function addVehicleRow(vehicleName: string): HTMLElement {
    const row = document.createElement('div');
    row.className = 'patracdvr-vehicle-row';
    row.dataset.vehicleName = vehicleName;
    byId<HTMLElement>('patracdvr_container').appendChild(row);
    return row;
}

/** Membre PATRACDVR complet (Store.state.formData.patracdvr_rows/_unassigned). */
function makeMember(trigramme: string, cellule: string, fonction = 'Sans'): OiPatracMember {
    return {
        trigramme,
        fonction,
        cellule,
        principales: 'Sans',
        secondaires: 'Sans',
        afis: 'Sans',
        grenades: 'Sans',
        equipement: 'Sans',
        equipement2: 'Sans',
        tenue: 'Sans',
        gpb: 'Sans',
        dir: '',
    };
}

beforeEach(() => {
    setupStaticContainers();
    Store.state.formData = {};
    window.isFormLoading = false;
    // formulaires.ts (oi-formulaires, vague V5) n'est pas chargé dans ce test
    // unitaire : stub neutre, requis car addMoicp/addZmspcp/addEffraction/
    // addEffractionHypothesis/saveEffractionTools l'appellent SANS garde
    // `typeof` (RÈGLE D'OR §2.2 : même absence de garde que l'original).
    window.syncDomToStore = vi.fn();
});

afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// (a) cycle PATRACDVR → refreshArticulationFromPatracdvr
// ---------------------------------------------------------------------------

describe('(a) refreshArticulationFromPatracdvr — cycle PATRACDVR', () => {
    it('fait apparaître un véhicule dans rame_vl_container et un membre India dans colonne/pénétration', () => {
        addVehicleRow('VL-1');
        addMemberButton('ABC', 'India 1', 'Inter');
        Store.state.formData.patracdvr_rows = [
            { vehicle: 'VL-1', members: [makeMember('ABC', 'India 1', 'Inter')] },
        ];

        refreshArticulationFromPatracdvr();

        const rameChip = query<HTMLElement>('#rame_vl_container .rame-vl-chip');
        expect(rameChip.dataset.vehicleName).toBe('VL-1');

        const colonneChip = query<HTMLElement>('#colonne_progression_container .order-chip');
        expect(colonneChip.dataset.trigramme).toBe('ABC');

        const penetrationChip = query<HTMLElement>('#ordre_penetration_container .order-chip');
        expect(penetrationChip.dataset.trigramme).toBe('ABC');
    });

    it('ne fait rien si window.isFormLoading est vrai (garde articulation.js:732)', () => {
        window.isFormLoading = true;
        addVehicleRow('VL-BLOCKED');
        Store.state.formData.patracdvr_rows = [{ vehicle: 'VL-BLOCKED', members: [] }];

        refreshArticulationFromPatracdvr();

        expect(document.querySelector('#rame_vl_container .rame-vl-chip')).toBeNull();
    });

    it('réactivité (articulation.js:754-770) : muter patracdvr_rows déclenche automatiquement le refresh, sans appel manuel', () => {
        addVehicleRow('VL-REACT');

        Store.state.formData.patracdvr_rows = [{ vehicle: 'VL-REACT', members: [] }];

        const chip = query<HTMLElement>('#rame_vl_container .rame-vl-chip');
        expect(chip.dataset.vehicleName).toBe('VL-REACT');
    });

    it("réactivité : n'agit pas si window.isFormLoading est vrai au moment de la mutation", () => {
        window.isFormLoading = true;
        addVehicleRow('VL-REACT-BLOCKED');

        Store.state.formData.patracdvr_rows = [{ vehicle: 'VL-REACT-BLOCKED', members: [] }];

        expect(document.querySelector('#rame_vl_container .rame-vl-chip')).toBeNull();
    });
});

// ---------------------------------------------------------------------------
// (b) NON-DESTRUCTION
// ---------------------------------------------------------------------------

describe('(b) non-destruction — refreshArticulationFromPatracdvr est incrémental', () => {
    it('un bloc MOICP créé manuellement et édité (titre) survit à un refresh ultérieur (hash JSON avant/après)', () => {
        addMemberButton('ABC', 'India 1', 'Inter');
        Store.state.formData.patracdvr_rows = [
            { vehicle: 'VL-1', members: [makeMember('ABC', 'India 1', 'Inter')] },
        ];

        addMoicp(); // création manuelle → auto-peuplement depuis India (ABC)

        const block = query<HTMLElement>('.moicp-block');
        const titleInput = query<HTMLInputElement>('.block-title-input', block);
        titleInput.value = 'MOICP édité par le test';

        const zone = query<HTMLElement>('.moicp-members', block);
        const snapshot = () => ({
            title: titleInput.value,
            members: queryAll<HTMLElement>('.articulation-member', zone).map(c => c.dataset.trigramme),
        });

        const before = JSON.stringify(snapshot());

        refreshArticulationFromPatracdvr();

        const after = JSON.stringify(snapshot());

        expect(after).toBe(before);
        expect(snapshot().members).toEqual(['ABC']);
    });

    it('ajoute les nouveaux membres India valides sans supprimer les existants (synchronisation incrémentale)', () => {
        addMemberButton('ABC', 'India 1', 'Inter');
        Store.state.formData.patracdvr_rows = [
            { vehicle: 'VL-1', members: [makeMember('ABC', 'India 1', 'Inter')] },
        ];

        addMoicp();
        const zone = query<HTMLElement>('.moicp-members');
        expect(queryAll('.articulation-member', zone).map(c => (c as HTMLElement).dataset.trigramme)).toEqual(['ABC']);

        // Un second membre India rejoint le PATRACDVR.
        addMemberButton('DEF', 'India 2', 'Inter');
        Store.state.formData.patracdvr_rows = [
            {
                vehicle: 'VL-1',
                members: [makeMember('ABC', 'India 1', 'Inter'), makeMember('DEF', 'India 2', 'Inter')],
            },
        ];

        refreshArticulationFromPatracdvr();

        const trigrammes = queryAll<HTMLElement>('.articulation-member', zone).map(c => c.dataset.trigramme);
        expect(trigrammes).toContain('ABC');
        expect(trigrammes).toContain('DEF');
    });

    it('retire un chip devenu invalide (membre reclassé hors India) sans toucher les autres', () => {
        addMemberButton('ABC', 'India 1', 'Inter');
        addMemberButton('DEF', 'India 2', 'Inter');
        Store.state.formData.patracdvr_rows = [
            {
                vehicle: 'VL-1',
                members: [makeMember('ABC', 'India 1', 'Inter'), makeMember('DEF', 'India 2', 'Inter')],
            },
        ];

        addMoicp();
        const zone = query<HTMLElement>('.moicp-members');
        expect(queryAll('.articulation-member', zone)).toHaveLength(2);

        // DEF quitte la cellule India (reclassé "Sans") : devient invalide pour 'moicp'.
        Store.state.formData.patracdvr_rows = [
            {
                vehicle: 'VL-1',
                members: [makeMember('ABC', 'India 1', 'Inter'), makeMember('DEF', 'Sans', 'Inter')],
            },
        ];
        refreshArticulationFromPatracdvr();

        const trigrammes = queryAll<HTMLElement>('.articulation-member', zone).map(c => c.dataset.trigramme);
        expect(trigrammes).toEqual(['ABC']);
    });
});

// ---------------------------------------------------------------------------
// (c) restauration : PAS d'auto-peuplement
// ---------------------------------------------------------------------------

describe("(c) mode restauration — n'auto-peuple JAMAIS", () => {
    it('addEffraction(data) ignore le PATRACDVR et respecte EXACTEMENT data.members', () => {
        // ZZZ serait auto-peuplé en création MANUELLE (cellule effrac) — ne doit
        // PAS apparaître en mode restauration.
        addMemberButton('ZZZ', 'Effrac', 'Effrac');
        Store.state.formData.patracdvr_rows = [
            { vehicle: 'VL-1', members: [makeMember('ZZZ', 'Effrac', 'Effrac')] },
        ];

        addEffraction({ id: 'effrac_restore', members: ['ONLYTHIS'] });

        const zone = query<HTMLElement>('.effraction-members');
        const trigrammes = queryAll<HTMLElement>('.articulation-member', zone).map(c => c.dataset.trigramme);
        expect(trigrammes).toEqual(['ONLYTHIS']);
    });

    it('addEffraction({ members: [] }) respecte une liste vide (bloc volontairement vidé, pas de re-peuplement)', () => {
        addMemberButton('ZZZ', 'Effrac', 'Effrac');
        Store.state.formData.patracdvr_rows = [
            { vehicle: 'VL-1', members: [makeMember('ZZZ', 'Effrac', 'Effrac')] },
        ];

        addEffraction({ id: 'effrac_empty', members: [] });

        const zone = query<HTMLElement>('.effraction-members');
        expect(queryAll('.articulation-member', zone)).toHaveLength(0);
    });

    it('addMoicp(data) restaure exactement les membres fournis, sans auto-peuplement India', () => {
        addMemberButton('IND1', 'India 1', 'Inter');
        Store.state.formData.patracdvr_rows = [
            { vehicle: 'VL-1', members: [makeMember('IND1', 'India 1', 'Inter')] },
        ];

        addMoicp({ id: 'moicp_restore', members: ['RESTORED'] });

        const zone = query<HTMLElement>('.moicp-members');
        const trigrammes = queryAll<HTMLElement>('.articulation-member', zone).map(c => c.dataset.trigramme);
        expect(trigrammes).toEqual(['RESTORED']);
    });

    it('addZmspcp(data) restaure exactement les membres fournis, sans auto-peuplement AO', () => {
        addMemberButton('AO1', 'AO1', 'Inter');
        Store.state.formData.patracdvr_rows = [{ vehicle: 'VL-1', members: [makeMember('AO1', 'AO1', 'Inter')] }];

        addZmspcp({ id: 'zmspcp_restore', members: ['RESTOREDZ'] });

        const zone = query<HTMLElement>('.zmspcp-members');
        const trigrammes = queryAll<HTMLElement>('.articulation-member', zone).map(c => c.dataset.trigramme);
        expect(trigrammes).toEqual(['RESTOREDZ']);
    });
});

// ---------------------------------------------------------------------------
// Auto-peuplement en création MANUELLE (contrepartie positive de (c))
// ---------------------------------------------------------------------------

describe('auto-peuplement — création manuelle uniquement', () => {
    it('addMoicp() sans data auto-peuple depuis les membres India, triés par cellule', () => {
        addMemberButton('B2', 'India 2', 'Inter');
        addMemberButton('A1', 'India 1', 'Inter');
        addMemberButton('X', 'AO1', 'Inter'); // pas India : ne doit pas apparaître
        Store.state.formData.patracdvr_rows = [
            {
                vehicle: 'VL-1',
                members: [makeMember('B2', 'India 2', 'Inter'), makeMember('A1', 'India 1', 'Inter'), makeMember('X', 'AO1', 'Inter')],
            },
        ];

        addMoicp();

        const zone = query<HTMLElement>('.moicp-members');
        const trigrammes = queryAll<HTMLElement>('.articulation-member', zone).map(c => c.dataset.trigramme);
        expect(trigrammes).toEqual(['A1', 'B2']); // triées par cellule (India 1 < India 2)
    });

    it('addZmspcp() sans data auto-peuple depuis les membres AO', () => {
        addMemberButton('AO1M', 'AO1', 'Inter');
        Store.state.formData.patracdvr_rows = [{ vehicle: 'VL-1', members: [makeMember('AO1M', 'AO1', 'Inter')] }];

        addZmspcp();

        const zone = query<HTMLElement>('.zmspcp-members');
        expect(queryAll<HTMLElement>('.articulation-member', zone).map(c => c.dataset.trigramme)).toEqual(['AO1M']);
    });

    it("addEffraction() sans data auto-peuple depuis cellule OU fonction contenant 'effrac' (cellule 'sans' exclue dans les deux cas, articulation.js:269 verbatim)", () => {
        addMemberButton('EFF1', 'Effrac', 'Sans');
        // articulation.js:269 — `(cellule.includes('effrac') || fonction.includes('effrac'))
        // && cellule !== 'sans'` : le ET final exclut aussi la branche "fonction" quand la
        // cellule est 'Sans' — EFF2 doit donc être dans UNE cellule non-'sans' pour matcher
        // via sa fonction (comportement VERBATIM de l'original, pas un choix du port).
        addMemberButton('EFF2', 'AO1', 'Effrac');
        Store.state.formData.patracdvr_rows = [
            { vehicle: 'VL-1', members: [makeMember('EFF1', 'Effrac', 'Sans'), makeMember('EFF2', 'AO1', 'Effrac')] },
        ];

        addEffraction();

        const zone = query<HTMLElement>('.effraction-members');
        const trigrammes = queryAll<HTMLElement>('.articulation-member', zone).map(c => c.dataset.trigramme);
        expect(trigrammes).toContain('EFF1');
        expect(trigrammes).toContain('EFF2');
    });

    it("prend aussi en compte patracdvr_unassigned pour l'auto-peuplement", () => {
        addMemberButton('UNAS', 'India 3', 'Inter');
        Store.state.formData.patracdvr_rows = [];
        Store.state.formData.patracdvr_unassigned = [makeMember('UNAS', 'India 3', 'Inter')];

        addMoicp();

        const zone = query<HTMLElement>('.moicp-members');
        expect(queryAll<HTMLElement>('.articulation-member', zone).map(c => c.dataset.trigramme)).toEqual(['UNAS']);
    });
});

// ---------------------------------------------------------------------------
// refreshRameVL / refreshColonneProgression / refreshOrdrePenetration
// ---------------------------------------------------------------------------

describe('refreshRameVL', () => {
    it('préserve un ordre sauvegardé et ajoute les nouveaux véhicules à la suite', () => {
        addVehicleRow('VL-A');
        addVehicleRow('VL-B');
        addVehicleRow('VL-C');

        refreshRameVL(['VL-C', 'VL-A']); // VL-B est nouveau, absent de la sauvegarde

        const names = queryAll<HTMLElement>('#rame_vl_container .rame-vl-chip').map(c => c.dataset.vehicleName);
        expect(names).toEqual(['VL-C', 'VL-A', 'VL-B']);
    });

    it("affiche un message si aucun véhicule n'est présent", () => {
        refreshRameVL();
        expect(byId('rame_vl_container').textContent).toContain('Aucun VL dans le PATRACDVR.');
    });
});

describe('refreshColonneProgression / refreshOrdrePenetration', () => {
    it("refreshOrdrePenetration reprend par défaut l'ordre de la colonne quand aucun ordre n'est sauvegardé", () => {
        addMemberButton('P1', 'India 1', 'Inter');
        addMemberButton('P2', 'India 2', 'Inter');
        Store.state.formData.patracdvr_rows = [
            { vehicle: 'VL-1', members: [makeMember('P1', 'India 1', 'Inter'), makeMember('P2', 'India 2', 'Inter')] },
        ];

        refreshColonneProgression(['P2', 'P1']); // ordre custom de la colonne
        refreshOrdrePenetration(); // pas de savedOrder → reprend l'ordre colonne affiché

        const penetration = queryAll<HTMLElement>('#ordre_penetration_container .order-chip').map(c => c.dataset.trigramme);
        expect(penetration).toEqual(['P2', 'P1']);
    });
});

// ---------------------------------------------------------------------------
// Modale « outils d'effraction »
// ---------------------------------------------------------------------------

describe('openEffractionToolsModal / saveEffractionTools', () => {
    it('ouvre la modale, pré-coche les outils déjà sélectionnés et les sauvegarde', () => {
        const img = document.createElement('img');
        img.id = 'photo_effrac_1';
        img.dataset.tools = JSON.stringify(['pied_de_biche']);
        document.body.appendChild(img);

        openEffractionToolsModal('photo_effrac_1');

        const modal = byId<HTMLDialogElement>('effractionToolsModal');
        expect(modal.showModal).toHaveBeenCalled();
        const piedDeBiche = query<HTMLElement>('.effrac-tool-btn[data-tool="pied_de_biche"]', modal);
        expect(piedDeBiche.classList.contains('active')).toBe(true);
        const belier = query<HTMLElement>('.effrac-tool-btn[data-tool="belier"]', modal);
        expect(belier.classList.contains('active')).toBe(false);

        // L'utilisateur active "belier" en plus.
        belier.classList.add('active');
        saveEffractionTools();

        expect(modal.close).toHaveBeenCalled();
        const savedTools = JSON.parse(img.dataset.tools ?? '[]') as string[];
        expect(savedTools).toContain('pied_de_biche');
        expect(savedTools).toContain('belier');
        expect(window.syncDomToStore).toHaveBeenCalled();
    });
});

// ---------------------------------------------------------------------------
// (d) contrat OiArticulationGlobals
// ---------------------------------------------------------------------------

describe('(d) contrat OiArticulationGlobals — pose sur window', () => {
    it('pose les 10 globaux sur window avec la RÉFÉRENCE de fonction exportée', () => {
        expect(window.addMoicp).toBe(addMoicp);
        expect(window.addZmspcp).toBe(addZmspcp);
        expect(window.addEffraction).toBe(addEffraction);
        expect(window.addEffractionHypothesis).toBe(addEffractionHypothesis);
        expect(window.openEffractionToolsModal).toBe(openEffractionToolsModal);
        expect(window.saveEffractionTools).toBe(saveEffractionTools);
        expect(window.refreshArticulationFromPatracdvr).toBe(refreshArticulationFromPatracdvr);
        expect(window.refreshRameVL).toBe(refreshRameVL);
        expect(window.refreshColonneProgression).toBe(refreshColonneProgression);
        expect(window.refreshOrdrePenetration).toBe(refreshOrdrePenetration);
    });

    it(
        'addEffractionHypothesis : UNE SEULE définition réelle (piège §11.3) — ' +
            'window.addEffractionHypothesis et addEffractionHypothesis() produisent le même effet',
        () => {
            addEffraction({ id: 'effrac_hyp_test', members: [] });

            window.addEffractionHypothesis('effrac_hyp_test', { title: 'Hyp via window' });

            const list = byId<HTMLElement>('effrac_hyp_list_effrac_hyp_test');
            expect(queryAll('.effrac-hypothesis-item', list)).toHaveLength(1);
            expect(query<HTMLInputElement>('.effrac-hyp-title', list).value).toBe('Hyp via window');

            addEffractionHypothesis('effrac_hyp_test', { title: 'Hyp via import direct' });
            expect(queryAll('.effrac-hypothesis-item', list)).toHaveLength(2);
        },
    );

    it("addEffraction() appelle addEffractionHypothesis pour chaque hypothèse restaurée (bouton onclick verbatim)", () => {
        addEffraction({
            id: 'effrac_with_hyp',
            members: [],
            hypotheses: [
                { id: 'h1', title: 'Hyp 1', desc: '', effrac: '', degag: '', assaut: '' },
                { id: 'h2', title: 'Hyp 2', desc: '', effrac: '', degag: '', assaut: '' },
            ],
        });

        const list = byId<HTMLElement>('effrac_hyp_list_effrac_with_hyp');
        expect(queryAll('.effrac-hypothesis-item', list)).toHaveLength(2);
    });
});
