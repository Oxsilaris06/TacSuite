/**
 * formulaires.ts — Cœur de la persistance formulaire du Générateur d'OI
 * (P3.CONV, paquet `oi-formulaires`, CRITIQUE + correctif de bug).
 * ===========================================================================
 *
 * Port TypeScript VERBATIM, fonction par fonction dans l'ordre du fichier, de
 * `modules/formulaires.js` (GStart-main, lecture seule, 1338 LOC intégral) :
 * `addDynamicField` (:15), `initChipContainer` (:24), `getChipData` (:89),
 * `addMeField` (:95), `addTimeEvent` (:110), `updateAdvTitle` (:155),
 * `removeAdversary` (:164), `addAdversary` (:178), `toggleAdvSection` (:332),
 * `addHypothesis` (:342), `debounce` (:374), `syncDomToStoreCore` (renommée,
 * déclaration brute :395), `loadFormData` (:551), `checkCoherence` (:744),
 * `exportSession` (:866), `importSession` (:887, + CORRECTIF §9),
 * `exportArchive` (:925), `parseArchive` (:1006), `importArchive` (:1064),
 * `detectImportCategories` (:1109), `showImportSelectModal` (:1131),
 * `applyArchiveImport` (:1177), `resetActivePage` (:1251), `resetAllData`
 * (:1297). Cf. `docs/SPEC-OI-CONVERSION.md` §2.2/§9/§11.4, `PAQUETS-OI.json`
 * (`oi-formulaires`).
 *
 * PIÈGE MAJEUR PRÉSERVÉ EXACTEMENT (formulaires.js:386-393) — identité
 * débouncée/immédiate : la déclaration brute est renommée en interne
 * `syncDomToStoreCore` (SEUL renommage autorisé dans ce paquet, mandaté par
 * `PAQUETS-OI.json`) pour distinguer explicitement les 2 versions. Ce module
 * EXPORTE sous le nom `syncDomToStore` la version DÉBOUNCÉE (500 ms,
 * sémantique post-formulaires.js:392 — c'est elle qui est posée sur
 * `window.syncDomToStore`, écrasant l'alias non-débouncé d'`init.ts`) et sous
 * les noms `syncDomToStoreImmediate` / `flushFormData` la version IMMÉDIATE
 * (capturée AVANT la « réassignation » — en ESM il n'y a jamais eu de
 * réassignation d'identifiant global à proprement parler, mais on reproduit
 * la même distinction de RÉFÉRENCES DE FONCTION). Tout autre choix ferait
 * diverger silencieusement les 20+ appelants cross-module (RULE D'OR ci-dessous).
 *
 * RÈGLE D'OR (SPEC §2.2) — DANS ce fichier, un identifiant bare comme
 * `syncDomToStore()` (ex. formulaires.js:40,173,326,356,740,867,1283) référence,
 * dans l'ORIGINAL en script classique, la MÊME liaison globale que
 * `window.syncDomToStore` (les déclarations `function`/`var` de premier niveau
 * ET les propriétés `window` partagent la même case mémoire). Ces appels
 * s'exécutent tous à RUNTIME (callbacks d'event, corps de fonctions async),
 * strictement APRÈS l'évaluation complète du module — donc APRÈS
 * l'initialisation de `export const syncDomToStore = debouncedSync;` — donc
 * ils sont portés ici par une référence LOCALE directe à `syncDomToStore`
 * (PAS par `window.syncDomToStore` : ce serait un aller-retour inutile vers
 * le MÊME objet, au sein du MÊME module). Seuls les appels CROSS-MODULE
 * (`toast` de `notifications.ts`, `handleFileChange`/`removeImage`/
 * `syncAllThumbnails`/`updateCustomBgPreview` de `medias.ts`,
 * `addMoicp`/`addZmspcp`/`addEffraction`/`refreshRameVL`/
 * `refreshColonneProgression`/`refreshOrdrePenetration` d'`articulation.ts`,
 * `openAnnotationModal` de `dessin.ts` — jamais appelé en code réel, seulement
 * dans des attributs `onclick` VERBATIM de gabarits `innerHTML` —,
 * `initializePatracdvr`/`updateArticulationDisplay` de `patrac.ts`) passent
 * par `window.<nom>`, avec exactement la même garde `typeof … === 'function'`
 * que l'original QUAND ELLE EXISTE (et son ABSENCE quand elle est absente,
 * ex. `refreshRameVL`/`window.removeImage`/`window.updateCustomBgPreview`
 * jamais gardés dans l'original).
 *
 * DOUBLONS DE POSE `window.*` (formulaires.js:362-371 vs :831-845) — valeurs
 * IDENTIQUES sauf 2 noms qui n'apparaissent que dans UN SEUL des deux blocs :
 * `toggleAdvSection` (SEULEMENT :370) et `removeAdversary` (SEULEMENT :838).
 * Consolidés ici en un UNIQUE bloc « GLOBAL EXPOSURE » (comportement identique :
 * chaque pose est idempotente, la valeur finale posée est la même).
 *
 * ===== CORRECTIF DE BUG MANDATÉ (SPEC-OI-CONVERSION.md §9) =====
 * `importSession` (formulaires.js:887-913) écrit `localStorage` (:901) PUIS
 * fait `location.reload()` (:906) SANS poser `window.isFormLoading` : le
 * reload déclenche `beforeunload`/`pagehide` → le flush de
 * `installFlushOnBoundaries()` re-sérialise le DOM ENCORE VIERGE et ÉCRASE la
 * session tout juste importée (mesuré dans la spec : 11162 octets remplacés
 * par 2087 avant que le reload ne relise). Correctif MINIMAL, UNE seule ligne
 * ajoutée entre l'écriture et l'`alert` (idiome DÉJÀ présent 2× dans le
 * fichier : `applyArchiveImport` :1234, `resetAllData` :1309) : voir
 * `importSession` ci-dessous. AUCUN autre changement (pas de nouveau drapeau,
 * pas de désinstallation de listener, pas de refonte en non-reload).
 * ===== FIN DU CORRECTIF =====
 *
 * IMPORTS RÉELS (acycliques, SPEC §2.3 `formulaires.ts ← init, outils, dessin,
 * patrac`) : `Store`/`dbManager`/`LOCAL_STORAGE_KEY`/`memberConfig` de
 * `@oi/init.js`, `createAnnotatedImageBlob` de `@oi/dessin.js` (:688, appel
 * NU dans l'original), `setupQuickEditPanel` de `@oi/patrac.js` (:562,639
 * nus / :733 gardé — la garde `typeof` est conservée par fidélité même si un
 * import statique ne peut jamais être « absent » : « test de forme », même
 * précédent que `patrac.ts:1357`/`pdf-engine-v2.ts:484`).
 *
 * ÉCART SIGNALÉ AU GATE — `cleanupObjectUrls` : `PAQUETS-OI.json` (§ IMPORTS
 * RÉELS) et `SPEC-OI-CONVERSION.md` §2.1 (matrice de dépendances) mandatent
 * `import { cleanupObjectUrls } from '@oi/outils.js'`. Vérifié par lecture
 * intégrale de `modules/formulaires.js` (grep confirmé) : cette fonction n'y
 * est JAMAIS appelée — le seul hit est un COMMENTAIRE (:554) disant
 * explicitement qu'elle a été retirée (« Suppression de cleanupObjectUrls car
 * nous n'utilisons plus de Blobs pour les vignettes »). L'importer sans
 * jamais l'utiliser ferait échouer `noUnusedLocals`. Ce port NE l'importe
 * donc PAS (dépendance obsolète de la matrice, sans site d'appel réel dans la
 * source actuelle) — signalé, non corrigé ailleurs.
 *
 * RÈGLE D'OR appliquée aux 2 seuls symboles restants non couverts ci-dessus :
 * `handleFileChange`/`openAnnotationModal`/`openEffractionToolsModal` (medias/
 * dessin/articulation) n'apparaissent QUE dans des attributs `onclick`/
 * `onchange` VERBATIM de gabarits `innerHTML` (chaînes JS jamais évaluées par
 * TS, ex. formulaires.js:220,225,230,718,719) : aucune référence directe
 * nécessaire dans ce fichier pour elles. `window.removeImage` (:170, :720
 * dans un gabarit) : le SEUL appel RÉEL (:170, dans `removeAdversary`) passe
 * `null` comme second argument, exactement comme l'original — ÉCART DE
 * CONTRAT DÉJÀ SIGNALÉ par `medias.ts` (son en-tête) : `OiMediaGlobals.removeImage`
 * déclare `itemElement: HTMLElement` NON nullable alors que l'original ET
 * l'implémentation l'acceptent `null` ; cast ponctuel ici (voir
 * `removeAdversary`), re-signalé au gate P3.D.
 *
 * ÉCART DE TYPAGE SIGNALÉ — `window.dbManager` vs `dbManager` (import direct) :
 * l'original écrit explicitement `window.dbManager` dans `exportArchive`/
 * `applyArchiveImport`/`resetActivePage`/`resetAllData` alors que `dbManager`
 * est aussi un `export const` de `init.js`, jamais réassigné. Puisque
 * `dbManager` fait partie des « IMPORTS RÉELS » mandatés pour CE paquet, ce
 * port utilise UNIFORMÉMENT la liaison importée `dbManager` (MÊME référence
 * que `window.dbManager`, posée une seule fois par `init.ts` et jamais
 * réassignée : comportement observable strictement identique, zéro risque de
 * capturer une « mauvaise version », contrairement à `syncDomToStore`).
 *
 * Adaptations de TYPAGE PUR (aucune restructuration de logique, règle commune
 * §3/§9 ; même patron que `patrac.ts`/`articulation.ts`/`medias.ts`, déjà
 * portés) :
 *  - `document.getElementById`/`querySelector(All)` renvoient `T | null` en
 *    TS strict : gardes `if (!x) return;` ajoutées sur les conteneurs
 *    statiques du gabarit (jamais absents en pratique), génériques explicites
 *    `<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>` (alias
 *    local `FieldValueElement`) pour les champs de formulaire mixtes.
 *  - `HTMLElement.dataset.*` est `string | undefined` : replis `?? ''` / `|| …`
 *    ajoutés aux points de lecture dynamique, jamais empruntés en pratique.
 *  - `initChipContainer` (formulaires.js:48-75) — le handler
 *    `customInput.onkeydown = function (event) { … this.value … }` est une
 *    AFFECTATION DIRECTE de propriété (pas `addEventListener`) : la propriété
 *    ambiante `GlobalEventHandlers.onkeydown` type `this` en
 *    `GlobalEventHandlers` (générique), pas en `HTMLInputElement` (contrairement
 *    à `addEventListener`, dont les surcharges infèrent correctement `this` sur
 *    l'élément concret — conservé tel quel pour les 2 handlers `click` de cette
 *    même fonction). Ce SEUL handler est donc réécrit en fonction FLÉCHÉE
 *    capturant `customInput` par fermeture au lieu de `this` — MÊME référence
 *    d'objet à l'exécution (`this === customInput` dans l'original), AUCUN
 *    changement de comportement, adaptation de typage pur.
 *  - `importSession` (formulaires.js:892) : `event.target.result` devient
 *    `reader.result` (capture directe de l'instance `FileReader`, même
 *    référence que `event.target` à l'exécution) — même précédent que
 *    `medias.ts`/`@pctac/utils.ts` (évite `ProgressEvent<FileReader>.target:
 *    FileReader | null`) ; narrowing `typeof json === 'string'` avec message
 *    de repli jamais emprunté en pratique, même précédent.
 *  - `catch (e) { }` dont `e` n'est JAMAIS lu dans l'original ⇒ liaison de
 *    catch omise (`noUnusedLocals`), même principe que `init.ts`
 *    (`init.js:369,386`) ; `catch (e) { … e … }` (lu) conservé, avec
 *    `e instanceof Error ? e.message : String(e)` aux 2 sites qui accèdent à
 *    `.message` (`exportArchive`, `applyArchiveImport`), même précédent que
 *    `@pctac/archive.ts:197`, `patrac.ts:1498`.
 *  - `OI_ARCHIVE_KEYS` (formulaires.js:920) : déclaré `readonly [string]`
 *    (tuple à 1 élément) plutôt que `string[]`, pour que `OI_ARCHIVE_KEYS[0]`
 *    soit typé `string` (pas `string | undefined`) sous `noUncheckedIndexedAccess`
 *    — même valeur, même comportement.
 *  - `parsed.zip` (`OiParsedArchiveOk.zip`) est typé `unknown` par le contrat
 *    (découplage vis-à-vis de la forme exacte de JSZip) : cast `as JSZip`
 *    ponctuel, avec commentaire de justification, aux 2 sites qui en ont
 *    besoin (`applyArchiveImport`, `_imgCountInZip`).
 *  - `IMPORT_CATEGORIES`/`detectImportCategories` : type interne
 *    `OiImportCategoryInternal` (= `OiImportCategory` + `countOf?` optionnel,
 *    absent du contrat public — l'original ne l'expose pas non plus en dehors
 *    de la fonction) ; `detectImportCategories` retourne bien `OiImportCategory[]`
 *    (sur-ensemble structurel assignable, aucune excess-property-check
 *    déclenchée car il ne s'agit jamais d'un littéral direct).
 *  - `showImportSelectModal` (formulaires.js:1161) : affectation chaînée
 *    `confirmBtn.onclick = cancelBtn.onclick = closeBtn.onclick = null;` sur
 *    3 éléments dont 2 possiblement `null` en TS strict (jamais absents en
 *    pratique, gabarit statique) : éclatée en 3 affectations gardées
 *    individuellement, comportement identique dans tous les cas réels.
 *  - `loadFormData` retourne `Promise<boolean>` (`true`/`false`, verbatim,
 *    formulaires.js:563,728,734) alors que `OiFormGlobals.loadFormData` est
 *    typé `Promise<void>` : contrairement au retour DIRECT (`checkCoherence`,
 *    ci-dessous), `Promise<T>` n'est PAS assignable à `Promise<void>` (vérifié
 *    par `tsc`) — la règle spéciale du retour `void` ne s'applique qu'au type
 *    de retour direct d'une fonction, pas au paramètre générique d'un type
 *    déjà construit comme `Promise<T>`. `window.loadFormData` est donc posé
 *    via une fine enveloppe `async () => { await loadFormData(); }` qui
 *    ignore la valeur de résolution — aucun appelant ne la lit (`main.ts`
 *    l'appelle nu, SPEC §12.3), zéro changement de comportement observable.
 *  - `checkCoherence` retourne `boolean` (verbatim), assignable tel quel à
 *    `(): void` (RÈGLE spéciale du retour `void` DIRECT, différente du cas
 *    `Promise<T>` ci-dessus), déjà exploitée côté consommateur par
 *    `presentation.ts` via cast pour LIRE cette valeur.
 *
 * Source : `/home/nico/Bureau/Web/GStart-main/modules/formulaires.js`
 * (lecture seule).
 */

import JSZip from 'jszip';

import { LOCAL_STORAGE_KEY, Store, dbManager, memberConfig } from '@oi/init.js';
import { createAnnotatedImageBlob } from '@oi/dessin.js';
import { setupQuickEditPanel } from '@oi/patrac.js';
import type {
    OiAdversary,
    OiAnnotation,
    OiCartographyState,
    OiFormData,
    OiImportCategory,
    OiMemberConfig,
    OiParsedArchive,
    OiParsedArchiveOk,
    OiPatracMember,
    OiPhotoMeta,
} from '@shared/types/contracts.js';

/** Élément de formulaire portant `.value` (input/textarea/select) — adaptation de typage pur. */
type FieldValueElement = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

// ==================== FormManager.js ====================

// formulaires.js:15-22
function addDynamicField(containerId: string, value: string = ''): void {
    const container = document.getElementById(containerId);
    if (!container) return;
    const item = document.createElement('div');
    item.className = 'dynamic-list-item';
    const fieldId = `dyn_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
    item.innerHTML = `<label for="${fieldId}" class="sr-only">Champ dynamique</label><input type="text" id="${fieldId}" class="dynamic-input" value="${value}" oninput="syncDomToStore()"><button type="button" class="remove-btn" onclick="this.parentElement.remove(); syncDomToStore();" aria-label="Supprimer le champ"><span class="material-symbols-outlined">close</span></button>`;
    container.appendChild(item);
}

// formulaires.js:24-87
function initChipContainer(containerId: string, selectedValues: readonly string[] = []): void {
    const container = document.getElementById(containerId);
    if (!container) return;
    const options = JSON.parse(container.dataset.options || '[]') as string[];
    container.innerHTML = '';

    options.forEach((option) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'chip-btn';
        btn.textContent = option;
        if (selectedValues.includes(option)) {
            btn.classList.add('selected');
        }
        btn.addEventListener('click', function (this: HTMLButtonElement) {
            this.classList.toggle('selected');
            syncDomToStore();
        });
        container.appendChild(btn);
    });

    const customInput = document.createElement('input');
    customInput.type = 'text';
    customInput.placeholder = 'Ajouter personnalisé (entrée)';
    // formulaires.js:48-75 — `onkeydown` (affectation directe de propriété, pas
    // `addEventListener`) type `this` en `GlobalEventHandlers` générique côté
    // TS : réécrit en fonction fléchée capturant `customInput` par fermeture,
    // MÊME référence que `this` à l'exécution (adaptation de typage pur, cf.
    // en-tête de ce fichier).
    customInput.onkeydown = (event: KeyboardEvent): void => {
        if (event.key === 'Enter' && customInput.value.trim()) {
            event.preventDefault();
            const customValue = customInput.value.trim();
            // Récupérer les options de base pour s'assurer de ne pas dupliquer
            const currentOptions = JSON.parse(container.dataset.options || '[]') as string[];
            // Récupérer les valeurs déjà sélectionnées/ajoutées dynamiquement
            const currentSelected = getChipData(containerId);

            if (!currentOptions.includes(customValue) && !currentSelected.includes(customValue)) {
                const newBtn = document.createElement('button');
                newBtn.type = 'button';
                newBtn.className = 'chip-btn selected';
                newBtn.textContent = customValue;
                newBtn.addEventListener('click', function (this: HTMLButtonElement) { this.classList.toggle('selected'); syncDomToStore(); });

                // Insérer avant le champ de saisie pour respecter l'ordre
                container.insertBefore(newBtn, customInput);
            } else if (currentOptions.includes(customValue) && !currentSelected.includes(customValue)) {
                // Si l'option existe mais n'est pas sélectionnée, la sélectionner
                const existingBtn = Array.from(container.querySelectorAll<HTMLButtonElement>('.chip-btn')).find((b) => b.textContent === customValue);
                if (existingBtn) { existingBtn.classList.add('selected'); }
            }

            customInput.value = '';
            syncDomToStore();
        }
    };
    customInput.className = 'chip-add-input';
    customInput.style.flex = '0 0 170px';
    customInput.style.minHeight = '40px';
    customInput.style.padding = '8px 16px';
    customInput.style.margin = '0';
    customInput.style.borderRadius = '9999px';
    customInput.style.border = '1px dashed var(--border-color)';
    customInput.style.background = 'transparent';
    customInput.style.color = 'var(--text-primary)';
    customInput.style.fontSize = '0.9em';
    container.appendChild(customInput);
}

// formulaires.js:89-93
function getChipData(containerId: string): string[] {
    const container = document.getElementById(containerId);
    if (!container) return [];
    const selectedChips = container.querySelectorAll<HTMLElement>('.chip-btn.selected');
    return Array.from(selectedChips).map((btn) => btn.textContent ?? '');
}

// formulaires.js:95-108
function addMeField(value: string = '', containerId: string = 'me_container', fromLoad: boolean = false): void {
    const container = document.getElementById(containerId);
    if (!container) return;
    // Limite UX à la SAISIE interactive uniquement. La reconstruction depuis les
    // données (fromLoad) est fidèle : aucune troncature silencieuse au chargement.
    const currentItems = container.querySelectorAll('.dynamic-list-item');
    if (!fromLoad && currentItems.length >= 3) return;
    const item = document.createElement('div');
    item.className = 'dynamic-list-item';
    const meIndex = currentItems.length + 1;
    const fieldId = `me_${containerId}_${meIndex}_${Date.now()}`;
    const safeVal = (window.UIPlatform ? window.UIPlatform.esc(value) : value);
    item.innerHTML = `<label for="${fieldId}">ME${meIndex}:</label><input type="text" id="${fieldId}" name="${fieldId}" class="me-input" value="${safeVal}" oninput="syncDomToStore()"><button type="button" class="remove-btn" onclick="this.parentElement.remove(); syncDomToStore();" aria-label="Supprimer ce moyen employé"><span class="material-symbols-outlined">close</span></button>`;
    container.appendChild(item);
}

// formulaires.js:110-153
function addTimeEvent(type_from_load?: string, hour_from_load: string = '', desc_from_load?: string): void {
    const container = document.getElementById('time_events_container');
    if (!container) return;
    const isLoadingFromFile = type_from_load !== undefined;

    let type: string;
    const hour = hour_from_load;
    let desc: string | undefined;

    if (isLoadingFromFile) {
        // `type_from_load` narrowé non-undefined par `isLoadingFromFile`
        // (Control Flow Analysis of Aliased Conditions, TS 4.4+).
        type = type_from_load;
        desc = desc_from_load;
    } else {
        const currentEventCount = container.children.length;
        const prefilledData = [
            { type: 'T0', desc: 'Rasso PSIG' }, { type: 'T1', desc: 'Départ PR' },
            { type: 'T2', desc: 'Départ LE' }, { type: 'T3', desc: 'MEP TERMINÉ' },
            { type: 'T4', desc: 'TOP ACTION' },
        ];
        const defaultValues = prefilledData[currentEventCount] ?? { type: `T${currentEventCount}`, desc: '' };
        type = defaultValues.type;
        desc = defaultValues.desc;
    }

    const eventId = `event_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const item = document.createElement('div');
    item.className = 'dynamic-list-item time-item draggable';
    item.id = eventId;
    item.setAttribute('draggable', 'true');
    const optionsHtml = ['T0', 'T1', 'T2', 'T3', 'T4', 'T5'].map((t) =>
        `<option value="${t}" ${t === type ? 'selected' : ''}>${t}</option>`
    ).join('');

    const selectId = `type_${eventId}`;
    const hourId = `hour_${eventId}`;
    const descId = `desc_${eventId}`;

    item.innerHTML = `
                <label for="${selectId}" class="sr-only">Type d'événement</label>
                <select id="${selectId}" class="time-type-select" onchange="syncDomToStore()">${optionsHtml}</select>
                <label for="${hourId}" class="sr-only">Heure</label>
                <input type="time" id="${hourId}" class="time-hour-input" value="${hour}" onchange="syncDomToStore()">
                <label for="${descId}" class="sr-only">Description</label>
                <input type="text" id="${descId}" class="time-description-input" placeholder="Description" value="${desc || ''}" oninput="syncDomToStore()">
                <button type="button" class="remove-btn" onmousedown="event.stopPropagation()" ontouchstart="event.stopPropagation()" onclick="this.parentElement.remove(); syncDomToStore();" aria-label="Supprimer cet événement"><span class="material-symbols-outlined">close</span></button>`;
    container.appendChild(item);
}

// formulaires.js:155-162
function updateAdvTitle(id: string, val: string): void {
    const entry = document.getElementById(id);
    if (!entry) return;
    const title = entry.querySelector('.adv-title');
    if (title) {
        title.textContent = val ? `Adversaire: ${val}` : 'Adversaire';
    }
}

// formulaires.js:164-176
function removeAdversary(id: string): void {
    if (confirm('Supprimer définitivement cette fiche adversaire ?')) {
        const entry = document.getElementById(id);
        if (entry) {
            // Supprimer les photos d'abord
            entry.querySelectorAll<HTMLElement>('.image-preview').forEach((img) => {
                // formulaires.js:170 — ÉCART DE CONTRAT DÉJÀ SIGNALÉ (medias.ts, cf.
                // son en-tête) : OiMediaGlobals.removeImage déclare itemElement
                // NON nullable alors que l'original ET l'implémentation acceptent
                // `null` (suppression sans retrait DOM ciblé, `entry.remove()` juste
                // après retire tout). Cast ponctuel, re-signalé au gate P3.D.
                void window.removeImage(img.id, null as unknown as HTMLElement);
            });
            entry.remove();
            syncDomToStore();
        }
    }
}

// formulaires.js:178-327
function addAdversary(data: OiAdversary | null = null): void {
    const container = document.getElementById('adversaries_container');
    if (!container) return;
    const id = data?.id ? data.id : `adv_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const div = document.createElement('div');
    div.className = 'collapsible-container adversary-entry open';
    div.id = id;
    div.dataset.advId = id;

    // formulaires.js:187 — `advIndex` n'est JAMAIS utilisé ailleurs dans le corps
    // de la fonction (mort-code verbatim, vérifié) ; `noUnusedLocals` interdit de
    // lier une valeur inexploitée → expression seule conservée (aucun effet de
    // bord, lecture pure), liaison omise (même principe qu'`articulation.ts`,
    // `articulation.js:366`, cf. son en-tête). `void` requis par ESLint
    // (`no-unused-expressions` : un opérateur binaire nu n'est pas une forme
    // reconnue comme « appel », contrairement à `getData(...)` chez articulation.ts).
    void (container.children.length + 1);
    // Échappement HTML de toute valeur restaurée (évite corruption du reload/PDF et self-XSS).
    const e = (v: unknown): string => (window.UIPlatform ? window.UIPlatform.esc(v) : String(v == null ? '' : v)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'));
    const nameVal = (data?.nom_adversaire as string | undefined) || '';
    const nameValSafe = e(nameVal);
    const title = nameVal ? `Adversaire: ${e(nameVal)}` : 'Adversaire';

    div.innerHTML = `
        <div class="collapsible-header">
            <h3 class="adv-title">${title}</h3>
            <div style="display: flex; gap: 10px; align-items: center;">
                <div onclick="event.stopPropagation()">
                    <button type="button" class="remove-btn" onclick="removeAdversary('${id}')" title="Supprimer cet adversaire" aria-label="Supprimer cet adversaire"><span class="material-symbols-outlined">close</span></button>
                </div>
                <span class="material-symbols-outlined">expand_more</span>
            </div>
        </div>
        <div class="collapsible-content">

            <!-- SECTION : Photos & signalement visuel (repliable pour se concentrer sur la saisie) -->
            <section class="adv-section adv-collapsible" data-collapsed="false">
                <button type="button" class="adv-section-head adv-section-toggle" aria-expanded="true" aria-label="Replier ou déplier les photos" onclick="toggleAdvSection(this)">
                    <span class="material-symbols-outlined" aria-hidden="true">photo_camera</span>
                    <h4>Photos &amp; signalement</h4>
                    <span class="adv-section-hint">replier</span>
                    <span class="material-symbols-outlined adv-section-chevron" aria-hidden="true">expand_more</span>
                </button>
                <div class="adv-section-body">
                    <div class="adv-section-body-inner">
                        <label for="input_main_${id}">Photo principale&nbsp;:</label>
                        <div id="photo_main_${id}" class="image-preview-container single-photo photo-display-area" data-is-single="true" style="margin-bottom: 5px;"></div>
                        <button type="button" class="add-btn adv-photo-btn" onclick="document.getElementById('input_main_${id}').click()"><span class="material-symbols-outlined" aria-hidden="true">add_a_photo</span> Photo principale</button>
                        <input type="file" id="input_main_${id}" name="input_main_${id}" class="sr-only-input" accept="image/*" onchange="handleFileChange(this, 'photo_main_${id}', true)">

                        <label for="input_extra_${id}">Photos supplémentaires&nbsp;:</label>
                        <div id="photo_extra_${id}" class="image-preview-container extra-photos photo-display-area" style="margin-bottom: 5px;"></div>
                        <button type="button" class="add-btn adv-photo-btn" onclick="document.getElementById('input_extra_${id}').click()"><span class="material-symbols-outlined" aria-hidden="true">add_photo_alternate</span> Photos supplémentaires</button>
                        <input type="file" id="input_extra_${id}" name="input_extra_${id}" class="sr-only-input" accept="image/*" multiple onchange="handleFileChange(this, 'photo_extra_${id}', false)">

                        <label for="input_renforts_${id}" class="adv-sublabel-danger"><span class="material-symbols-outlined">group_add</span> Renforts potentiels&nbsp;:</label>
                        <div id="photo_renforts_${id}" class="image-preview-container photo-display-area" style="margin-bottom: 5px;"></div>
                        <button type="button" class="add-btn adv-photo-btn" onclick="document.getElementById('input_renforts_${id}').click()"><span class="material-symbols-outlined" aria-hidden="true">add</span> Photo(s) renforts</button>
                        <input type="file" id="input_renforts_${id}" class="sr-only-input" accept="image/*" multiple onchange="handleFileChange(this, 'photo_renforts_${id}', false)">
                    </div>
                </div>
            </section>

            <!-- SECTION : Identité — même grille alignée que les autres étapes -->
            <section class="adv-section">
                <div class="adv-section-head"><span class="material-symbols-outlined">badge</span><h4>Identité</h4></div>
                <div class="oi-fields-grid">
                    <label for="nom_adv_${id}">Nom / Prénom&nbsp;:</label>
                    <input type="text" id="nom_adv_${id}" name="nom_adv_${id}" class="adv-field" data-field="nom_adversaire" placeholder="Nom et prénom" value="${nameValSafe}" oninput="updateAdvTitle('${id}', this.value); syncDomToStore()">

                    <label for="naissance_adv_${id}">Naissance&nbsp;:</label>
                    <div class="adv-duo">
                        <input type="date" id="naissance_adv_${id}" name="naissance_adv_${id}" class="adv-field" data-field="date_naissance" value="${(data?.date_naissance as string | undefined) || ''}" oninput="syncDomToStore()">
                        <input type="text" id="lieu_adv_${id}" name="lieu_adv_${id}" class="adv-field" data-field="lieu_naissance" placeholder="Lieu de naissance" value="${e(data?.lieu_naissance)}" oninput="syncDomToStore()">
                    </div>

                    <label for="stature_adv_${id}">Stature / Ethnie&nbsp;:</label>
                    <div class="adv-duo">
                        <input type="text" id="stature_adv_${id}" name="stature_adv_${id}" class="adv-field" data-field="stature_adversaire" placeholder="Taille, corpulence" value="${e(data?.stature_adversaire)}" oninput="syncDomToStore()">
                        <select id="ethnie_adv_${id}" name="ethnie_adv_${id}" class="adv-field" data-field="ethnie_adversaire" onchange="syncDomToStore()">
                            <option value="" ${!data?.ethnie_adversaire ? 'selected' : ''} disabled>Ethnie</option>
                            <option ${data?.ethnie_adversaire === 'Caucasien' ? 'selected' : ''}>Caucasien</option>
                            <option ${data?.ethnie_adversaire === 'Nord africain' ? 'selected' : ''}>Nord africain</option>
                            <option ${data?.ethnie_adversaire === 'Afro-antillais' ? 'selected' : ''}>Afro-antillais</option>
                            <option ${data?.ethnie_adversaire === 'Asiatique' ? 'selected' : ''}>Asiatique</option>
                        </select>
                    </div>

                    <label for="signes_adv_${id}">Signes particuliers&nbsp;:</label>
                    <input type="text" id="signes_adv_${id}" name="signes_adv_${id}" class="adv-field" data-field="signes_particuliers" placeholder="Tatouages, cicatrices, lunettes…" value="${e(data?.signes_particuliers)}" oninput="syncDomToStore()">

                    <label for="sitfam_adv_${id}">Situation familiale&nbsp;:</label>
                    <input type="text" id="sitfam_adv_${id}" name="sitfam_adv_${id}" class="adv-field" data-field="situation_familiale" placeholder="Célibataire, en couple, enfants…" value="${e(data?.situation_familiale)}" oninput="syncDomToStore()">

                    <label for="profession_adv_${id}">Profession&nbsp;:</label>
                    <input type="text" id="profession_adv_${id}" name="profession_adv_${id}" class="adv-field" data-field="profession_adversaire" placeholder="Activité professionnelle" value="${e(data?.profession_adversaire)}" oninput="syncDomToStore()">

                    <label for="domicile_adv_${id}">Domicile&nbsp;:</label>
                    <textarea id="domicile_adv_${id}" name="domicile_adv_${id}" class="adv-field" data-field="domicile_adversaire" rows="2" placeholder="Adresse, étage, particularités d'accès…" oninput="syncDomToStore()">${e(data?.domicile_adversaire)}</textarea>
                </div>
            </section>

            <!-- SECTION : Évaluation de la menace -->
            <section class="adv-section">
                <div class="adv-section-head danger"><span class="material-symbols-outlined">gpp_maybe</span><h4>Évaluation de la menace</h4></div>
                <div class="oi-fields-grid">
                    <label for="antecedents_adv_${id}">Antécédents&nbsp;:</label>
                    <textarea id="antecedents_adv_${id}" name="antecedents_adv_${id}" class="adv-field" data-field="antecedents_adversaire" rows="2" placeholder="Judiciaires, comportementaux…" oninput="syncDomToStore()">${e(data?.antecedents_adversaire)}</textarea>

                    <label class="adv-chip-label">État d'esprit&nbsp;:</label>
                    <div id="esprit_${id}" class="chip-container full-row" data-options='["Serein", "Hostile", "Conciliant", "Sur ses gardes"]'></div>

                    <label for="attitude_adv_${id}">Attitude connue&nbsp;:</label>
                    <textarea id="attitude_adv_${id}" name="attitude_adv_${id}" class="adv-field" data-field="attitude_adversaire" rows="2" placeholder="Comportement observé, réactions…" oninput="syncDomToStore()">${e(data?.attitude_adversaire)}</textarea>

                    <label class="adv-chip-label">Volume (renfort)&nbsp;:</label>
                    <div id="volume_${id}" class="chip-container full-row" data-options='["Seul", "Famille", "BO", "Conjointe", "2-3", "4+"]'></div>

                    <label for="substances_adv_${id}">Substances&nbsp;:</label>
                    <input type="text" id="substances_adv_${id}" name="substances_adv_${id}" class="adv-field" data-field="substances_adversaire" placeholder="Stupéfiants, alcool, traitement…" value="${e(data?.substances_adversaire)}" oninput="syncDomToStore()">

                    <label for="armes_adv_${id}">Armes connues&nbsp;:</label>
                    <input type="text" id="armes_adv_${id}" name="armes_adv_${id}" class="adv-field" data-field="armes_connues" placeholder="Type, nombre, accessibilité…" value="${e(data?.armes_connues)}" oninput="syncDomToStore()">
                </div>
            </section>

            <!-- SECTION : Moyens & véhicules -->
            <section class="adv-section">
                <div class="adv-section-head"><span class="material-symbols-outlined">build</span><h4>Moyens &amp; véhicules</h4></div>

                <label class="adv-block-label">Moyens employés (ME)&nbsp;:</label>
                <div id="me_${id}" class="me-container"></div>
                <button type="button" class="add-btn" onclick="addMeField('', 'me_${id}')"><span class="material-symbols-outlined" aria-hidden="true">add</span> Moyen employé</button>

                <label class="adv-block-label" style="margin-top: 18px;">Véhicules&nbsp;:</label>
                <div id="vehicules_${id}" class="vehicules-container"></div>
                <button type="button" class="add-btn" onclick="addDynamicField('vehicules_${id}')"><span class="material-symbols-outlined" aria-hidden="true">add</span> Véhicule</button>
            </section>
        </div>
    `;

    container.appendChild(div);

    // Initialisation des composants
    initChipContainer(`esprit_${id}`, (data?.etat_esprit_list as string[] | undefined) || []);
    initChipContainer(`volume_${id}`, (data?.volume_list as string[] | undefined) || []);

    if (data?.me_list) {
        data.me_list.forEach((val) => addMeField(val, `me_${id}`, true));
    }
    if (data?.vehicules_list) {
        data.vehicules_list.forEach((val) => addDynamicField(`vehicules_${id}`, val));
    }

    if (!data) syncDomToStore();
}

// Repli/dépli d'une section repliable de la fiche adversaire (ex. Photos).
// Bascule data-collapsed + aria-expanded ; l'animation est gérée en CSS
// (grid-template-rows 1fr↔0fr — sans clipping ni hauteur magique).
// formulaires.js:332-340
function toggleAdvSection(btn: HTMLElement): void {
    const sec = btn.closest<HTMLElement>('.adv-collapsible');
    if (!sec) return;
    const collapsed = sec.getAttribute('data-collapsed') === 'true';
    sec.setAttribute('data-collapsed', collapsed ? 'false' : 'true');
    btn.setAttribute('aria-expanded', collapsed ? 'true' : 'false');
    const hint = btn.querySelector('.adv-section-hint');
    if (hint) hint.textContent = collapsed ? 'replier' : 'déplier';
}

// formulaires.js:342-357
function addHypothesis(val: string = ''): void {
    const container = document.getElementById('hypotheses_container');
    if (!container) return;
    const id = `hyp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const div = document.createElement('div');
    div.className = 'dynamic-list-item';
    div.style.display = 'flex';
    div.style.gap = '10px';
    div.style.marginBottom = '10px';
    div.innerHTML = `
        <label for="${id}" class="sr-only">Hypothèse</label>
        <input type="text" id="${id}" class="hypothese-input" value="${val.replace(/"/g, '&quot;')}" placeholder="Saisir une hypothèse..." oninput="syncDomToStore()" style="flex-grow: 1; padding: 10px; border-radius: 8px; border: 1px solid var(--border-color); background-color: var(--bg-body); color: var(--text-primary);">
        <button type="button" class="remove-btn" onclick="this.parentElement.remove(); syncDomToStore()" style="padding: 0 10px;" title="Supprimer" aria-label="Supprimer cette hypothèse"><span class="material-symbols-outlined">close</span></button>
    `;
    container.appendChild(div);
    syncDomToStore();
}

// Debounce helper — formulaires.js:374-384
function debounce<Args extends unknown[]>(func: (...args: Args) => void, wait: number): (...args: Args) => void {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    return function executedFunction(...args: Args): void {
        const later = (): void => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

// formulaires.js:386-393 — PIÈGE MAJEUR, cf. en-tête de ce fichier. La
// déclaration brute (originellement `function syncDomToStore()`, ligne :395)
// est renommée `syncDomToStoreCore` (SEUL renommage mandaté, PAQUETS-OI.json
// `oi-formulaires`) pour rendre explicite la distinction débouncée/immédiate.
const debouncedSync = debounce(syncDomToStoreCore, 500);
// IMPORTANT : en script classique, `function syncDomToStore` créait
// `window.syncDomToStore`. La ligne `window.syncDomToStore = debouncedSync;`
// l'écrasait ensuite par la version débouncée → tout identifiant nu
// `syncDomToStore` référencé APRÈS ce point désignait la version DÉBOUNCÉE.
// On capture donc la version brute (immédiate) AVANT toute réassignation, pour
// les flush de fin de cycle de vie.
const immediateSync = syncDomToStoreCore;
/** Version DÉBOUNCÉE (500 ms) — posée sur `window.syncDomToStore` (RÈGLE D'OR §2.2). */
export const syncDomToStore = debouncedSync;
/** Version IMMÉDIATE (non débouncée), capturée avant l'« écrasement ». */
export const syncDomToStoreImmediate = immediateSync;
/** Alias de la version immédiate — flush de fin de cycle de vie (OI1). */
export const flushFormData = immediateSync;

// formulaires.js:395-549
function syncDomToStoreCore(): void {
    if (window.isFormLoading) {
        console.log('Sync skipped: Form is loading...');
        return;
    }
    try {
        const data: OiFormData = {};
        document.querySelectorAll<FieldValueElement>('#oi-form input:not([type="file"]), #oi-form textarea, #oi-form select').forEach((field) => {
            if (field.id) data[field.id] = field.value;
        });

        data.dynamic_photos = {};
        const dynamicPhotos = data.dynamic_photos;
        document.querySelectorAll<HTMLElement>('.image-preview-container').forEach((container) => {
            if (container.id) {
                const imagesMetadata: OiPhotoMeta[] = Array.from(container.querySelectorAll<HTMLElement>('.image-preview-item')).map((item) => {
                    const img = item.querySelector<HTMLImageElement>('.image-preview');
                    const titleInput = item.querySelector<HTMLInputElement>('.photo-title-input');
                    return {
                        id: img?.id ?? '',
                        annotations: img?.dataset.annotations || '[]',
                        tools: img?.dataset.tools || '[]',
                        other_tools: img?.dataset.otherTools || '',
                        customTitle: titleInput ? titleInput.value : '',
                    };
                });
                if (imagesMetadata.length > 0) {
                    dynamicPhotos[container.id] = imagesMetadata;
                }
            }
        });

        // Suppression de la sauvegarde de l'ID d'image de fond

        // Adversaires dynamiques
        data.adversaries = Array.from(document.querySelectorAll<HTMLElement>('.adversary-entry')).map((entry) => {
            const advId = entry.dataset.advId ?? '';
            const advData: OiAdversary = {
                id: advId,
                me_list: [],
                etat_esprit_list: [],
                volume_list: [],
                vehicules_list: [],
            };
            entry.querySelectorAll<FieldValueElement>('.adv-field').forEach((field) => {
                const key = field.dataset.field;
                if (key) advData[key] = field.value;
            });
            advData.me_list = Array.from(entry.querySelectorAll<HTMLInputElement>('.me-container .me-input')).map((i) => i.value).filter(Boolean);
            advData.etat_esprit_list = getChipData(`esprit_${advId}`);
            advData.volume_list = getChipData(`volume_${advId}`);
            advData.vehicules_list = Array.from(entry.querySelectorAll<HTMLInputElement>('.vehicules-container .dynamic-input')).map((i) => i.value).filter(Boolean);
            return advData;
        });



        // Sauvegarde des données détaillées des membres PATRACDVR (incluant DIR)
        const memberDatasetsToSave: readonly (keyof OiPatracMember)[] = ['trigramme', 'fonction', 'cellule', 'equipement', 'equipement2', 'tenue', 'gpb',
            'principales', 'secondaires', 'afis', 'grenades', 'dir'];

        const unassignedEl = document.getElementById('unassigned_members_container');
        data.patracdvr_unassigned = unassignedEl
            ? Array.from(unassignedEl.querySelectorAll<HTMLElement>('.patracdvr-member-btn')).map((btn) => {
                // Object de forme connue (OiPatracMember, tous champs string) : cast
                // standard, aucun `any` — même précédent que patrac.ts:355-371 (sens inverse).
                const memberData = {} as OiPatracMember;
                memberDatasetsToSave.forEach((key) => { memberData[key] = btn.dataset[key] || ''; });
                return memberData;
            })
            : [];

        data.patracdvr_rows = Array.from(document.querySelectorAll<HTMLElement>('#patracdvr_container .patracdvr-vehicle-row')).map((row) => ({
            vehicle: row.dataset.vehicleName ?? '',
            members: Array.from(row.querySelectorAll<HTMLElement>('.patracdvr-member-btn')).map((btn) => {
                const memberData = {} as OiPatracMember;
                memberDatasetsToSave.forEach((key) => { memberData[key] = btn.dataset[key] || ''; });
                return memberData;
            })
        }));

        data.time_events = Array.from(document.querySelectorAll<HTMLElement>('#time_events_container .time-item')).map((item) => ({
            type: item.querySelector<HTMLSelectElement>('.time-type-select')?.value || '',
            hour: item.querySelector<HTMLInputElement>('.time-hour-input')?.value || '',
            description: item.querySelector<HTMLInputElement>('.time-description-input')?.value || ''
        }));

        data.hypotheses = Array.from(document.querySelectorAll<HTMLInputElement>('#hypotheses_container .hypothese-input')).map((input) => input.value);

        // Sauvegarde des blocs MOICP
        data.moicp_blocks = Array.from(document.querySelectorAll<HTMLElement>('.moicp-block')).map((block) => ({
            id: block.dataset.blockId ?? '',
            title: block.querySelector<FieldValueElement>('.block-title-input')?.value || '',
            mission: block.querySelector<FieldValueElement>('.moicp-mission')?.value || '',
            objectif: block.querySelector<FieldValueElement>('.moicp-objectif')?.value || '',
            itineraire: block.querySelector<FieldValueElement>('.moicp-itineraire')?.value || '',
            points_particuliers: block.querySelector<FieldValueElement>('.moicp-pp')?.value || '',
            cat: block.querySelector<FieldValueElement>('.moicp-cat')?.value || '',
            place_chef: block.querySelector<FieldValueElement>('.moicp-place-chef')?.value || '',
            members: Array.from(block.querySelectorAll<HTMLElement>('.articulation-member')).map((m) => m.dataset.trigramme ?? '')
        }));

        // Sauvegarde des blocs ZMSPCP
        data.zmspcp_blocks = Array.from(document.querySelectorAll<HTMLElement>('.zmspcp-block')).map((block) => ({
            id: block.dataset.blockId ?? '',
            title: block.querySelector<FieldValueElement>('.block-title-input')?.value || '',
            zone: block.querySelector<FieldValueElement>('.zmspcp-zone')?.value || '',
            mission: block.querySelector<FieldValueElement>('.zmspcp-mission')?.value || '',
            secteur: block.querySelector<FieldValueElement>('.zmspcp-secteur')?.value || '',
            points_particuliers: block.querySelector<FieldValueElement>('.zmspcp-pp')?.value || '',
            cat: block.querySelector<FieldValueElement>('.zmspcp-cat')?.value || '',
            place_chef: block.querySelector<FieldValueElement>('.zmspcp-place-chef')?.value || '',
            members: Array.from(block.querySelectorAll<HTMLElement>('.articulation-member')).map((m) => m.dataset.trigramme ?? '')
        }));

        // Sauvegarde des blocs Cellule Effraction
        data.effraction_blocks = Array.from(document.querySelectorAll<HTMLElement>('.effraction-block')).map((block) => ({
            id: block.dataset.blockId ?? '',
            title: block.querySelector<FieldValueElement>('.block-title-input')?.value || '',
            mission: block.querySelector<FieldValueElement>('.effrac-mission')?.value || '',
            porte: block.querySelector<FieldValueElement>('.effrac-porte')?.value || '',
            structure: block.querySelector<FieldValueElement>('.effrac-structure')?.value || '',
            serrurerie: block.querySelector<FieldValueElement>('.effrac-serrurerie')?.value || '',
            environnement: block.querySelector<FieldValueElement>('.effrac-environnement')?.value || '',
            bati_a_bati: block.querySelector<FieldValueElement>('.effrac-bati-bati')?.value || '',
            dormant_a_dormant: block.querySelector<FieldValueElement>('.effrac-dormant-dormant')?.value || '',
            prof_linteaux: block.querySelector<FieldValueElement>('.effrac-prof-linteaux')?.value || '',
            prof_bati: block.querySelector<FieldValueElement>('.effrac-prof-bati')?.value || '',
            h_porte: block.querySelector<FieldValueElement>('.effrac-h-porte')?.value || '',
            h_marche: block.querySelector<FieldValueElement>('.effrac-h-marche')?.value || '',
            prof_marche: block.querySelector<FieldValueElement>('.effrac-prof-marche')?.value || '',
            prof_moulure: block.querySelector<FieldValueElement>('.effrac-prof-moulure')?.value || '',
            members: Array.from(block.querySelectorAll<HTMLElement>('.articulation-member')).map((m) => m.dataset.trigramme ?? ''),
            hypotheses: Array.from(block.querySelectorAll<HTMLElement>('.effrac-hypothesis-item')).map((item) => ({
                id: item.dataset.hypId ?? '',
                title: item.querySelector<FieldValueElement>('.effrac-hyp-title')?.value || '',
                desc: item.querySelector<FieldValueElement>('.effrac-hyp-desc')?.value || '',
                effrac: item.querySelector<FieldValueElement>('.effrac-hyp-effrac')?.value || '',
                degag: item.querySelector<FieldValueElement>('.effrac-hyp-degag')?.value || '',
                assaut: item.querySelector<FieldValueElement>('.effrac-hyp-assaut')?.value || ''
            }))
        }));

        // Sauvegarde des ordres
        data.rame_vl_order = Array.from(document.querySelectorAll<HTMLElement>('#rame_vl_container .rame-vl-chip')).map((c) => c.dataset.vehicleName ?? '');
        data.colonne_progression_order = Array.from(document.querySelectorAll<HTMLElement>('#colonne_progression_container .order-chip')).map((c) => c.dataset.trigramme ?? '');
        data.ordre_penetration_order = Array.from(document.querySelectorAll<HTMLElement>('#ordre_penetration_container .order-chip')).map((c) => c.dataset.trigramme ?? '');

        // Sauvegarde des options de configuration (memberConfig est importé de @oi/init.js)
        if (typeof memberConfig !== 'undefined') data.options = memberConfig;

        // Cartographie OI (pins / dessins / vue) : ce n'est pas un champ DOM du
        // formulaire, donc syncDomToStore ne sait pas le reconstruire — il faut le
        // reporter explicitement, sinon il serait perdu à chaque saisie / F5.
        if (Store.state.formData && Store.state.formData.cartography) {
            data.cartography = Store.state.formData.cartography;
        }

        // Persister dans Store (le Proxy déclenche notify() -> saveToStorage)
        Store.state.formData = data;

    } catch (e) {
        console.error('Erreur de sauvegarde:', e);
    }
}

// formulaires.js:551-742
async function loadFormData(): Promise<boolean> {
    window.isFormLoading = true;
    try {
        // Suppression de cleanupObjectUrls car nous n'utilisons plus de Blobs pour les vignettes
        // Utilisation de la clé isolée
        const key = window.LOCAL_STORAGE_KEY || 'tactical_oi_data';
        const dataString = localStorage.getItem(key);
        if (!dataString) {
            // Si aucune donnée dans localStorage, on initialise le panneau d'édition rapide
            // avec les valeurs par défaut JS, et on retourne false
            window.initializePatracdvr({});
            setupQuickEditPanel();
            return false;
        }

        // JUSTIFICATION unknown : JSON.parse renvoie `any` dans lib.es5 ; OiFormData
        // n'a qu'un index signature `unknown` ⇒ la valeur parsée est structurellement
        // compatible sans validation de forme supplémentaire (identique à l'original).
        const data = JSON.parse(dataString) as OiFormData;

        // Chargement des options de configuration
        if (data.options) {
            Object.assign(memberConfig, data.options);
        }

        // Nettoyer l'UI
        document.querySelectorAll<HTMLElement>('.image-preview-container, .photo-display-area').forEach((c) => { c.innerHTML = ''; });

        // Charger les métadonnées de base
        Object.keys(data).forEach((key2) => {
            const excludedKeys = [
                'dynamic_photos', 'patracdvr_rows', 'patracdvr_unassigned',
                'time_events', 'adversaries', 'pdf_background_id',
                'moicp_blocks', 'zmspcp_blocks', 'effraction_blocks', 'options',
                'rame_vl_order', 'colonne_progression_order', 'ordre_penetration_order'
            ];
            if (excludedKeys.includes(key2)) return;
            const el = document.getElementById(key2);
            // formulaires.js:586 — `el.value` suppose un champ de formulaire ; valeur
            // toujours une string (écrite par syncDomToStoreCore via `field.value`).
            if (el) (el as FieldValueElement).value = data[key2] as string;
        });

        // --- 1. Création des conteneurs dynamiques (Adversaires, Temps, etc.) ---
        const adversariesContainer = document.getElementById('adversaries_container');
        if (adversariesContainer) {
            adversariesContainer.innerHTML = '';
            if (data.adversaries && data.adversaries.length > 0) {
                data.adversaries.forEach((adv) => addAdversary(adv));
            } else if (data.nom_adversaire) {
                // Migration depuis l'ancien format statique si présent
                const migrateAdv = (suffix: string = ''): OiAdversary => ({
                    id: '',
                    nom_adversaire: data[`nom_adversaire${suffix}`],
                    domicile_adversaire: data[`domicile_adversaire${suffix}`],
                    date_naissance: data[`date_naissance${suffix}`],
                    lieu_naissance: data[`lieu_naissance${suffix}`],
                    stature_adversaire: data[`stature_adversaire${suffix}`],
                    ethnie_adversaire: data[`ethnie_adversaire${suffix}`],
                    signes_particuliers: data[`signes_particuliers${suffix}`],
                    profession_adversaire: data[`profession_adversaire${suffix}`],
                    antecedents_adversaire: data[`antecedents_adversaire${suffix}`],
                    attitude_adversaire: data[`attitude_adversaire${suffix}`],
                    substances_adversaire: data[`substances_adversaire${suffix}`],
                    armes_connues: data[`armes_connues${suffix}`],
                    me_list: (data[`me_list${suffix === '_2' ? '_2' : ''}`] as string[] | undefined) ?? [],
                    etat_esprit_list: (data[`etat_esprit_list${suffix === '_2' ? '_2' : ''}`] as string[] | undefined) ?? [],
                    volume_list: (data[`volume_list${suffix === '_2' ? '_2' : ''}`] as string[] | undefined) ?? [],
                    vehicules_list: (data[`vehicules_list${suffix === '_2' ? '_2' : ''}`] as string[] | undefined) ?? [],
                });
                addAdversary(migrateAdv());
                if (data.nom_adversaire_2) addAdversary(migrateAdv('_2'));
            }
        }

        const timeEventsContainer = document.getElementById('time_events_container');
        if (timeEventsContainer) timeEventsContainer.innerHTML = '';
        (data.time_events || []).forEach((ev) => addTimeEvent(ev.type, ev.hour, ev.description));

        const hypothesesContainer = document.getElementById('hypotheses_container');
        if (hypothesesContainer) {
            hypothesesContainer.innerHTML = '';
            if (data.hypotheses && data.hypotheses.length > 0) {
                data.hypotheses.forEach((h) => addHypothesis(h));
            } else if (data.hypothese_h1 || data.hypothese_h2 || data.hypothese_h3) {
                // Migration from old static H1, H2, H3
                if (data.hypothese_h1) addHypothesis(data.hypothese_h1 as string);
                if (data.hypothese_h2) addHypothesis(data.hypothese_h2 as string);
                if (data.hypothese_h3) addHypothesis(data.hypothese_h3 as string);
            }
        }


        // --- 2. Initialisations diverses ---
        window.initializePatracdvr(data);
        setupQuickEditPanel();

        // --- 2b. Restauration articulaton MOICP / ZMSPCP ---
        const moicpContainer = document.getElementById('moicp_container');
        if (moicpContainer) moicpContainer.innerHTML = '';
        const zmspcpContainer = document.getElementById('zmspcp_container');
        if (zmspcpContainer) zmspcpContainer.innerHTML = '';
        const effracContainer = document.getElementById('effraction_container');
        if (effracContainer) effracContainer.innerHTML = '';

        if (data.moicp_blocks && data.moicp_blocks.length > 0) {
            data.moicp_blocks.forEach((blockData) => window.addMoicp(blockData));
        }
        if (data.zmspcp_blocks && data.zmspcp_blocks.length > 0) {
            data.zmspcp_blocks.forEach((blockData) => window.addZmspcp(blockData));
        }
        if (data.effraction_blocks && data.effraction_blocks.length > 0) {
            data.effraction_blocks.forEach((blockData) => window.addEffraction(blockData));
        }

        // Rafraîchir les ordres (Rame VL, Colonne, Pénétration)
        // formulaires.js:660-662 — l'original passe `null` ; le contrat de
        // OiArticulationGlobals type ces paramètres en `readonly string[] | undefined`
        // (SANS null, cf. articulation.ts, même adaptation déjà actée là-bas) :
        // `undefined` substitué, comportement identique (`if (savedX && …)`).
        window.refreshRameVL(data.rame_vl_order || undefined);
        window.refreshColonneProgression(data.colonne_progression_order || undefined);
        window.refreshOrdrePenetration(data.ordre_penetration_order || undefined);

        await window.updateCustomBgPreview();

        // --- 3. Restauration des photos (après que les conteneurs existent) ---
        if (data.dynamic_photos) {
            const dynamicPhotos = data.dynamic_photos;
            for (const previewId in dynamicPhotos) {
                const previewContainer = document.getElementById(previewId);
                const fileDataArray = dynamicPhotos[previewId];

                if (previewContainer && fileDataArray) {
                    for (const imgData of fileDataArray) {
                        const imageBlob = await dbManager.getItem(imgData.id);
                        if (imageBlob) {
                            // On convertit en Base64 pour éviter les erreurs "local resource" en file://
                            const base64Data = await new Promise<string>((resolve, reject) => {
                                const reader = new FileReader();
                                reader.onloadend = () => {
                                    const result = reader.result;
                                    if (typeof result === 'string') {
                                        resolve(result);
                                    } else {
                                        reject(new Error("FileReader n'a pas renvoyé de chaîne (readAsDataURL)."));
                                    }
                                };
                                reader.onerror = reject;
                                reader.readAsDataURL(imageBlob);
                            });

                            let previewUrl = base64Data;
                            // JUSTIFICATION unknown : JSON.parse renvoie `any` dans lib.es5,
                            // même précédent que init.ts (loadFromStorage).
                            Store.state.annotations = JSON.parse(imgData.annotations || '[]') as OiAnnotation[];
                            if (Store.state.annotations.length > 0) {
                                try {
                                    const annotatedBlob = await createAnnotatedImageBlob(imageBlob, Store.state.annotations);
                                    previewUrl = await new Promise<string>((resolve, reject) => {
                                        const reader = new FileReader();
                                        reader.onloadend = () => {
                                            const result = reader.result;
                                            if (typeof result === 'string') {
                                                resolve(result);
                                            } else {
                                                reject(new Error("FileReader n'a pas renvoyé de chaîne (readAsDataURL)."));
                                            }
                                        };
                                        reader.onerror = reject;
                                        reader.readAsDataURL(annotatedBlob);
                                    });
                                } catch (e) {
                                    console.error('Erreur génération preview annotée', e);
                                }
                            }

                            const interactiveItem = document.createElement('div');
                            interactiveItem.className = 'image-preview-item draggable';
                            interactiveItem.draggable = true;
                            interactiveItem.id = imgData.id + '_item';

                            const isEffrac = previewId.includes('effrac');

                            interactiveItem.innerHTML = `
                                        <img id="${imgData.id}" class="image-preview" src="${previewUrl}" style="display:block;"
                                            data-annotations='${(imgData.annotations || '[]').replace(/'/g, '&apos;')}'
                                            data-tools='${(imgData.tools || '[]').replace(/'/g, '&apos;')}'
                                            data-other-tools='${(imgData.other_tools || '').replace(/'/g, '&apos;')}'
                                        >
                                        <input type="text" class="photo-title-input" placeholder="Légende de la photo..."
                                            value="${(imgData.customTitle || '').replace(/"/g, '&quot;')}"
                                            style="width: 100%; margin-top: 5px; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2); color: white; border-radius: 4px; padding: 2px 5px; font-size: 0.8em;"
                                            oninput="syncDomToStore()">
                                        <div style="display: flex; gap: 5px; margin-top: 5px;">
                                            <button type="button" class="add-btn" style="background-color: var(--accent-blue); padding: 4px 8px;" onmousedown="event.stopPropagation()" ontouchstart="event.stopPropagation()" onclick="openAnnotationModal('${imgData.id}')" aria-label="Annoter la photo"><span class="material-symbols-outlined" style="font-size: 1.2em;">edit</span></button>
                                            ${isEffrac ? `<button type="button" class="add-btn" style="background-color: var(--effraction-gold); padding: 4px 8px;" onmousedown="event.stopPropagation()" ontouchstart="event.stopPropagation()" onclick="openEffractionToolsModal('${imgData.id}')" aria-label="Sélectionner les outils d'effraction"><span class="material-symbols-outlined" style="font-size: 1.2em;">hardware</span></button>` : ''}
                                            <button type="button" class="remove-btn" style="padding: 4px 8px;" onmousedown="event.stopPropagation()" ontouchstart="event.stopPropagation()" onclick="removeImage('${imgData.id}', this.closest('.image-preview-item'))" aria-label="Supprimer la photo">&times;</button>
                                        </div>`;
                            previewContainer.appendChild(interactiveItem);
                        }
                    }
                }
            }
        }
        return true;

    } catch (e) {
        console.error('Erreur de chargement:', e);
        if (typeof window.initializePatracdvr === 'function') window.initializePatracdvr({});
        if (typeof setupQuickEditPanel === 'function') setupQuickEditPanel();
        return false;
    } finally {
        window.isFormLoading = false;
        // Final sync once everything is in DOM
        if (typeof window.updateArticulationDisplay === 'function') window.updateArticulationDisplay();
        if (typeof window.syncAllThumbnails === 'function') window.syncAllThumbnails();
        syncDomToStore();
    }
}

// formulaires.js:744-828
function checkCoherence(): boolean {
    // Utilisation de la clé isolée
    const key = window.LOCAL_STORAGE_KEY || 'tactical_oi_data';
    const dataString = localStorage.getItem(key);
    Store.state.formData = JSON.parse(dataString || '{}') as OiFormData;
    const getVal = (id: string): string => (Store.state.formData[id] as string | undefined) || '';
    const alerts: string[] = [];
    const members: OiPatracMember[] = (Store.state.formData.patracdvr_rows || []).flatMap((row) => row.members);
    const indiaMembers = members.filter((m) => m.cellule && m.cellule.toLowerCase().startsWith('india'));
    const aoMembers = members.filter((m) => m.cellule && m.cellule.toLowerCase().startsWith('ao'));
    const allAssignedMembers = [...indiaMembers, ...aoMembers];

    if (!getVal('date_op')) { alerts.push("La Date de l'opération est manquante. <span class='material-symbols-outlined'>event</span>"); }

    if (!Store.state.formData.adversaries || Store.state.formData.adversaries.length === 0) {
        alerts.push("Aucun adversaire n'a été créé. (Onglet 2) <span class='material-symbols-outlined'>person</span>");
    } else {
        Store.state.formData.adversaries.forEach((adv, index) => {
            if (!adv.nom_adversaire) alerts.push(`Le Nom de l'adversaire n°${index + 1} est manquant. <span class='material-symbols-outlined'>person</span>`);
            if (!adv.domicile_adversaire) alerts.push(`Le Domicile de l'adversaire "${adv.nom_adversaire || index + 1}" est manquant. <span class='material-symbols-outlined'>home</span>`);
        });
    }

    allAssignedMembers.forEach((member) => {
        const hasNoPrimary = member.principales === 'Sans' || !member.principales;
        const hasNoSecondary = member.secondaires === 'Sans' || !member.secondaires;

        if (hasNoPrimary && hasNoSecondary && member.fonction !== 'Sans') {
            alerts.push(`Membre ${member.trigramme} est assigné mais n'a AUCUN armement principal/secondaire. (Cellule: ${member.cellule}) <span class='material-symbols-outlined'>local_fire_department</span>`);
        }
        if (member.afis !== 'Sans' && !member.afis) {
            alerts.push(`Membre ${member.trigramme} a un AFI non spécifié. <span class='material-symbols-outlined'>handgun</span>`);
        }
    });

    const chefInter = allAssignedMembers.find((m) => m.fonction && m.fonction.includes('Chef inter'));
    if (chefInter && !chefInter.cellule.toLowerCase().startsWith('india')) {
        alerts.push(`Le Chef inter (${chefInter.trigramme}) est assigné à la cellule ${chefInter.cellule} au lieu d'India. <span class='material-symbols-outlined'>group</span>`);
    }

    if (!Store.state.formData.time_events || Store.state.formData.time_events.length < 3) {
        alerts.push("La Chronologie (T0, T1, T4...) est incomplète. Au moins 3 étapes sont recommandées. (Onglet 5) <span class='material-symbols-outlined'>timeline</span>");
    } else {
        const t4 = Store.state.formData.time_events.find((e) => e.type === 'T4');
        if (!t4) alerts.push("Le TOP ACTION (T4) n'est pas défini dans la chronologie. <span class='material-symbols-outlined'>timer</span>");
    }

    const unassignedCount = (Store.state.formData.patracdvr_unassigned || []).length;
    if (unassignedCount > 0) {
        alerts.push(`${unassignedCount} membres ne sont PAS assignés à un véhicule/équipe. <span class='material-symbols-outlined'>groups_2</span>`);
    }

    const coherenceAlertsContainer = document.getElementById('coherence_alerts_container');
    if (coherenceAlertsContainer) {
        coherenceAlertsContainer.innerHTML = '';
        if (alerts.length > 0) {
            alerts.forEach((alertText) => {
                const alertDiv = document.createElement('div');
                alertDiv.className = 'coherence-alert';
                alertDiv.innerHTML = `<span class="material-symbols-outlined">error</span> ${alertText.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')}`;
                coherenceAlertsContainer.appendChild(alertDiv);
            });
        } else {
            coherenceAlertsContainer.innerHTML = '<div class="coherence-alert" style="background-color: var(--success-green); color: #000000;"><span class="material-symbols-outlined">check_circle</span> Aucune incohérence majeure détectée. Prêt à générer.</div>';
        }
    }

    const recapFinalisation = document.getElementById('recap_finalisation');
    if (recapFinalisation) {
        let recapHtml = '<h4>Synthèse des Éléments Clés :</h4><ul>';
        recapHtml += `<li>Opération du ${getVal('date_op') || 'N/A'} - H: ${getVal('heure_execution') || 'N/A'}</li>`;
        if (Store.state.formData.adversaries) {
            Store.state.formData.adversaries.forEach((adv, i) => {
                recapHtml += `<li>Objectif ${i + 1} : ${adv.nom_adversaire || 'Sans Nom'}</li>`;
            });
        }
        recapHtml += `<li>Équipe INDIA : ${indiaMembers.map((m) => m.trigramme).join(', ') || 'N/A'}</li>`;
        recapHtml += `<li>Équipe AO : ${aoMembers.map((m) => m.trigramme).join(', ') || 'N/A'}</li>`;
        recapHtml += `<li>Hypothèses : ${(Store.state.formData.hypotheses || []).slice(0, 1).join(', ').substring(0, 30) || 'N/A'}</li>`;
        recapHtml += '</ul>';
        recapFinalisation.innerHTML = recapHtml;
    }

    return alerts.length === 0;
}


// --- GLOBAL EXPOSURE --- formulaires.js:362-371 ET :831-845 (2 blocs de pose
// dupliqués, valeurs identiques sauf 2 noms exclusifs à l'un des deux, cf.
// en-tête de ce fichier) : consolidés ici en un unique bloc.
window.addDynamicField = addDynamicField;
window.initChipContainer = initChipContainer;
window.getChipData = getChipData;
window.addMeField = addMeField;
window.addTimeEvent = addTimeEvent;
window.updateAdvTitle = updateAdvTitle;
window.removeAdversary = removeAdversary; // formulaires.js:838 (absent du 1er bloc :362-371)
window.addAdversary = addAdversary;
window.toggleAdvSection = toggleAdvSection; // formulaires.js:370 (absent du 2nd bloc :831-845)
window.addHypothesis = addHypothesis;
window.syncDomToStore = syncDomToStore; // formulaires.js:841 — version DÉBOUNCÉE, écrase l'alias non-débouncé posé par init.ts
window.saveToStorage = syncDomToStore; // formulaires.js:842 — alias, écrase init.ts (commentaire d'origine conservé : sera écrasé par formulaires.js)
window.saveFormData = syncDomToStore; // formulaires.js:843
window.flushFormData = flushFormData; // formulaires.js:844 — OI1, vrai flush immédiat (non débouncé)
// formulaires.js:845 — `loadFormData` retourne `Promise<boolean>` (verbatim,
// cf. en-tête) ; `OiFormGlobals.loadFormData` est typé `Promise<void>`.
// `Promise<T>` N'EST PAS assignable à `Promise<void>` (contrairement au
// retour direct `T` vers `void`, cf. `checkCoherence` plus haut) : enveloppe
// fine qui ignore la valeur de résolution, aucun changement de comportement
// pour les appelants (`main.ts` l'appelle nu, sans lire son retour, SPEC §12.3).
window.loadFormData = async () => { await loadFormData(); };

window.isFormLoading = false; // formulaires.js:360

// OI1 — Flush IMMÉDIAT DOM→Store→stockage avant toute frontière sortante, pour
// qu'aucune frappe récente (dans la fenêtre de débounce 500 ms) ne soit perdue
// à la fermeture de l'onglet ou au passage en arrière-plan. On utilise immediateSync
// (et non la version débouncée, dont le minuteur ne se déclenche jamais si la page se ferme).
// formulaires.js:851-858
(function installFlushOnBoundaries() {
    const flush = (): void => { try { immediateSync(); } catch { /* non bloquant */ } };
    window.addEventListener('pagehide', flush);
    window.addEventListener('beforeunload', flush);
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') flush();
    });
})();
window.checkCoherence = checkCoherence; // formulaires.js:859

// --- SESSION MANAGEMENT & RESET FUNCTIONS ---

/**
 * Exporte la session actuelle dans un fichier JSON.
 * formulaires.js:866-882
 */
function exportSession(): void {
    syncDomToStore();
    const data = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (data) {
        const blob = new Blob([data], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `OI_Session_${new Date().toISOString().slice(0, 10)}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    } else {
        alert('Aucune donnée à exporter.');
    }
}
window.exportSession = exportSession;

/**
 * Importe une session depuis un fichier JSON.
 * formulaires.js:887-913
 */
function importSession(file: File): void {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
        try {
            // formulaires.js:892 — l'original lit `event.target.result` ; capture
            // directe de `reader.result` (même référence, `event.target === reader`
            // à l'exécution), même précédent que medias.ts/@pctac/utils.ts.
            const result = reader.result;
            if (typeof result !== 'string') {
                throw new Error("FileReader n'a pas renvoyé de chaîne (readAsText).");
            }
            const json = result;
            const data: unknown = JSON.parse(json); // Validation JSON

            // On s'assure que c'est bien un objet de données tactiques
            if (typeof data !== 'object' || Array.isArray(data)) {
                throw new Error('Format de données invalide');
            }

            const key = window.LOCAL_STORAGE_KEY || 'tactical_oi_data';
            localStorage.setItem(key, json);
            // CORRECTIF DE PORTAGE (SPEC-OI-CONVERSION §9) — sans ce drapeau, le flush
            // beforeunload/pagehide de installFlushOnBoundaries() ré-écrit la clé avec
            // le DOM encore vierge et efface la session tout juste importée.
            // Même garde que applyArchiveImport (formulaires.js:1234) et resetAllData (:1309).
            window.isFormLoading = true;
            alert('Session importée avec succès. Rechargement du formulaire...');

            // Le rechargement est la méthode la plus sûre pour reconstruire tout le DOM
            // proprement à partir du nouvel état localStorage.
            location.reload();
        } catch (err) {
            alert('Erreur: Fichier de session invalide.');
            console.error(err);
        }
    };
    reader.readAsText(file);
}
window.importSession = importSession;

// --- ARCHIVE TOUT-EN-UN (.oi.zip) ---
// Exporte/importe en un clic l'INTÉGRALITÉ de l'OI : tous les champs
// (tactical_oi_data, qui inclut la cartographie pins/shapes/vue) + toutes les
// photos (Blobs IndexedDB : zones photos, fond PDF, membres, annotations).
// Même principe que l'archive PC-Tac (.pctac.zip).
// formulaires.js:920 — tuple à 1 élément (adaptation de typage, cf. en-tête).
const OI_ARCHIVE_KEYS: readonly [string] = [LOCAL_STORAGE_KEY]; // tactical_oi_data = champs + cartographie

/**
 * Exporte toute la session (champs + photos + carto) dans un seul .oi.zip.
 * formulaires.js:925-994
 */
async function exportArchive(): Promise<void> {
    // formulaires.js:926 — garde « lib absente » réécrite en test de forme
    // (JSZip est désormais un import statique, toujours défini).
    if (typeof JSZip !== 'function') {
        alert("JSZip indisponible (réseau ?). Impossible de générer l'archive.");
        return;
    }
    try {
        // 1) Flush DOM -> Store -> localStorage (immédiat, non débouncé)
        immediateSync();
        if (dbManager && !dbManager.db) {
            try { await dbManager.init(); } catch { /* IndexedDB indispo */ }
        }

        const zip = new JSZip();

        // 2) Données localStorage (champs + cartographie)
        const data: Record<string, string> = {};
        OI_ARCHIVE_KEYS.forEach((k) => {
            const raw = localStorage.getItem(k);
            if (raw !== null) data[k] = raw;
        });
        zip.file('data.json', JSON.stringify(data, null, 2));

        // 3) Images (Blobs IndexedDB) -> octets bruts + table des types MIME
        const imageMeta: Record<string, string> = {};
        const imagesFolder = zip.folder('images');
        let imgCount = 0;
        if (dbManager && dbManager.db) {
            let keys: IDBValidKey[] = [];
            try { keys = await dbManager.getAllKeys(); } catch { keys = []; }
            for (const key of keys) {
                const keyStr = String(key);
                try {
                    const blob = await dbManager.getItem(keyStr);
                    if (!blob) continue;
                    imageMeta[keyStr] = blob.type || '';
                    // ArrayBuffer plutôt que Blob : entrée JSZip la plus largement supportée.
                    const ab = (typeof blob.arrayBuffer === 'function')
                        ? await blob.arrayBuffer()
                        : blob;
                    // formulaires.js:963 — `folder('images')` est typé `JSZip | null` bien
                    // qu'il ne renvoie jamais `null` pour un nom simple (aucun changement
                    // de comportement observable) — même précédent que @pctac/archive.ts.
                    if (imagesFolder) imagesFolder.file(encodeURIComponent(keyStr) + '.bin', ab);
                    imgCount++;
                } catch (err) {
                    console.warn('[OI Archive] image illisible:', keyStr, err);
                }
            }
        }
        zip.file('images.json', JSON.stringify(imageMeta, null, 2));

        // 4) Manifest
        zip.file('manifest.json', JSON.stringify({
            appName: 'OI',
            version: 1,
            createdAt: new Date().toISOString(),
            imageCount: imgCount
        }, null, 2));

        const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
        const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `OI-Archive-${stamp}.oi.zip`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(a.href), 2000);
        if (typeof window.toast === 'function') window.toast(`Archive exportée (${imgCount} photo${imgCount > 1 ? 's' : ''})`, 'success');
    } catch (e) {
        console.error('[OI Archive] export échec:', e);
        alert("Erreur d'export d'archive : " + (e instanceof Error ? e.message : String(e)));
    }
}
window.exportArchive = exportArchive;

/**
 * Analyse robuste d'une archive .oi.zip. Ne touche À RIEN : se contente de
 * valider et de renvoyer { ok, error?, zip?, dataJson?, imageMeta? }.
 * Centralise TOUTES les exceptions (zip illisible, data.json manquant/corrompu,
 * mauvaise app, données OI absentes/illisibles) pour un message clair.
 * formulaires.js:1006-1062
 */
async function parseArchive(file: File): Promise<OiParsedArchive> {
    if (!file) return { ok: false, error: 'Aucun fichier sélectionné.' };
    if (file.size === 0) return { ok: false, error: 'Archive vide (0 octet) : fichier illisible.' };
    if (typeof JSZip !== 'function') return { ok: false, error: "JSZip indisponible (réseau ?). Impossible de lire l'archive." };

    let zip: JSZip;
    try {
        zip = await JSZip.loadAsync(await file.arrayBuffer());
    } catch {
        return { ok: false, error: "Fichier illisible : ce n'est pas une archive .oi.zip valide (ou elle est corrompue)." };
    }

    const dataFile = zip.file('data.json');
    if (!dataFile) return { ok: false, error: 'Archive invalide : « data.json » introuvable. Fichier non reconnu.' };

    let dataJson: unknown;
    try {
        dataJson = JSON.parse(await dataFile.async('string'));
    } catch {
        return { ok: false, error: 'Archive corrompue : « data.json » illisible (JSON invalide). Import annulé.' };
    }
    if (!dataJson || typeof dataJson !== 'object' || Array.isArray(dataJson)) {
        return { ok: false, error: 'Archive invalide : structure de données inattendue. Import annulé.' };
    }
    // JUSTIFICATION unknown : validé ci-dessus (objet non-array) ; JSON.parse ne
    // garantit pas les VALEURS (string), comme l'original — non revalidé plus finement.
    const dataJsonRecord = dataJson as Record<string, string>;

    const manifestFile = zip.file('manifest.json');
    if (manifestFile) {
        try {
            const manifest = JSON.parse(await manifestFile.async('string')) as { appName?: string } | null;
            if (manifest && manifest.appName && manifest.appName !== 'OI') {
                return { ok: false, error: `Cette archive provient de « ${manifest.appName} », pas du Générateur d'OI. Import annulé.` };
            }
        } catch { /* manifest illisible : on tolère */ }
    }

    const oiRaw = dataJsonRecord[OI_ARCHIVE_KEYS[0]];
    if (oiRaw === undefined || oiRaw === null) {
        return { ok: false, error: 'Archive non reconnue : aucune donnée OI (tactical_oi_data) trouvée.' };
    }
    try {
        const probe: unknown = JSON.parse(oiRaw);
        if (!probe || typeof probe !== 'object') throw new Error('shape');
    } catch {
        return { ok: false, error: 'Données OI corrompues dans l\'archive (tactical_oi_data illisible). Import annulé.' };
    }

    let imageMeta: Record<string, string> = {};
    const metaFile = zip.file('images.json');
    if (metaFile) {
        try { imageMeta = (JSON.parse(await metaFile.async('string')) as Record<string, string>) || {}; } catch { imageMeta = {}; }
    }

    return { ok: true, zip, dataJson: dataJsonRecord, imageMeta };
}
window.parseArchive = parseArchive;

/**
 * Importe une archive .oi.zip (champs + photos + carto). Accepte aussi un
 * ancien fichier .json de session (compat : délègue à importSession).
 * formulaires.js:1064-1086
 */
async function importArchive(file: File): Promise<void> {
    if (!file) return;
    const name = (file.name || '').toLowerCase();

    // Compat : ancienne session JSON -> on délègue à importSession (si dispo).
    if (name.endsWith('.json')) {
        if (typeof window.importSession === 'function') { window.importSession(file); return; }
        alert('Import JSON indisponible : fonction de session absente.');
        return;
    }

    // 1) Analyse robuste : toute exception est interceptée et explicitée.
    const parsed = await window.parseArchive(file);
    if (!parsed.ok) { alert(parsed.error); return; }
    // 2) Détection des catégories réellement présentes + modale de sélection.
    const cats = detectImportCategories(parsed);
    if (!cats.length) { alert("L'archive ne contient aucune donnée importable."); return; }
    const selectedIds = await showImportSelectModal(cats);
    if (!selectedIds || !selectedIds.length) return; // annulé, fermé, ou rien coché

    // 3) Import SÉLECTIF robuste (images best-effort, rollback quota).
    await applyArchiveImport(parsed, cats, selectedIds);
}
window.importArchive = importArchive;

/**
 * Catégories d'import. `rest:true` = toutes les clés non possédées par une autre
 * catégorie (= les champs texte du formulaire). `images:true` = tire aussi les
 * blobs IndexedDB. `countOf(oi, imgN)` compte les éléments pour l'affichage.
 * formulaires.js:1088-1100
 *
 * `countOf` n'apparaît pas dans le contrat public `OiImportCategory` (l'original
 * ne l'expose pas non plus au-delà de cette fonction) : type interne strictement
 * sur-ensemble, structurellement assignable en retour (cf. en-tête de ce fichier).
 */
interface OiImportCategoryInternal extends OiImportCategory {
    countOf?: (oi: OiFormData, imgN: number) => number;
}

const IMPORT_CATEGORIES: OiImportCategoryInternal[] = [
    { id: 'champs', label: 'Champs texte (situation, mission, environnement…)', icon: 'description', rest: true },
    { id: 'adversaires', label: 'Adversaires', icon: 'person_search', keys: ['adversaries'], unit: 'adversaire', countOf: (o) => (o.adversaries || []).length },
    { id: 'photos', label: 'Photos HD (annotations, légendes)', icon: 'photo_camera', keys: ['dynamic_photos'], images: true, unit: 'photo', countOf: (_o, imgN) => imgN },
    { id: 'membres', label: 'Membres PATRACDVR (+ Configuration Unité)', icon: 'groups', keys: ['patracdvr_unassigned', 'patracdvr_rows', 'options'], unit: 'membre', countOf: (o) => ((o.patracdvr_unassigned || []).length + (o.patracdvr_rows || []).reduce((s, r) => s + r.members.length, 0)) },
    { id: 'articulation', label: 'Articulation MOICP / ZMSPCP / Effraction', icon: 'account_tree', keys: ['moicp_blocks', 'zmspcp_blocks', 'effraction_blocks', 'rame_vl_order', 'colonne_progression_order', 'ordre_penetration_order'], unit: 'bloc', countOf: (o) => ((o.moicp_blocks || []).length + (o.zmspcp_blocks || []).length + (o.effraction_blocks || []).length) },
    { id: 'cartographie', label: 'Cartographie (carte, pings, dessins)', icon: 'map', keys: ['cartography'], unit: 'élément', countOf: (o) => { const c: Partial<OiCartographyState> = o.cartography || {}; return (c.pins || []).length + (c.shapes || []).length; } }
];

// formulaires.js:1102-1106
function _imgCountInZip(zip: JSZip): number {
    let n = 0;
    const f = zip.folder('images');
    if (f) f.forEach((_rp, entry) => { if (!entry.dir) n++; });
    return n;
}

/** Renvoie la liste des catégories réellement présentes dans l'archive (avec compteur). */
// formulaires.js:1109-1128
function detectImportCategories(parsed: OiParsedArchiveOk): OiImportCategory[] {
    let oi: OiFormData = {};
    try { oi = (JSON.parse(parsed.dataJson[OI_ARCHIVE_KEYS[0]] || '{}') as OiFormData) || {}; } catch { oi = {}; }
    // JUSTIFICATION cast : OiParsedArchiveOk.zip est typé `unknown` par le contrat
    // (découplage vis-à-vis de la forme exacte de JSZip) ; on sait ici qu'il
    // s'agit bien de l'instance produite par parseArchive.
    const imgN = _imgCountInZip(parsed.zip as JSZip);
    const specialKeys = new Set(IMPORT_CATEGORIES.filter((c) => !c.rest).flatMap((c) => c.keys || []));
    const restKeys = Object.keys(oi).filter((k) => !specialKeys.has(k));
    const hasVal = (v: unknown): boolean => v != null && v !== '' && !(Array.isArray(v) && v.length === 0) &&
        !(typeof v === 'object' && !Array.isArray(v) && Object.keys(v as object).length === 0);

    const present: OiImportCategoryInternal[] = [];
    for (const c of IMPORT_CATEGORIES) {
        if (c.rest) {
            const cnt = restKeys.filter((k) => hasVal(oi[k])).length;
            if (cnt > 0) present.push({ ...c, count: cnt, restKeys });
        } else {
            const count = c.countOf ? c.countOf(oi, imgN) : 0;
            if (count > 0) present.push({ ...c, count });
        }
    }
    return present;
}

/** Affiche la modale de sélection. Résout avec la liste d'ids cochés, ou null si annulé. */
// formulaires.js:1131-1174
function showImportSelectModal(cats: readonly OiImportCategory[]): Promise<string[] | null> {
    return new Promise((resolve) => {
        const modal = document.getElementById('importSelectModal') as HTMLDialogElement | null;
        const list = document.getElementById('importSelectList');
        const allCb = document.getElementById('importSelectAll') as HTMLInputElement | null;
        const confirmBtn = document.getElementById('importSelectConfirmBtn') as HTMLButtonElement | null;
        const cancelBtn = document.getElementById('importSelectCancelBtn') as HTMLButtonElement | null;
        const closeBtn = document.getElementById('importSelectCloseBtn') as HTMLButtonElement | null;
        if (!modal || !list || !allCb || !confirmBtn) { resolve(null); return; }
        const esc = (v: unknown): string => (window.UIPlatform ? window.UIPlatform.esc(v) : String(v));

        list.innerHTML = '';
        cats.forEach((c) => {
            const row = document.createElement('label');
            row.className = 'import-cat-row';
            const unitTxt = c.unit ? `${c.count} ${esc(c.unit)}${(c.count ?? 0) > 1 ? 's' : ''}` : `${c.count}`;
            row.innerHTML = `<input type="checkbox" class="import-cat-cb" value="${esc(c.id)}" checked>
                <span class="material-symbols-outlined">${esc(c.icon)}</span>
                <span class="import-cat-label">${esc(c.label)}</span>
                <span class="import-cat-count">${unitTxt}</span>`;
            list.appendChild(row);
        });
        const cbs = (): HTMLInputElement[] => Array.from(list.querySelectorAll<HTMLInputElement>('.import-cat-cb'));
        allCb.checked = true;
        allCb.onchange = () => { cbs().forEach((cb) => { cb.checked = allCb.checked; }); };
        list.onchange = () => { allCb.checked = cbs().every((cb) => cb.checked); };

        let done = false;
        const cleanup = (result: string[] | null): void => {
            if (done) return; done = true;
            // formulaires.js:1161 — affectation chaînée sur 3 éléments dont 2
            // possiblement null en TS strict (jamais absents en pratique, gabarit
            // statique) : éclatée en 3 affectations gardées, cf. en-tête.
            confirmBtn.onclick = null;
            if (cancelBtn) cancelBtn.onclick = null;
            if (closeBtn) closeBtn.onclick = null;
            if (typeof modal.close === 'function') { try { modal.close(); } catch { /* … */ } }
            document.body.classList.remove('modal-open');
            resolve(result);
        };
        confirmBtn.onclick = () => cleanup(cbs().filter((cb) => cb.checked).map((cb) => cb.value));
        if (cancelBtn) cancelBtn.onclick = () => cleanup(null);
        if (closeBtn) closeBtn.onclick = () => cleanup(null);

        document.body.classList.add('modal-open');
        if (typeof modal.showModal === 'function') { try { modal.showModal(); } catch { modal.setAttribute('open', ''); } }
        else modal.setAttribute('open', '');
    });
}

/** Importe UNIQUEMENT les catégories cochées (fusion non destructive du reste). */
// formulaires.js:1177-1241
async function applyArchiveImport(parsed: OiParsedArchiveOk, cats: readonly OiImportCategory[], selectedIds: readonly string[]): Promise<void> {
    const KEY = OI_ARCHIVE_KEYS[0];
    let oiArchive: Record<string, unknown> = {};
    let oiCurrent: Record<string, unknown> = {};
    try { oiArchive = (JSON.parse(parsed.dataJson[KEY] || '{}') as Record<string, unknown>) || {}; } catch { oiArchive = {}; }
    try { oiCurrent = (JSON.parse(localStorage.getItem(KEY) || '{}') as Record<string, unknown>) || {}; } catch { oiCurrent = {}; }

    const selected = cats.filter((c) => selectedIds.includes(c.id));
    const importImages = selected.some((c) => c.images);

    // Fusion sélective : on ne touche QUE les clés des catégories cochées.
    for (const c of selected) {
        if (c.rest) {
            (c.restKeys || []).forEach((k) => { oiCurrent[k] = oiArchive[k]; });
        } else {
            (c.keys || []).forEach((k) => { if (k in oiArchive) oiCurrent[k] = oiArchive[k]; });
        }
    }

    const snapshot = localStorage.getItem(KEY);
    let imgFail = 0;
    try {
        // Images AVANT le localStorage (clearAllImages mute le Store → flush).
        if (importImages && dbManager) {
            if (!dbManager.db) { try { await dbManager.init(); } catch { /* … */ } }
            if (dbManager.db) {
                try { await dbManager.clearAllImages(); } catch { /* … */ }
                // JUSTIFICATION cast : cf. detectImportCategories.
                const zip = parsed.zip as JSZip;
                const imagesFolder = zip.folder('images');
                if (imagesFolder) {
                    const tasks: Promise<void>[] = [];
                    imagesFolder.forEach((relPath, entry) => {
                        if (entry.dir) return;
                        const k = decodeURIComponent(relPath.replace(/\.bin$/, '').replace(/\.txt$/, ''));
                        tasks.push(entry.async('arraybuffer')
                            .then((ab) => dbManager.putItem(k, new Blob([ab], { type: parsed.imageMeta[k] || '' })))
                            .catch((err: unknown) => { imgFail++; console.warn('[OI Archive] image ignorée:', k, err); }));
                    });
                    await Promise.allSettled(tasks);
                }
            }
        }

        try {
            localStorage.setItem(KEY, JSON.stringify(oiCurrent));
        } catch {
            if (snapshot === null) localStorage.removeItem(KEY); else localStorage.setItem(KEY, snapshot);
            throw new Error("Espace de stockage insuffisant (quota localStorage). Données d'origine restaurées.");
        }

        if (Store && typeof Store.loadFromStorage === 'function') {
            try { Store.loadFromStorage(); } catch { /* … */ }
        }

        // noUncheckedIndexedAccess : split()[0] est toujours défini (au moins un
        // élément) ; repli sur c.label jamais emprunté en pratique.
        const labels = selected.map((c) => c.label.split(' (')[0] ?? c.label).join(', ');
        const warn = imgFail > 0 ? ` (${imgFail} photo(s) ignorée(s))` : '';
        window.isFormLoading = true;
        alert(`Import effectué : ${labels}${warn}. Rechargement…`);
        location.reload();
    } catch (e) {
        console.error('[OI Archive] import sélectif échec:', e);
        alert("Erreur d'import : " + (e instanceof Error ? e.message : String(e)));
    }
}
window.detectImportCategories = detectImportCategories; // formulaires.js:1242
window.showImportSelectModal = showImportSelectModal; // formulaires.js:1243

/**
 * Réinitialise tous les champs de la page active.
 * formulaires.js:1251-1292
 */
async function resetActivePage(): Promise<void> {
    const activeStep = document.querySelector('.wizard-step.active');
    if (!activeStep) return;

    // Protection PATRACDVR
    if (activeStep.querySelector('#patracdvr_container')) {
        window.toast('Le PATRACDVR ne peut être réinitialisé que via son bouton dédié.', 'warning');
        return;
    }

    if (!confirm('Réinitialiser uniquement les champs de la page active ?')) return;

    // 1. Vider les champs standards
    activeStep.querySelectorAll<FieldValueElement>('input:not([type="file"]), textarea, select').forEach((el) => {
        if (el.type === 'checkbox' || el.type === 'radio') (el as HTMLInputElement).checked = false;
        else el.value = '';
    });

    // 2. Supprimer les éléments dynamiques
    activeStep.querySelectorAll('.dynamic-list-item, .adversary-entry, .moicp-block, .zmspcp-block, .effraction-block, .time-item, .order-chip').forEach((el) => el.remove());

    // 3. Désélectionner les puces (chips)
    activeStep.querySelectorAll('.chip-btn.selected').forEach((el) => el.classList.remove('selected'));

    // 4. Supprimer les photos de la zone ET de l'IndexedDB
    const images = activeStep.querySelectorAll<HTMLImageElement>('.image-preview-item img');
    for (const img of images) {
        if (dbManager) await dbManager.deleteItem(img.id);
        // TS strict : closest() renvoie Element | null, jamais absent en pratique
        // (l'image est toujours dans ce conteneur par construction).
        const itemEl = img.closest<HTMLElement>('.image-preview-item');
        if (itemEl) itemEl.remove();
    }

    // Sauvegarde de l'état vidé
    syncDomToStore();

    // Fermer la modale d'options de reset : sans ça elle reste ouverte par-dessus
    // les champs vidés et l'utilisateur croit que rien ne s'est passé.
    const _rom = document.getElementById('resetOptionsModal') as HTMLDialogElement | null;
    if (_rom && _rom.open) _rom.close();
    document.body.classList.remove('modal-open');

    window.toast('Page réinitialisée', 'success');
}
window.resetActivePage = resetActivePage;

/**
 * Réinitialise l'intégralité du formulaire (Garde le PATRACDVR par défaut).
 * formulaires.js:1297-1338
 */
async function resetAllData(keepPatrac: boolean = true): Promise<void> {
    const msg = keepPatrac
        ? 'Réinitialisation complète : Effacer toutes les données et photos (SAUF la configuration PATRAC) ?'
        : 'Réinitialisation TOTALE : Effacer TOUTES les données, y compris le personnel ?';

    if (!confirm(msg)) return;

    // Neutraliser le flush de fermeture (pagehide/beforeunload) ET la sauvegarde
    // débouncée : sans ça, le DOM courant — encore rempli, car le reset n'efface
    // que le stockage et le Store, pas les champs visibles — réécraserait le
    // localStorage vidé pendant la fenêtre d'1 s précédant le reload.
    // syncDomToStore ignore tout flush tant que isFormLoading est vrai.
    window.isFormLoading = true;

    // Fermer la modale d'options (le reload la fermerait, mais on évite le clignotement).
    const _rom = document.getElementById('resetOptionsModal') as HTMLDialogElement | null;
    if (_rom && _rom.open) _rom.close();
    document.body.classList.remove('modal-open');

    let patracBackup: OiFormData | null = null;
    if (keepPatrac && Store.state.formData) {
        patracBackup = {
            patracdvr_rows: Store.state.formData.patracdvr_rows || [],
            patracdvr_unassigned: Store.state.formData.patracdvr_unassigned || [],
            // formulaires.js:1321 — `{}` en repli n'est pas structurellement un
            // OiMemberConfig complet ; en pratique toujours défini après un premier
            // chargement (Object.assign en amont) — cast de typage pur, fidélité au
            // comportement original qui ne valide pas la forme.
            options: Store.state.formData.options || ({} as OiMemberConfig),
        };
    }

    // Clear everything
    localStorage.removeItem(LOCAL_STORAGE_KEY);
    if (dbManager) await dbManager.clearAllImages();

    if (patracBackup) {
        Store.state.formData = patracBackup;
        Store.saveToStorage();
        window.toast('Application réinitialisée (Personnel conservé)', 'success');
        setTimeout(() => location.reload(), 1000);
    } else {
        window.toast('Application réinitialisée à zéro', 'success');
        setTimeout(() => location.reload(), 1000);
    }
}
window.resetAllData = resetAllData;
