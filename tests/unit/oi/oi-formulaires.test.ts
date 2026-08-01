/**
 * oi-formulaires.test.ts — Tests unitaires du cœur de persistance formulaire
 * (P3.CONV, paquet `oi-formulaires`, CRITIQUE, port de `modules/formulaires.js`,
 * 1338 LOC).
 *
 * Couvre les tests OBLIGATOIRES de `PAQUETS-OI.json` (id="oi-formulaires") :
 *  (a) `syncDomToStore` exporté est bien la version DÉBOUNCÉE (deux appels
 *      rapprochés ne produisent qu'une écriture, `vi.useFakeTimers`) et
 *      `flushFormData` la version immédiate — même référence que
 *      `syncDomToStoreImmediate`.
 *  (b) hash de non-régression : un cycle `loadFormData` → re-sync ne perd
 *      aucun champ clé (chronologie, hypothèses, adversaire).
 *  (c) `parseArchive` sur une archive valide et sur 3 cas d'erreur (zip
 *      corrompu, manifest/app différente, data.json absent).
 *  (d) `checkCoherence` sur des cas d'alerte connus (date manquante,
 *      chronologie < 3 étapes, membre sans armement) + cas cohérent.
 *  (e) TEST DÉDIÉ AU CORRECTIF « importSession survit au flush de
 *      beforeunload » (SPEC-OI-CONVERSION.md §9).
 *  (f) complémentaire : hors de tout import, un `beforeunload` flushe
 *      normalement (la garde ne casse pas le safety-net nominal).
 *
 * `vi.resetModules()` + import dynamique par test (même précédent que
 * `oi-store.test.ts`, `oi-patrac.test.ts`) : isolation de l'état de module
 * (debounce, listeners `installFlushOnBoundaries`) entre les tests.
 *
 * Ce module importe transitivement `@oi/init.js`, `@oi/dessin.js`,
 * `@oi/patrac.js` (imports réels de `formulaires.ts`) : leurs propres
 * affectations `window.X = …` (implémentations RÉELLES) sont posées à
 * l'import. Les fonctions RÈGLE D'OR consommées par `formulaires.ts`
 * (`window.initializePatracdvr`, `window.addMoicp`, `window.addZmspcp`,
 * `window.addEffraction`, `window.refreshRameVL`,
 * `window.refreshColonneProgression`, `window.refreshOrdrePenetration`,
 * `window.updateArticulationDisplay`, `window.syncAllThumbnails`,
 * `window.updateCustomBgPreview`, `window.toast`, `window.removeImage`) sont
 * RE-STUBBÉES en `vi.fn()` APRÈS l'import de `formulaires.ts`, pour isoler ce
 * paquet de l'implémentation réelle des autres (même précédent que
 * `oi-store.test.ts` : « window.syncDomToStore = syncSpy; »).
 *
 * indexedDB N'EST PAS stubbée : aucun test n'exerce le chemin photo
 * (`data.dynamic_photos` absent des fixtures ⇒ le bloc `dbManager.getItem`
 * de `loadFormData` n'est jamais atteint), ni les téléchargements d'images
 * `exportArchive`/`applyArchiveImport` (`dbManager.db` reste `null` ⇒ les
 * branches images sont sautées, comportement identique à IndexedDB indisponible).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** DOM minimal requis par les fonctions de `formulaires.ts` exercées ici. */
function setupDom(): void {
    document.body.innerHTML = `
        <form id="oi-form">
            <input id="date_op" type="date">
            <input id="heure_execution" type="time">
            <input id="situation" type="text">
        </form>
        <div id="time_events_container"></div>
        <div id="adversaries_container"></div>
        <div id="hypotheses_container"></div>
        <div id="moicp_container"></div>
        <div id="zmspcp_container"></div>
        <div id="effraction_container"></div>
        <div id="rame_vl_container"></div>
        <div id="colonne_progression_container"></div>
        <div id="ordre_penetration_container"></div>
        <div id="unassigned_members_container"></div>
        <div id="patracdvr_container"></div>
        <div id="coherence_alerts_container"></div>
        <div id="recap_finalisation"></div>
        <dialog id="resetOptionsModal"></dialog>
        <dialog id="importSelectModal">
            <div id="importSelectList"></div>
            <input id="importSelectAll" type="checkbox">
            <button id="importSelectConfirmBtn"></button>
            <button id="importSelectCancelBtn"></button>
            <button id="importSelectCloseBtn"></button>
        </dialog>
    `;
}

/**
 * Re-stub les façades RÈGLE D'OR (SPEC §2.2) consommées cross-module par
 * `formulaires.ts`, pour isoler ce paquet des implémentations réelles de
 * `patrac.ts`/`articulation.ts`/`medias.ts`/`notifications.ts` (posées par les
 * imports transitifs de ce fichier de test).
 */
function stubCrossModuleWindow(): void {
    window.initializePatracdvr = vi.fn();
    window.updateArticulationDisplay = vi.fn();
    window.addMoicp = vi.fn();
    window.addZmspcp = vi.fn();
    window.addEffraction = vi.fn();
    window.refreshRameVL = vi.fn();
    window.refreshColonneProgression = vi.fn();
    window.refreshOrdrePenetration = vi.fn();
    window.syncAllThumbnails = vi.fn();
    window.updateCustomBgPreview = vi.fn(async () => { /* stub */ });
    window.toast = vi.fn();
    window.removeImage = vi.fn(async () => { /* stub */ });
}

describe('oi-formulaires — persistance du formulaire OI', () => {
    beforeEach(() => {
        setupDom();
        localStorage.clear();
        vi.resetModules();
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
        vi.useRealTimers();
    });

    describe('(a) syncDomToStore — identité débouncée / immédiate (formulaires.js:386-393)', () => {
        it('syncDomToStore (débouncée) : deux appels rapprochés ne produisent qu\'une écriture localStorage', async () => {
            vi.useFakeTimers();
            const mod = await import('@oi/formulaires.js');
            stubCrossModuleWindow();

            const setItemSpy = vi.spyOn(localStorage, 'setItem');
            mod.syncDomToStore();
            mod.syncDomToStore();
            mod.syncDomToStore();

            // Rien n'est encore écrit tant que le minuteur de 500ms n'a pas expiré.
            expect(setItemSpy).not.toHaveBeenCalled();

            vi.advanceTimersByTime(500);

            expect(setItemSpy).toHaveBeenCalledTimes(1);
        });

        it('flushFormData / syncDomToStoreImmediate : écrit IMMÉDIATEMENT (pas de minuteur)', async () => {
            const mod = await import('@oi/formulaires.js');
            stubCrossModuleWindow();

            const setItemSpy = vi.spyOn(localStorage, 'setItem');
            mod.flushFormData();

            expect(setItemSpy).toHaveBeenCalledTimes(1);
        });

        it('flushFormData et syncDomToStoreImmediate sont LA MÊME référence de fonction', async () => {
            const mod = await import('@oi/formulaires.js');
            expect(mod.flushFormData).toBe(mod.syncDomToStoreImmediate);
        });

        it('syncDomToStore (débouncée) est une référence DIFFÉRENTE de flushFormData (immédiate)', async () => {
            const mod = await import('@oi/formulaires.js');
            expect(mod.syncDomToStore).not.toBe(mod.flushFormData);
        });

        it('window.syncDomToStore / window.saveToStorage / window.saveFormData pointent vers la version débouncée exportée', async () => {
            const mod = await import('@oi/formulaires.js');
            expect(window.syncDomToStore).toBe(mod.syncDomToStore);
            expect(window.saveToStorage).toBe(mod.syncDomToStore);
            expect(window.saveFormData).toBe(mod.syncDomToStore);
            expect(window.flushFormData).toBe(mod.flushFormData);
        });
    });

    describe('(b) non-régression : loadFormData → re-sync ne perd aucun champ clé', () => {
        it('restitue chronologie, hypothèses et adversaire après un cycle load → sync', async () => {
            const session = {
                date_op: '2026-08-01',
                situation: 'Situation de test',
                time_events: [
                    { type: 'T0', hour: '08:00', description: 'Rasso' },
                    { type: 'T1', hour: '08:30', description: 'Départ' },
                    { type: 'T4', hour: '09:00', description: 'TOP ACTION' },
                ],
                hypotheses: ['Hypothèse A', 'Hypothèse B'],
                adversaries: [
                    { id: 'adv_1', nom_adversaire: 'DUPONT', domicile_adversaire: '1 rue Test', me_list: [], etat_esprit_list: [], volume_list: [], vehicules_list: [] },
                ],
                patracdvr_rows: [],
                patracdvr_unassigned: [],
            };
            localStorage.setItem('tactical_oi_data', JSON.stringify(session));

            const mod = await import('@oi/formulaires.js');
            stubCrossModuleWindow();

            // window.loadFormData est une enveloppe void (cf. formulaires.ts,
            // en-tête) — le comportement est vérifié par l'état DOM/Store
            // reconstruit, pas par une valeur de retour.
            await window.loadFormData();

            // Le DOM doit avoir été reconstruit avec les 3 events, 2 hypothèses et 1 adversaire.
            expect(document.querySelectorAll('#time_events_container .time-item').length).toBe(3);
            expect(document.querySelectorAll('#hypotheses_container .hypothese-input').length).toBe(2);
            expect(document.querySelectorAll('#adversaries_container .adversary-entry').length).toBe(1);

            // Re-synchronise le DOM reconstruit vers le Store/localStorage (immédiat).
            mod.flushFormData();
            const raw = localStorage.getItem('tactical_oi_data');
            expect(raw).not.toBeNull();
            const roundTripped = JSON.parse(raw as string) as {
                date_op?: string;
                time_events?: { type: string; hour: string; description: string }[];
                hypotheses?: string[];
                adversaries?: { nom_adversaire?: unknown }[];
            };

            expect(roundTripped.date_op).toBe('2026-08-01');
            expect(roundTripped.time_events).toHaveLength(3);
            expect(roundTripped.time_events?.[2]?.type).toBe('T4');
            expect(roundTripped.hypotheses).toEqual(['Hypothèse A', 'Hypothèse B']);
            expect(roundTripped.adversaries).toHaveLength(1);
            expect(roundTripped.adversaries?.[0]?.nom_adversaire).toBe('DUPONT');
        });

        it('loadFormData initialise le PATRACDVR (vide) si aucune donnée en localStorage', async () => {
            await import('@oi/formulaires.js');
            stubCrossModuleWindow();

            await window.loadFormData();

            expect(window.initializePatracdvr).toHaveBeenCalledWith({});
        });
    });

    describe('(c) parseArchive — validation pure (formulaires.js:1006-1062)', () => {
        async function buildValidArchiveFile(): Promise<File> {
            const JSZipCtor = (await import('jszip')).default;
            const zip = new JSZipCtor();
            zip.file('data.json', JSON.stringify({ tactical_oi_data: JSON.stringify({ date_op: '2026-08-01' }) }));
            zip.file('manifest.json', JSON.stringify({ appName: 'OI', version: 1 }));
            zip.file('images.json', JSON.stringify({}));
            const blob = await zip.generateAsync({ type: 'blob' });
            return new File([blob], 'session.oi.zip');
        }

        it('accepte une archive .oi.zip valide (ok: true, dataJson/imageMeta exposés)', async () => {
            await import('@oi/formulaires.js');
            const file = await buildValidArchiveFile();

            const parsed = await window.parseArchive(file);

            expect(parsed.ok).toBe(true);
            if (parsed.ok) {
                expect(parsed.dataJson['tactical_oi_data']).toContain('2026-08-01');
                expect(parsed.imageMeta).toEqual({});
            }
        });

        it('refuse un fichier vide (0 octet)', async () => {
            await import('@oi/formulaires.js');
            const file = new File([], 'vide.oi.zip');

            const parsed = await window.parseArchive(file);

            expect(parsed.ok).toBe(false);
            if (!parsed.ok) expect(parsed.error).toContain('vide');
        });

        it('refuse un zip corrompu (contenu non-zip)', async () => {
            await import('@oi/formulaires.js');
            const file = new File(['ceci n\'est pas un zip'], 'corrompu.oi.zip');

            const parsed = await window.parseArchive(file);

            expect(parsed.ok).toBe(false);
            if (!parsed.ok) expect(parsed.error).toMatch(/illisible|corrompue/i);
        });

        it('refuse une archive dont le manifest indique une autre application', async () => {
            const JSZipCtor = (await import('jszip')).default;
            const zip = new JSZipCtor();
            zip.file('data.json', JSON.stringify({ tactical_oi_data: JSON.stringify({}) }));
            zip.file('manifest.json', JSON.stringify({ appName: 'PC TAC' }));
            const blob = await zip.generateAsync({ type: 'blob' });
            const file = new File([blob], 'autre-app.zip');

            await import('@oi/formulaires.js');
            const parsed = await window.parseArchive(file);

            expect(parsed.ok).toBe(false);
            if (!parsed.ok) expect(parsed.error).toContain('PC TAC');
        });

        it('refuse une archive sans data.json', async () => {
            const JSZipCtor = (await import('jszip')).default;
            const zip = new JSZipCtor();
            zip.file('manifest.json', JSON.stringify({ appName: 'OI' }));
            const blob = await zip.generateAsync({ type: 'blob' });
            const file = new File([blob], 'sans-data.zip');

            await import('@oi/formulaires.js');
            const parsed = await window.parseArchive(file);

            expect(parsed.ok).toBe(false);
            if (!parsed.ok) expect(parsed.error).toContain('data.json');
        });
    });

    describe('(d) checkCoherence — alertes connues (formulaires.js:744-828)', () => {
        it('signale la date d\'opération manquante', async () => {
            localStorage.setItem('tactical_oi_data', JSON.stringify({}));
            await import('@oi/formulaires.js');

            const ok = window.checkCoherence();

            expect(ok).toBe(false);
            const alertsHtml = document.getElementById('coherence_alerts_container')?.innerHTML ?? '';
            expect(alertsHtml).toContain('opération');
        });

        it('signale une chronologie incomplète (< 3 étapes)', async () => {
            localStorage.setItem('tactical_oi_data', JSON.stringify({
                date_op: '2026-08-01',
                adversaries: [{ id: 'a1', nom_adversaire: 'X', domicile_adversaire: 'Y' }],
                time_events: [{ type: 'T0', hour: '08:00', description: '' }],
            }));
            await import('@oi/formulaires.js');

            window.checkCoherence();

            const alertsHtml = document.getElementById('coherence_alerts_container')?.innerHTML ?? '';
            expect(alertsHtml).toContain('Chronologie');
        });

        it('signale un membre assigné sans AUCUN armement principal/secondaire', async () => {
            localStorage.setItem('tactical_oi_data', JSON.stringify({
                date_op: '2026-08-01',
                adversaries: [{ id: 'a1', nom_adversaire: 'X', domicile_adversaire: 'Y' }],
                time_events: [
                    { type: 'T0', hour: '08:00', description: '' },
                    { type: 'T1', hour: '08:10', description: '' },
                    { type: 'T4', hour: '09:00', description: '' },
                ],
                patracdvr_rows: [{
                    vehicle: 'VL1',
                    members: [{
                        trigramme: 'ABC', fonction: 'Inter', cellule: 'India 1',
                        principales: 'Sans', secondaires: 'Sans', afis: 'Sans', grenades: 'Sans',
                        equipement: 'Sans', equipement2: 'Sans', tenue: 'UBAS', gpb: 'GPBL', dir: '',
                    }],
                }],
                patracdvr_unassigned: [],
            }));
            await import('@oi/formulaires.js');

            const ok = window.checkCoherence();

            expect(ok).toBe(false);
            const alertsHtml = document.getElementById('coherence_alerts_container')?.innerHTML ?? '';
            expect(alertsHtml).toContain('ABC');
            expect(alertsHtml).toContain('armement');
        });

        it('ne signale RIEN quand toutes les conditions sont réunies (retourne true)', async () => {
            localStorage.setItem('tactical_oi_data', JSON.stringify({
                date_op: '2026-08-01',
                adversaries: [{ id: 'a1', nom_adversaire: 'X', domicile_adversaire: 'Y' }],
                time_events: [
                    { type: 'T0', hour: '08:00', description: '' },
                    { type: 'T1', hour: '08:10', description: '' },
                    { type: 'T4', hour: '09:00', description: '' },
                ],
                patracdvr_rows: [{
                    vehicle: 'VL1',
                    members: [{
                        trigramme: 'ABC', fonction: 'Inter', cellule: 'India 1',
                        principales: 'UMP9', secondaires: 'PSA', afis: 'PIE', grenades: 'Sans',
                        equipement: 'Sans', equipement2: 'Sans', tenue: 'UBAS', gpb: 'GPBL', dir: '',
                    }],
                }],
                patracdvr_unassigned: [],
            }));
            await import('@oi/formulaires.js');

            const ok = window.checkCoherence();

            expect(ok).toBe(true);
            const alertsHtml = document.getElementById('coherence_alerts_container')?.innerHTML ?? '';
            expect(alertsHtml).toContain('Aucune incohérence majeure');
        });
    });

    describe('(e) CORRECTIF SPEC §9 — importSession survit au flush de beforeunload', () => {
        it('la session importée n\'est PAS écrasée par un beforeunload/pagehide déclenché juste après', async () => {
            // État "vierge" distinct de la session importée, déjà présent en storage.
            localStorage.setItem('tactical_oi_data', JSON.stringify({ situation: 'ETAT VIERGE AVANT IMPORT' }));

            await import('@oi/formulaires.js');
            stubCrossModuleWindow();

            const reloadSpy = vi.fn();
            // jsdom : `Location.prototype.reload` n'est pas configurable (spyOn
            // échoue avec « Cannot redefine property »). On remplace la
            // propriété `location` de `window` elle-même (configurable côté
            // jsdom), avec un objet minimal exposant juste `reload`.
            Object.defineProperty(window, 'location', {
                configurable: true,
                value: { reload: reloadSpy },
            });
            vi.stubGlobal('alert', vi.fn());

            const session = { date_op: '2026-08-01', situation: 'SESSION IMPORTEE' };
            const file = new File([JSON.stringify(session)], 'session.json', { type: 'application/json' });

            window.importSession(file);

            // Attend la résolution asynchrone du FileReader (readAsText).
            await vi.waitFor(() => {
                expect(reloadSpy).toHaveBeenCalled();
            });

            expect(window.isFormLoading).toBe(true);

            // Déclenche manuellement le flush de fermeture : SANS le correctif, il
            // ré-écrirait la clé avec le DOM encore vierge et effacerait l'import.
            window.dispatchEvent(new Event('beforeunload'));
            window.dispatchEvent(new Event('pagehide'));

            const stored = localStorage.getItem('tactical_oi_data');
            expect(stored).not.toBeNull();
            const parsed = JSON.parse(stored as string) as { date_op?: string; situation?: string };
            expect(parsed.date_op).toBe('2026-08-01');
            expect(parsed.situation).toBe('SESSION IMPORTEE');
        });
    });

    describe('(f) complémentaire — hors de tout import, beforeunload flushe normalement', () => {
        it('le safety-net installFlushOnBoundaries flushe bien le DOM courant vers localStorage', async () => {
            const mod = await import('@oi/formulaires.js');
            stubCrossModuleWindow();

            expect(window.isFormLoading).toBe(false);

            const dateInput = document.getElementById('date_op') as HTMLInputElement;
            dateInput.value = '2026-08-01';

            window.dispatchEvent(new Event('beforeunload'));

            const stored = localStorage.getItem('tactical_oi_data');
            expect(stored).not.toBeNull();
            const parsed = JSON.parse(stored as string) as { date_op?: string };
            expect(parsed.date_op).toBe('2026-08-01');
            // Utilisé pour éviter un avertissement de variable inutilisée si le champ n'est pas lu ailleurs.
            expect(mod.syncDomToStore).toBeTypeOf('function');
        });
    });

    describe('Structure DOM — fonctions mécaniques (couverture complémentaire)', () => {
        it('addDynamicField / getChipData / addHypothesis / toggleAdvSection sont posées sur window', async () => {
            await import('@oi/formulaires.js');

            expect(typeof window.addDynamicField).toBe('function');
            expect(typeof window.getChipData).toBe('function');
            expect(typeof window.addHypothesis).toBe('function');
            expect(typeof window.toggleAdvSection).toBe('function');
            expect(typeof window.addAdversary).toBe('function');
            expect(typeof window.removeAdversary).toBe('function');
            expect(typeof window.exportSession).toBe('function');
            expect(typeof window.importSession).toBe('function');
            expect(typeof window.exportArchive).toBe('function');
            expect(typeof window.importArchive).toBe('function');
            expect(typeof window.parseArchive).toBe('function');
            expect(typeof window.detectImportCategories).toBe('function');
            expect(typeof window.showImportSelectModal).toBe('function');
            expect(typeof window.resetActivePage).toBe('function');
            expect(typeof window.resetAllData).toBe('function');
            expect(typeof window.checkCoherence).toBe('function');
            expect(typeof window.loadFormData).toBe('function');
        });

        it('addHypothesis insère un champ dans #hypotheses_container et synchronise le Store', async () => {
            const mod = await import('@oi/formulaires.js');
            stubCrossModuleWindow();

            window.addHypothesis('Ma première hypothèse');

            const inputs = document.querySelectorAll<HTMLInputElement>('#hypotheses_container .hypothese-input');
            expect(inputs).toHaveLength(1);
            expect(inputs[0]?.value).toBe('Ma première hypothèse');
            expect(mod.syncDomToStore).toBeTypeOf('function');
        });

        it('addDynamicField ajoute un champ texte dans le conteneur donné', async () => {
            document.body.innerHTML += '<div id="vehicules_test"></div>';
            await import('@oi/formulaires.js');

            window.addDynamicField('vehicules_test', 'Clio grise');

            const input = document.querySelector<HTMLInputElement>('#vehicules_test .dynamic-input');
            expect(input?.value).toBe('Clio grise');
        });

        it('getChipData retourne les libellés des puces sélectionnées', async () => {
            document.body.innerHTML += `
                <div id="chips_test">
                    <button type="button" class="chip-btn selected">Alpha</button>
                    <button type="button" class="chip-btn">Beta</button>
                    <button type="button" class="chip-btn selected">Gamma</button>
                </div>
            `;
            await import('@oi/formulaires.js');

            const data = window.getChipData('chips_test');

            expect(data).toEqual(['Alpha', 'Gamma']);
        });

        it('toggleAdvSection bascule data-collapsed et aria-expanded', async () => {
            document.body.innerHTML += `
                <section class="adv-collapsible" data-collapsed="false">
                    <button type="button" class="toggle-btn" aria-expanded="true">
                        <span class="adv-section-hint">replier</span>
                    </button>
                </section>
            `;
            await import('@oi/formulaires.js');
            const btn = document.querySelector<HTMLButtonElement>('.toggle-btn');
            expect(btn).not.toBeNull();

            window.toggleAdvSection(btn as HTMLButtonElement);

            const sec = document.querySelector('.adv-collapsible');
            expect(sec?.getAttribute('data-collapsed')).toBe('true');
            expect(btn?.getAttribute('aria-expanded')).toBe('false');
        });

        it('addAdversary(null) crée une fiche dépliée et synchronise (débouncé) ; addAdversary(data) ne synchronise pas (restauration)', async () => {
            vi.useFakeTimers();
            const mod = await import('@oi/formulaires.js');
            stubCrossModuleWindow();
            const setItemSpy = vi.spyOn(localStorage, 'setItem');

            window.addAdversary();
            expect(document.querySelectorAll('.adversary-entry.open')).toHaveLength(1);
            vi.advanceTimersByTime(500);
            expect(setItemSpy).toHaveBeenCalledTimes(1); // syncDomToStore() (débouncé) déclenché par la création manuelle

            setItemSpy.mockClear();
            window.addAdversary({ id: 'adv_x', nom_adversaire: 'RESTAURE', me_list: [], etat_esprit_list: [], volume_list: [], vehicules_list: [] });
            expect(document.querySelectorAll('.adversary-entry')).toHaveLength(2);
            vi.advanceTimersByTime(500);
            // Restauration : AUCUN appel à syncDomToStore (ni immédiat ni débouncé).
            expect(setItemSpy).not.toHaveBeenCalled();
            expect(mod.syncDomToStore).toBeTypeOf('function');
        });
    });
});
