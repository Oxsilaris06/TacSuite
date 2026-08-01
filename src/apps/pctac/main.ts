/**
 * main.ts — Point d'entrée PC-Tac (P2.D, câblage).
 * ===========================================================================
 * Port TypeScript de `modules/pctac/main.js` (GStart-main, 546 LOC) + du bloc
 * `<script>` inline de `pctac2.html:9-16`. Ordre imposé par
 * `docs/SPEC-PCTAC-CONVERSION.md` §5 — aucune étape fusionnée, réordonnée ni
 * « optimisée ».
 *
 * Écart DOM : AUCUN. Les 5 `onclick` statiques de `pctac/index.html` et les
 * handlers générés en `innerHTML` par `ui.ts` restent VERBATIM à ce stade
 * (façades `window.UI` / `window.openEditModal` / `window.deleteLogEntry` /
 * `window.deleteCollectionItem` posées ci-dessous ou par `ui.ts` lui-même) —
 * la délégation `data-action` (SPEC-PCTAC-CONVERSION.md §3.2) est différée à
 * une passe ultérieure dédiée, hors périmètre de ce câblage (§3.2 : « P2.D,
 * PAS dans les paquets de conversion » désigne le calendrier de la
 * délégation elle-même, distinct du câblage main.ts traité ici).
 */

// ── §5.1 étape 0 — Journalisation d'erreurs globale, VERBATIM de
// pctac2.html:9-16 (sinon perdue : le bloc est absent de pctac/index.html
// depuis P0.A5, catégorie « scripts retirés »). ─────────────────────────────
window.addEventListener('error', (e) => {
    console.error('[PCTAC] Erreur non capturée:',
        e.message, (e.filename || '') + ':' + (e.lineno || '') + ':' + (e.colno || ''), e.error || '');
});
window.addEventListener('unhandledrejection', (e) => {
    console.error('[PCTAC] Promesse rejetée non gérée:', e.reason);
});

// ── §5.1 étape 1 — Polices auto-hébergées (P0.FIX : zéro CDN Google Fonts). ─
import '@shared/fonts.js';

// ── §5.1 étape 2 — CSS MapLibre GL (P0.A5 point 4, cf. docs/DECISIONS-DEPS.md). ─
import 'maplibre-gl/dist/maplibre-gl.css';

// ── §5.1 étape 3 — UIPlatform, posé en 1er comme pctac2.html:20. `ui-platform.ts`
// ne s'auto-assigne pas sur `window` (contrairement à `tuto-engine.ts`) : l'affectation
// est à la charge de chaque app, ici. ───────────────────────────────────────
import { UIPlatform } from '@shared/ui-platform.js';
window.UIPlatform = UIPlatform;

// ── §5.1 étape 4 — PocheTuto (pctac2.html:2392). `tuto-engine.ts` s'auto-assigne
// déjà sur `window.PocheTuto` (idempotent) : l'import suffit à poser la façade,
// aucune liaison nommée n'est nécessaire ici (on consomme `window.PocheTuto` en
// étape 5, comme l'original via le global). ─────────────────────────────────
import '@shared/tuto-engine.js';

// ── §5.1 étape 5 — Données du tutoriel + montage (pctac2.html:2393, via l'ex-IIFE
// `boot()` de tuto_data.js, reprise ici verbatim). ⚠ ORDRE 3→4→5 OBLIGATOIRE : la
// garde ci-dessous (`!window.PocheTuto || !window.PocheTuto.mount`) désactiverait
// silencieusement le tutoriel si l'ordre était inversé. ────────────────────
import { pctacTutoData } from '@pctac/tuto-data.js';
if (!window.PocheTuto || !window.PocheTuto.mount) {
    console.warn('[Tuto] moteur tuto-engine.js absent — tutoriel désactivé.');
} else {
    window.PocheTuto.mount({
        appId: 'pctac',
        appName: 'PC Tac',
        accent: '#4f8dff',
        buttonLabel: 'Tuto',
        // Le bouton s'intègre dans le dock flottant natif de la page (#dockMenu).
        dock: {
            selector: '#dockMenu',
            itemTag: 'div',
            itemClass: 'dock-menu-item',
            icon: 'menu_book',
            title: 'Tutoriel interactif — PC Tac',
            insertAfter: '#dockToggleBtn',
        },
        data: pctacTutoData,
    });
}

// ── §5.2 — Imports applicatifs, ordre de main.js:1-12 à la ligne près. ──────
import { Storage } from '@pctac/storage.js';
import { UI } from '@pctac/ui.js';
import { LogManager } from '@pctac/log-manager.js';
import { PdfExport } from '@pctac/pdf-export.js';
import { Utils } from '@pctac/utils.js';
import { ImageStore } from '@pctac/image-store.js';
import '@pctac/planmap/index.js'; // expose window.PlanMap (utilisé par UI.switchMainView)
import '@pctac/tchap-live.js'; // géoloc équipe live (Tchap) → marqueurs sur PlanMap — APRÈS planmap (lit window.PlanMap)
// NB : dashboard.js (board relationnel) est VOLONTAIREMENT débranché — inefficace
// en l'état, mis de côté. Ne pas réimporter sans décision explicite.
import { Persist } from '@shared/persist.js';
import {
    CUSTOM_PAX_KEY,
    ADVERSARIES_KEY,
    HOSTAGES_KEY,
    FRIENDS_KEY,
    PHOTOS_KEY,
    DASHBOARD_KEY,
} from '@pctac/config.js';

/**
 * Point d'entrée principal du module PC TAC
 */

document.addEventListener('DOMContentLoaded', async () => {
    // §5.3 étape 1 — Service Worker (PWA, offline-fallback).
    // TODO P4.A : SW reconstruit sur les assets buildés (docs/PLAN.md §6, Phase 4).
    // `public/` ne contient encore aucun `sw.js` à ce stade du portage ; un
    // `register('sw.js')` échouerait ici en 404 (requête réseau + `console.warn`),
    // ce que le `.catch()` de l'original absorbait déjà silencieusement (pas de
    // régression d'observable : rien ne s'enregistre, ni avant ni après).

    // §5.3 étape 2 — Migration des photos base64 vers IndexedDB (s'exécute une seule fois).
    try {
        await ImageStore.migrateFromLocalStorage();
    } catch (e) {
        console.error('[PC TAC] migration IndexedDB échouée:', e);
    }

    // §5.3 étape 3-5 — Initialisation UI.
    UI.initElements();
    UI.initPaxModeAndColors();
    UI.updateTimeInput();
    setInterval(() => UI.updateTimeInput(), 60000);
    // Une heure saisie À LA MAIN ne doit pas être écrasée par le tick de 60 s :
    // updateTimeInput teste window.isTimeInputManuallyChanged, mais rien ne le posait.
    if (UI.elements.heureInput) {
        UI.elements.heureInput.addEventListener('input', () => { window.isTimeInputManuallyChanged = true; });
    }

    // §5.3 étape 7 — Charger les données initiales.
    const initialLogs = Storage.loadLogData();
    UI.renderLogTable(initialLogs);
    UI.refreshLieuSuggestions();

    // §5.3 étape 8 — Initialiser les écouteurs d'onglets.
    document.querySelectorAll('.tab-btn').forEach((btnEl) => {
        const btn = btnEl as HTMLElement;
        btn.setAttribute('role', 'tab'); // T13 (a11y)
        btn.addEventListener('click', () => {
            const viewId = btn.dataset.view;
            if (viewId) UI.switchMainView(viewId);
        });
    });
    // §5.3 étape 9 — T13 (a11y) — navigation aux flèches entre onglets (les .tab-btn
    // sont déjà des <button>, donc focusables et activables au clavier nativement).
    const tabBar = document.querySelector('.main-tab-bar') as HTMLElement | null;
    if (tabBar && window.UIPlatform && typeof UIPlatform.makeTablist === 'function') {
        UIPlatform.makeTablist(tabBar, {
            tabSelector: '.tab-btn',
            activate: (tab) => { if (tab.dataset.view) UI.switchMainView(tab.dataset.view); },
        });
    }

    // §5.3 étape 10 — Charger la dernière vue.
    let lastView = localStorage.getItem('lastView') || 'view-main-courante';
    // Vue persistée qui n'existe plus (ex : 'view-dashboard' débranché) → repli.
    if (!document.getElementById(lastView)) lastView = 'view-main-courante';
    UI.switchMainView(lastView);

    // §5.3 étape 11 — Initialiser le thème.
    const savedTheme = localStorage.getItem('theme') || 'dark';
    if (savedTheme === 'light') {
        document.body.classList.replace('dark-mode', 'light-mode');
        if (UI.elements.darkModeIcon) UI.elements.darkModeIcon.textContent = 'clear_day';
    }

    // --- ÉVÉNEMENTS ---

    // §5.3 étape 12 — Soumission Log.
    if (UI.elements.logForm) {
        UI.elements.logForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const paxInput = UI.elements.paxInput as HTMLInputElement;
            const formData = {
                mode: (UI.elements.paxModeInput as HTMLInputElement).value as 'standard' | 'free',
                pax: paxInput.value,
                paxColor: paxInput.dataset.customColor || (UI.elements.paxCustomColorInput as HTMLInputElement).value,
                heure: (UI.elements.heureInput as HTMLInputElement).value,
                lieu: (UI.elements.lieuInput as HTMLInputElement).value,
                freePax: UI.elements.freePaxInput ? UI.elements.freePaxInput.value : '',
                remarques: (UI.elements.remarquesInput as HTMLTextAreaElement).value,
            };
            const newEntry = LogManager.addEntry(formData);
            if (newEntry) {
                UI.renderLogTable(Storage.loadLogData());
                (UI.elements.remarquesInput as HTMLTextAreaElement).value = '';
                (UI.elements.lieuInput as HTMLInputElement).value = '';
                UI.refreshLieuSuggestions();
                (UI.elements.remarquesInput as HTMLTextAreaElement).focus();
                window.isTimeInputManuallyChanged = false; // l'entrée est posée : l'horloge reprend
                UI.updateTimeInput(true);
            }
        });
    }

    // §5.3 étape 13 — Création Intervenant Personnalisé.
    const confirmCreatePaxBtn = document.getElementById('confirmCreatePaxBtn');
    if (confirmCreatePaxBtn) {
        confirmCreatePaxBtn.onclick = () => {
            const name = (document.getElementById('new_pax_name') as HTMLInputElement).value.trim();
            const color = (document.getElementById('new_pax_color_val') as HTMLInputElement).value;
            if (!name) { alert('Nom requis'); return; }
            const list = Storage.loadCollection(CUSTOM_PAX_KEY);
            // Unicité de la couleur (garde au submit, en plus du blocage visuel :
            // l'état a pu changer pendant que la modale était ouverte).
            const taken = list.find((p) => p && p.color && String(p.color).toLowerCase() === String(color).toLowerCase());
            if (taken) {
                alert(`Couleur déjà utilisée par « ${String(taken.name)} ». Choisis-en une autre.`);
                UI.refreshNewPaxPalette();
                return;
            }
            list.push({ id: Date.now().toString(), name, color });
            Storage.saveCollection(CUSTOM_PAX_KEY, list);
            UI.renderCustomPaxOptions();
            UI.hideCreatePaxModal();
        };
    }

    // §5.3 étape 14 — Gestion des collections génériques (Adversaires, Otages, Amis, Photos).
    interface PctacFormConfig {
        id: string;
        key: string;
        view: string;
        fields: string[];
        map: (f: string[]) => Record<string, unknown>;
    }
    const forms: PctacFormConfig[] = [
        {
            id: 'adversary-form',
            key: ADVERSARIES_KEY,
            view: 'view-adversaires',
            fields: ['adv_nom', 'adv_prenom', 'adv_dob', 'adv_lien', 'adv_antecedents', 'adv_attitude', 'adv_substance', 'adv_arme', 'adv_photo'],
            map: (f) => ({ nom: f[0], prenom: f[1], dob: f[2], lien: f[3], antecedents: f[4], attitude: f[5], substance: f[6], armes: f[7], photo: f[8] }),
        },
        {
            id: 'hostage-form',
            key: HOSTAGES_KEY,
            view: 'view-otages',
            fields: ['hostage_nom', 'hostage_prenom', 'hostage_dob', 'hostage_lien', 'hostage_etat', 'hostage_blessure', 'hostage_photo'],
            map: (f) => ({ nom: f[0], prenom: f[1], dob: f[2], lien: f[3], etat: f[4], blessures: f[5], photo: f[6] }),
        },
        {
            id: 'friend-form',
            key: FRIENDS_KEY,
            view: 'view-amis',
            fields: ['friend_nom', 'friend_prenom', 'friend_unite', 'friend_tph', 'friend_mission'],
            map: (f) => ({ nom: f[0], prenom: f[1], unite: f[2], tph: f[3], mission: f[4] }),
        },
    ];

    forms.forEach((cfg) => {
        const f = document.getElementById(cfg.id) as HTMLFormElement | null;
        if (f) {
            f.addEventListener('submit', async (e) => {
                e.preventDefault();
                const values = cfg.fields.map((id) => {
                    const el = document.getElementById(id) as HTMLInputElement;
                    if (el.type === 'file') return el.dataset.base64 || '';
                    return el.value;
                });

                // Au moins un champ texte/photo doit avoir une vraie valeur
                if (values.some((v) => v && (typeof v !== 'string' || v.trim() !== ''))) {
                    const itemId = Date.now().toString();
                    const mapped = cfg.map(values);
                    // mapped.photo est une dataURL (string) quand présente, comme dans l'original.
                    const photoData = mapped.photo as string | undefined;

                    // L'image part en IndexedDB, on garde seulement un flag dans la collection
                    if (photoData && typeof photoData === 'string' && photoData.startsWith('data:')) {
                        try { await ImageStore.put(itemId, photoData); } catch (e) { console.error('[PC TAC] put image échec:', e); }
                        delete mapped.photo;
                        mapped.hasImage = true;
                    }

                    const list = Storage.loadCollection(cfg.key);
                    list.push({ id: itemId, ...mapped });
                    Storage.saveCollection(cfg.key, list);

                    cfg.fields.forEach((id) => {
                        const el = document.getElementById(id) as HTMLInputElement;
                        if (el.type === 'file') { el.value = ''; delete el.dataset.base64; }
                        else el.value = '';
                    });
                    // Reset des aperçus miniatures
                    ['adv_photo_preview', 'hostage_photo_preview'].forEach((pid) => {
                        const p = document.getElementById(pid);
                        if (p) {
                            const isAdv = pid === 'adv_photo_preview';
                            p.innerHTML = `<span class="material-symbols-outlined" style="font-size: 30px; color: var(--text-muted);">${isAdv ? 'person' : 'person_off'}</span>`;
                        }
                    });

                    if (cfg.view === 'view-adversaires') {
                        await UI.renderAdversaries();
                        // Copie automatique vers Photos pour les adversaires
                        if (photoData) {
                            const syncId = itemId + '_sync';
                            try { await ImageStore.put(syncId, photoData); } catch (e) { console.error('[PC TAC] put sync image échec:', e); }
                            const photoList = Storage.loadCollection(PHOTOS_KEY);
                            photoList.push({
                                id: syncId,
                                title: `${String(mapped.nom)} ${String(mapped.prenom)}`,
                                category: 'neutralized',
                                status: 'active',
                                hasImage: true,
                            });
                            Storage.saveCollection(PHOTOS_KEY, photoList);
                            await UI.renderPhotos();
                        }
                    }
                    if (cfg.view === 'view-otages') {
                        await UI.renderHostages();
                        // Copie automatique vers Photos pour les otages avec statut intelligent
                        if (photoData) {
                            const b = ((mapped.blessures as string | undefined) || '').toLowerCase().trim();
                            const rasTerms = ['ras', '-', '/', 'rien', 'neant', 'néant', 'idemne', 'indemne', 'aucune', '0', 'ok'];
                            const isRas = rasTerms.some((term) => b === term || b === term + '.');

                            let status = 'ok';
                            if ((b !== '' && !isRas) || b.includes('inconnu') || b === '?') status = 'preoccupant';
                            if (b.includes('blesse') || b.includes('blessé') || b.includes('grave')) status = 'blesse';
                            if (b.includes('mort') || b.includes('dcd') || b.includes('decede') || b.includes('décédé')) status = 'dcd';

                            const syncId = itemId + '_sync';
                            try { await ImageStore.put(syncId, photoData); } catch (e) { console.error('[PC TAC] put sync image échec:', e); }
                            const photoList = Storage.loadCollection(PHOTOS_KEY);
                            photoList.push({
                                id: syncId,
                                title: `${String(mapped.nom)} ${String(mapped.prenom)}`,
                                category: 'hostage',
                                status,
                                hasImage: true,
                            });
                            Storage.saveCollection(PHOTOS_KEY, photoList);
                            await UI.renderPhotos();
                        }
                    }
                    if (cfg.view === 'view-amis') UI.renderFriends();
                }
            });
        }
    });

    // §5.3 étape 15 — Gestion base64 pour les inputs file d'adversaire/otage + aperçu miniature.
    ['adv_photo', 'hostage_photo'].forEach((id) => {
        const el = document.getElementById(id) as HTMLInputElement | null;
        if (el) {
            el.addEventListener('change', async (e) => {
                const file = (e.target as HTMLInputElement).files?.[0];
                if (file) {
                    try {
                        const compressedData = await Utils.compressImage(file, 800, 800, 0.7);
                        el.dataset.base64 = compressedData;
                        // Mise à jour de la miniature dans le formulaire
                        const previewId = id === 'adv_photo' ? 'adv_photo_preview' : 'hostage_photo_preview';
                        const preview = document.getElementById(previewId);
                        if (preview) {
                            preview.innerHTML = `<img src="${compressedData}" style="width: 100%; height: 100%; object-fit: cover;">`;
                        }
                    } catch (err) {
                        console.error('Erreur de compression:', err);
                    }
                }
            });
        }
    });

    // §5.3 étape 16 — Formulaire Photo spécifique.
    if (UI.elements.photoForm) {
        UI.elements.photoForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const title = (document.getElementById('photo_title') as HTMLInputElement).value.trim();
            const fileInput = document.getElementById('photo_file') as HTMLInputElement;
            const categorySelect = document.getElementById('photo_category') as HTMLSelectElement | null;
            const category = categorySelect ? categorySelect.value : 'other';
            const file = fileInput.files?.[0];
            if (!title || !file) { alert('Titre et fichier requis'); return; }

            try {
                const compressedData = await Utils.compressImage(file, 1024, 1024, 0.7);
                const photoId = Date.now().toString();
                await ImageStore.put(photoId, compressedData);
                const list = Storage.loadCollection(PHOTOS_KEY);
                list.push({ id: photoId, title, category, status: 'active', hasImage: true });
                Storage.saveCollection(PHOTOS_KEY, list);
                (document.getElementById('photo_title') as HTMLInputElement).value = '';
                fileInput.value = '';
                await UI.renderPhotos();
            } catch (err) {
                console.error('Erreur de compression/sauvegarde:', err);
                alert("Erreur lors de l'ajout de la photo.");
            }
        });
    }

    // §5.3 étape 17 — EXPOSITIONS GLOBALES.
    window.deleteLogEntry = (id) => {
        LogManager.deleteEntry(id);
        UI.renderLogTable(Storage.loadLogData());
    };

    /** Forme minimale lue/mutée par la purge ci-dessous (board relationnel, `dashboard.js` mort). */
    interface PctacDashboardPurgeLink {
        from?: unknown;
        to?: unknown;
    }
    interface PctacDashboardPurgeState {
        positions?: Record<string, unknown>;
        links?: (PctacDashboardPurgeLink | null | undefined)[];
    }
    // Prédicat strict (cf. storage.ts `isObject`) — équivalent en pratique à
    // l'original `v && typeof v === 'object'` : DASHBOARD_KEY ne contient jamais
    // de valeur JSON falsy non-null (0/''/false) à la racine.
    const isDashboardState = (v: unknown): v is PctacDashboardPurgeState =>
        v !== null && typeof v === 'object';

    window.deleteCollectionItem = async (key, id, viewId) => {
        if (!confirm('Confirmer la suppression ?')) return;
        const list = Storage.loadCollection(key).filter((item) => item.id !== id);
        Storage.saveCollection(key, list);

        // Nettoyer l'image dans IndexedDB
        try { await ImageStore.delete(id); } catch (e) { console.error('[PC TAC] delete image échec:', e); }

        // Suppression en cascade pour les photos synchronisées
        if (viewId === 'view-adversaires' || viewId === 'view-otages') {
            const photoKey = 'pcTacPhotos';
            const photos = Storage.loadCollection(photoKey);
            const syncId = id + '_sync';
            const filteredPhotos = photos.filter((p) => p.id !== syncId);
            Storage.saveCollection(photoKey, filteredPhotos);
            try { await ImageStore.delete(syncId); } catch (e) { console.error('[PC TAC] delete sync échec:', e); }
        }

        // Purge de l'état du board relationnel : position du nœud supprimé et
        // liens manuels qui le référencent (sinon orphelins persistés à vie).
        try {
            const st = Persist.get<PctacDashboardPurgeState | null>(DASHBOARD_KEY, { validator: isDashboardState, fallback: null });
            if (st) {
                // Trois formes de clés de nœud : id photo brut, '<id>_sync', et les
                // placeholders entités préfixés 'ent:adv:<id>' / 'ent:host:<id>'.
                const matches = (k: unknown): boolean => k === id || k === id + '_sync' || String(k).endsWith(':' + id);
                let touched = false;
                if (st.positions) {
                    for (const k of Object.keys(st.positions)) {
                        if (matches(k)) { delete st.positions[k]; touched = true; }
                    }
                }
                if (Array.isArray(st.links)) {
                    const before = st.links.length;
                    st.links = st.links.filter((l) => !l || (!matches(l.from) && !matches(l.to)));
                    if (st.links.length !== before) touched = true;
                }
                if (touched) Persist.set(DASHBOARD_KEY, st);
            }
        } catch { /* purge board non bloquante */ }

        if (viewId === 'view-adversaires') await UI.renderAdversaries();
        if (viewId === 'view-otages') await UI.renderHostages();
        if (viewId === 'view-amis') UI.renderFriends();
        if (viewId === 'view-photos') await UI.renderPhotos();
    };

    // §5.3 étape 18 — Boutons dock : PDF, reset (+ confirm/cancel), création PAX,
    // éditions adversaire/otage/log.
    const previewPdfBtn = document.getElementById('previewPdfDockBtn');
    if (previewPdfBtn) previewPdfBtn.onclick = () => { void PdfExport.buildPdf(); };

    const resetBtn = document.getElementById('resetDataDockBtn');
    if (resetBtn) resetBtn.onclick = () => UI.showResetModal();

    const confirmResetBtn = document.getElementById('confirmResetBtn');
    if (confirmResetBtn) {
        confirmResetBtn.onclick = async () => {
            Storage.clearAllData();
            try { await ImageStore.clear(); } catch (e) { console.error('[PC TAC] clear IDB échec:', e); }

            // Reset des champs du formulaire principal
            ['lieu_input', 'remarques_input', 'heure_input'].forEach((id) => {
                const el = document.getElementById(id) as HTMLInputElement | null;
                if (el) el.value = '';
            });
            // Reset des formulaires de collection
            ['adversary-form', 'hostage-form', 'friend-form', 'photo-form'].forEach((fid) => {
                const f = document.getElementById(fid) as HTMLFormElement | null;
                if (f) f.reset();
            });
            // Reset des aperçus photo
            ['adv_photo_preview', 'hostage_photo_preview'].forEach((pid) => {
                const p = document.getElementById(pid);
                if (p) {
                    const isAdv = pid === 'adv_photo_preview';
                    p.innerHTML = `<span class="material-symbols-outlined" style="font-size: 30px; color: var(--text-muted);">${isAdv ? 'person' : 'person_off'}</span>`;
                }
            });
            ['adv_photo', 'hostage_photo'].forEach((id) => {
                const el = document.getElementById(id) as HTMLInputElement | null;
                if (el) { el.value = ''; delete el.dataset.base64; }
            });

            UI.hideResetModal();
            location.reload();
        };
    }

    const cancelCreatePaxBtn = document.getElementById('cancelCreatePaxBtn');
    if (cancelCreatePaxBtn) cancelCreatePaxBtn.onclick = () => UI.hideCreatePaxModal();

    // Édition Adversaire (champs + photo)
    const confirmEditAdvBtn = document.getElementById('confirmEditAdvBtn');
    if (confirmEditAdvBtn) confirmEditAdvBtn.onclick = () => { void UI.handleAdversaryUpdate(); };

    const editAdvPhotoInput = document.getElementById('edit_adv_photo_input') as HTMLInputElement | null;
    if (editAdvPhotoInput) {
        editAdvPhotoInput.onchange = async (e) => {
            const file = (e.target as HTMLInputElement).files?.[0];
            if (file) {
                try {
                    const compressedData = await Utils.compressImage(file, 800, 800, 0.7);
                    (document.getElementById('edit_adv_preview') as HTMLElement).innerHTML = `<img src="${compressedData}" style="width: 100%; height: 100%; object-fit: cover;">`;
                    editAdvPhotoInput.dataset.compressedBase64 = compressedData;
                } catch (err) {
                    console.error('Erreur de compression:', err);
                }
            }
        };
    }

    // Édition Otage (champs + photo)
    const confirmEditHostBtn = document.getElementById('confirmEditHostBtn');
    if (confirmEditHostBtn) confirmEditHostBtn.onclick = () => { void UI.handleHostageUpdate(); };

    const editHostPhotoInput = document.getElementById('edit_host_photo_input') as HTMLInputElement | null;
    if (editHostPhotoInput) {
        editHostPhotoInput.onchange = async (e) => {
            const file = (e.target as HTMLInputElement).files?.[0];
            if (file) {
                try {
                    const compressedData = await Utils.compressImage(file, 800, 800, 0.7);
                    (document.getElementById('edit_host_preview') as HTMLElement).innerHTML = `<img src="${compressedData}" style="width: 100%; height: 100%; object-fit: cover;">`;
                    editHostPhotoInput.dataset.compressedBase64 = compressedData;
                } catch (err) {
                    console.error('Erreur de compression:', err);
                }
            }
        };
    }

    // Édition Log (Enregistrer + Annuler du Reset)
    const confirmEditLogBtn = document.getElementById('confirmEditBtn');
    if (confirmEditLogBtn) confirmEditLogBtn.onclick = () => UI.confirmEditLog();

    const cancelResetBtn = document.getElementById('cancelResetBtn');
    if (cancelResetBtn) cancelResetBtn.onclick = () => UI.hideResetModal();

    // §5.3 étape 19 — ARCHIVE TOUT-EN-UN (.pctac.zip). Import dynamique conservé
    // (main.js:436) — Archive n'est PAS parmi les imports statiques de §5.2.
    const { Archive } = await import('@pctac/archive.js');

    const exportArchiveBtn = document.getElementById('exportJsonDockBtn');
    if (exportArchiveBtn) exportArchiveBtn.onclick = () => { void Archive.exportZip(); };

    const importArchiveBtn = document.getElementById('importJsonDockBtn');
    const archiveFileInput = document.getElementById('archiveImportInput') as HTMLInputElement | null;
    if (importArchiveBtn && archiveFileInput) {
        importArchiveBtn.onclick = () => archiveFileInput.click();
        archiveFileInput.onchange = async (e) => {
            const file = (e.target as HTMLInputElement).files?.[0];
            if (!file) return;
            try {
                const res = await Archive.importFile(file);
                if ('cancelled' in res && res.cancelled) {
                    archiveFileInput.value = '';
                    return;
                }
                UI.renderLogTable(Storage.loadLogData());
                UI.refreshLieuSuggestions();
                await UI.renderAdversaries();
                await UI.renderHostages();
                UI.renderFriends();
                await UI.renderPhotos();
                if (window.PlanMap && window.PlanMap.initialized) window.PlanMap.refresh();
                alert('Archive importée avec succès.');
            } catch (err) {
                console.error('[Archive] import échec:', err);
                alert("Erreur d'import : " + (err instanceof Error ? err.message : String(err)));
            }
            archiveFileInput.value = '';
        };
    }

    // §5.3 étape 20 — PASSERELLE OI → PC TAC (Proposition 1).
    // Importe l'équipe (PATRACDVR) et les adversaires depuis une archive .oi.zip
    // générée par le Générateur d'Ordre Initial (4.html). Zéro double saisie.
    const importOiBtn = document.getElementById('importOiDockBtn');
    const oiFileInput = document.getElementById('oiImportInput') as HTMLInputElement | null;
    if (importOiBtn && oiFileInput) {
        importOiBtn.onclick = () => oiFileInput.click();
        oiFileInput.onchange = async (e) => {
            const file = (e.target as HTMLInputElement).files?.[0];
            if (!file) return;
            try {
                const res = await Archive.importOiArchive(file);
                await UI.renderAdversaries();
                await UI.renderPhotos();
                UI.renderCustomPaxOptions();

                const parts = [`${res.advAdded} adversaire(s)`];
                if (res.advPhotos) parts.push(`${res.advPhotos} photo(s)`);
                parts.push(`${res.paxAdded} intervenant(s)`);
                const skipped = (res.advSkipped || 0) + (res.paxSkipped || 0);
                alert(
                    `Passerelle OI → PC TAC : ${parts.join(', ')} importé(s) avec succès.`
                    + (skipped ? `\n${skipped} doublon(s) déjà présent(s) ignoré(s).` : ''),
                );
            } catch (err) {
                console.error('[OI→PCTAC] import échec:', err);
                alert('Import OI impossible : ' + (err instanceof Error ? err.message : String(err)));
            }
            oiFileInput.value = '';
        };
    }

    // §5.3 étape 21 — Thème / plein écran.
    const darkModeToggle = document.getElementById('darkModeToggle');
    if (darkModeToggle) darkModeToggle.onclick = () => UI.handleThemeToggle();

    const fullscreenToggle = document.getElementById('fullscreenToggle');
    if (fullscreenToggle) {
        fullscreenToggle.onclick = () => { void UI.toggleFullscreen(); };
        document.addEventListener('fullscreenchange', () => UI.updateFullscreenIcon());
    }

    // §5.3 étape 22 — Saturation localStorage : Persist émet 'pctac:quota' au lieu
    // de jeter. Sans écouteur, les écritures étaient perdues EN SILENCE — on
    // affiche un bandeau persistant (fermable) pour que l'opérateur exporte/allège.
    window.addEventListener('pctac:quota', () => {
        if (document.getElementById('pctac_quota_banner')) return; // déjà affiché
        const b = document.createElement('div');
        b.id = 'pctac_quota_banner';
        b.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:99999;'
            + 'background:#7f1d1d;color:#fff;padding:10px 44px 10px 14px;'
            + 'font:600 13px/1.4 Inter,system-ui,sans-serif;text-align:center;'
            + 'box-shadow:0 2px 12px rgba(0,0,0,.5);';
        b.textContent = "STOCKAGE PLEIN : les dernières modifications n'ont PAS été enregistrées. "
            + 'Exporte une archive (.pctac.zip) puis supprime des photos pour libérer de l\'espace.';
        const x = document.createElement('button');
        x.type = 'button';
        x.textContent = '✕';
        x.style.cssText = 'position:absolute;right:8px;top:6px;background:none;border:none;'
            + 'color:#fff;font-size:16px;cursor:pointer;padding:4px;';
        x.onclick = () => b.remove();
        b.appendChild(x);
        document.body.appendChild(b);
    });

    const dockToggleBtn = document.getElementById('dockToggleBtn');
    if (dockToggleBtn) dockToggleBtn.onclick = () => UI.toggleDock();
    // T17 — restaure l'état réduit/déployé du dock (le markup est figé 'collapsed',
    // et la préférence enregistrée n'était jamais relue au démarrage).
    try {
        const savedDock = localStorage.getItem('dockCollapsed');
        if (savedDock !== null && UI.elements.dockMenu) {
            const collapsed = savedDock === 'true';
            UI.elements.dockMenu.classList.toggle('collapsed', collapsed);
            if (UI.elements.dockToggleIcon) UI.elements.dockToggleIcon.textContent = collapsed ? 'expand_less' : 'expand_more';
        }
    } catch { /* localStorage indispo */ }
});
