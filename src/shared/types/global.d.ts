/**
 * global.d.ts — Augmentation de `Window` : rattachement des contrats globaux.
 * ===========================================================================
 *
 * Toutes les interfaces viennent de `./contracts.js` ; ce fichier ne fait que
 * déclarer QUELLE propriété de `window` porte QUEL contrat. Il est chargé
 * automatiquement (dossier `src` inclus par `tsconfig.json`).
 *
 * ── Règle d'optionnalité (opposable aux gates) ─────────────────────────────
 * Une propriété est déclarée REQUISE lorsque le module qui la pose est importé
 * INCONDITIONNELLEMENT par l'entrée de l'app (`src/apps/<app>/main.ts`) : dans
 * un bundle ESM, l'ordre de chargement est garanti, contrairement aux
 * `<script>` classiques des originaux. Les gardes défensives des originaux
 * (`if (window.X)`, `typeof X === 'function'`) restent parfaitement valides en
 * TypeScript sur un type requis : elles peuvent donc être portées verbatim.
 *
 * Une propriété est déclarée OPTIONNELLE seulement si elle peut réellement
 * manquer à l'exécution :
 *   - `QrSync` : module JAMAIS chargé par `pctac2.html` (cf. SPEC-CONTRATS.md) ;
 *   - `isTimeInputManuallyChanged` : posée paresseusement au premier `input`.
 *
 * ⚠ Si un agent de phase ultérieure rend le chargement d'un module PARESSEUX
 * (`await import(...)`), il DOIT repasser la propriété correspondante en
 * optionnelle et ajouter la garde côté consommateurs.
 *
 * ── Exclusions actées ──────────────────────────────────────────────────────
 * `window.Dashboard` et `window.SharedComponents` ne sont PAS déclarés : code
 * mort confirmé par grep (justification détaillée dans docs/SPEC-CONTRATS.md).
 * Toute tentative de les référencer doit donc échouer à la compilation — c'est
 * le comportement voulu.
 */

import type {
    ArchiveContract,
    ImageStoreContract,
    LogManagerContract,
    OiAnnotationGlobals,
    OiArticulationGlobals,
    OiDbManagerContract,
    OiDefaults,
    OiDragGlobals,
    OiFormGlobals,
    OiInlineGlobals,
    OiMediaGlobals,
    OiMemberConfig,
    OiPatracGlobals,
    OiPresentationGlobals,
    OiStoreContract,
    OiToolsGlobals,
    OiWizardGlobals,
    OICartoContract,
    PctacConfigGlobals,
    PctacStorageContract,
    PdfEngineV2Contract,
    PdfExportContract,
    PlanMapContract,
    PocheTutoContract,
    QrSyncContract,
    UIContract,
    UIPlatformContract,
} from './contracts.js';

declare global {
    interface Window
        extends
            /* --- OI : globaux fonctionnels des 16 modules classiques --- */
                    OiWizardGlobals,
            OiToolsGlobals,
            OiFormGlobals,
            OiPatracGlobals,
            OiArticulationGlobals,
            OiDragGlobals,
            OiMediaGlobals,
            OiAnnotationGlobals,
            OiPresentationGlobals,
            OiInlineGlobals,
            /* --- PC-Tac : constantes de config.js posées sur window --- */
            PctacConfigGlobals,
            /* --- PC-Tac : 4 méthodes de storage.js bindées individuellement --- */
            Pick<
                PctacStorageContract,
                'saveLogData' | 'loadLogData' | 'getTpAssociations' | 'saveTpAssociation'
            > {
        /* ==================================================================
         * PARTAGÉ (OI + PC-Tac)
         * ================================================================== */

        /** `shared/ui-platform.js` — socle UI transverse (esc, sortable, makeTablist…). */
        UIPlatform: UIPlatformContract;

        /** `modules/tuto-engine.js` — moteur de tutoriel interactif. */
        PocheTuto: PocheTutoContract;

        /* ==================================================================
         * PC-TAC
         * ================================================================== */

        /** `modules/pctac/planMap.js` — vue Plan tactique MapLibre (façade inter-modules). */
        PlanMap: PlanMapContract;

        /** `modules/pctac/ui.js` — contrôleur UI central. */
        UI: UIContract;

        /** `modules/pctac/archive.js` — export/import `.pctac.zip` + passerelle OI. */
        Archive: ArchiveContract;

        /** `modules/pctac/imageStore.js` — images en IndexedDB. */
        ImageStore: ImageStoreContract;

        /** `modules/pctac/logManager.js` — logique métier de la main courante. */
        LogManager: LogManagerContract;

        /** `modules/pctac/pdfExport.js` — export PDF pdf-lib. */
        PdfExport: PdfExportContract;

        /**
         * `modules/pctac/qrSync.js` — transfert par QR.
         * OPTIONNEL : ce module n'est chargé par AUCUN point d'entrée de
         * `pctac2.html` et le DOM qu'il pilote est absent de la page.
         */
        QrSync?: QrSyncContract | undefined;

        /* --- binds individuels de ui.js:885-890 (utilisés par les onclick) --- */
        /** `UI.openEditModal` bindé (ui.js:886) — consommé par ui.js:214 (`innerHTML`). */
        openEditModal: UIContract['openEditModal'];
        /** `UI.switchMainView` bindé (ui.js:887). */
        switchMainView: UIContract['switchMainView'];
        /** `UI.toggleSearchMode` bindé (ui.js:888). */
        toggleSearchMode: UIContract['toggleSearchMode'];
        /** `UI.closeSearchMode` bindé (ui.js:889). */
        closeSearchMode: UIContract['closeSearchMode'];
        /** `UI.filterLogs` bindé (ui.js:890). */
        filterLogs: UIContract['filterLogs'];

        /* --- handlers définis inline dans main.js:293-298 --- */
        /** Supprime une entrée de journal puis re-rend la table (main.js:293). */
        deleteLogEntry(id: string): void;
        /**
         * Supprime un item de collection (avec `confirm()`), son image IDB et,
         * pour adversaires/otages, la photo « _sync » associée (main.js:298).
         */
        deleteCollectionItem(key: string, id: string, viewId: string): Promise<void>;

        /**
         * Drapeau posé au premier `input` sur `#heure_input` (main.js:39) et
         * remis à `false` après soumission (main.js:100). Absent tant que
         * l'utilisateur n'a pas touché le champ → OPTIONNEL.
         */
        isTimeInputManuallyChanged?: boolean | undefined;

        /* ==================================================================
         * OI — contrats objet
         * ================================================================== */

        /*
         * NB : `LOCAL_STORAGE_KEY` est déclaré une seule fois, via
         * `PctacConfigGlobals`. La propriété est HOMONYME dans les deux apps
         * mais porte des valeurs différentes selon la page chargée :
         *   - PC-Tac (`config.js:314`) → 'pcTacLogData'
         *   - OI     (`init.js:8`)     → 'tactical_oi_data'
         * Aucune collision à l'exécution : les deux apps sont deux documents
         * distincts (`pctac/index.html` vs `oi/index.html`).
         */

        /** `modules/init.js:340` — store réactif (Proxy profond). */
        Store: OiStoreContract;

        /** `modules/init.js:341` — wrapper IndexedDB `OI_GeneratorLiteDB`. */
        dbManager: OiDbManagerContract;

        /** `modules/init.js:343` — listes d'options PATRACDVR (mutées en place). */
        memberConfig: OiMemberConfig;

        /** `modules/init.js:356` — textes pré-remplis MOICP / ZMSPCP / Effraction. */
        DEFAULTS: OiDefaults;

        /** `modules/pdf_engine_v2.js:1154` — moteur PDF actif de l'OI. */
        PDFEngineV2: PdfEngineV2Contract;

        /** `modules/oi_cartographie.js:1669` — cartographie MapLibre intégrée à l'OI. */
        OICarto: OICartoContract;
    }
}

export {};
