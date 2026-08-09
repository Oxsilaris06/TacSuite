/**
 * patrac.ts — Tableau de répartition du personnel et des véhicules (PATRACDVR)
 * (P3.CONV, paquet `oi-patrac`, CRITIQUE).
 * ===========================================================================
 *
 * Port TypeScript VERBATIM, fonction par fonction dans l'ordre du fichier, de
 * `modules/patrac.js` (GStart-main, lecture seule, 1201 LOC intégral) :
 * `getUnassignedContainer`/`getPatracdvrContainer` (:11-12), `renameVehicle`
 * (:19), `addPatracdvrRow` (:33), `addManualVehicle` (:86), `addManualMember`
 * (:96), `addCellBatch` (:138), `addPatracdvrMember` (:195),
 * `handleMemberContextMenu` (:236), `cloneMemberFromContext` (:257),
 * `deleteMemberFromContext` (:276), `updateMemberButtonVisuals` (:293),
 * `updateArticulationDisplay` (:324), `initializePatracdvr` (:332),
 * `resetPatracdvrUI` (:341), `loadConfigObject` (:354), `setupQuickEditPanel`
 * (:386), `_qeRowValueText` (:439), `repaintRowValue` (:453), `flashAutoSave`
 * (:464), `handleMemberSelection` (:472), bloc PROPOSITION 4 batch (:517-689),
 * `populateQuickEditPanel` (:691), `openQuickEditModal` (:723),
 * `saveQuickEditModalChanges` (:836), `closeQuickEditModal` (:851),
 * `saveQuickEditChanges` (:862), `initPatracQuickEditUi` (:878),
 * `openUniteConfigModal` (:1056), `saveUniteConfig` (:1074),
 * `generatePatracdvrPdf` (:1098). Cf. `docs/SPEC-OI-CONVERSION.md` §2.2/§5/§11.5,
 * `PAQUETS-OI.json` (`oi-patrac`).
 *
 * CÂBLAGE DRAG&DROP (mission de fusion menée dans `oi-drag-drop`, SPEC §5.2) :
 * `patrac.js:76-79` (4 listeners dragenter/dragleave/dragover/drop par
 * véhicule, `addPatracdvrRow`) → `wireDropContainer(membersContainer)` ;
 * `patrac.js:224-226` (3 listeners touchstart/touchmove/touchend par membre,
 * `addPatracdvrMember`) → `wireDraggableMember(btn)`. Les DEUX importés de
 * `@oi/drag-drop.js`. Les autres `addEventListener` de `addPatracdvrMember`
 * (click → `handleMemberSelection`, contextmenu → `handleMemberContextMenu`,
 * :220-221) restent EN DUR, non factorisés.
 *
 * ⚠ ÉCART CONSTATÉ, SIGNALÉ AU GATE (règle commune §13.1 : signaler, pas
 * corriger un fichier hors périmètre) — `persistAfterDrag` : les instructions
 * `PAQUETS-OI.json` (`oi-patrac`) mandatent
 * `import { persistAfterDrag } from '@oi/drag-drop.js'` pour les 2 appels
 * directs `persistAfterDrag()` de `patrac.js:649,674` (`patracBatchMoveTo`,
 * `patracBatchUnassign`). Or le paquet `oi-drag-drop`, déjà porté, N'EXPORTE
 * PAS `persistAfterDrag` (seuls `wireDropContainer`/`wireDraggableMember` le
 * sont — vérifié : `grep -n '^export' src/apps/oi/drag-drop.ts`). `drag-drop.ts`
 * est le fichier CIBLE d'un autre paquet (règle commune §13.1.2 : jamais
 * modifié par ce paquet). Ce fichier reproduit donc, EN LOCAL, la fonction
 * VERBATIM de `drag.js:12-20` (identique bit-à-bit à celle déjà présente dans
 * `drag-drop.ts:108-116`) pour honorer les 2 appels À ZÉRO ARGUMENT, SANS
 * GARDE, exactement comme l'original (jamais `window.persistAfterDrag` : ce
 * nom n'est déclaré nulle part dans `global.d.ts`, cohérent avec le fait qu'il
 * n'appartient à aucun contrat `OiXxxGlobals`). Comportement observable
 * STRICTEMENT IDENTIQUE à un import qui aurait fonctionné (la fonction n'est
 * JAMAIS réassignée ailleurs, contrairement à `syncDomToStore` — aucun risque
 * de capturer une version « périmée »). À corriger au gate P3.D en exportant
 * `persistAfterDrag` depuis `drag-drop.ts` puis en remplaçant cette copie
 * locale par un `import`.
 *
 * RÈGLE D'OR (SPEC §2.2) appliquée partout ailleurs : `window.syncDomToStore`,
 * `window.toast`, `window.flushFormData`, `window.refreshArticulationFromPatracdvr`,
 * `window.isFormLoading`, `window.UIPlatform` sont résolus par `window`, avec
 * EXACTEMENT la même garde `typeof …` que l'original QUAND ELLE EXISTE — y
 * compris son ABSENCE : plusieurs sites de l'original appellent `syncDomToStore()`
 * SANS garde (ex. `:70,82,231,272`) et d'autres AVEC garde (ex. `:905,964,996`) ;
 * les deux formes sont reproduites site par site, à l'identique.
 * `updateArticulationDisplay` (:324-329) reste un WRAPPER DE COMPATIBILITÉ
 * (contrat `OiPatracGlobals` figé) : `if (window.isFormLoading) return;` puis
 * `window.refreshArticulationFromPatracdvr()` sous garde `typeof` — JAMAIS un
 * import de `articulation.ts` (dépendance à SENS UNIQUE : `articulation.ts` ne
 * doit RIEN importer de `patrac.ts`, et réciproquement).
 * `setupQuickEditPanel` (:386) est EXPORTÉE (consommée par `formulaires.ts`,
 * import ESM, non exposée sur `window` — comme l'original).
 * `openQuickEditModal` (:723) est ORPHELINE CONFIRMÉE (grep négatif : aucun
 * appelant dans `patrac.js` ni ailleurs dans la source portée, jamais posée
 * sur `window`) — portée VERBATIM (fidélité), exportée uniquement pour
 * satisfaire `noUnusedLocals` (même précédent que `sanitizePdfText`,
 * `presentation.ts`, SPEC §11.9) ; signalée au gate.
 * Mode batch neutralisé en tactile : `togglePatracBatchMode` pose/retire la
 * classe `patrac-batch-mode` sur `document.body` (:523), lue SANS garde par
 * `handleTouchStart` de `drag-drop.ts` (`drag.js:25`) — invariant préservé
 * mot pour mot, aucun code supplémentaire requis côté `patrac.ts`.
 * `generatePatracdvrPdf` (:1098-1201) : `import * as PDFLib from 'pdf-lib'`
 * (npm, PAS le global CDN). `safe()` (:1119, neutralisation WinAnsi triviale
 * par regex `[^\x00-\xFF]` → `?`) VÉRIFIÉE structurellement DIFFÉRENTE de
 * `sanitizeWinAnsi` (`@pctac/pdf-export.ts:89`, table de translittération
 * ciblée guillemets/tirets courbes) : SIGNALÉ au gate comme demandé par la
 * mission, PAS de factorisation unilatérale (non identiques).
 *
 * Adaptations de TYPAGE PUR (aucune restructuration de logique, même patron
 * que `articulation.ts`/`drag-drop.ts`, déjà portés) :
 *  - `activeMemberId` (29 liaisons lexicales de `init.js`, réassignée 7× dans
 *    l'original : `:66,284,344,489,499,538,858`) devient partout
 *    `oiState.activeMemberId` (`@oi/state.js`, SPEC §3). Alias `const`
 *    ponctuels (`const activeId = oiState.activeMemberId;`) ajoutés là où le
 *    typage strict a besoin d'un affinement stable dans une fermeture
 *    (propriété d'objet mutable, contrairement à une variable locale) —
 *    aucun changement de comportement, valeur identique lue une seule fois.
 *  - `document.getElementById`/`querySelector(All)` renvoient `T | null` en
 *    TS strict : gardes `if (!x) return;` / `if (x) { … }` ajoutées partout où
 *    l'original accède sans vérifier (conteneurs et éléments de formulaire
 *    statiques, jamais absents en pratique) — même précédent que
 *    `articulation.ts`/`drag-drop.ts`.
 *  - `HTMLElement.dataset.*` est `string | undefined` : replis `?? ''` / `|| …`
 *    ajoutés aux points de lecture dynamique (`row.dataset.attr`,
 *    `btn.dataset.attribute`…), jamais empruntés en pratique.
 *  - `handleMemberSelection` (:472) est appelée à la fois comme VRAI listener
 *    `click` (`MouseEvent`) ET synthétiquement avec un objet `{ target }` nu
 *    (`addManualMember:124`) — d'où la garde `typeof event.stopPropagation
 *    === 'function'` déjà présente dans l'original (:476), seule façon de
 *    distinguer les deux cas à l'exécution. Type d'union minimal
 *    `PatracSelectionEvent` plutôt que `MouseEvent` strict, pour couvrir les
 *    deux appelants sans `any`.
 *  - `cloneMemberFromContext` (:257) : `data = { ...original.dataset }` puis
 *    `delete data.id` (:264) vise une clé `id` qui n'existe JAMAIS dans ce
 *    dataset (mort-code verbatim — `addPatracdvrMember` ne pose jamais
 *    `dataset.id`) ; type `Partial<OiPatracMember> & { id?: string }` pour
 *    rendre la clé déletable sans changer le comportement (jamais présente).
 *  - `generatePatracdvrPdf` : `page`/`y` mutés par les fermetures `newPage`/
 *    `drawHeaderRow` (:1135-1157) — accesseur `pdfPage()` qui jette si
 *    l'invariant « toujours appelé après `newPage()` » était violé (jamais en
 *    pratique), même précédent que `@pctac/pdf-export.ts` (`pdfPage()`, cf.
 *    son en-tête). `catch (e)` (:1195) : `e instanceof Error ? e.message :
 *    String(e)`, même précédent que `@pctac/main.ts:582,614`.
 *  - `saveUniteConfig` (:1074) : `ta.dataset.configKey` est un `string`
 *    quelconque côté typage ; `isMemberConfigKey()` (garde de type locale)
 *    vérifie l'appartenance à `keyof OiMemberConfig` sans `any` ni `!` — jamais
 *    fausse en pratique (la clé est toujours posée par `openUniteConfigModal`
 *    depuis `Object.entries(quickEditMapping)`).
 *  - `Object.keys(memberData) as (keyof OiPatracMember)[]` (`addPatracdvrMember`,
 *    `saveQuickEditModalChanges`) : cast standard sur un objet de forme connue
 *    (`OiPatracMember` / `modalTempData`), aucun `any`.
 *
 * Source : `/home/nico/Bureau/Web/GStart-main/modules/patrac.js` (lecture
 * seule).
 */

import { wireDraggableMember, wireDropContainer } from '@oi/drag-drop.js';
import { memberConfig, multiSelectAttributes, quickEditMapping } from '@oi/init.js';
import { oiState } from '@oi/state.js';
import { confirmDialog, toast } from '@shared/feedback.js';
import type { OiFormData, OiMemberConfig, OiPatracMember } from '@shared/types/contracts.js';
import * as PDFLib from 'pdf-lib';

// ==================== Patracdvr.js ====================

// Redundant declarations removed (now in init.js)

// Helper: Get live DOM references to PATRACDVR containers
// patrac.js:11-12 — fonctions locales, jamais exposées, jamais dans state.ts.
function getUnassignedContainer(): HTMLElement | null {
    return document.getElementById('unassigned_members_container');
}
function getPatracdvrContainer(): HTMLElement | null {
    return document.getElementById('patracdvr_container');
}

// Helper used by FormManager
// getMemberConfig -> memberConfig is global

// patrac.js:17 — état de module local (jamais réassigné hors de ce fichier ⇒ pas dans state.ts).
let modalTempData: Record<string, string | undefined> = {};

// patrac.js:19-31
function renameVehicle(element: HTMLElement): void {
    const currentName = element.textContent ?? '';
    const newName = prompt('Renommer le véhicule :', currentName);
    if (newName && newName.trim() !== '') {
        element.textContent = newName.trim();
        const row = element.closest<HTMLElement>('.patracdvr-vehicle-row');
        if (row) {
            row.dataset.vehicleName = newName.trim();
            window.syncDomToStore();
            updateArticulationDisplay();
        }
    }
}

// patrac.js:33-84
function addPatracdvrRow(vehicleName: string, members: readonly Partial<OiPatracMember>[] = []): void {
    const container = document.getElementById('patracdvr_container');
    if (!container) return;
    const row = document.createElement('div');
    row.className = 'patracdvr-vehicle-row';
    row.dataset.vehicleName = vehicleName;

    row.innerHTML = `
                <div class="vehicle-header">
                    <span class="vehicle-name" onclick="renameVehicle(this)" title="Cliquer pour renommer">${vehicleName}</span>
                    <button type="button" class="remove-btn" title="Supprimer le véhicule" aria-label="Supprimer le véhicule"><span class="material-symbols-outlined">close</span></button>
                </div>
                <div class="patracdvr-members-container"></div>`;

    container.appendChild(row);

    const membersContainer = row.querySelector<HTMLElement>('.patracdvr-members-container');
    const removeBtn = row.querySelector<HTMLElement>('.remove-btn');
    if (removeBtn) {
        removeBtn.addEventListener('click', async () => {
            // R2-T2b : `confirm()` natif → `confirmDialog` (@shared/feedback.js), danger (suppression définitive).
            const confirmation = await confirmDialog({
                message: `Voulez-vous vraiment supprimer le véhicule "${vehicleName}" et désattribuer ses membres ?`,
                confirmLabel: 'Supprimer',
                danger: true,
            });
            if (confirmation) {
                // Désattribution des membres
                membersContainer?.querySelectorAll<HTMLElement>('.patracdvr-member-btn').forEach(memberBtn => {
                    memberBtn.dataset.cellule = 'Sans';
                    memberBtn.dataset.fonction = 'Sans';
                    updateMemberButtonVisuals(memberBtn);
                    getUnassignedContainer()?.appendChild(memberBtn);
                });
                // Suppression de la ligne du véhicule
                row.remove();
                // Réinitialisation du panneau d'édition rapide si le membre actif était dans ce véhicule
                if (oiState.activeMemberId) {
                    const activeMember = document.getElementById(oiState.activeMemberId);
                    if (!document.contains(activeMember)) {
                        oiState.activeMemberId = null;
                        const quickEditPanel = document.getElementById('quickEditPanel') as HTMLElement | null;
                        if (quickEditPanel) quickEditPanel.style.display = 'none';
                    }
                }
                window.syncDomToStore();
                updateArticulationDisplay();
            }
        });
    }

    // Attacher les écouteurs de Drop uniquement au conteneur de membres du véhicule
    // patrac.js:76-79 — motif à 4 listeners FUSIONNÉ avec drag.js:301-306 dans
    // wireDropContainer (paquet oi-drag-drop, SPEC §5.2) : NE PAS redupliquer.
    if (membersContainer) wireDropContainer(membersContainer);

    members.forEach(memberData => addPatracdvrMember(membersContainer, memberData));
    window.syncDomToStore();
    updateArticulationDisplay();
}

// patrac.js:86-94
function addManualVehicle(): void {
    let vehicleName = prompt('Veuillez saisir le nom du nouveau VL (ex: KODIAQ, SHARAN, VTC...):');
    if (vehicleName) {
        vehicleName = vehicleName.trim();
        if (vehicleName.length > 0) {
            addPatracdvrRow(vehicleName);
        }
    }
}

// patrac.js:96-131
function addManualMember(): void {
    let trigramme = prompt('Veuillez saisir le trigramme du nouveau PAX (ex: ABC):');
    if (trigramme) {
        trigramme = trigramme.trim().toUpperCase();
        const existingMember = document.querySelector(`.patracdvr-member-btn[data-trigramme="${trigramme}"]`);
        if (existingMember) {
            toast(`Le membre avec le trigramme "${trigramme}" existe déjà. Veuillez en choisir un autre.`, { kind: 'error' });
            return;
        }

        if (trigramme.length >= 2 && trigramme.length <= 4) {
            const initialData: Partial<OiPatracMember> = {
                trigramme: trigramme,
                cellule: 'Sans',
                fonction: 'Sans',
                principales: 'Sans',
                secondaires: 'PSA',
                afis: 'Sans',
                grenades: 'Sans',
                equipement: 'Sans',
                equipement2: 'Cam pieton',
                tenue: 'UBAS',
                gpb: 'GPBL',
                dir: '', // Initialisation DIR
            };
            const newMemberBtn = addPatracdvrMember(getUnassignedContainer(), initialData);

            if (newMemberBtn) {
                handleMemberSelection({ target: newMemberBtn });
            }
            // syncDomToStore(); // Déjà appelé dans addPatracdvrMember
        } else {
            toast('Le trigramme doit contenir entre 2 et 4 caractères.', { kind: 'error' });
        }
    }
}

/**
 * Crée une CELLULE entière (≥ 2 PAX) en une fois. Une cellule India/AO occupe le
 * prochain numéro libre ; Effraction est unique. La fonction par défaut découle du
 * type (India→Inter, AO→AO, Effrac→Effrac). Les PAX sont pré-affectés à la cellule,
 * donc l'articulation (MOICP←India / ZMSPCP←AO / Effraction) se peuple aussitôt.
 */
// patrac.js:138-193
function addCellBatch(type: string): void {
    const labelMap: Record<string, string> = { India: 'India (Inter)', AO: 'AO', Effrac: 'Effraction' };
    const input = prompt(
        `Trigrammes des PAX de la cellule ${labelMap[type] || type}\n` +
        `(séparés par espace, virgule ou retour à la ligne — 2 minimum) :`
    );
    if (input === null) return;
    const trigs = input.split(/[\s,;]+/).map(t => t.trim().toUpperCase()).filter(Boolean);
    if (trigs.length < 2) {
        toast('Une cellule comporte au moins 2 personnels.', { kind: 'error' });
        return;
    }

    let cellule: string;
    let fonction: string;
    if (type === 'Effrac') {
        cellule = 'Effrac';
        fonction = 'Effrac';
    } else {
        const isIndia = (type === 'India');
        const prefix = isIndia ? 'India ' : 'AO';
        const max = isIndia ? 5 : 8;
        const used = new Set(
            Array.from(document.querySelectorAll<HTMLElement>('.patracdvr-member-btn')).map(b => b.dataset.cellule)
        );
        let n = 1;
        while (n <= max && used.has(prefix + n)) n++;
        if (n > max) n = max; // toutes occupées : on réutilise la dernière
        cellule = prefix + n;
        fonction = isIndia ? 'Inter' : 'AO';
    }

    const existing = new Set(
        Array.from(document.querySelectorAll<HTMLElement>('.patracdvr-member-btn')).map(b => b.dataset.trigramme)
    );
    let created = 0, skipped = 0;
    // Cellule Effraction : auto-équipement → 1er PAX = Bélier, 2e PAX = Lot 5.11.
    const effracEquip = ['Belier', 'Lot 5.11'];
    trigs.forEach(trig => {
        if (trig.length < 2 || trig.length > 4 || existing.has(trig)) { skipped++; return; }
        existing.add(trig);
        const memberData: Partial<OiPatracMember> = { trigramme: trig, cellule: cellule, fonction: fonction };
        if (type === 'Effrac') memberData.equipement = effracEquip[created] || 'Sans';
        addPatracdvrMember(getUnassignedContainer(), memberData);
        created++;
    });

    if (created > 0) {
        window.syncDomToStore();
        updateArticulationDisplay();
        if (typeof window.toast === 'function') {
            window.toast(`Cellule ${cellule} : ${created} PAX ajouté(s)${skipped ? ', ' + skipped + ' ignoré(s)' : ''}.`, 'success');
        }
    } else {
        toast('Aucun PAX valide créé (trigrammes invalides ou déjà existants).', { kind: 'error' });
    }
}

// patrac.js:195-234
function addPatracdvrMember(
    containerElement: HTMLElement | null,
    data: Partial<OiPatracMember> = {},
): HTMLButtonElement | undefined {
    if (!containerElement) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'patracdvr-member-btn draggable';
    btn.id = `member_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    btn.setAttribute('draggable', 'true');
    const memberData: OiPatracMember = {
        trigramme: 'N/A',
        fonction: 'Sans',
        cellule: 'India 1',
        principales: 'Sans',
        secondaires: 'PSA',
        afis: 'Sans',
        grenades: 'Sans',
        equipement: 'Sans',
        equipement2: 'Cam pieton',
        tenue: 'UBAS',
        gpb: 'GPBL',
        dir: '',
        ...data,
    };
    // Object.keys sur un objet de forme connue (OiPatracMember, tous champs string) : cast standard, aucun `any`.
    (Object.keys(memberData) as (keyof OiPatracMember)[]).forEach(key => { btn.dataset[key] = memberData[key]; });
    updateMemberButtonVisuals(btn);

    btn.addEventListener('click', handleMemberSelection);
    btn.addEventListener('contextmenu', handleMemberContextMenu);

    // --- AJOUT CORRECTIF MOBILE ---
    // patrac.js:224-226 — FUSIONNÉ avec drag.js dans wireDraggableMember
    // (paquet oi-drag-drop, SPEC §5.2) : NE PAS redupliquer les 3 listeners.
    wireDraggableMember(btn);
    // ------------------------------

    containerElement.appendChild(btn);

    window.syncDomToStore();
    updateArticulationDisplay();
    return btn;
}

// patrac.js:236-255
function handleMemberContextMenu(event: MouseEvent): void {
    event.preventDefault();
    // patrac.js:238 — `event.target` est `EventTarget | null` en TS ; cast unique
    // réutilisé, même précédent que `drag-drop.ts` (`eventTarget`).
    const eventTarget = event.target as HTMLElement;
    const btn = eventTarget.closest<HTMLElement>('.patracdvr-member-btn');
    if (!btn) return;

    window.contextMemberId = btn.id;
    const menu = document.getElementById('memberContextMenu') as HTMLElement | null;
    if (menu) {
        menu.style.display = 'block';
        menu.style.left = event.pageX + 'px';
        menu.style.top = event.pageY + 'px';
    }

    // Hide menu on click elsewhere
    const hideMenu = (): void => {
        if (menu) menu.style.display = 'none';
        document.removeEventListener('click', hideMenu);
    };
    setTimeout(() => document.addEventListener('click', hideMenu), 10);
}

// patrac.js:257-274
function cloneMemberFromContext(): void {
    const id = window.contextMemberId;
    if (!id) return;
    const original = document.getElementById(id);
    if (!original) return;

    // patrac.js:263 — clone du dataset : mêmes clés que OiPatracMember (posées
    // par addPatracdvrMember) ; `delete data.id` vise une clé jamais présente
    // dans ce dataset (mort-code verbatim) — `id?: string` ajouté au type pour
    // rendre la clé déletable sans `any`, aucun changement de comportement.
    const data = { ...original.dataset } as Partial<OiPatracMember> & { id?: string };
    delete data.id; // Let addPatracdvrMember generate a new ID

    // Add "Clone" suffix to trigramme if space permits, or just duplicate
    const baseTrigramme = data.trigramme || 'N/A';
    data.trigramme = (baseTrigramme + 'C').slice(0, 4);

    const container = original.parentElement;
    addPatracdvrMember(container, data);
    window.syncDomToStore();
    updateArticulationDisplay();
}

// patrac.js:276-291
// R2-T2b : signature élargie en `Promise<void>` (`confirmDialog` async) — compatible
// avec le contrat `deleteMemberFromContext(): void` (règle « void » TS, cf. en-tête).
async function deleteMemberFromContext(): Promise<void> {
    const id = window.contextMemberId;
    if (!id) return;
    const el = document.getElementById(id);
    if (!el) return;

    const confirmed = await confirmDialog({
        message: `Supprimer définitivement le membre ${el.dataset.trigramme || ''} ?`,
        confirmLabel: 'Supprimer',
        danger: true,
    });
    if (confirmed) {
        if (oiState.activeMemberId === id) {
            oiState.activeMemberId = null;
            const quickEditPanel = document.getElementById('quickEditPanel') as HTMLElement | null;
            if (quickEditPanel) quickEditPanel.style.display = 'none';
        }
        el.remove();
        window.syncDomToStore();
        updateArticulationDisplay();
    }
}

// patrac.js:293-322
function updateMemberButtonVisuals(btn: HTMLElement): void {
    const trigramme = btn.dataset.trigramme || 'N/A';
    const fonction = btn.dataset.fonction || '';
    const cellule = btn.dataset.cellule || '';
    const dir = btn.dataset.dir || '';

    const cellDisplay = cellule !== 'Sans' ? cellule : '';
    // NOUVEAU: Affichage DIR
    const dirDisplay = dir ? `<br><span class="dir-info">DIR: ${dir}</span>` : '';

    // Gestion multi-fonctions pour l'affichage (troncature si trop long)
    let functionDisplay = '';
    if (fonction !== 'Sans') {
        const funcs = fonction.split(', ');
        if (funcs.length > 1) {
            functionDisplay = ` / ${funcs[0]} +${funcs.length - 1}`;
        } else {
            functionDisplay = ` / ${fonction}`;
        }
    }

    const separation = (cellDisplay && functionDisplay) ? '' : '';

    btn.innerHTML = `<span class="trigramme">${trigramme}</span><span class="fonction">${cellDisplay}${separation}${functionDisplay}</span>${dirDisplay}`;

    // Si le membre est dans le conteneur "Personnel à attribuer", on masque la fonction/cellule.
    if (btn.closest('#unassigned_members_container')) {
        btn.innerHTML = `<span class="trigramme">${trigramme}</span>`;
    }
}

// patrac.js:324-330
function updateArticulationDisplay(): void {
    if (window.isFormLoading) return;
    // Compatibility wrapper — la logique a été déplacée dans articulation.js
    if (typeof window.refreshArticulationFromPatracdvr === 'function') {
        window.refreshArticulationFromPatracdvr();
    }
}

// patrac.js:332-339
function initializePatracdvr(dataFromStorage?: OiFormData | Record<string, never>): void {
    const unassigned = getUnassignedContainer();
    if (unassigned) unassigned.innerHTML = '';
    const patracdvr = getPatracdvrContainer();
    if (patracdvr) patracdvr.innerHTML = '';
    if (dataFromStorage && ((dataFromStorage.patracdvr_rows?.length ?? 0) > 0 || (dataFromStorage.patracdvr_unassigned?.length ?? 0) > 0)) {
        (dataFromStorage.patracdvr_unassigned ?? []).forEach(member => addPatracdvrMember(getUnassignedContainer(), member));
        (dataFromStorage.patracdvr_rows ?? []).forEach(row => addPatracdvrRow(row.vehicle, row.members));
    }
}

// patrac.js:341-352
// R2-T2b : signature élargie en `Promise<void>` (`confirmDialog` async) — compatible
// avec le contrat `resetPatracdvrUI(): void` (règle « void » TS, cf. en-tête).
async function resetPatracdvrUI(): Promise<void> {
    const confirmed = await confirmDialog({
        message: 'Voulez-vous vraiment réinitialiser tout le personnel et les véhicules du PATRACDVR ?',
        confirmLabel: 'Réinitialiser',
        danger: true,
    });
    if (confirmed) {
        initializePatracdvr({});
        // patrac.js:344 — `typeof activeMemberId !== 'undefined'` : conservé
        // verbatim (fidélité), bien que toujours vrai pour une propriété
        // d'objet (`oiState.activeMemberId`), jamais "undeclared" en ESM.
        if (typeof oiState.activeMemberId !== 'undefined') oiState.activeMemberId = null;
        const panel = document.getElementById('quickEditPanel') as HTMLElement | null;
        if (panel) panel.style.display = 'none';

        window.syncDomToStore();
        updateArticulationDisplay();
        if (typeof window.toast === 'function') window.toast('PATRACDVR réinitialisé', 'success');
    }
}

// patrac.js:354-382
function loadConfigObject(config: { options?: Partial<OiMemberConfig>; members?: readonly Partial<OiPatracMember>[] }): void {
    if (config.options) {
        Object.assign(memberConfig, config.options);
        setupQuickEditPanel();
    }

    if (config.members && Array.isArray(config.members)) {
        const unassigned = getUnassignedContainer();
        if (unassigned) unassigned.innerHTML = '';
        const patracdvr = getPatracdvrContainer();
        if (patracdvr) patracdvr.innerHTML = '';
        config.members.forEach(memberData => {
            const defaultData: Partial<OiPatracMember> = {
                cellule: memberData.cellule || 'Sans',
                fonction: memberData.fonction || 'Sans',
                principales: memberData.principales || 'Sans',
                secondaires: memberData.secondaires || 'PSA',
                afis: memberData.afis || 'Sans',
                grenades: memberData.grenades || 'Sans',
                equipement: memberData.equipement || 'Sans',
                equipement2: memberData.equipement2 || 'Sans',
                tenue: memberData.tenue || 'UBAS',
                gpb: memberData.gpb || 'GPBL',
                dir: '',
                ...memberData,
            };
            addPatracdvrMember(getUnassignedContainer(), defaultData);
        });
    }
    window.syncDomToStore();
}

// Panneau d'édition de membre = fiche-accordéon : 1 ligne par attribut (en-tête
// label → valeur(s) courante(s) + chevron) ; le corps repliable contient les pills.
// patrac.js:386-436 — exportée (consommée par formulaires.ts), PAS posée sur window (comme l'original).
export function setupQuickEditPanel(): void {
    const contentContainer = document.querySelector<HTMLElement>('#quickEditPanel .quick-edit-content');
    if (!contentContainer) return;
    contentContainer.innerHTML = '';

    for (const [title, config] of Object.entries(quickEditMapping)) {
        const options = memberConfig[config.key] || [];

        const row = document.createElement('div');
        row.className = 'qe-row';
        row.dataset.attr = config.attribute;
        row.dataset.key = config.key;

        const head = document.createElement('button');
        head.type = 'button';
        head.className = 'qe-row-head';
        head.setAttribute('aria-expanded', 'false');
        head.innerHTML =
            `<span class="qe-row-label">${title}</span>` +
            `<span class="qe-row-value"></span>` +
            `<span class="material-symbols-outlined qe-row-chevron" aria-hidden="true">chevron_right</span>`;
        row.appendChild(head);

        const body = document.createElement('div');
        body.className = 'qe-row-body';
        const optionsContainer = document.createElement('div');
        optionsContainer.className = 'quick-edit-options';
        options.forEach(option => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'quick-edit-btn';
            btn.textContent = option;
            btn.dataset.attribute = config.attribute;
            btn.dataset.value = option;
            optionsContainer.appendChild(btn);
        });
        body.appendChild(optionsContainer);
        row.appendChild(body);

        // Attribut à option unique (ex Arme S. = "PSA") : pas d'accordéon, l'en-tête
        // bascule la valeur entre l'option et "Sans".
        if (options.length <= 1) {
            row.classList.add('qe-row-mono');
            row.dataset.single = options[0] || 'Sans';
            const chev = row.querySelector<HTMLElement>('.qe-row-chevron');
            if (chev) chev.style.display = 'none';
        }

        contentContainer.appendChild(row);
    }
}

/** Texte de synthèse de la valeur d'un attribut pour l'en-tête de ligne. */
// patrac.js:439-450
function _qeRowValueText(member: HTMLElement, row: HTMLElement): { text: string; empty: boolean } {
    const attr = row.dataset.attr ?? '';
    const raw = member.dataset[attr] || '';
    if (multiSelectAttributes.includes(attr)) {
        // Afficher TOUTES les valeurs sélectionnées (aucune troncature).
        const vals = raw.split(', ').map(v => v.trim()).filter(v => v && v !== 'Sans');
        if (!vals.length) return { text: 'Sans', empty: true };
        return { text: vals.join(' · '), empty: false };
    }
    if (!raw || raw === 'Sans') return { text: 'Sans', empty: true };
    return { text: raw, empty: false };
}

/** Rafraîchit la valeur affichée dans l'en-tête d'une ligne (+ état mono on/off). */
// patrac.js:452-460
function repaintRowValue(row: HTMLElement, member: HTMLElement): void {
    const valEl = row.querySelector<HTMLElement>('.qe-row-value');
    if (!valEl) return;
    const { text, empty } = _qeRowValueText(member, row);
    valEl.textContent = text;
    valEl.classList.toggle('is-empty', empty);
    if (row.classList.contains('qe-row-mono')) row.classList.toggle('qe-mono-on', !empty);
}

/** Pastille « Enregistré » : feedback visuel d'auto-sauvegarde. */
// patrac.js:463-470
let _qeAutosaveTimer: ReturnType<typeof setTimeout> | null = null;
function flashAutoSave(): void {
    const el = document.getElementById('qeAutosave') as HTMLElement | null;
    if (!el) return;
    el.classList.add('show');
    if (_qeAutosaveTimer !== null) clearTimeout(_qeAutosaveTimer);
    _qeAutosaveTimer = setTimeout(() => el.classList.remove('show'), 1200);
}

/**
 * patrac.js:472 — accepte un vrai `MouseEvent` (listener `click`,
 * `addPatracdvrMember` ci-dessus) OU un objet SYNTHÉTIQUE `{ target }` nu
 * (appel direct depuis `addManualMember`, patrac.js:124) : seule la garde
 * `typeof event.stopPropagation === 'function'` (:476) distingue les deux à
 * l'exécution — d'où ce type d'union minimal plutôt que `MouseEvent` strict.
 */
type PatracSelectionEvent = { target: EventTarget | null; stopPropagation?: () => void };

// patrac.js:472-508
function handleMemberSelection(event: PatracSelectionEvent): void {
    const clickedButton = (event.target as HTMLElement | null)?.closest<HTMLElement>('.patracdvr-member-btn');
    if (!clickedButton) return;

    if (event && typeof event.stopPropagation === 'function') {
        event.stopPropagation();
    }

    // PROPOSITION 4 — Déplacement groupé : en mode sélection multiple, un clic
    // (dé)sélectionne le PAX au lieu d'ouvrir l'édition rapide.
    if (_patracBatchMode) {
        _patracBatchToggle(clickedButton);
        return;
    }

    if (oiState.activeMemberId === clickedButton.id) {
        clickedButton.classList.remove('member-active');
        oiState.activeMemberId = null;
        const quickEditPanel = document.getElementById('quickEditPanel') as HTMLElement | null;
        if (quickEditPanel) quickEditPanel.style.display = 'none';
        return;
    }

    if (oiState.activeMemberId) {
        const oldActive = document.getElementById(oiState.activeMemberId);
        if (oldActive) oldActive.classList.remove('member-active');
    }

    oiState.activeMemberId = clickedButton.id;
    clickedButton.classList.add('member-active');

    // Composant unique mobile + desktop : la fiche-accordéon inline (compacte).
    populateQuickEditPanel(oiState.activeMemberId);
    const panel = document.getElementById('quickEditPanel') as HTMLElement | null;
    if (panel) {
        panel.style.display = 'flex';
        panel.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
    window.syncDomToStore();
}

/* =====================================================================
 * PROPOSITION 4 — DÉPLACEMENT EN LOT (BATCH) PAR SÉLECTION OU CELLULE
 *
 * Objectif (audit §4.2) : sur petit écran, en environnement stressant, éviter
 * le glisser-déposer unitaire. On sélectionne plusieurs PAX (ou une cellule
 * tactique entière) d'un geste, puis on les réaffecte à un véhicule en un clic.
 * ===================================================================== */
// patrac.js:517-518
let _patracBatchMode = false;
const _patracBatchSel = new Set<string>();

/**
 * Duplication VERBATIM de `persistAfterDrag` (`drag.js:12-20`, identique à
 * `drag-drop.ts:108-116`) — voir ÉCART SIGNALÉ AU GATE en tête de fichier :
 * `drag-drop.ts` n'exporte pas cette fonction alors que la mission le mandate.
 * Appelée À ZÉRO ARGUMENT, SANS garde `typeof`, exactement comme
 * `patrac.js:649,674` (jamais `window.persistAfterDrag` : nom absent de
 * `global.d.ts`, hors de tout contrat `OiXxxGlobals`).
 */
function persistAfterDrag(): void {
    if (typeof window.syncDomToStore === 'function') window.syncDomToStore();
    else if (typeof window.Store?.saveToStorage === 'function') window.Store.saveToStorage();

    // NOUVEAU: Déclenche la mise à jour proactive de l'Articulation (Step 6)
    if (typeof window.updateArticulationDisplay === 'function') {
        window.updateArticulationDisplay();
    }
}

/** Active/désactive le mode sélection multiple. */
// patrac.js:521-544
function togglePatracBatchMode(force?: boolean): void {
    _patracBatchMode = (typeof force === 'boolean') ? force : !_patracBatchMode;
    document.body.classList.toggle('patrac-batch-mode', _patracBatchMode);

    const toggleBtn = document.getElementById('patracBatchToggleBtn') as HTMLElement | null;
    if (toggleBtn) toggleBtn.classList.toggle('active', _patracBatchMode);

    const bar = document.getElementById('patracBatchBar') as HTMLElement | null;
    if (bar) bar.style.display = _patracBatchMode ? 'flex' : 'none';

    if (!_patracBatchMode) {
        patracBatchClear();
    } else {
        // En entrant en mode sélection, on referme l'édition rapide pour éviter la confusion.
        if (oiState.activeMemberId) {
            const act = document.getElementById(oiState.activeMemberId);
            if (act) act.classList.remove('member-active');
            oiState.activeMemberId = null;
            const qp = document.getElementById('quickEditPanel') as HTMLElement | null;
            if (qp) qp.style.display = 'none';
        }
        _patracBatchUpdateBar();
    }
}

/** (Dé)sélectionne un PAX dans la sélection courante. */
// patrac.js:547-557
function _patracBatchToggle(btn: HTMLElement | null): void {
    if (!btn) return;
    if (_patracBatchSel.has(btn.id)) {
        _patracBatchSel.delete(btn.id);
        btn.classList.remove('batch-selected');
    } else {
        _patracBatchSel.add(btn.id);
        btn.classList.add('batch-selected');
    }
    _patracBatchUpdateBar();
}

/** Met à jour le compteur et l'état actif/inactif des actions de la barre. */
// patrac.js:560-570
function _patracBatchUpdateBar(): void {
    // Purge des id disparus (membre supprimé entre-temps).
    Array.from(_patracBatchSel).forEach(id => { if (!document.getElementById(id)) _patracBatchSel.delete(id); });
    const n = _patracBatchSel.size;
    const countEl = document.getElementById('patracBatchCount') as HTMLElement | null;
    if (countEl) countEl.textContent = n + ' PAX sélectionné' + (n > 1 ? 's' : '');
    ['patracBatchMove', 'patracBatchUnassign', 'patracBatchSelectCell', 'patracBatchClear'].forEach(id => {
        const b = document.getElementById(id) as HTMLButtonElement | null;
        if (b) b.disabled = (n === 0);
    });
}

/** Étend la sélection à TOUTE la (ou les) cellule(s) des PAX déjà sélectionnés. */
// patrac.js:573-591
function patracBatchSelectWholeCell(): void {
    const cells = new Set<string>();
    _patracBatchSel.forEach(id => {
        const el = document.getElementById(id);
        const cel = el ? el.dataset.cellule : undefined;
        if (cel && cel !== 'Sans') cells.add(cel);
    });
    if (!cells.size) {
        toast("Sélectionnez d'abord au moins un PAX appartenant à une cellule (India, AO, Effraction…).", { kind: 'error' });
        return;
    }
    document.querySelectorAll<HTMLElement>('.patracdvr-member-btn').forEach(btn => {
        const cel = btn.dataset.cellule;
        if (cel && cells.has(cel)) {
            _patracBatchSel.add(btn.id);
            btn.classList.add('batch-selected');
        }
    });
    _patracBatchUpdateBar();
}

/** Affiche/masque la liste des cibles (véhicules + « Non affectés »). */
// patrac.js:594-626
function patracBatchShowTargets(): void {
    const wrap = document.getElementById('patracBatchTargets') as HTMLElement | null;
    if (!wrap) return;
    if (wrap.style.display === 'flex') { wrap.style.display = 'none'; return; }
    if (!_patracBatchSel.size) return;

    wrap.innerHTML = '';
    const vehicles = Array.from(document.querySelectorAll<HTMLElement>('#patracdvr_container .patracdvr-vehicle-row'));
    if (!vehicles.length) {
        const span = document.createElement('span');
        span.textContent = "Aucun véhicule. Ajoutez un VL d'abord.";
        span.style.opacity = '0.7';
        wrap.appendChild(span);
    }
    vehicles.forEach(row => {
        const name = row.dataset.vehicleName || 'VL';
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'add-btn patrac-batch-target-btn';
        b.innerHTML = '<span class="material-symbols-outlined" aria-hidden="true">directions_car</span> ' + name;
        b.onclick = () => patracBatchMoveTo(row.querySelector<HTMLElement>('.patracdvr-members-container'));
        wrap.appendChild(b);
    });
    const u = document.createElement('button');
    u.type = 'button';
    u.className = 'add-btn patrac-batch-target-btn';
    u.style.background = 'var(--bg-interactive, #333)';
    u.innerHTML = '<span class="material-symbols-outlined" aria-hidden="true">logout</span> Non affectés';
    u.onclick = () => patracBatchUnassign();
    wrap.appendChild(u);

    wrap.style.display = 'flex';
}

/**
 * Déplace tous les PAX sélectionnés dans le conteneur de membres cible (véhicule).
 * patrac.js:629 déclare `container` sans garde de nullité ; le contrat figé
 * `OiPatracGlobals.patracBatchMoveTo` type `container: HTMLElement` (non-null,
 * requis) — le paramètre `HTMLElement | null` ci-dessous (avec le
 * `if (!container) return;` VERBATIM de patrac.js:630) reste assignable à
 * `window.patracBatchMoveTo` par contravariance (accepte un sur-ensemble des
 * entrées) et préserve la garde défensive de l'original.
 */
// patrac.js:629-652
function patracBatchMoveTo(container: HTMLElement | null): void {
    if (!container) return;
    const ids = Array.from(_patracBatchSel);
    if (!ids.length) return;
    let moved = 0;
    ids.forEach(id => {
        const btn = document.getElementById(id);
        if (!btn) return;
        container.appendChild(btn);
        // On PRÉSERVE la cellule/fonction (déplacer une cellule entière garde son identité).
        // Seul cas particulier : un PAX « Sans » cellule reçoit une cellule par défaut,
        // cohérent avec le glisser-déposer unitaire existant.
        if ((btn.dataset.cellule || 'Sans') === 'Sans') btn.dataset.cellule = 'India 1';
        btn.classList.remove('batch-selected');
        updateMemberButtonVisuals(btn);
        moved++;
    });
    _patracBatchSel.clear();
    const wrap = document.getElementById('patracBatchTargets') as HTMLElement | null;
    if (wrap) wrap.style.display = 'none';
    persistAfterDrag();
    _patracBatchUpdateBar();
    if (moved && typeof window.toast === 'function') window.toast(moved + ' PAX déplacé(s).', 'success');
}

/** Renvoie les PAX sélectionnés vers « Personnel à attribuer ». */
// patrac.js:655-677
function patracBatchUnassign(): void {
    const container = getUnassignedContainer();
    if (!container) return;
    const ids = Array.from(_patracBatchSel);
    if (!ids.length) return;
    let moved = 0;
    ids.forEach(id => {
        const btn = document.getElementById(id);
        if (!btn) return;
        container.appendChild(btn);
        btn.dataset.cellule = 'Sans';
        btn.dataset.fonction = 'Sans';
        btn.classList.remove('batch-selected');
        updateMemberButtonVisuals(btn);
        moved++;
    });
    _patracBatchSel.clear();
    const wrap = document.getElementById('patracBatchTargets') as HTMLElement | null;
    if (wrap) wrap.style.display = 'none';
    persistAfterDrag();
    _patracBatchUpdateBar();
    if (moved && typeof window.toast === 'function') window.toast(moved + ' PAX désattribué(s).', 'success');
}

/** Vide la sélection courante (sans quitter le mode). */
// patrac.js:680-689
function patracBatchClear(): void {
    _patracBatchSel.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.remove('batch-selected');
    });
    _patracBatchSel.clear();
    const wrap = document.getElementById('patracBatchTargets') as HTMLElement | null;
    if (wrap) wrap.style.display = 'none';
    _patracBatchUpdateBar();
}

// patrac.js:691-721
function populateQuickEditPanel(memberId: string): void {
    const member = document.getElementById(memberId);
    if (!member) return;

    const trigrammeDisplay = member.dataset.trigramme || 'N/A';
    const trigDisplayEl = document.getElementById('selectedMemberTrigramme') as HTMLElement | null;
    if (trigDisplayEl) trigDisplayEl.textContent = trigrammeDisplay;
    const trigInput = document.getElementById('quick_edit_trigramme_input') as HTMLInputElement | null;
    if (trigInput) trigInput.value = trigrammeDisplay;

    const dirInput = document.getElementById('quick_edit_dir_input') as HTMLInputElement | null;
    if (dirInput) dirInput.value = member.dataset.dir || '';

    document.querySelectorAll<HTMLElement>('#quickEditPanel .quick-edit-btn').forEach(btn => {
        const attribute = btn.dataset.attribute ?? '';
        const value = btn.dataset.value ?? '';
        const memberValue = member.dataset[attribute];

        if (multiSelectAttributes.includes(attribute)) {
            const currentValues = memberValue ? memberValue.split(', ') : [];
            btn.classList.toggle('selected', currentValues.includes(value));
        } else {
            btn.classList.toggle('selected', memberValue === value);
        }
    });

    // Peindre la valeur courante de chaque ligne-fiche + replier toutes les lignes.
    document.querySelectorAll<HTMLElement>('#quickEditPanel .qe-row').forEach(row => {
        repaintRowValue(row, member);
        row.classList.remove('is-open');
        const h = row.querySelector<HTMLElement>('.qe-row-head');
        if (h) h.setAttribute('aria-expanded', 'false');
    });
}

/**
 * patrac.js:723-834 — ORPHELINE confirmée (grep négatif : aucun appelant dans
 * `patrac.js` ni ailleurs dans la source portée, jamais posée sur `window`,
 * jamais référencée par un `onclick` HTML). Portée VERBATIM (fidélité) ;
 * exportée uniquement pour satisfaire `noUnusedLocals` (précédent identique :
 * `sanitizePdfText`, `presentation.ts`, SPEC §11.9) — signalée au gate.
 */
export function openQuickEditModal(memberId: string): void {
    const modal = document.getElementById('quickEditModal') as HTMLDialogElement | null;
    const title = document.getElementById('quick_modal_title') as HTMLElement | null;
    const content = document.getElementById('quick_modal_content') as HTMLElement | null;
    const member = document.getElementById(memberId);

    if (!member || !modal || !title || !content) return;

    // Bloquer le scroll du fond
    document.body.classList.add('modal-open');

    // Initialiser les données temporaires à partir du membre
    modalTempData = { ...member.dataset };
    const originalTrigramme = modalTempData.trigramme || 'N/A';
    title.textContent = `Édition: ${originalTrigramme}`;
    content.innerHTML = '';

    // --- 1. Champ Trigramme ---
    const trigrammeDiv = document.createElement('div');
    trigrammeDiv.className = 'quick-edit-category';
    trigrammeDiv.innerHTML = `
        <h5>Trigramme</h5>
        <input type="text" id="modal_quick_edit_trigramme_input" placeholder="ABC"
               value="${originalTrigramme}"
               style="padding: 12px; font-size: 1.1em; width:100%; box-sizing:border-box; background: var(--bg-interactive); border: 1px solid var(--border-color); color: var(--text-primary); border-radius: 8px;">
    `;
    content.appendChild(trigrammeDiv);

    // --- 2. Champ DIR Radio ---
    const dirDiv = document.createElement('div');
    dirDiv.className = 'quick-edit-category';
    dirDiv.innerHTML = `
        <h5>DIR (Canal Radio)</h5>
        <input type="text" id="modal_quick_edit_dir_input" placeholder="Ex: 42"
               value="${modalTempData.dir || ''}"
               style="padding: 12px; font-size: 1.1em; width:100%; box-sizing:border-box; background: var(--bg-interactive); border: 1px solid var(--border-color); color: var(--text-primary); border-radius: 8px;">
    `;
    content.appendChild(dirDiv);

    // Écouteurs pour les données temporaires
    setTimeout(() => {
        const tInput = document.getElementById('modal_quick_edit_trigramme_input') as HTMLInputElement | null;
        const dInput = document.getElementById('modal_quick_edit_dir_input') as HTMLInputElement | null;

        if (tInput) tInput.addEventListener('input', (e) => {
            modalTempData.trigramme = (e.target as HTMLInputElement).value.toUpperCase();
            title.textContent = `Édition: ${modalTempData.trigramme}`;
        });
        if (dInput) dInput.addEventListener('input', (e) => {
            modalTempData.dir = (e.target as HTMLInputElement).value;
        });
    }, 10);

    // --- 3. Options d'édition (boutons) ---
    setupQuickEditPanel();
    const quickEditPanelContent = document.querySelector<HTMLElement>('#quickEditPanel .quick-edit-content');
    if (!quickEditPanelContent) return;
    const contentClone = quickEditPanelContent.cloneNode(true) as HTMLElement;
    content.appendChild(contentClone);

    // Mettre à jour l'état visuel des boutons clonés et ajouter les écouteurs
    const modalButtons = content.querySelectorAll<HTMLElement>('.quick-edit-btn');
    modalButtons.forEach(btn => {
        const attr = btn.dataset.attribute ?? '';
        const val = btn.dataset.value ?? '';
        const currentVal = modalTempData[attr];

        if (multiSelectAttributes.includes(attr)) {
            const vals = currentVal ? currentVal.split(', ') : [];
            btn.classList.toggle('selected', vals.includes(val));
        } else {
            btn.classList.toggle('selected', currentVal === val);
        }

        btn.addEventListener('click', (e) => {
            e.preventDefault();
            const attribute = btn.dataset.attribute ?? '';
            const value = btn.dataset.value ?? '';

            if (multiSelectAttributes.includes(attribute)) {
                const rawValues = modalTempData[attribute];
                let currentValues = rawValues ? rawValues.split(', ') : [];
                if (value === 'Sans') {
                    currentValues = ['Sans'];
                } else {
                    if (currentValues.includes('Sans')) currentValues = [];
                    if (currentValues.includes(value)) {
                        currentValues = currentValues.filter(v => v !== value);
                    } else {
                        currentValues.push(value);
                    }
                }
                if (currentValues.length === 0) currentValues = ['Sans'];
                modalTempData[attribute] = currentValues.join(', ');

                btn.classList.toggle('selected', currentValues.includes(value));
                const group = btn.parentElement;
                if (value !== 'Sans') {
                    const sansBtn = group ? Array.from(group.children).find(b => (b as HTMLElement).dataset.value === 'Sans') : undefined;
                    if (sansBtn) sansBtn.classList.remove('selected');
                } else {
                    if (group) Array.from(group.children).forEach(b => { if (b !== btn) b.classList.remove('selected'); });
                }
            } else {
                modalTempData[attribute] = value;
                const group = btn.parentElement;
                if (group) group.querySelectorAll('.quick-edit-btn').forEach(b => b.classList.remove('selected'));
                btn.classList.add('selected');
            }
        });
    });

    modal.showModal();
}

// patrac.js:836-849
function saveQuickEditModalChanges(): void {
    const activeId = oiState.activeMemberId;
    if (!activeId) return;
    const member = document.getElementById(activeId);
    if (!member) return;

    (Object.keys(modalTempData)).forEach(key => {
        member.dataset[key] = modalTempData[key];
    });

    updateMemberButtonVisuals(member);
    closeQuickEditModal();

    window.syncDomToStore();
    updateArticulationDisplay();
}

// patrac.js:851-860
function closeQuickEditModal(): void {
    const modal = document.getElementById('quickEditModal') as HTMLDialogElement | null;
    if (modal) modal.close();
    document.body.classList.remove('modal-open');
    const activeId = oiState.activeMemberId;
    if (activeId) {
        const oldActive = document.getElementById(activeId);
        if (oldActive) oldActive.classList.remove('member-active');
        oiState.activeMemberId = null;
    }
}

// patrac.js:862-876
function saveQuickEditChanges(): void {
    const activeId = oiState.activeMemberId;
    if (!activeId) return;
    const member = document.getElementById(activeId);
    if (!member) return;

    const trigInput = document.getElementById('quick_edit_trigramme_input') as HTMLInputElement | null;
    const newTrigramme = trigInput ? trigInput.value.toUpperCase() : '';
    member.dataset.trigramme = newTrigramme;
    const trigDisplayEl = document.getElementById('selectedMemberTrigramme') as HTMLElement | null;
    if (trigDisplayEl) trigDisplayEl.textContent = newTrigramme;

    const dirInput = document.getElementById('quick_edit_dir_input') as HTMLInputElement | null;
    member.dataset.dir = dirInput ? dirInput.value : '';

    updateMemberButtonVisuals(member);
    window.syncDomToStore();
    updateArticulationDisplay();
    populateQuickEditPanel(activeId);
}

// patrac.js:878-1022
function initPatracQuickEditUi(): void {
    if (patracQuickEditUiInitialized) return;
    patracQuickEditUiInitialized = true;

    // (Plus de bouton « Sauvegarder » : auto-sauvegarde à chaque modification.)

    const quickEditPanel = document.getElementById('quickEditPanel') as HTMLElement | null;
    if (quickEditPanel) {
        quickEditPanel.addEventListener('click', (event) => {
            event.stopPropagation();
            const target = event.target as HTMLElement;

            // 1) Clic sur un EN-TÊTE de ligne : accordéon (ouvre/ferme), ou bascule
            //    on/off pour les attributs à option unique (mono).
            const head = target.closest<HTMLElement>('.qe-row-head');
            if (head) {
                const row = head.closest<HTMLElement>('.qe-row');
                if (!row) return;
                if (row.classList.contains('qe-row-mono')) {
                    const activeId = oiState.activeMemberId;
                    if (!activeId) return;
                    const m = document.getElementById(activeId);
                    if (!m) return;
                    const attr = row.dataset.attr ?? '';
                    const single = row.dataset.single || 'Sans';
                    m.dataset[attr] = (m.dataset[attr] === single) ? 'Sans' : single;
                    repaintRowValue(row, m);
                    updateMemberButtonVisuals(m);
                    if (typeof window.syncDomToStore === 'function') { window.syncDomToStore(); updateArticulationDisplay(); }
                    flashAutoSave();
                    return;
                }
                const willOpen = !row.classList.contains('is-open');
                quickEditPanel.querySelectorAll<HTMLElement>('.qe-row.is-open').forEach(r => {
                    r.classList.remove('is-open');
                    const h = r.querySelector<HTMLElement>('.qe-row-head'); if (h) h.setAttribute('aria-expanded', 'false');
                });
                if (willOpen) { row.classList.add('is-open'); head.setAttribute('aria-expanded', 'true'); }
                return;
            }

            // 2) Clic sur une PILL d'option : écrit l'attribut du membre actif.
            const quickEditButton = target.closest<HTMLElement>('.quick-edit-btn');
            const activeId = oiState.activeMemberId;
            if (quickEditButton && activeId) {
                const activeMember = document.getElementById(activeId);
                if (!activeMember) return;
                const attribute = quickEditButton.dataset.attribute ?? '';
                const value = quickEditButton.dataset.value ?? '';

                if (multiSelectAttributes.includes(attribute)) {
                    const rawValues = activeMember.dataset[attribute];
                    let currentValues = rawValues ? rawValues.split(', ') : [];
                    if (value === 'Sans') {
                        currentValues = ['Sans'];
                    } else {
                        if (currentValues.includes('Sans')) currentValues = [];
                        if (currentValues.includes(value)) {
                            currentValues = currentValues.filter(v => v !== value);
                        } else {
                            currentValues.push(value);
                        }
                    }
                    if (currentValues.length === 0) currentValues = ['Sans'];
                    activeMember.dataset[attribute] = currentValues.join(', ');

                    quickEditButton.classList.toggle('selected', currentValues.includes(value));
                    const group = quickEditButton.parentElement;
                    if (value !== 'Sans') {
                        const sansBtn = group ? Array.from(group.children).find(b => b.textContent === 'Sans') : undefined;
                        if (sansBtn) sansBtn.classList.remove('selected');
                    } else {
                        if (group) Array.from(group.children).forEach(b => { if (b !== quickEditButton) b.classList.remove('selected'); });
                    }
                } else {
                    activeMember.dataset[attribute] = value;
                    if (attribute === 'cellule' && value === 'Sans') {
                        activeMember.dataset.fonction = 'Sans';
                    }
                    if (attribute === 'fonction' && value !== 'Sans' && activeMember.dataset.cellule === 'Sans') {
                        activeMember.dataset.cellule = 'India 1';
                    }
                    const group = quickEditButton.parentElement;
                    if (group) group.querySelectorAll('.quick-edit-btn').forEach(btn => btn.classList.remove('selected'));
                    quickEditButton.classList.add('selected');
                }

                updateMemberButtonVisuals(activeMember);
                if (typeof window.syncDomToStore === 'function') {
                    window.syncDomToStore();
                    updateArticulationDisplay();
                }

                // Refléter la nouvelle valeur dans l'en-tête + replier (mono-select).
                const editedRow = quickEditButton.closest<HTMLElement>('.qe-row');
                if (editedRow) {
                    repaintRowValue(editedRow, activeMember);
                    // Couplage cellule↔fonction : repeindre toutes les lignes concernées.
                    if (attribute === 'cellule' || attribute === 'fonction') {
                        quickEditPanel.querySelectorAll<HTMLElement>('.qe-row').forEach(r => repaintRowValue(r, activeMember));
                    }
                    // Sélection unique (non multi) : on replie pour enchaîner vite.
                    if (!multiSelectAttributes.includes(attribute)) {
                        setTimeout(() => {
                            editedRow.classList.remove('is-open');
                            const h = editedRow.querySelector<HTMLElement>('.qe-row-head'); if (h) h.setAttribute('aria-expanded', 'false');
                        }, 150);
                    }
                }
                flashAutoSave();
            }
        });

        quickEditPanel.addEventListener('input', (e) => {
            const activeId = oiState.activeMemberId;
            if (!activeId) return;
            const member = document.getElementById(activeId);
            if (!member) return;
            const eventTarget = e.target as HTMLInputElement;
            if (eventTarget.id === 'quick_edit_trigramme_input') {
                member.dataset.trigramme = eventTarget.value.toUpperCase();
                updateMemberButtonVisuals(member);
                if (typeof window.syncDomToStore === 'function') window.syncDomToStore();
                flashAutoSave();
            } else if (eventTarget.id === 'quick_edit_dir_input') {
                member.dataset.dir = eventTarget.value;
                updateMemberButtonVisuals(member);
                if (typeof window.syncDomToStore === 'function') {
                    window.syncDomToStore();
                    updateArticulationDisplay();
                }
                flashAutoSave();
            }
        });
    }

    const quickEditModal = document.getElementById('quickEditModal') as HTMLDialogElement | null;
    const cancelBtn = document.getElementById('quick_modal_cancelBtn') as HTMLElement | null;
    const saveBtnModal = document.getElementById('quick_modal_saveBtn') as HTMLElement | null;

    if (quickEditModal && cancelBtn && saveBtnModal) {
        cancelBtn.addEventListener('click', closeQuickEditModal);
        saveBtnModal.addEventListener('click', saveQuickEditModalChanges);

        quickEditModal.addEventListener('click', (e) => {
            if (e.target === quickEditModal) closeQuickEditModal();
        });
    }
}

let patracQuickEditUiInitialized = false;
window.initPatracQuickEditUi = initPatracQuickEditUi;

// --- GLOBAL EXPOSURE ---
window.renameVehicle = renameVehicle;
window.addManualVehicle = addManualVehicle;
window.addManualMember = addManualMember;
window.addCellBatch = addCellBatch;
window.addPatracdvrRow = addPatracdvrRow;
window.addPatracdvrMember = addPatracdvrMember;
window.initializePatracdvr = initializePatracdvr;
window.updateMemberButtonVisuals = updateMemberButtonVisuals;
window.populateQuickEditPanel = populateQuickEditPanel;
window.saveQuickEditChanges = saveQuickEditChanges;
window.updateArticulationDisplay = updateArticulationDisplay;
window.cloneMemberFromContext = cloneMemberFromContext;
window.deleteMemberFromContext = deleteMemberFromContext;
window.resetPatracdvrUI = resetPatracdvrUI;
window.loadConfigObject = loadConfigObject;

// Proposition 4 — déplacement en lot (batch)
window.togglePatracBatchMode = togglePatracBatchMode;
window.patracBatchSelectWholeCell = patracBatchSelectWholeCell;
window.patracBatchShowTargets = patracBatchShowTargets;
window.patracBatchMoveTo = patracBatchMoveTo;
window.patracBatchUnassign = patracBatchUnassign;
window.patracBatchClear = patracBatchClear;

// ============================================================
// CONFIGURATION UNITÉ — édition de memberConfig depuis l'OI
// (remplace l'aller-retour vers patracdvr.html : tout se fait dans 4.html)
// ============================================================

/**
 * patrac.js:1077 — `ta.dataset.configKey` est toujours une clé valide de
 * `OiMemberConfig` en pratique (posée par `openUniteConfigModal` depuis
 * `Object.entries(quickEditMapping)`) ; garde de type locale pour satisfaire
 * `noUncheckedIndexedAccess` sans `any` ni `!`, jamais fausse en pratique.
 */
function isMemberConfigKey(key: string): key is keyof OiMemberConfig {
    return key in memberConfig;
}

// patrac.js:1056-1072
function openUniteConfigModal(): void {
    const content = document.getElementById('unite_config_content') as HTMLElement | null;
    const modal = document.getElementById('uniteConfigModal') as HTMLDialogElement | null;
    if (!content || !modal || typeof quickEditMapping === 'undefined') return;
    const esc = (v: unknown): string => (window.UIPlatform ? window.UIPlatform.esc(v) : String(v));
    content.innerHTML = '';
    for (const [title, cfg] of Object.entries(quickEditMapping)) {
        const group = document.createElement('div');
        group.className = 'unite-config-group';
        const opts = (memberConfig[cfg.key] || []).join(', ');
        group.innerHTML = `<label>${esc(title)}</label><textarea data-config-key="${esc(cfg.key)}" rows="2">${esc(opts)}</textarea>`;
        content.appendChild(group);
    }
    document.body.classList.add('modal-open');
    if (typeof modal.showModal === 'function') { try { modal.showModal(); } catch { modal.setAttribute('open', ''); } }
    else modal.setAttribute('open', '');
}

// patrac.js:1074-1093
function saveUniteConfig(): void {
    const content = document.getElementById('unite_config_content') as HTMLElement | null;
    if (!content) return;
    content.querySelectorAll<HTMLTextAreaElement>('textarea[data-config-key]').forEach(ta => {
        const key = ta.dataset.configKey;
        if (!key || !isMemberConfigKey(key)) return;
        const list = ta.value.split(/[,\n]/).map(s => s.trim()).filter(Boolean);
        const deduped = [...new Set(list)];
        memberConfig[key] = deduped.length ? deduped : ['Sans'];
    });
    // Régénérer les boutons d'édition de membre + persister IMMÉDIATEMENT (data.options).
    if (typeof setupQuickEditPanel === 'function') setupQuickEditPanel();
    if (typeof window.flushFormData === 'function') window.flushFormData();
    else if (typeof window.syncDomToStore === 'function') window.syncDomToStore();
    const modal = document.getElementById('uniteConfigModal') as HTMLDialogElement | null;
    if (modal && typeof modal.close === 'function') modal.close();
    document.body.classList.remove('modal-open');
    if (typeof window.toast === 'function') window.toast("Configuration de l'unité enregistrée", 'success');
}
window.openUniteConfigModal = openUniteConfigModal;
window.saveUniteConfig = saveUniteConfig;

// ============================================================
// PDF DU PATRACDVR — généré directement (pdf-lib), sans patracdvr.html
// ============================================================
/**
 * patrac.js:1098-1201. `safe()` (:1119) est une neutralisation WinAnsi
 * TRIVIALE (regex `[^\x00-\xFF]` → `?`), STRUCTURELLEMENT DIFFÉRENTE de
 * `sanitizeWinAnsi` (`@pctac/pdf-export.ts:89`, table de translittération
 * ciblée guillemets/tirets courbes) — vérifiée non identique, PAS de
 * factorisation unilatérale (SPEC §11.5), signalé au gate.
 */
async function generatePatracdvrPdf(): Promise<void> {
    // patrac.js:1099 — en ESM `PDFLib` n'est jamais `undefined` ; test de forme
    // sur la classe réellement utilisée, message inchangé (même précédent que
    // `@pctac/pdf-export.ts:177`).
    if (typeof PDFLib?.PDFDocument !== 'function') {
        if (typeof window.toast === 'function') window.toast('Bibliothèque PDF indisponible (réseau ?).', 'error');
        return;
    }
    try {
        // Collecte depuis le DOM (mêmes classes que patracdvr.html).
        const rowsData: { vehicle: string; members: Record<string, string | undefined>[] }[] = [];
        document.querySelectorAll<HTMLElement>('#patracdvr_container .patracdvr-vehicle-row').forEach(row => {
            const members = Array.from(row.querySelectorAll<HTMLElement>('.patracdvr-member-btn')).map(b => ({ ...b.dataset }));
            rowsData.push({ vehicle: row.dataset.vehicleName || 'Véhicule', members });
        });
        const unassigned = Array.from(document.querySelectorAll<HTMLElement>('#unassigned_members_container .patracdvr-member-btn')).map(b => ({ ...b.dataset }));
        if (unassigned.length) rowsData.push({ vehicle: 'NON ASSIGNÉS', members: unassigned });
        if (!rowsData.length) { if (typeof window.toast === 'function') window.toast('Aucun membre dans le PATRACDVR.', 'warning'); return; }

        const { PDFDocument, StandardFonts, rgb } = PDFLib;
        const pdf = await PDFDocument.create();
        const font = await pdf.embedFont(StandardFonts.Helvetica);
        const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
        // Helvetica standard = WinAnsi : on neutralise tout caractère non encodable.
        // patrac.js:1119 — `v` accepte toute valeur de dataset (`string | undefined`)
        // ou un littéral fixe (`'Véhicule'`, `'-'`…) : `unknown` en entrée, jamais
        // d'autre forme en pratique (mêmes appelants que l'original).
        const safe = (v: unknown): string => String(v == null ? '' : v).replace(/[^\x00-\xFF]/g, '?');

        const A4L: [number, number] = [841.89, 595.28];
        const M = 28;
        const cols: { t: string; k: string; w: number }[] = [
            { t: 'PAX', k: 'trigramme', w: 52 }, { t: 'Fct', k: 'fonction', w: 78 },
            { t: 'Cel.', k: 'cellule', w: 56 }, { t: 'Arme P.', k: 'principales', w: 66 },
            { t: 'Arme S.', k: 'secondaires', w: 56 }, { t: 'AFI', k: 'afis', w: 54 },
            { t: 'Gren.', k: 'grenades', w: 56 }, { t: 'Equip 1', k: 'equipement', w: 92 },
            { t: 'Equip 2', k: 'equipement2', w: 92 }, { t: 'Tenue', k: 'tenue', w: 56 },
            { t: 'GPB', k: 'gpb', w: 56 }, { t: 'DIR', k: 'dir', w: 42 },
        ];
        const tableW = cols.reduce((s, c) => s + c.w, 0);
        const cInk = rgb(0.1, 0.1, 0.12), cLine = rgb(0.62, 0.62, 0.66), cHead = rgb(0.85, 0.88, 0.95), cVeh = rgb(0.80, 0.86, 1);
        const fs = 8, vehH = 16, headH = 18;

        // patrac.js:1135 — `page`/`y` mutés par les fermetures `newPage`/
        // `drawHeaderRow` ci-dessous ; accesseur `pdfPage()` qui jette si
        // l'invariant « toujours appelé après newPage() » était violé (jamais
        // en pratique) — même précédent que `@pctac/pdf-export.ts` (`pdfPage()`).
        let page: PDFLib.PDFPage | null = null;
        let y = 0;
        const pdfPage = (): PDFLib.PDFPage => {
            if (page === null) {
                throw new Error('generatePatracdvrPdf: page PDF non initialisée (newPage() jamais appelé).');
            }
            return page;
        };
        const newPage = (): void => { page = pdf.addPage(A4L); y = A4L[1] - M; };
        const wrap = (txt: unknown, w: number): string[] => {
            const words = safe(txt).split(/\s+/).filter(Boolean); const lines: string[] = []; let cur = '';
            for (const wd of words) {
                const test = cur ? cur + ' ' + wd : wd;
                if (font.widthOfTextAtSize(test, fs) > w - 6 && cur) { lines.push(cur); cur = wd; } else cur = test;
            }
            if (cur) lines.push(cur);
            return lines.length ? lines : ['-'];
        };
        const drawHeaderRow = (): void => {
            let x = M;
            pdfPage().drawRectangle({ x: M, y: y - headH, width: tableW, height: headH, color: cHead });
            cols.forEach(c => {
                pdfPage().drawText(c.t, { x: x + 3, y: y - headH + 6, size: fs, font: bold, color: cInk });
                pdfPage().drawLine({ start: { x, y }, end: { x, y: y - headH }, color: cLine, thickness: 0.5 });
                x += c.w;
            });
            pdfPage().drawLine({ start: { x, y }, end: { x, y: y - headH }, color: cLine, thickness: 0.5 });
            pdfPage().drawLine({ start: { x: M, y: y - headH }, end: { x: M + tableW, y: y - headH }, color: cLine, thickness: 0.5 });
            y -= headH;
        };

        newPage();
        pdfPage().drawText('PATRACDVR', { x: M, y: y - 14, size: 20, font: bold, color: rgb(0.18, 0.42, 0.85) });
        pdfPage().drawText(new Date().toLocaleDateString('fr-FR'), { x: M + tableW - 70, y: y - 12, size: 10, font, color: cInk });
        y -= 34;
        drawHeaderRow();

        for (const grp of rowsData) {
            if (y - vehH - 6 < M) { newPage(); drawHeaderRow(); }
            pdfPage().drawRectangle({ x: M, y: y - vehH, width: tableW, height: vehH, color: cVeh });
            pdfPage().drawText('VEHICULE : ' + safe(grp.vehicle), { x: M + 4, y: y - vehH + 4, size: 9, font: bold, color: cInk });
            y -= vehH;
            for (const m of grp.members) {
                const cellLines = cols.map(c => { let v = m[c.k] || ''; if (v === 'Sans') v = '-'; return wrap(v, c.w); });
                const nLines = Math.max(1, ...cellLines.map(l => l.length));
                const h = Math.max(vehH, nLines * (fs + 2) + 4);
                if (y - h < M) { newPage(); drawHeaderRow(); }
                let x = M;
                cols.forEach((c, ci) => {
                    pdfPage().drawLine({ start: { x, y }, end: { x, y: y - h }, color: cLine, thickness: 0.5 });
                    (cellLines[ci] ?? []).forEach((ln, li) => pdfPage().drawText(ln, { x: x + 3, y: y - 11 - li * (fs + 2), size: fs, font, color: cInk }));
                    x += c.w;
                });
                pdfPage().drawLine({ start: { x, y }, end: { x, y: y - h }, color: cLine, thickness: 0.5 });
                pdfPage().drawLine({ start: { x: M, y: y - h }, end: { x: M + tableW, y: y - h }, color: cLine, thickness: 0.5 });
                y -= h;
            }
        }

        const bytes = await pdf.save();
        // patrac.js:1187 — `Uint8Array<ArrayBufferLike>` (pdf-lib) vs `BlobPart`
        // (lib.dom.d.ts) : cast, même précédent que `@pctac/pdf-export.ts:637`.
        const blob = new Blob([bytes as BlobPart], { type: 'application/pdf' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `PATRACDVR_${new Date().toISOString().slice(0, 10)}.pdf`;
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(a.href), 2000);
        if (typeof window.toast === 'function') window.toast('PDF PATRACDVR généré', 'success');
    } catch (e) {
        console.error('[PATRACDVR PDF] échec:', e);
        // patrac.js:1197 — `e` est `unknown` en TS strict (`useUnknownInCatchVariables`),
        // même précédent que `@pctac/main.ts:582,614`.
        const message = e instanceof Error ? e.message : String(e);
        if (typeof window.toast === 'function') window.toast('Erreur de génération PDF : ' + message, 'error');
        else toast('Erreur PDF PATRACDVR : ' + message, { kind: 'error' });
    }
}
window.generatePatracdvrPdf = generatePatracdvrPdf;
