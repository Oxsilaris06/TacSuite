/**
 * articulation.ts — MOICP / ZMSPCP / Effraction (P3.CONV, paquet `oi-articulation`).
 * ===========================================================================
 *
 * Port TypeScript VERBATIM, fonction par fonction dans l'ordre du fichier, de
 * `modules/articulation.js` (GStart-main, lecture seule, 1011 LOC intégral) :
 * `addMoicp` (:29), `addZmspcp` (:127), `_autoPopulateFromCellule` (:227),
 * `_autoPopulateEffraction` (:253), `_addArticulationMemberChip` (:281),
 * `_setupArticulationDropZone` (:323), `refreshRameVL` (:385),
 * `_enableTouchSort` (:438), `_setupRameDropZone` (:451),
 * `_updateRamePositions` (:479), `refreshColonneProgression` (:493),
 * `refreshOrdrePenetration` (:529), `_getIndiaMembersOrdered` (:569),
 * `_createOrderChip` (:588), `_setupOrderDropZone` (:620),
 * `_updateOrderPositions` (:648), `_getArticulationMembers` (:660),
 * `_syncArticulationBlocks` (:690), `refreshArticulationFromPatracdvr` (:731),
 * réactivité `Store.subscribe` (:755), `addEffraction` (:779),
 * `addEffractionHypothesis` (:911), `openEffractionToolsModal` (:960),
 * `saveEffractionTools` (:985). Cf. `docs/SPEC-OI-CONVERSION.md` §2.2/§11.3,
 * `PAQUETS-OI.json` (`oi-articulation`).
 *
 * PIÈGE VÉRIFIÉ ET TRANCHÉ (§11.3) — `addEffractionHypothesis` : il n'existe
 * AUCUNE `function addEffractionHypothesis` dans l'original. Sa SEULE
 * définition est l'expression de fonction assignée à
 * `window.addEffractionHypothesis` en `:911` ; la ligne `:1006`
 * (`window.addEffractionHypothesis = addEffractionHypothesis;`) est une
 * AUTO-AFFECTATION SANS EFFET (l'identifiant nu résout sur la propriété
 * `window` déjà posée). Les deux blocs de pose globale de l'original (`:21-27`
 * et `:1003-1009`) portent sur des déclarations de fonction HOISTÉES ⇒
 * valeurs finales identiques ⇒ ce port ne définit chaque fonction QU'UNE FOIS
 * et ne pose les 10 globaux QU'UNE FOIS, en fin de module.
 *
 * INVARIANTS PRÉSERVÉS (SPEC §11.3, vérifiés par test, cf. fichier de test) :
 *   - `refreshArticulationFromPatracdvr` / `_syncArticulationBlocks` (:690)
 *     sont INCRÉMENTAUX et NON DESTRUCTIFS — jamais un « reset puis recréer ».
 *   - Auto-peuplement depuis le PATRACDVR (India→MOICP, AO→ZMSPCP,
 *     'effrac'→Effraction) UNIQUEMENT à la création MANUELLE (`data` absent) ;
 *     JAMAIS en mode restauration (`data` fourni, y compris `members: []`).
 *   - Ce module lit le DOM du PATRACDVR DIRECTEMENT
 *     (`.patracdvr-member-btn`, `#patracdvr_container .patracdvr-vehicle-row`)
 *     et N'IMPORTE PAS `patrac.ts` — découplage volontaire à préserver.
 *   - `sortable()` (:439, :442, :476, :645) vient de `@shared/ui-platform.js`
 *     (import direct, PAS de `drag-drop.ts`) — mécanisme de drag TACTILE
 *     distinct du drag&drop HTML5 natif porté verbatim juste au-dessus.
 *   - RÈGLE D'OR (SPEC §2.2) : `syncDomToStore` (version débouncée posée par
 *     `formulaires.ts`) et `isFormLoading` sont résolus via `window`, avec
 *     les mêmes gardes que l'original (aucune garde quand l'original n'en a
 *     pas). `handleFileChange` n'apparaît que dans des attributs `onchange`
 *     VERBATIM de gabarits `innerHTML` (chaînes, jamais évaluées par TS) —
 *     aucune référence directe nécessaire dans ce fichier.
 *
 * Adaptations de TYPAGE PUR (aucune restructuration de logique, règle commune
 * §3/§9 ; même patron que `carto/pins.ts`, `carto/map-core.ts`, déjà porté) :
 *   - `document.getElementById`/`querySelector` renvoient `T | null` en TS
 *     strict : gardes `if (!x) return;` ajoutées partout où l'original accède
 *     sans vérifier (conteneurs statiques, jamais absents en pratique).
 *   - `HTMLElement.dataset.*` est `string | undefined` : replis `?? ''`
 *     ajoutés aux points de lecture (jamais empruntés en pratique, ces
 *     attributs sont toujours posés par les générateurs `innerHTML` du même
 *     fichier ou par `patrac.ts`).
 *   - `DragEvent.dataTransfer` est `DataTransfer | null` : garde
 *     `if (e.dataTransfer)` (accès multiples) ou cast `as DataTransfer` (accès
 *     unique) — même précédent que `@pctac/ui.ts:317-319,704`.
 *   - `Array.prototype.reduce` pour le calcul de position de drop
 *     (`afterElement`) : generic explicite `reduce<{ offset: number; element:
 *     HTMLElement | undefined }>`, même précédent que `@pctac/ui.ts:354-362`
 *     (`getDragAfterElement`).
 *   - `HTMLElement.textContent` attend `string` : `String(i + 1)` remplace
 *     l'affectation numérique implicite de l'original (JS coerçait
 *     silencieusement, TS ne le permet pas).
 *   - `articulation.js:366` — `const trigramme = e.dataTransfer.getData(...)`
 *     n'est JAMAIS utilisé dans l'original (mort-code verbatim) ;
 *     `noUnusedLocals` interdit de lier une valeur inexploitée → l'appel est
 *     conservé en expression seule (même effet exact : aucun, `getData` est
 *     une lecture pure), liaison omise (même principe que la liaison de
 *     `catch` omise dans `init.ts`, cf. `init.js:369,386`).
 *   - `refreshRameVL`/`refreshColonneProgression`/`refreshOrdrePenetration` :
 *     le contrat `OiArticulationGlobals` (figé) type `savedData`/`savedOrder`
 *     en `readonly string[] | undefined`, SANS `null` ; l'original passe
 *     `null` depuis `refreshArticulationFromPatracdvr:737,741,745` —
 *     `undefined` est substitué aux 3 sites d'appel (même comportement :
 *     `if (savedX && …)` traite les deux identiquement).
 *   - `sortable` (`@shared/ui-platform.js`) est importé directement (pas de
 *     `window.UIPlatform`) : la garde de présence `!window.UIPlatform ||
 *     typeof UIPlatform.sortable !== 'function'` de l'original (:439) n'a
 *     plus lieu d'être (import ESM statique, toujours résolu) — voir
 *     `_enableTouchSort` ci-dessous.
 *
 * Source : `/home/nico/Bureau/Web/GStart-main/modules/articulation.js`
 * (lecture seule).
 */

import { DEFAULTS, Store, dbManager } from '@oi/init.js';
import { sortable } from '@shared/ui-platform.js';
import type {
    OiEffractionBlock,
    OiEffractionHypothesis,
    OiMoicpBlock,
    OiPatracMember,
    OiZmspcpBlock,
} from '@shared/types/contracts.js';

/** Type de bloc d'articulation (3ᵉ argument des helpers internes de l'original). */
type OiArticulationBlockKind = 'moicp' | 'zmspcp' | 'effraction';

// ============================================================
// Module: articulation.js
// Gestion dynamique des blocs MOICP, ZMSPCP,
// Ordre de la rame VL, Colonne de progression, Pénétration
// ============================================================

/**
 * Crée un bloc MOICP dynamique.
 * Auto-peuplé avec les membres India du PATRACDVR.
 * @param data - Données de restauration (optionnel)
 */
// articulation.js:15-120
export function addMoicp(data?: Partial<OiMoicpBlock> | null): void {
    const container = document.getElementById('moicp_container');
    if (!container) return;
    const blockId = data?.id || `moicp_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
    const blockIndex = container.querySelectorAll('.moicp-block').length + 1;

    const div = document.createElement('div');
    const stateClass = data ? '' : 'open'; // S'ouvre si ajouté manuellement
    div.className = `articulation-block moicp-block collapsible-container ${stateClass}`;
    div.dataset.blockId = blockId;

    const defaultCat = data?.cat || DEFAULTS.cat.moicp;
    const defaultMission = data?.mission || DEFAULTS.missions.moicp;

    div.innerHTML = `
        <div class="collapsible-header" style="background: color-mix(in srgb, var(--accent-blue) 12%, transparent); color: var(--accent-blue); border-left: 4px solid var(--accent-blue); border-radius: var(--radius-md) var(--radius-md) 0 0;">
            <h3 class="block-title" style="margin: 0; display: flex; align-items: center; gap: 10px;">
                <span class="material-symbols-outlined">shield</span>
                <input type="text" class="block-title-input" value="${data?.title || 'Inter ' + blockIndex}"
                    style="background: transparent; border: none; border-bottom: 1px solid rgba(59, 130, 246, 0.3); color: var(--accent-blue); font-size: 1.1em; font-weight: bold; padding: 2px 5px; width: 220px;"
                    onclick="event.stopPropagation()" oninput="syncDomToStore()">
            </h3>
            <div style="display: flex; align-items: center; gap: 8px;">
                <button type="button" class="remove-btn" onclick="event.stopPropagation(); removeBlockEl(this, '.moicp-block');"
                    style="min-height: 36px; height: 36px; width: 36px; padding: 0; border-radius: 50%;" title="Supprimer ce MOICP" aria-label="Supprimer ce MOICP"><span class="material-symbols-outlined">close</span></button>
                <span class="material-symbols-outlined">expand_more</span>
            </div>
        </div>
        <div class="collapsible-content">
            <label>Mission (M):</label>
            <textarea class="moicp-mission" rows="3" oninput="syncDomToStore()">${defaultMission}</textarea>

            <label>Objectif (O):</label>
            <input type="text" class="moicp-objectif" value="${data?.objectif || ''}" oninput="syncDomToStore()">

            <label>Itinéraire (I):</label>
            <textarea class="moicp-itineraire" rows="3" oninput="syncDomToStore()">${data?.itineraire || ''}</textarea>

            <label>Points Particuliers (P):</label>
            <textarea class="moicp-pp" rows="3" oninput="syncDomToStore()">${data?.points_particuliers || ''}</textarea>

            <label>Conduite à Tenir (C):</label>
            <textarea class="moicp-cat" rows="5" oninput="syncDomToStore()">${defaultCat}</textarea>

            <label>Place du chef inter :</label>
            <input type="text" class="moicp-place-chef" value="${data?.place_chef || ''}" oninput="syncDomToStore()">

            <h4 style="margin-top: 15px; color: var(--accent-blue);">
                <span class="material-symbols-outlined" style="vertical-align: middle;">group</span> Composition (ordre d'engagement)
            </h4>
            <p style="font-size: 0.85em; color: var(--text-muted); margin-bottom: 8px;">
                <span class="material-symbols-outlined" style="font-size: 1em; vertical-align: middle;">info</span>
                Glissez pour réordonner. Cliquez sur la croix pour retirer un membre de ce bloc.
            </p>
            <div class="articulation-members-zone moicp-members"
                style="min-height: 50px; border: 2px dashed var(--border-color); border-radius: var(--radius-md); padding: 10px; display: flex; flex-wrap: wrap; gap: 8px;">
            </div>

            <!-- Photos Itinéraire -->
            <h4 style="margin-top: 15px; color: var(--accent-blue);">
                <span class="material-symbols-outlined" style="vertical-align: middle;">route</span> Photos Itinéraire
            </h4>
            <div style="display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 10px;">
                <button type="button" class="add-btn" style="flex:1; justify-content: center; min-height: 44px;" onclick="document.getElementById('input_itin_ext_${blockId}').click()"><span class="material-symbols-outlined" aria-hidden="true">photo_camera</span> Extérieur</button>
                <input type="file" id="input_itin_ext_${blockId}" class="sr-only-input" accept="image/*" multiple onchange="handleFileChange(this, 'photo_itin_ext_${blockId}', false)">

                <button type="button" class="add-btn" style="flex:1; justify-content: center; min-height: 44px;" onclick="document.getElementById('input_itin_int_${blockId}').click()"><span class="material-symbols-outlined" aria-hidden="true">photo_camera</span> Intérieur</button>
                <input type="file" id="input_itin_int_${blockId}" class="sr-only-input" accept="image/*" multiple onchange="handleFileChange(this, 'photo_itin_int_${blockId}', false)">
            </div>
            <div id="photo_itin_ext_${blockId}" class="image-preview-container photo-display-area" style="margin-bottom:10px;"></div>
            <div id="photo_itin_int_${blockId}" class="image-preview-container photo-display-area"></div>
        </div>
    `;

    container.appendChild(div);

    // Peupler avec les membres
    const membersZone = div.querySelector<HTMLElement>('.moicp-members');
    if (!membersZone) return;
    _setupArticulationDropZone(membersZone);

    if (data && Array.isArray(data.members)) {
        // Restauration fidèle : on respecte EXACTEMENT les membres sauvegardés
        // (y compris une liste vide → bloc volontairement vidé, pas de re-peuplement).
        data.members.forEach(trigramme => {
            _addArticulationMemberChip(membersZone, trigramme, 'moicp');
        });
    } else {
        // Création manuelle uniquement : auto-peuplement depuis les India du PATRACDVR.
        _autoPopulateFromCellule(membersZone, 'india', 'moicp');
    }

    if (!data) window.syncDomToStore();
}

/**
 * Crée un bloc ZMSPCP dynamique.
 * Auto-peuplé avec les membres AO du PATRACDVR.
 * @param data - Données de restauration (optionnel)
 */
// articulation.js:122-215
export function addZmspcp(data?: Partial<OiZmspcpBlock> | null): void {
    const container = document.getElementById('zmspcp_container');
    if (!container) return;
    const blockId = data?.id || `zmspcp_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
    const blockIndex = container.querySelectorAll('.zmspcp-block').length + 1;

    const div = document.createElement('div');
    const stateClass = data ? '' : 'open'; // S'ouvre si ajouté manuellement
    div.className = `articulation-block zmspcp-block collapsible-container ${stateClass}`;
    div.dataset.blockId = blockId;

    const defaultCat = data?.cat || DEFAULTS.cat.zmspcp;
    const defaultMission = data?.mission || DEFAULTS.missions.zmspcp;

    div.innerHTML = `
        <div class="collapsible-header" style="background: color-mix(in srgb, var(--moicp-zmspcp-purple) 12%, transparent); color: var(--moicp-zmspcp-purple, #8e44ad); border-left: 4px solid var(--moicp-zmspcp-purple, #8e44ad); border-radius: var(--radius-md) var(--radius-md) 0 0;">
            <h3 class="block-title" style="margin: 0; display: flex; align-items: center; gap: 10px;">
                <span class="material-symbols-outlined">visibility</span>
                <input type="text" class="block-title-input" value="${data?.title || 'Appui Observation ' + blockIndex}"
                    style="background: transparent; border: none; border-bottom: 1px solid rgba(142, 68, 173, 0.3); color: var(--moicp-zmspcp-purple, #8e44ad); font-size: 1.1em; font-weight: bold; padding: 2px 5px; width: 220px;"
                    onclick="event.stopPropagation()" oninput="syncDomToStore()">
            </h3>
            <div style="display: flex; align-items: center; gap: 8px;">
                <button type="button" class="remove-btn" onclick="event.stopPropagation(); removeBlockEl(this, '.zmspcp-block');"
                    style="min-height: 36px; height: 36px; width: 36px; padding: 0; border-radius: 50%;" title="Supprimer ce ZMSPCP" aria-label="Supprimer ce ZMSPCP"><span class="material-symbols-outlined">close</span></button>
                <span class="material-symbols-outlined">expand_more</span>
            </div>
        </div>
        <div class="collapsible-content">
            <label>Zone d'installation (Z):</label>
            <textarea class="zmspcp-zone" rows="3" oninput="syncDomToStore()">${data?.zone || ''}</textarea>

            <label>Mission (M):</label>
            <textarea class="zmspcp-mission" rows="3" oninput="syncDomToStore()">${defaultMission}</textarea>

            <label>Secteur de surveillance (S):</label>
            <textarea class="zmspcp-secteur" rows="3" oninput="syncDomToStore()">${data?.secteur || ''}</textarea>

            <label>Points Particuliers (P):</label>
            <textarea class="zmspcp-pp" rows="3" oninput="syncDomToStore()">${data?.points_particuliers || ''}</textarea>

            <label>Conduite à Tenir (C):</label>
            <textarea class="zmspcp-cat" rows="5" oninput="syncDomToStore()">${defaultCat}</textarea>

            <label>Place du chef AO :</label>
            <input type="text" class="zmspcp-place-chef" value="${data?.place_chef || ''}" oninput="syncDomToStore()">

            <h4 style="margin-top: 15px; color: var(--moicp-zmspcp-purple, #8e44ad);">
                <span class="material-symbols-outlined" style="vertical-align: middle;">group</span> Composition (ordre d'engagement)
            </h4>
            <p style="font-size: 0.85em; color: var(--text-muted); margin-bottom: 8px;">
                <span class="material-symbols-outlined" style="font-size: 1em; vertical-align: middle;">info</span>
                Glissez pour réordonner. Cliquez sur la croix pour retirer un membre de ce bloc.
            </p>
            <div class="articulation-members-zone zmspcp-members"
                style="min-height: 50px; border: 2px dashed var(--border-color); border-radius: var(--radius-md); padding: 10px; display: flex; flex-wrap: wrap; gap: 8px;">
            </div>

            <!-- Photos Terrain -->
            <h4 style="margin-top: 15px; color: var(--moicp-zmspcp-purple, #8e44ad);">
                <span class="material-symbols-outlined" style="vertical-align: middle;">terrain</span> Photos Terrain / AO
            </h4>
            <div style="display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 10px;">
                <button type="button" class="add-btn" style="flex:1; justify-content: center;" onclick="document.getElementById('input_bapteme_${blockId}').click()"><span class="material-symbols-outlined" aria-hidden="true">photo_camera</span> Baptême Terrain</button>
                <input type="file" id="input_bapteme_${blockId}" hidden accept="image/*" multiple onchange="handleFileChange(this, 'photo_bapteme_${blockId}', false)">

                <button type="button" class="add-btn" style="flex:1; justify-content: center;" onclick="document.getElementById('input_empl_ao_${blockId}').click()"><span class="material-symbols-outlined" aria-hidden="true">photo_camera</span> Emplacement AO</button>
                <input type="file" id="input_empl_ao_${blockId}" hidden accept="image/*" multiple onchange="handleFileChange(this, 'photo_empl_ao_${blockId}', false)">
            </div>
            <div id="photo_bapteme_${blockId}" class="image-preview-container photo-display-area" style="margin-bottom:10px;"></div>
            <div id="photo_empl_ao_${blockId}" class="image-preview-container photo-display-area"></div>
        </div>
    `;

    container.appendChild(div);

    const membersZone = div.querySelector<HTMLElement>('.zmspcp-members');
    if (!membersZone) return;
    _setupArticulationDropZone(membersZone);

    if (data && Array.isArray(data.members)) {
        // Restauration fidèle (liste vide respectée).
        data.members.forEach(trigramme => {
            _addArticulationMemberChip(membersZone, trigramme, 'zmspcp');
        });
    } else {
        _autoPopulateFromCellule(membersZone, 'ao', 'zmspcp');
    }

    if (!data) window.syncDomToStore();
}

// ============================================================
// Fonctions internes pour les blocs MOICP/ZMSPCP
// ============================================================

/**
 * Auto-peuple une zone de membres depuis les cellules PATRACDVR.
 * @param zone - La drop zone
 * @param cellulePrefix - 'india' ou 'ao'
 * @param type - 'moicp' ou 'zmspcp'
 */
// articulation.js:221-251
function _autoPopulateFromCellule(zone: HTMLElement, cellulePrefix: string, type: OiArticulationBlockKind): void {
    if (!zone || !Store.state.formData.patracdvr_rows) return;
    zone.innerHTML = '';

    const allMembers: OiPatracMember[] = [];
    // Récupérer depuis les lignes (véhicules)
    Store.state.formData.patracdvr_rows.forEach(row => {
        row.members.forEach(m => allMembers.push(m));
    });
    // Récupérer depuis les non-assignés
    if (Store.state.formData.patracdvr_unassigned) {
        Store.state.formData.patracdvr_unassigned.forEach(m => allMembers.push(m));
    }

    const sorted = allMembers
        .filter(m => {
            const cellule = (m.cellule || '').toLowerCase();
            return cellule.startsWith(cellulePrefix) && cellule !== 'sans';
        })
        .sort((a, b) => (a.cellule || '').localeCompare(b.cellule || '', undefined, { numeric: true, sensitivity: 'base' }));

    sorted.forEach(m => {
        _addArticulationMemberChip(zone, m.trigramme, type);
    });
}

// articulation.js:253-276
function _autoPopulateEffraction(zone: HTMLElement): void {
    if (!zone || !Store.state.formData.patracdvr_rows) return;
    zone.innerHTML = '';

    const allMembers: OiPatracMember[] = [];
    Store.state.formData.patracdvr_rows.forEach(row => {
        row.members.forEach(m => allMembers.push(m));
    });
    if (Store.state.formData.patracdvr_unassigned) {
        Store.state.formData.patracdvr_unassigned.forEach(m => allMembers.push(m));
    }

    const sorted = allMembers
        .filter(m => {
            const cellule = (m.cellule || '').toLowerCase();
            const fonction = (m.fonction || '').toLowerCase();
            return (cellule.includes('effrac') || fonction.includes('effrac')) && cellule !== 'sans';
        })
        .sort((a, b) => (a.cellule || '').localeCompare(b.cellule || '', undefined, { numeric: true, sensitivity: 'base' }));

    sorted.forEach(m => {
        _addArticulationMemberChip(zone, m.trigramme, 'effraction');
    });
}

/**
 * Ajoute un chip de membre dans une zone d'articulation.
 */
// articulation.js:278-318
function _addArticulationMemberChip(zone: HTMLElement, trigramme: string, type: OiArticulationBlockKind): void {
    if (!trigramme || trigramme === 'N/A') return;

    const chip = document.createElement('div');
    chip.className = `articulation-member ${type}-member`;
    chip.dataset.trigramme = trigramme;
    chip.draggable = true;

    // Récupérer infos depuis le PATRACDVR
    const patracdvrBtn = document.querySelector<HTMLElement>(`.patracdvr-member-btn[data-trigramme="${trigramme}"]`);
    const cellule = patracdvrBtn ? (patracdvrBtn.dataset.cellule || '') : '';
    const fonction = patracdvrBtn ? (patracdvrBtn.dataset.fonction || '') : '';

    const cellDisplay = cellule !== 'Sans' ? cellule : '';
    const funcDisplay = fonction !== 'Sans' ? fonction : '';
    const subtitle = [cellDisplay, funcDisplay].filter(Boolean).join(' / ');

    chip.innerHTML = `
        <span class="art-member-trigramme">${trigramme}</span>
        ${subtitle ? `<span class="art-member-detail">${subtitle}</span>` : ''}
        <button type="button" class="art-member-remove" onclick="this.parentElement.remove(); syncDomToStore();" title="Retirer" aria-label="Retirer ce membre"><span class="material-symbols-outlined">close</span></button>
    `;

    // Drag events pour réordonner
    chip.addEventListener('dragstart', (e) => {
        if (e.dataTransfer) {
            e.dataTransfer.setData('text/plain', trigramme);
            e.dataTransfer.effectAllowed = 'move';
        }
        chip.classList.add('dragging');
        setTimeout(() => chip.style.opacity = '0.4', 0);
    });
    chip.addEventListener('dragend', () => {
        chip.classList.remove('dragging');
        chip.style.opacity = '1';
        window.syncDomToStore();
    });

    zone.appendChild(chip);
}

/**
 * Configure une zone de drop pour les membres d'articulation.
 */
// articulation.js:320-376
function _setupArticulationDropZone(zone: HTMLElement): void {
    zone.addEventListener('dragover', (e) => {
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
        zone.style.borderColor = 'var(--accent-blue)';
        zone.style.background = 'rgba(91, 155, 213, 0.05)';

        const dragging = zone.querySelector<HTMLElement>('.articulation-member.dragging');
        if (!dragging) return;

        const siblings = [...zone.querySelectorAll<HTMLElement>('.articulation-member:not(.dragging)')];
        const afterElement = siblings.reduce<{ offset: number; element: HTMLElement | undefined }>((closest, child) => {
            const box = child.getBoundingClientRect();
            const offset = e.clientX - box.left - box.width / 2;
            if (offset < 0 && offset > closest.offset) {
                return { offset, element: child };
            }
            return closest;
        }, { offset: Number.NEGATIVE_INFINITY, element: undefined }).element;

        if (afterElement == null) {
            zone.appendChild(dragging);
        } else {
            zone.insertBefore(dragging, afterElement);
        }
    });

    zone.addEventListener('dragleave', () => {
        zone.style.borderColor = 'var(--border-color)';
        zone.style.background = '';
    });

    // T6 — réordonnancement tactile intra-zone (horizontal). Le transfert entre
    // zones reste géré par le drag&drop HTML5 (souris) ; le tactile réordonne au sein
    // d'une zone (l'affectation des zones est principalement auto-peuplée).
    _enableTouchSort(zone, '.articulation-member', () => { window.syncDomToStore(); }, 'x');

    zone.addEventListener('drop', (e) => {
        e.preventDefault();
        zone.style.borderColor = 'var(--border-color)';
        zone.style.background = '';

        // Si c'est un drop inter-bloc (le chip vient d'un autre bloc du même type)
        // articulation.js:366 — la valeur lue n'est jamais exploitée dans l'original
        // (mort-code verbatim) ; appel conservé (même effet : aucun, lecture pure),
        // liaison omise (noUnusedLocals).
        e.dataTransfer?.getData('text/plain');
        const dragging = document.querySelector<HTMLElement>('.articulation-member.dragging');

        if (dragging && dragging.parentElement !== zone) {
            // Déplacer le chip vers cette zone
            zone.appendChild(dragging);
        }

        window.syncDomToStore();
    });
}

// ============================================================
// Ordre de la rame VL
// ============================================================

/**
 * Rafraîchit les boutons VL dans les slots de la rame.
 */
// articulation.js:378-434
export function refreshRameVL(savedData?: readonly string[]): void {
    const container = document.getElementById('rame_vl_container');
    if (!container) return;
    container.innerHTML = '';

    // Récupérer tous les VL du PATRACDVR
    // Adaptation de TYPAGE PUR (identique à carto/pins.ts::_getPatracdvrVehicles) :
    // `.filter(Boolean)` original → prédicat de type explicite, même filtrage.
    const vehicleNames: string[] = Array.from(
        document.querySelectorAll<HTMLElement>('#patracdvr_container .patracdvr-vehicle-row'),
    )
        .map(row => row.dataset.vehicleName)
        .filter((name): name is string => Boolean(name));

    if (vehicleNames.length === 0) {
        container.innerHTML = '<p style="color: var(--text-muted); font-style: italic;">Aucun VL dans le PATRACDVR.</p>';
        return;
    }

    // Si on a des données sauvegardées, les utiliser pour l'ordre
    let orderedNames: string[] = vehicleNames;
    if (savedData && savedData.length > 0) {
        // Combiner saved + nouveaux VL pas encore dans la sauvegarde
        const savedSet = new Set(savedData);
        const extra = vehicleNames.filter(n => !savedSet.has(n));
        orderedNames = savedData.filter(n => vehicleNames.includes(n)).concat(extra);
    }

    orderedNames.forEach((name, index) => {
        const chip = document.createElement('div');
        chip.className = 'rame-vl-chip';
        chip.dataset.vehicleName = name;
        chip.draggable = true;
        chip.innerHTML = `
            <span class="rame-vl-position">${index + 1}</span>
            <span class="rame-vl-name">${name}</span>
        `;

        chip.addEventListener('dragstart', (e) => {
            if (e.dataTransfer) e.dataTransfer.setData('text/plain', name);
            chip.classList.add('dragging');
            setTimeout(() => chip.style.opacity = '0.4', 0);
        });
        chip.addEventListener('dragend', () => {
            chip.classList.remove('dragging');
            chip.style.opacity = '1';
            _updateRamePositions();
            window.syncDomToStore();
        });

        container.appendChild(chip);
    });

    _setupRameDropZone(container);
}

// T6 — active le réordonnancement TACTILE d'une liste (Pointer Events), en
// complément du drag&drop HTML5 (souris desktop) qui reste inchangé. Idempotent.
// articulation.js:436-449 — l'original teste `!window.UIPlatform || typeof
// UIPlatform.sortable !== 'function'` (résolution globale tardive) avant l'appel ;
// ici `sortable` est importé directement depuis '@shared/ui-platform.js' (déjà
// porté ; RÈGLE D'OR §2.2 — seuls les symboles Oi*Globals passent par `window`,
// @shared est toujours résolu par import statique, même précédent que
// `@pctac/ui.ts:70` `import { esc } from '@shared/ui-platform.js'`), donc
// toujours disponible : la garde de présence originale n'a plus lieu d'être.
function _enableTouchSort(
    container: HTMLElement | null,
    itemSelector: string,
    onReorder: () => void,
    axis?: 'x' | 'y',
): void {
    if (!container || container.dataset.touchSortInit === 'true') return;
    container.dataset.touchSortInit = 'true';
    sortable(container, {
        itemSelector,
        pointerTypes: ['touch'],   // souris -> on laisse le DnD HTML5 natif
        longPress: 180,            // appui maintenu court avant de saisir (laisse passer le scroll)
        axis: axis || 'y',
        onReorder,
    });
}

// articulation.js:451-477
function _setupRameDropZone(container: HTMLElement): void {
    if (container.dataset.dropZoneInit === 'true') return;
    container.dataset.dropZoneInit = 'true';
    container.addEventListener('dragover', (e) => {
        e.preventDefault();
        const dragging = container.querySelector<HTMLElement>('.rame-vl-chip.dragging');
        if (!dragging) return;

        const siblings = [...container.querySelectorAll<HTMLElement>('.rame-vl-chip:not(.dragging)')];
        const afterElement = siblings.reduce<{ offset: number; element: HTMLElement | undefined }>((closest, child) => {
            const box = child.getBoundingClientRect();
            const offset = e.clientY - box.top - box.height / 2;
            if (offset < 0 && offset > closest.offset) {
                return { offset, element: child };
            }
            return closest;
        }, { offset: Number.NEGATIVE_INFINITY, element: undefined }).element;

        if (afterElement == null) {
            container.appendChild(dragging);
        } else {
            container.insertBefore(dragging, afterElement);
        }
    });
    // T6 — réordonnancement tactile (le DnD HTML5 ci-dessus ne marche qu'à la souris).
    _enableTouchSort(container, '.rame-vl-chip', () => { _updateRamePositions(); window.syncDomToStore(); });
}

// articulation.js:479-484
function _updateRamePositions(): void {
    const chips = document.querySelectorAll<HTMLElement>('#rame_vl_container .rame-vl-chip');
    chips.forEach((chip, i) => {
        const posEl = chip.querySelector<HTMLElement>('.rame-vl-position');
        if (posEl) posEl.textContent = String(i + 1);
    });
}

// ============================================================
// Ordre de la colonne de progression
// ============================================================

/**
 * Rafraîchit l'ordre de la colonne de progression (membres India).
 */
// articulation.js:490-520
export function refreshColonneProgression(savedOrder?: readonly string[]): void {
    const container = document.getElementById('colonne_progression_container');
    if (!container) return;
    container.innerHTML = '';

    // Récupérer tous les membres India
    const indiaMembers = _getIndiaMembersOrdered();

    if (indiaMembers.length === 0) {
        container.innerHTML = '<p style="color: var(--text-muted); font-style: italic;">Aucun membre India dans le PATRACDVR.</p>';
        return;
    }

    let ordered: string[] = indiaMembers.map(m => m.trigramme);
    if (savedOrder && savedOrder.length > 0) {
        const currentSet = new Set(ordered);
        const extra = ordered.filter(t => !savedOrder.includes(t));
        ordered = savedOrder.filter(t => currentSet.has(t)).concat(extra);
    }

    ordered.forEach((trigramme, index) => {
        const memberInfo = indiaMembers.find(m => m.trigramme === trigramme);
        const chip = _createOrderChip(trigramme, memberInfo, index, 'colonne');
        container.appendChild(chip);
    });

    _setupOrderDropZone(container, 'colonne');
}

// ============================================================
// Ordre de pénétration
// ============================================================

/**
 * Rafraîchit l'ordre de pénétration (par défaut = ordre colonne).
 */
// articulation.js:522-563
export function refreshOrdrePenetration(savedOrder?: readonly string[]): void {
    const container = document.getElementById('ordre_penetration_container');
    if (!container) return;
    container.innerHTML = '';

    const indiaMembers = _getIndiaMembersOrdered();

    if (indiaMembers.length === 0) {
        container.innerHTML = '<p style="color: var(--text-muted); font-style: italic;">Aucun membre India dans le PATRACDVR.</p>';
        return;
    }

    let ordered: string[];
    if (savedOrder && savedOrder.length > 0) {
        const currentSet = new Set(indiaMembers.map(m => m.trigramme));
        const extra = indiaMembers.map(m => m.trigramme).filter(t => !savedOrder.includes(t));
        ordered = savedOrder.filter(t => currentSet.has(t)).concat(extra);
    } else {
        // Par défaut = ordre colonne
        const colonneChips = document.querySelectorAll<HTMLElement>('#colonne_progression_container .order-chip');
        if (colonneChips.length > 0) {
            // dataset.trigramme est `string | undefined` en TS strict ; toujours posé
            // par _createOrderChip ci-dessous (adaptation de typage pur).
            ordered = Array.from(colonneChips).map(c => c.dataset.trigramme ?? '');
        } else {
            ordered = indiaMembers.map(m => m.trigramme);
        }
    }

    ordered.forEach((trigramme, index) => {
        const memberInfo = indiaMembers.find(m => m.trigramme === trigramme);
        const chip = _createOrderChip(trigramme, memberInfo, index, 'penetration');
        container.appendChild(chip);
    });

    _setupOrderDropZone(container, 'penetration');
}

// ============================================================
// Helpers pour les ordres (colonne / pénétration)
// ============================================================

/** Membre India lu depuis un `.patracdvr-member-btn` (dataset), articulation.js:581-585. */
interface OiArticulationOrderedMember {
    trigramme: string;
    cellule: string;
    fonction: string;
}

// articulation.js:565-586
function _getIndiaMembersOrdered(): OiArticulationOrderedMember[] {
    const allMembers = document.querySelectorAll<HTMLElement>('.patracdvr-member-btn');
    return Array.from(allMembers)
        .filter(btn => {
            const cellule = (btn.dataset.cellule || '').toLowerCase();
            return cellule.startsWith('india') && cellule !== 'sans';
        })
        .sort((a, b) => {
            const cellA = a.dataset.cellule || '';
            const cellB = b.dataset.cellule || '';
            return cellA.localeCompare(cellB, undefined, { numeric: true, sensitivity: 'base' });
        })
        .map(btn => ({
            // dataset.* est `string | undefined` en TS strict ; toujours posé par
            // patrac.ts pour ces boutons (adaptation de typage pur, cf. carto/pins.ts).
            trigramme: btn.dataset.trigramme ?? '',
            cellule: btn.dataset.cellule ?? '',
            fonction: btn.dataset.fonction ?? '',
        }));
}

// articulation.js:588-618
function _createOrderChip(
    trigramme: string,
    memberInfo: OiArticulationOrderedMember | undefined,
    index: number,
    type: 'colonne' | 'penetration',
): HTMLElement {
    const chip = document.createElement('div');
    chip.className = `order-chip ${type}-chip`;
    chip.dataset.trigramme = trigramme;
    chip.draggable = true;

    const cellule = memberInfo?.cellule || '';
    const fonction = memberInfo?.fonction || '';
    const cellDisplay = cellule !== 'Sans' ? cellule : '';
    const funcDisplay = fonction !== 'Sans' ? fonction : '';

    chip.innerHTML = `
        <span class="order-position">${index + 1}</span>
        <span class="order-trigramme">${trigramme}</span>
        <span class="order-detail">${[cellDisplay, funcDisplay].filter(Boolean).join(' / ')}</span>
    `;

    chip.addEventListener('dragstart', (e) => {
        if (e.dataTransfer) e.dataTransfer.setData('text/plain', trigramme);
        chip.classList.add('dragging');
        setTimeout(() => chip.style.opacity = '0.4', 0);
    });
    chip.addEventListener('dragend', () => {
        chip.classList.remove('dragging');
        chip.style.opacity = '1';
        _updateOrderPositions(chip.parentElement);
        window.syncDomToStore();
    });

    return chip;
}

// articulation.js:620-646
function _setupOrderDropZone(container: HTMLElement, type: 'colonne' | 'penetration'): void {
    if (container.dataset.dropZoneInit === 'true') return;
    container.dataset.dropZoneInit = 'true';
    container.addEventListener('dragover', (e) => {
        e.preventDefault();
        const dragging = container.querySelector<HTMLElement>(`.${type}-chip.dragging`);
        if (!dragging) return;

        const siblings = [...container.querySelectorAll<HTMLElement>(`.${type}-chip:not(.dragging)`)];
        const afterElement = siblings.reduce<{ offset: number; element: HTMLElement | undefined }>((closest, child) => {
            const box = child.getBoundingClientRect();
            const offset = e.clientY - box.top - box.height / 2;
            if (offset < 0 && offset > closest.offset) {
                return { offset, element: child };
            }
            return closest;
        }, { offset: Number.NEGATIVE_INFINITY, element: undefined }).element;

        if (afterElement == null) {
            container.appendChild(dragging);
        } else {
            container.insertBefore(dragging, afterElement);
        }
    });
    // T6 — réordonnancement tactile (le DnD HTML5 ci-dessus ne marche qu'à la souris).
    _enableTouchSort(container, `.${type}-chip`, () => { _updateOrderPositions(container); window.syncDomToStore(); });
}

// articulation.js:648-653
function _updateOrderPositions(container: HTMLElement | null): void {
    if (!container) return;
    container.querySelectorAll<HTMLElement>('.order-chip').forEach((chip, i) => {
        const posEl = chip.querySelector<HTMLElement>('.order-position');
        if (posEl) posEl.textContent = String(i + 1);
    });
}

/**
 * Retourne la liste ordonnée des membres PATRACDVR valides pour un type de bloc.
 * @param type - 'moicp' (India), 'zmspcp' (AO) ou 'effraction'
 */
// articulation.js:655-680
function _getArticulationMembers(type: OiArticulationBlockKind): OiPatracMember[] {
    if (!Store.state.formData.patracdvr_rows) return [];
    const allMembers: OiPatracMember[] = [];
    Store.state.formData.patracdvr_rows.forEach(row => {
        row.members.forEach(m => allMembers.push(m));
    });
    if (Store.state.formData.patracdvr_unassigned) {
        Store.state.formData.patracdvr_unassigned.forEach(m => allMembers.push(m));
    }
    return allMembers
        .filter(m => {
            const cellule = (m.cellule || '').toLowerCase();
            const fonction = (m.fonction || '').toLowerCase();
            if (cellule === 'sans') return false;
            if (type === 'moicp') return cellule.startsWith('india');
            if (type === 'zmspcp') return cellule.startsWith('ao');
            if (type === 'effraction') return cellule.includes('effrac') || fonction.includes('effrac');
            return false;
        })
        .sort((a, b) => (a.cellule || '').localeCompare(b.cellule || '', undefined, { numeric: true, sensitivity: 'base' }));
}

/**
 * Synchronise les zones de composition d'un type de bloc SANS détruire
 * la répartition ni l'ordre manuels :
 *  - retire les chips dont le membre n'existe plus / a changé de cellule
 *  - ajoute les nouveaux membres (absents de toutes les zones) dans la 1re zone
 * @param selector - sélecteur des zones (ex: '.moicp-members')
 * @param type - 'moicp' | 'zmspcp' | 'effraction'
 */
// articulation.js:682-717
function _syncArticulationBlocks(selector: string, type: OiArticulationBlockKind): void {
    const zones = document.querySelectorAll<HTMLElement>(selector);
    if (zones.length === 0) return;

    const valid = _getArticulationMembers(type);
    const validSet = new Set(valid.map(m => m.trigramme));

    // 1. Retirer les chips obsolètes de toutes les zones
    zones.forEach(zone => {
        zone.querySelectorAll<HTMLElement>('.articulation-member').forEach(chip => {
            // dataset.trigramme est `string | undefined` en TS strict ; toujours posé
            // par _addArticulationMemberChip (adaptation de typage pur).
            if (!validSet.has(chip.dataset.trigramme ?? '')) chip.remove();
        });
    });

    // 2. Recenser les membres déjà placés (dans n'importe quelle zone du type)
    const present = new Set<string>();
    zones.forEach(zone => {
        zone.querySelectorAll<HTMLElement>('.articulation-member').forEach(chip => present.add(chip.dataset.trigramme ?? ''));
    });

    // 3. Ajouter les nouveaux membres dans la première zone, dans l'ordre des cellules
    // noUncheckedIndexedAccess : `zones[0]` est `HTMLElement | undefined` bien que
    // `zones.length === 0` soit déjà exclu ci-dessus (branche jamais atteinte en pratique).
    const firstZone = zones[0];
    if (!firstZone) return;
    valid.forEach(m => {
        if (!present.has(m.trigramme)) {
            _addArticulationMemberChip(firstZone, m.trigramme, type);
        }
    });
}

// ============================================================
// Rafraîchissement global depuis PATRACDVR
// ============================================================

/**
 * Appelé après modification du PATRACDVR pour synchroniser
 * les ordres et les compositions. Proactif : rafraîchit les 3 listes d'ordres.
 */
// articulation.js:719-752
export function refreshArticulationFromPatracdvr(): void {
    if (window.isFormLoading) return;
    console.log('Synchronisation Articulation depuis PATRACDVR...');

    // 1. Rame VL
    const currentRame = Array.from(document.querySelectorAll<HTMLElement>('#rame_vl_container .rame-vl-chip'))
        .map(c => c.dataset.vehicleName ?? '');
    // articulation.js:737 — l'original passe `null` quand la liste est vide ; le contrat
    // `refreshRameVL(savedData?: readonly string[])` (figé, règle commune §6) n'admet pas
    // `null` dans son union → `undefined`, même comportement (`if (savedData && …)` traite
    // les deux identiquement).
    refreshRameVL(currentRame.length > 0 ? currentRame : undefined);

    // 2. Colonne de progression (via Store)
    const currentColonne = Array.from(document.querySelectorAll<HTMLElement>('#colonne_progression_container .order-chip'))
        .map(c => c.dataset.trigramme ?? '');
    refreshColonneProgression(currentColonne.length > 0 ? currentColonne : undefined);

    // 3. Ordre de pénétration
    const currentPenetration = Array.from(document.querySelectorAll<HTMLElement>('#ordre_penetration_container .order-chip'))
        .map(c => c.dataset.trigramme ?? '');
    refreshOrdrePenetration(currentPenetration.length > 0 ? currentPenetration : undefined);

    // 4. Synchronisation NON destructive des compositions MOICP/ZMSPCP/Effraction
    //    (préserve l'ordre et la répartition manuelle ; ajoute les nouveaux, retire les obsolètes)
    _syncArticulationBlocks('.moicp-members', 'moicp');
    _syncArticulationBlocks('.zmspcp-members', 'zmspcp');
    _syncArticulationBlocks('.effraction-members', 'effraction');
}

// --- RÉACTIVITÉ --- articulation.js:754-770
let lastPatracData = '';
Store.subscribe((state) => {
    if (window.isFormLoading) return;

    // On ne surveille que les changements structurels du PATRACDVR
    const currentPatracData = JSON.stringify({
        rows: state.formData.patracdvr_rows,
        unassigned: state.formData.patracdvr_unassigned,
    });

    if (currentPatracData !== lastPatracData) {
        lastPatracData = currentPatracData;
        console.log("Mise à jour réactive de l'articulation...");
        refreshArticulationFromPatracdvr();
    }
});

// ============================================================
// CELLULE EFFRACTION
// ============================================================

/**
 * Crée un bloc Cellule Effraction dynamique.
 */
// articulation.js:772-909
export function addEffraction(data?: Partial<OiEffractionBlock> | null): void {
    const container = document.getElementById('effraction_container');
    if (!container) return;
    const blockId = data?.id || `effrac_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
    const blockIndex = container.querySelectorAll('.effraction-block').length + 1;

    const div = document.createElement('div');
    const stateClass = data ? '' : 'open'; // S'ouvre si ajouté manuellement
    div.className = `articulation-block effraction-block collapsible-container ${stateClass}`;
    div.id = blockId;
    div.dataset.blockId = blockId;

    div.innerHTML = `
        <div class="collapsible-header" style="background: color-mix(in srgb, var(--effraction-gold) 12%, transparent); color: var(--effraction-gold); border-left: 4px solid var(--effraction-gold); border-radius: var(--radius-md) var(--radius-md) 0 0;">
            <h3 class="block-title" style="margin: 0; display: flex; align-items: center; gap: 10px;">
                <span class="material-symbols-outlined">hardware</span>
                <input type="text" class="block-title-input" value="${data?.title || 'Effraction ' + blockIndex}"
                    style="background: transparent; border: none; border-bottom: 1px solid rgba(212, 175, 55, 0.3); color: var(--effraction-gold); font-size: 1.1em; font-weight: bold; padding: 2px 5px; width: 220px;"
                    onclick="event.stopPropagation()" oninput="syncDomToStore()">
            </h3>
            <div style="display: flex; align-items: center; gap: 8px;">
                <button type="button" class="remove-btn" onclick="event.stopPropagation(); removeBlockEl(this, '.effraction-block');"
                    style="min-height: 36px; height: 36px; width: 36px; padding: 0; border-radius: 50%;" title="Supprimer" aria-label="Supprimer cette cellule effraction"><span class="material-symbols-outlined">close</span></button>
                <span class="material-symbols-outlined">expand_more</span>
            </div>
        </div>
        <div class="collapsible-content">
            <h4 style="margin-top: 15px; color: var(--effraction-gold);">
                <span class="material-symbols-outlined" style="vertical-align: middle;">group</span> Composition cellule EFFRAC
            </h4>
            <p style="font-size: 0.85em; color: var(--text-muted); margin-bottom: 8px;">
                <span class="material-symbols-outlined" style="font-size: 1em; vertical-align: middle;">info</span>
                Glissez pour réordonner.
            </p>
            <div class="articulation-members-zone effraction-members"
                style="min-height: 50px; border: 2px dashed var(--border-color); border-radius: var(--radius-md); padding: 10px; display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 15px;">
            </div>

            <label>Mission EFFRAC :</label>
            <textarea class="effrac-mission" rows="4" style="width:100%; margin-bottom: 15px;" oninput="syncDomToStore()" placeholder="...">${data?.mission || DEFAULTS.missions.effraction}</textarea>

            <label>Type de porte :</label>
            <textarea class="effrac-porte" rows="2" style="width:100%" oninput="syncDomToStore()" placeholder="Description libre...">${data?.porte || ''}</textarea>

            <label>Structure & Dormant :</label>
            <textarea class="effrac-structure" rows="2" style="width:100%" oninput="syncDomToStore()" placeholder="Ex: Isolation par l'exterieur recouvert de crépi...">${data?.structure || ''}</textarea>

            <label>Serrurerie :</label>
            <textarea class="effrac-serrurerie" rows="2" style="width:100%" oninput="syncDomToStore()" placeholder="Ex: PVC, 1 point de fermeture...">${data?.serrurerie || ''}</textarea>

            <label>Environnement immédiat :</label>
            <textarea class="effrac-environnement" rows="2" style="width:100%" oninput="syncDomToStore()" placeholder="Ex: Petite marche en brique...">${data?.environnement || ''}</textarea>

            <div class="effrac-measurements-grid" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 10px; margin-top: 10px;">
                <div>
                    <label style="font-size: 0.8em; color: var(--effraction-gold);">Bâti à Bâti (cm)</label>
                    <input type="text" class="effrac-bati-bati" value="${data?.bati_a_bati || ''}" oninput="syncDomToStore()" placeholder="0">
                </div>
                <div>
                    <label style="font-size: 0.8em; color: var(--effraction-gold);">Dormant à Dormant (cm)</label>
                    <input type="text" class="effrac-dormant-dormant" value="${data?.dormant_a_dormant || ''}" oninput="syncDomToStore()" placeholder="0">
                </div>
                <div>
                    <label style="font-size: 0.8em; color: var(--effraction-gold);">Profondeur linteaux (cm)</label>
                    <input type="text" class="effrac-prof-linteaux" value="${data?.prof_linteaux || ''}" oninput="syncDomToStore()" placeholder="0">
                </div>
                <div>
                    <label style="font-size: 0.8em; color: var(--effraction-gold);">Profondeur Bâti (cm)</label>
                    <input type="text" class="effrac-prof-bati" value="${data?.prof_bati || ''}" oninput="syncDomToStore()" placeholder="0">
                </div>
                <div>
                    <label style="font-size: 0.8em; color: var(--effraction-gold);">Hauteur de porte (cm)</label>
                    <input type="text" class="effrac-h-porte" value="${data?.h_porte || ''}" oninput="syncDomToStore()" placeholder="0">
                </div>
                <div>
                    <label style="font-size: 0.8em; color: var(--text-muted);">Hauteur marche (opt.)</label>
                    <input type="text" class="effrac-h-marche" value="${data?.h_marche || ''}" oninput="syncDomToStore()" placeholder="0">
                </div>
                <div>
                    <label style="font-size: 0.8em; color: var(--text-muted);">Prof. marche (opt.)</label>
                    <input type="text" class="effrac-prof-marche" value="${data?.prof_marche || ''}" oninput="syncDomToStore()" placeholder="0">
                </div>
                <div>
                    <label style="font-size: 0.8em; color: var(--text-muted);">Prof. moulure (opt.)</label>
                    <input type="text" class="effrac-prof-moulure" value="${data?.prof_moulure || ''}" oninput="syncDomToStore()" placeholder="0">
                </div>
            </div>

            <h4 style="margin-top: 25px; color: var(--effraction-gold);">
                <span class="material-symbols-outlined" style="vertical-align: middle;">psychology</span> Hypothèses & Déroulement
            </h4>
            <div class="effrac-hypotheses-list" id="effrac_hyp_list_${blockId}"></div>
            <button type="button" class="add-btn" style="width:100%; justify-content: center; margin-bottom: 20px;" onclick="addEffractionHypothesis('${blockId}')"><span class="material-symbols-outlined" aria-hidden="true">add</span> Ajouter Hypothèse</button>

            <h4 style="margin-top: 15px; color: var(--effraction-gold);">
                <span class="material-symbols-outlined" style="vertical-align: middle;">add_a_photo</span> Photos Effraction
            </h4>
            <div style="font-size: 0.85em; color: var(--text-muted); margin-bottom: 8px;">
                <span class="material-symbols-outlined" style="font-size: 1em; vertical-align: middle;">info</span>
                Ajoutez des photos et précisez les outils pour chacune.
            </div>
            <button type="button" class="add-btn" style="width:100%; justify-content: center;" onclick="document.getElementById('input_effrac_${blockId}').click()"><span class="material-symbols-outlined" aria-hidden="true">add</span> Ajouter Photo(s)</button>
            <input type="file" id="input_effrac_${blockId}" class="sr-only-input" accept="image/*" multiple onchange="handleFileChange(this, 'photo_effrac_${blockId}', false)">
            <div id="photo_effrac_${blockId}" class="image-preview-container photo-display-area" style="margin-top:10px;"></div>
        </div>
    `;

    container.appendChild(div);

    const membersZone = div.querySelector<HTMLElement>('.effraction-members');
    if (!membersZone) return;
    _setupArticulationDropZone(membersZone);

    if (data && Array.isArray(data.members)) {
        // Restauration fidèle (liste vide respectée).
        data.members.forEach(trigramme => {
            _addArticulationMemberChip(membersZone, trigramme, 'effraction');
        });
    } else {
        _autoPopulateEffraction(membersZone);
    }

    if (data?.hypotheses && data.hypotheses.length > 0) {
        data.hypotheses.forEach(hyp => addEffractionHypothesis(blockId, hyp));
    }

    // Default mission if it hasn't been rehydrated and no data is passed (handled via the textarea default text implicitly, but if data exists it uses data.mission)
    if (data?.mission) {
        const missionEl = div.querySelector<HTMLTextAreaElement>('.effrac-mission');
        if (missionEl) missionEl.value = data.mission;
    }

    if (!data) window.syncDomToStore();
}

/**
 * articulation.js:911 — SEULE définition réelle (expression de fonction assignée
 * directement à `window.addEffractionHypothesis`). La ligne :1006 de l'original
 * (`window.addEffractionHypothesis = addEffractionHypothesis;`) est une
 * auto-affectation SANS EFFET (identifiant nu résolu sur la propriété déjà posée) —
 * il n'existe AUCUNE `function addEffractionHypothesis` distincte dans l'original.
 * Le port définit cette fonction UNE SEULE FOIS, en déclaration hoistée classique
 * (accessible depuis `addEffraction` ci-dessus et depuis l'attribut `onclick` inline
 * généré), et la pose sur `window` UNE SEULE FOIS avec les 9 autres globaux, en fin
 * de module (cf. SPEC-OI-CONVERSION.md §11.3).
 */
export function addEffractionHypothesis(blockId: string, data?: Partial<OiEffractionHypothesis> | null): void {
    const list = document.getElementById(`effrac_hyp_list_${blockId}`);
    if (!list) return;
    const hypId = data?.id || `hyp_effrac_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;

    const div = document.createElement('div');
    div.className = 'effrac-hypothesis-item dynamic-list-item';
    div.dataset.hypId = hypId;
    div.style.flexDirection = 'column';
    div.style.alignItems = 'stretch';
    div.style.background = 'var(--bg-container)';
    div.style.padding = '15px';
    div.style.border = '1px solid var(--border-color)';
    div.style.borderRadius = 'var(--radius-md)';
    div.style.marginBottom = '10px';

    div.innerHTML = `
        <div style="display:flex; justify-content: space-between; align-items:center; margin-bottom: 10px;">
            <input type="text" class="effrac-hyp-title" value="${data?.title || 'Hypothèse ' + (list.children.length + 1)}" placeholder="Titre..." style="font-weight: bold; background: transparent; border: none; border-bottom: 1px solid var(--border-color); color: var(--text-primary); font-size: 1.1em; width: 60%;" oninput="syncDomToStore()">
            <button type="button" class="remove-btn" onclick="this.closest('.effrac-hypothesis-item').remove(); syncDomToStore();" style="padding: 5px;" aria-label="Supprimer cette hypothèse"><span class="material-symbols-outlined">close</span></button>
        </div>

        <label style="font-size: 0.85em;">Description Initiale:</label>
        <textarea class="effrac-hyp-desc" rows="2" style="width:100%; margin-bottom: 10px;" oninput="syncDomToStore()">${data?.desc || ''}</textarea>

        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 10px; margin-top: 10px;">
            <div>
                <label style="font-size: 0.85em; color: var(--accent-blue);">Phase Effraction:</label>
                <textarea class="effrac-hyp-effrac text-muted" rows="3" style="width:100%" oninput="syncDomToStore()">${data?.effrac || ''}</textarea>
            </div>
            <div>
                <label style="font-size: 0.85em; color: var(--accent-blue);">Phase Dégagement:</label>
                <textarea class="effrac-hyp-degag text-muted" rows="3" style="width:100%" oninput="syncDomToStore()">${data?.degag || ''}</textarea>
            </div>
            <div>
                <label style="font-size: 0.85em; color: var(--accent-blue);">Phase Assaut:</label>
                <textarea class="effrac-hyp-assaut text-muted" rows="3" style="width:100%" oninput="syncDomToStore()">${data?.assaut || ''}</textarea>
            </div>
        </div>
    `;
    list.appendChild(div);
    if (!data) window.syncDomToStore();
}

/**
 * Logique pour le modal des outils d'effraction
 */
let currentEffractionImgId: string | null = null;

// articulation.js:960-983
export function openEffractionToolsModal(imgId: string): void {
    currentEffractionImgId = imgId;
    const img = document.getElementById(imgId);
    if (!img) return;

    const modal = document.getElementById('effractionToolsModal') as HTMLDialogElement | null;
    if (!modal) return;

    const tools = JSON.parse(img.dataset.tools || '[]') as string[];
    const otherTools = img.dataset.otherTools || '';

    // Reset buttons
    modal.querySelectorAll<HTMLElement>('.effrac-tool-btn').forEach(btn => {
        // dataset.tool est `string | undefined` en TS strict ; toujours posé sur ces
        // boutons statiques du gabarit `#effractionToolsModal` (adaptation de typage pur).
        btn.classList.toggle('active', tools.includes(btn.dataset.tool ?? ''));
        btn.onclick = () => btn.classList.toggle('active');
    });

    // Reset other tools input
    const otherToolsInput = document.getElementById('effrac_other_tools') as HTMLInputElement | null;
    if (otherToolsInput) otherToolsInput.value = otherTools;

    document.body.classList.add('modal-open');
    modal.showModal();
}

// articulation.js:985-1000
export function saveEffractionTools(): void {
    if (!currentEffractionImgId) return;
    const img = document.getElementById(currentEffractionImgId);
    if (!img) return;

    const modal = document.getElementById('effractionToolsModal') as HTMLDialogElement | null;
    if (!modal) return;
    const selectedTools = Array.from(modal.querySelectorAll<HTMLElement>('.effrac-tool-btn.active')).map(btn => btn.dataset.tool);
    const otherToolsInput = document.getElementById('effrac_other_tools') as HTMLInputElement | null;

    img.dataset.tools = JSON.stringify(selectedTools);
    img.dataset.otherTools = otherToolsInput ? otherToolsInput.value : '';

    modal.close();
    document.body.classList.remove('modal-open');
    window.syncDomToStore();
}

/**
 * Suppression d'un bloc d'articulation AVEC purge IndexedDB des photos qu'il
 * contient (sinon images orphelines dans `OI_GeneratorLiteDB/images`). Purge
 * best-effort (`.catch` console) : appelée depuis des handlers `onclick`
 * inline, pas d'`await` possible. Même révocation d'object URL que
 * `medias.ts` `removeImage` (capture locale, noUncheckedIndexedAccess).
 */
export function removeBlockEl(btn: HTMLElement, selector: string): void {
    const block = btn.closest<HTMLElement>(selector);
    if (!block) return;
    for (const img of block.querySelectorAll<HTMLElement>('.image-preview')) {
        const cachedUrl = Store.state.objectUrlsCache[img.id];
        if (cachedUrl) {
            URL.revokeObjectURL(cachedUrl);
            delete Store.state.objectUrlsCache[img.id];
        }
        dbManager.deleteItem(img.id).catch((error: unknown) => {
            console.error("Erreur lors de la purge d'une image du bloc supprimé:", error);
        });
    }
    block.remove();
    window.syncDomToStore();
}

// --- GLOBAL EXPOSURE --- articulation.js:20-27 + :1002-1009 : les deux blocs de
// pose de l'original portent sur des déclarations de fonction HOISTÉES, donc à
// valeurs finales identiques (cf. §11.3 en tête de fichier) ⇒ UNE SEULE pose ici,
// en fin de module.
window.addMoicp = addMoicp;
window.addZmspcp = addZmspcp;
window.addEffraction = addEffraction;
window.addEffractionHypothesis = addEffractionHypothesis;
window.openEffractionToolsModal = openEffractionToolsModal;
window.saveEffractionTools = saveEffractionTools;
window.refreshArticulationFromPatracdvr = refreshArticulationFromPatracdvr;
window.refreshRameVL = refreshRameVL;
window.refreshColonneProgression = refreshColonneProgression;
window.refreshOrdrePenetration = refreshOrdrePenetration;
window.removeBlockEl = removeBlockEl;
