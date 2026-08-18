/**
 * contracts.ts — Interfaces des contrats globaux `window.*` de TacSuite.
 * =====================================================================
 *
 * Source de vérité : lecture du code de `/home/nico/Bureau/Web/GStart-main`
 * (LECTURE SEULE). Chaque signature est relevée sur le code RÉEL, pas déduite.
 * Les références `fichier:ligne` renvoient à l'original.
 *
 * Portée :
 *   - contrats PARTAGÉS   : UIPlatform (`shared/ui-platform.js`),
 *                           PocheTuto  (`modules/tuto-engine.js`)
 *   - contrats PC-Tac     : PlanMap, UI, Archive, ImageStore, LogManager,
 *                           PdfExport, QrSync, Storage (binds individuels),
 *                           config (constantes posées sur window),
 *                           handlers `deleteLogEntry` / `deleteCollectionItem`
 *   - contrats OI         : Store, dbManager, memberConfig, DEFAULTS,
 *                           PDFEngineV2, OICarto, + tous les globaux
 *                           fonctionnels des 16 modules classiques
 *   - contrat MODULE (hors window) : Persist — jamais posé sur `window`,
 *                           mais c'est LA couche canonique de persistance
 *                           PC-Tac ; son interface est ici pour que tous les
 *                           consommateurs partagent la même définition.
 *
 * Exclusions actées (cf. docs/SPEC-CONTRATS.md §Exclusions) :
 *   - `window.Dashboard`      (modules/pctac/dashboard.js jamais importé)
 *   - `window.SharedComponents` (modules/shared.js : zéro consommateur)
 *
 * Règles de typage appliquées :
 *   - `any` INTERDIT. `unknown` est utilisé quand la donnée est réellement
 *     hétérogène (formData OI, valeurs JSON restaurées).
 *   - Les surcharges implicites du JS (paramètre absent, `null`, valeur par
 *     défaut) sont rendues par des paramètres optionnels ou des unions.
 *   - `exactOptionalPropertyTypes` étant actif, tout champ pouvant recevoir
 *     EXPLICITEMENT `undefined` est déclaré `?: T | undefined`.
 */

import type { Map as MapLibreMap } from 'maplibre-gl';
import type { TutoChapter, TutoData, TutoFlatStep } from './tuto.js';

/* =========================================================================
 * 1. CONTRAT PARTAGÉ — window.UIPlatform  (shared/ui-platform.js, 319 LOC)
 * =========================================================================
 * Socle transverse OI + PC-Tac, script classique idempotent
 * (`if (window.UIPlatform) return;`). Aucun composant visuel : uniquement
 * comportements / accessibilité / tactile bas niveau.
 * Consommateurs vivants : `esc` (ui.js, planMap.js, formulaires.js, patrac.js,
 * oi_cartographie.js), `sortable` (articulation.js), `makeTablist`
 * (pctac/main.js, 4.html). Les autres membres sont exposés mais inutilisés.
 */

/** Handle retourné par `UIPlatform.onLongPress` (ui-platform.js:102). */
export interface UIPlatformLongPressHandle {
    /** `true` si le long-press a déjà été déclenché depuis le dernier pointerdown. */
    isFired(): boolean;
}

/** Options de `UIPlatform.onLongPress` (ui-platform.js:85-88). */
export interface UIPlatformLongPressOptions {
    /** Délai avant déclenchement, ms. Défaut 450. */
    delay?: number | undefined;
    /** Tolérance de déplacement annulant le geste, px. Défaut 10. */
    moveTol?: number | undefined;
}

/** Options de `UIPlatform.onDoubleTap` (ui-platform.js:105-106). */
export interface UIPlatformDoubleTapOptions {
    /** Fenêtre de double-tap, ms. Défaut 320. Le nom du champ EST `window`. */
    window?: number | undefined;
}

/** Options de `UIPlatform.sortable` (ui-platform.js:122-128, 180). */
export interface UIPlatformSortableOptions {
    /** Sélecteur des items triables. Défaut `':scope > *'`. */
    itemSelector?: string | undefined;
    /** Sélecteur de la poignée de drag. Défaut `null` (tout l'item). */
    handleSelector?: string | null | undefined;
    /** Délai de long-press avant armement, ms. `0`/`undefined` = armement au seuil. */
    longPress?: number | false | undefined;
    /** Seuil de déplacement avant armement, px. Défaut 8. */
    threshold?: number | undefined;
    /** Axe de la liste. Défaut `'y'`. */
    axis?: 'x' | 'y' | undefined;
    /** Filtre par type de pointeur (ex. `['touch']`). Défaut : tous. */
    pointerTypes?: string[] | undefined;
    /**
     * Callback de fin de réordonnancement (ui-platform.js:211).
     * Appelé avec la liste ORDONNÉE des items et l'index de destination.
     * NB : le JSDoc d'origine annonce `(orderedEls, fromIdx, toIdx)` mais le
     * code n'en passe que DEUX — la signature ci-dessous est celle du code.
     */
    onReorder?: ((orderedItems: Element[], toIndex: number) => void) | undefined;
}

/** Handle retourné par `UIPlatform.sortable` (ui-platform.js:221). */
export interface UIPlatformSortableHandle {
    destroy(): void;
}

/** Options de `UIPlatform.makeDialog` (ui-platform.js:236-242). */
export interface UIPlatformDialogOptions {
    /** Appelé sur Échap. Si absent, Échap n'a aucun effet. */
    onClose?: ((e: KeyboardEvent) => void) | undefined;
}

/** Handle retourné par `UIPlatform.makeDialog` (ui-platform.js:250-264). */
export interface UIPlatformDialogHandle {
    /** Mémorise le focus, verrouille le scroll, pose le focus trap. */
    open(): void;
    /** Retire le focus trap, déverrouille le scroll, restaure le focus. */
    close(): void;
}

/** Options de `UIPlatform.makeTablist` (ui-platform.js:268-281). */
export interface UIPlatformTablistOptions {
    /** Sélecteur des onglets. Défaut `'[role="tab"]'`. */
    tabSelector?: string | undefined;
    /** Appelé avec l'onglet nouvellement focalisé (navigation clavier). */
    activate?: ((tab: HTMLElement) => void) | undefined;
}

export interface UIPlatformContract {
    /** Échappement HTML (`& < > " '`). `null`/`undefined` → `''`. */
    esc(value: unknown): string;
    /** Alias strict de `esc` (ui-platform.js:22). */
    escAttr(value: unknown): string;
    /**
     * Lit `key` : `JSON.parse` si possible, sinon la chaîne brute, sinon
     * `fallback` (clé absente ou localStorage indisponible).
     * Le type de retour est `unknown` par construction (3 formes possibles).
     */
    loadState(key: string, fallback?: unknown): unknown;
    /** Écrit `key` (stringify sauf si `value` est déjà une chaîne). `false` en échec. */
    saveState(key: string, value: unknown): boolean;
    /**
     * Applique la valeur persistée au boot puis renvoie un setter qui persiste.
     * `applier` est appelé sous try/catch (non bloquant).
     */
    persistState(
        key: string,
        applier?: ((value: unknown) => void) | null,
        fallback?: unknown,
    ): (value: unknown) => void;
    /** Verrou de scroll réf-compté. */
    lockScroll(): void;
    /** Déverrouille ; `force` remet le compteur à 0 d'un coup. */
    unlockScroll(force?: boolean): void;
    /** Recadre un popover dans le viewport (marge par défaut 8px). */
    clampToViewport(el: HTMLElement | null | undefined, margin?: number | null): void;
    onLongPress(
        el: HTMLElement,
        cb: (e: PointerEvent) => void,
        opts?: UIPlatformLongPressOptions | null,
    ): UIPlatformLongPressHandle;
    onDoubleTap(
        el: HTMLElement,
        cb: (e: PointerEvent) => void,
        opts?: UIPlatformDoubleTapOptions | null,
    ): void;
    sortable(container: HTMLElement, opts?: UIPlatformSortableOptions | null): UIPlatformSortableHandle;
    makeDialog(el: HTMLElement, opts?: UIPlatformDialogOptions | null): UIPlatformDialogHandle;
    makeTablist(container: HTMLElement, opts?: UIPlatformTablistOptions | null): void;
}

/* =========================================================================
 * 2. CONTRAT PARTAGÉ — window.PocheTuto  (modules/tuto-engine.js, 755 LOC)
 * =========================================================================
 * Moteur de tutoriel autonome, identique dans les deux apps ; seules les
 * données changent (`tuto_oi_data.js` vs `pctac/tuto_data.js`).
 * IIFE idempotente (`if (window.PocheTuto) return;`).
 */

/** Intégration du déclencheur dans un dock existant (tuto-engine.js:334-345). */
export interface PocheTutoDockConfig {
    /** Sélecteur du dock hôte, ex. `'#dockMenu'`. Si absent/introuvable → FAB flottant. */
    selector?: string | undefined;
    /** Tag de l'item injecté. Défaut `'div'`. */
    itemTag?: string | undefined;
    /** Classe de l'item injecté (ex. `'dock-menu-item'`). */
    itemClass?: string | undefined;
    /** Icône Material Symbols. Défaut `'menu_book'`. */
    icon?: string | undefined;
    /** Attribut `title` de l'item. Défaut `'Tutoriel interactif — <appName>'`. */
    title?: string | undefined;
    /** Sélecteur du frère après lequel insérer l'item (ex. `'#dockToggleBtn'`). */
    insertAfter?: string | undefined;
}

/** Configuration passée à `PocheTuto.mount` (tuto-engine.js:8-18, 295-314). */
export interface PocheTutoConfig {
    /** Espace de persistance : clés `ptuto_<appId>_seen/_pos/_greeted`. Défaut `'app'`. */
    appId?: string | undefined;
    /** Nom affiché dans l'en-tête du panneau. */
    appName?: string | undefined;
    /** Couleur d'accent CSS. Défaut `'#4f8dff'`. */
    accent?: string | undefined;
    /** Libellé du bouton flottant de repli. */
    buttonLabel?: string | undefined;
    dock?: PocheTutoDockConfig | undefined;
    /** Obligatoire : `mount` abandonne (warn + `undefined`) si `data` est absent. */
    data: TutoData;
}

/**
 * Instance retournée par `mount` (constructeur `Tuto`, tuto-engine.js:295).
 * Aucun consommateur actuel n'exploite la valeur de retour ; le type reste
 * néanmoins fidèle aux membres réellement présents sur l'instance.
 */
export interface PocheTutoInstance {
    readonly cfg: PocheTutoConfig;
    readonly data: TutoData;
    readonly chapters: TutoChapter[];
    /** Index plat de tous les steps, construit au montage. */
    readonly flat: TutoFlatStep[];
    /** Préfixe des clés localStorage : `'ptuto_' + appId`. */
    readonly storeKey: string;
    /** Index global du step courant. */
    pos: number;
    /** Steps déjà vus, clés `'<chapterId>:<stepIndex>'`. */
    viewed: Set<string>;
    /** Injecte l'item de dock ou le FAB flottant (appelé au `ready` par `mount`). */
    mountButton(): void;
    /** Ouvre le panneau ; sans argument, reprend à la position persistée. */
    open(gi?: number): void;
    close(): void;
    /** Navigation relative (`+1` / `-1`). */
    go(delta: number): void;
    /** Saut à un index global. */
    jump(gi: number): void;
    render(): void;
    openToc(): void;
    closeToc(): void;
    /** Note inline temporaire (auto-effacée après ~5,2 s). */
    showNote(msg: string): void;
}

export interface PocheTutoContract {
    /** Retourne `undefined` si `cfg` ou `cfg.data` manque (warn console). */
    mount(cfg: PocheTutoConfig): PocheTutoInstance | undefined;
    /** Dernière instance montée (tuto-engine.js:750). Détail d'implémentation exposé. */
    _inst?: PocheTutoInstance | undefined;
}

/* =========================================================================
 * 3. PC-TAC — couche de persistance canonique (modules/pctac/persist.js)
 * =========================================================================
 * `Persist` n'est JAMAIS posé sur `window` (module ESM standalone, zéro
 * import). Son interface figure ici parce que c'est le contrat de fondation
 * partagé par storage / logManager / planMap / tchapLive.
 */

/** Résultat d'écriture de `Persist.set` / `Persist.setRaw` (persist.js:198, 238). */
export type PersistWriteResult =
    | { ok: true }
    /** Quota dépassé : l'évènement window `'pctac:quota'` a été émis, rien n'est jeté. */
    | { ok: false; quota: true }
    /** Autre échec (localStorage indisponible, valeur non sérialisable…). */
    | { ok: false; error: Error };

/** Détail de l'évènement `CustomEvent('pctac:quota')` (persist.js:92). */
export interface PctacQuotaEventDetail {
    /** Clé dont l'écriture a échoué. */
    key: string;
    /** Complété a posteriori si `navigator.storage.estimate()` répond à temps. */
    estimate: StorageEstimate | null;
}

/** Options de `Persist.get` (persist.js:144). */
export interface PersistGetOptions<T> {
    /**
     * Validateur métier. Seul le retour STRICTEMENT `false` (ou une exception)
     * vaut rejet ; le rejet déclenche la sauvegarde de la chaîne brute dans
     * `<key>.bak` puis le retour du fallback.
     */
    validator?: ((value: unknown) => boolean) | null | undefined;
    /** Valeur retournée si clé absente / JSON corrompu / validateur en échec. */
    fallback?: T | undefined;
}

export interface PersistContract {
    /**
     * Lecture JSON défensive.
     * Le paramètre de type `T` est une ASSERTION dont la preuve d'exécution est
     * `opts.validator` (contrat d'origine : `Persist.get(K, {validator: isArray,
     * fallback: []})`). Sans validateur, appeler avec `T = unknown`.
     */
    get<T = unknown>(key: string, opts?: PersistGetOptions<T>): T;
    /** Sérialise puis écrit. Ne jette JAMAIS sur quota. */
    set(key: string, value: unknown): PersistWriteResult;
    /** Lecture brute, tolérante à l'indisponibilité du stockage. */
    getRaw(key: string): string | null;
    /** Écriture brute (sans `JSON.stringify`). Même contrat de quota que `set`. */
    setRaw(key: string, str: string): PersistWriteResult;
}

/* =========================================================================
 * 4. PC-TAC — modèles de données partagés
 * ========================================================================= */

/** Mode de saisie d'un intervenant dans la main courante. */
export type PctacPaxMode = 'standard' | 'free';

/** U16 — statut d'une fiche adversaire (défaut `'active'`). */
export type PctacAdversaryStatus = 'active' | 'neutralized';

/** U16 — statut d'une fiche otage (défaut dérivé de l'heuristique blessures). */
export type PctacHostageStatus = 'ok' | 'preoccupant' | 'blesse' | 'dcd';

/** Une entrée du journal (main courante). Forme produite par `LogManager.addEntry`. */
export interface PctacLogEntry {
    /** `Date.now().toString(36) + Math.random().toString(36).substr(2,5)`. */
    id: string;
    /** `HH:MM`. Clé de tri (tri lexicographique dans `Storage.saveLogData`). */
    heure: string;
    /** Libellé de l'intervenant. */
    pax: string;
    paxMode: PctacPaxMode;
    /** Hex en mode libre, `''` en mode standard, `undefined` possible à l'import legacy. */
    paxColor?: string | undefined;
    lieu: string;
    remarques: string;
    /**
     * U15 — date d'opération ISO `YYYY-MM-DD`, posée à la création par
     * `LogManager.addEntry`. Absente des entrées legacy (qui trient AVANT
     * toute entrée datée : clé de tri `(date ?? '', heure)`).
     */
    date?: string | undefined;
    /**
     * Entrée générée automatiquement par l'app (pose/retrait de ping,
     * changement de statut) : au PDF, ces entrées sortent de la main courante
     * vers la page « JOURNAL DES ACTIONS PC-TAC » en fin de document.
     */
    auto?: boolean | undefined;
    /** Champ legacy transporté par le flux QR (`QrSync`), absent des entrées créées aujourd'hui. */
    fenetrePorte?: string | undefined;
}

/**
 * Item générique d'une collection PC-Tac (adversaires / otages / amis / photos /
 * pax personnalisés). Les champs varient par collection : seul `id` est garanti.
 */
export interface PctacCollectionItem {
    id: string;
    /** `true` quand l'image de l'item vit dans IndexedDB (`ImageStore`), pas en localStorage. */
    hasImage?: boolean | undefined;
    [key: string]: unknown;
}

/** Entrée du catalogue d'icônes de ping (config.js:PIN_ICONS, ~80 entrées). */
export interface PctacPinIcon {
    /** Nom d'icône Material Symbols Outlined (sert aussi de clé). */
    id: string;
    label: string;
    /** Catégorie d'affichage du catalogue (ex. `'Forces'`). */
    cat: string;
    /** Mots-clés de matching flou (`suggestPinIcons`). */
    tags: string[];
}

/** Catégorie de photo (config.js:PHOTO_CATEGORIES). */
export interface PctacPhotoCategory {
    id: string;
    label: string;
}

/** Couleur nommée du mode libre (config.js:FREE_MODE_COLORS). */
export interface PctacNamedColor {
    hex: string;
    name: string;
}

/** Métadonnées de couleur d'un PAX standard (config.js:PDF_PAX_COLORS). */
export interface PctacPaxColorEntry {
    /** Libellé affiché (peut différer de la clé : `'Otage'` → `'Civil/Otage'`). */
    text: string;
    color: string;
    fontColor: string;
}

/* =========================================================================
 * 5. PC-TAC — window.saveLogData / loadLogData / getTpAssociations /
 *              saveTpAssociation   (modules/pctac/storage.js:114-117)
 * =========================================================================
 * Façade métier au-dessus de `Persist`. L'objet `Storage` lui-même n'est PAS
 * sur window : seules 4 méthodes y sont bindées (compat legacy, zéro
 * consommateur identifié — cf. docs/SPEC-CONTRATS.md).
 */
export interface PctacStorageContract {
    /** Trie par `heure` (mutation en place) puis persiste via `Persist.set`. */
    saveLogData(logData: PctacLogEntry[]): void;
    loadLogData(): PctacLogEntry[];
    /**
     * Associations « Pax Libre ». ATTENTION : la map est indexée par COULEUR
     * (`assoc[color] = label`), pas par libellé.
     */
    getTpAssociations(): Record<string, string>;
    saveTpAssociation(label: string, color: string): void;
    saveCollection(key: string, data: readonly PctacCollectionItem[]): void;
    loadCollection(key: string): PctacCollectionItem[];
    /** Supprime les 14 clés listées dans `storage.js:84-102` (localStorage direct). */
    clearAllData(): void;
}

/* =========================================================================
 * 6. PC-TAC — window.ImageStore  (modules/pctac/imageStore.js:154)
 * =========================================================================
 * IndexedDB `pcTacImages` / store `images` / version 1. Les valeurs stockées
 * sont des data URLs (`string`), pas des Blob.
 */
export interface ImageStoreContract {
    /**
     * No-op si `id` ou `dataUrl` est falsy.
     * NB : la promesse résout sur le commit de transaction ; la valeur résolue
     * est un artefact IDB interne jamais consommé → typée `void`.
     */
    put(id: string, dataUrl: string): Promise<void>;
    /** `null` si `id` falsy ou entrée absente. */
    get(id: string): Promise<string | null>;
    /** `{}` si `ids` vide. Chaque valeur est `null` si l'entrée est absente. */
    getMany(ids: readonly string[]): Promise<Record<string, string | null>>;
    delete(id: string): Promise<void>;
    deleteMany(ids: readonly string[]): Promise<void>;
    clear(): Promise<void>;
    /**
     * Migration one-shot base64 (localStorage) → IndexedDB, gardée par le flag
     * `pcTacIdbMigratedV1`. Cible : `pcTacPhotos.data`, `pcTacAdversaries.photo`,
     * `pcTacHostages.photo`. Pose `hasImage: true` et supprime le champ source.
     */
    migrateFromLocalStorage(): Promise<void>;
    /**
     * Réinjecte les data URLs dans `field` (défaut `'data'`) SANS muter la liste
     * d'origine. Retourne `items` tel quel si la liste est vide/absente.
     */
    hydrate<T extends { id: string }>(items: T[], field?: string): Promise<T[]>;
}

/* =========================================================================
 * 7. PC-TAC — window.LogManager  (modules/pctac/logManager.js:139)
 * ========================================================================= */

/** Données de formulaire acceptées par `LogManager.addEntry` (logManager.js:16). */
export interface PctacLogEntryInput {
    mode: PctacPaxMode;
    /** En mode libre, sert de repli avant `freePax` puis `'Pax Libre'`. */
    pax: string;
    freePax?: string | undefined;
    /** Ignoré en mode standard (forcé à `''`). */
    paxColor?: string | undefined;
    heure: string;
    lieu?: string | undefined;
    remarques?: string | undefined;
    /** Entrée générée automatiquement (cf. `PctacLogEntry.auto`). */
    auto?: boolean | undefined;
}

/** Fichier JSON legacy accepté par `LogManager.importJson` (logManager.js:106). */
export interface PctacLegacyLogJson {
    metadata?: { appName?: string } | undefined;
    logEntries?: readonly Partial<PctacLogEntry>[] | undefined;
}

/** Résultat de `LogManager.importJson` (logManager.js:129). */
export interface PctacImportJsonResult {
    success: true;
    /** Nombre d'entrées RÉELLEMENT ajoutées (après déduplication par `id`). */
    count: number;
    logs: PctacLogEntry[];
}

export interface LogManagerContract {
    /** `null` + `alert()` si PAX ou heure manquants (comportement d'origine conservé). */
    addEntry(data: PctacLogEntryInput): PctacLogEntry | null;
    /** Historique LRU des lieux, max 30, clé `pcTacLieuHistory`. */
    addLieuToHistory(lieu: string): void;
    getLieuHistory(): string[];
    /** Retourne le journal APRÈS suppression. */
    deleteEntry(id: string): PctacLogEntry[];
    /** Retourne le journal APRÈS mise à jour (inchangé si `id` introuvable). */
    updateEntry(id: string, updatedData: Partial<PctacLogEntry>): PctacLogEntry[];
    /** Jette `Error('Fichier JSON invalide.')` si le format n'est pas reconnu. */
    importJson(jsonContent: PctacLegacyLogJson): PctacImportJsonResult;
}

/* =========================================================================
 * 8. PC-TAC — window.Archive  (modules/pctac/archive.js:459)
 * ========================================================================= */

/** Résultat de `Archive.importFile` (archive.js:157, 199, 211, 233, 274). */
export type ArchiveImportResult =
    | { ok: true }
    /** L'utilisateur a annulé la confirmation d'écrasement. */
    | { ok: false; cancelled: true }
    | { ok: false; error: unknown };

/** Résultat de la passerelle OI → PC-Tac (archive.js:455). */
export interface ArchiveOiImportResult {
    ok: true;
    /** Adversaires ajoutés depuis l'étape 2 de l'OI. */
    advAdded: number;
    /** Photos d'adversaire restaurées dans IndexedDB. */
    advPhotos: number;
    /** Adversaires ignorés (doublon de nom normalisé, ou nom vide). */
    advSkipped: number;
    /** Trigrammes PATRACDVR ajoutés à `pcTacCustomPax`. */
    paxAdded: number;
    /** Trigrammes ignorés (`'N/A'`, vide, ou déjà présents). */
    paxSkipped: number;
}

export interface ArchiveContract {
    /**
     * Export `.pctac.zip` (JSZip) : `manifest.json` + `data.json` +
     * `images/<id>.txt`. `alert()` + retour anticipé si JSZip est absent.
     */
    exportZip(): Promise<void>;
    /**
     * Import `.pctac.zip` OU `.json` legacy (routage par extension).
     * Jette sur archive illisible / manifest d'une autre app.
     */
    importFile(file: File): Promise<ArchiveImportResult>;
    /**
     * PASSERELLE OI → PC-Tac : lit un `.oi.zip` (ou une session `.json` legacy)
     * du Générateur d'OI et fusionne SANS écraser (adversaires + trigrammes).
     */
    importOiArchive(file: File): Promise<ArchiveOiImportResult>;
    /** Interne : snapshot best-effort des images IDB, pour le rollback d'import. */
    _snapshotImages(): Promise<Record<string, string>>;
    /** Interne : import de l'ancien export JSON « PC Tac Log » (logs seuls). */
    _importLegacyJson(obj: unknown): Promise<{ ok: true }>;
}

/* =========================================================================
 * 9. PC-TAC — window.PdfExport  (modules/pctac/pdfExport.js:596)
 * ========================================================================= */
export interface PdfExportContract {
    /**
     * Génère et TÉLÉCHARGE `PC-TAC-EXPORT-<timestamp>.pdf` (pdf-lib).
     * Ne jette jamais : `alert()` si pdf-lib absent ou en cas d'erreur.
     * Aucune valeur retournée (le blob est consommé en interne).
     */
    buildPdf(): Promise<void>;
}

/* =========================================================================
 * 10. PC-TAC — window.QrSync  (modules/pctac/qrSync.js:193)
 * =========================================================================
 * ⚠ MODULE MORT dans `pctac2.html` : jamais importé par le graphe ESM, et le
 * DOM qu'il pilote (`#transferModal`, `#qr-reader`, `#qrcode-container`…) est
 * ABSENT de la page. Interface fournie car exigée par la mission ; l'exclusion
 * du portage est proposée dans docs/SPEC-CONTRATS.md.
 */

/** Ligne compressée d'un lot QR (qrSync.js:62) — ordre positionnel figé. */
export type PctacQrRow = (string | undefined)[];

/** Callback invoqué après fusion réussie d'un lot scanné. */
export type PctacQrScanCallback = (logs: PctacLogEntry[]) => void;

export interface QrSyncContract {
    /** Lots courants (chaque lot = `QR_BATCH_SIZE` lignes, soit 5). */
    qrChunks: PctacQrRow[][];
    /** Index du lot affiché. */
    currentIndex: number;
    chunkArray<T>(array: readonly T[], size: number): T[][];
    openModal(callback?: PctacQrScanCallback): void;
    closeModal(): void;
    /** `'send'` → pagination QR ; toute autre valeur → démarrage du scanner. */
    switchTab(tabName: string, callback?: PctacQrScanCallback): void;
    preparePagination(): void;
    showQR(index: number): void;
    startScanner(onSuccessCallback?: PctacQrScanCallback): void;
    stopScanner(): void;
    /** N'accepte que les charges taguées `t === 'PC-TAC-V1'` ; dédup par `id`. */
    handleScanSuccess(decodedText: string, callback?: PctacQrScanCallback): void;
    nextPage(): void;
    prevPage(): void;
}

/* =========================================================================
 * 11. PC-TAC — window.UI  (modules/pctac/ui.js:884) + binds individuels
 * =========================================================================
 * Contrôleur UI central. Consommé par des `onclick` inline du HTML statique
 * (`pctac2.html:2157, 2223, 2255, 2286, 2343`) ET par des `onclick` générés en
 * `innerHTML` (ui.js:214, 460-461, 490-491, 508, 530, 545, 550-551, 557, 563).
 */

/** Références DOM résolues par `UI.initElements` (ui.js:24-48). */
export interface PctacUiElements {
    logTableBody: HTMLTableSectionElement | null;
    logForm: HTMLFormElement | null;
    heureInput: HTMLInputElement | null;
    /** `<input type="hidden">`. */
    paxInput: HTMLInputElement | null;
    /** `<input type="hidden">` portant `'standard'` | `'free'`. */
    paxModeInput: HTMLInputElement | null;
    /** `<input type="hidden">` portant l'hex de couleur libre. */
    paxCustomColorInput: HTMLInputElement | null;
    lieuInput: HTMLInputElement | null;
    remarquesInput: HTMLTextAreaElement | null;
    paxSelectContainer: HTMLElement | null;
    darkModeIcon: HTMLElement | null;
    fullscreenIcon: HTMLElement | null;
    dockMenu: HTMLElement | null;
    dockToggleIcon: HTMLElement | null;
    adversaryForm: HTMLFormElement | null;
    hostageForm: HTMLFormElement | null;
    friendForm: HTMLFormElement | null;
    photoForm: HTMLFormElement | null;
    createPaxModal: HTMLElement | null;
    newPaxColorPalette: HTMLElement | null;
}

export interface UIContract {
    /**
     * `{}` avant `initElements()`, d'où le `Partial` : tous les accès du code
     * d'origine sont gardés (`if (this.elements.x)`).
     */
    elements: Partial<PctacUiElements>;

    /* --- cycle de vie --- */
    initElements(): void;
    /** Ferme toute `.modal` au clic sur `#modalBackdrop` (idempotent via `dataset.bound`). */
    bindModalBackdrop(): void;
    initColorPalettes(): void;
    initPaxModeAndColors(): void;

    /* --- navigation / thème / chrome --- */
    /** Bascule d'onglet + persistance `lastView` (échec de quota toléré). */
    switchMainView(viewId: string): void;
    toggleFullscreen(): void;
    updateFullscreenIcon(): void;
    /** Bascule `dark-mode`/`light-mode` + persiste `theme`. */
    handleThemeToggle(): void;
    /** Replie/déplie `#dockMenu` + persiste `dockCollapsed`. */
    toggleDock(): void;

    /* --- saisie du journal --- */
    /** `'#ffffff'` ou `'#000000'` selon la luminance YIQ. */
    getContrastYIQ(hexcolor: string | null | undefined): string;
    /** N'écrase pas l'heure si `window.isTimeInputManuallyChanged` sauf `force`. */
    updateTimeInput(force?: boolean): void;
    deleteCustomPax(id: string): void;
    renderCustomPaxOptions(): void;
    showCreatePaxModal(): void;
    hideCreatePaxModal(): void;
    refreshNewPaxPalette(): void;
    /** Coche la pastille `hex` et reporte la valeur dans l'input caché. */
    selectColorSwatch(hex: string, paletteId: string, hiddenInputId?: string): void;
    refreshLieuSuggestions(): void;

    /* --- tableau du journal --- */
    /** Ordre d'affichage du journal : false = chrono ASC (stockage), true = inversé (récent en tête). */
    logSortDesc: boolean;
    renderLogTable(logData: readonly PctacLogEntry[]): void;
    openEditModal(id: string): void;
    confirmEditLog(): void;
    hideEditModal(): void;
    toggleSearchMode(): void;
    closeSearchMode(): void;
    filterLogs(): void;
    showResetModal(): void;
    hideResetModal(): void;

    /* --- collections --- */
    renderAdversaries(): Promise<void>;
    renderHostages(): Promise<void>;
    renderFriends(): void;
    /** Sans argument : reprend `lastPhotoFilter` (défaut `'all'`). */
    renderPhotos(filterCategory?: string): Promise<void>;
    handlePhotoDragStart(e: DragEvent): void;
    handlePhotoDragOver(e: DragEvent): void;
    handlePhotoDrop(e: DragEvent): void;
    handlePhotoDragEnd(): void;
    /**
     * U16/C1 — depuis une carte PHOTO : remonte au besoin vers la FICHE
     * (id sans le suffixe `_sync`) qui devient la source de vérité, puis
     * propage vers la photo. Photo orpheline : comportement historique.
     */
    updateAdversaryStatus(id: string, status: string): void;
    /**
     * U16/C1 — change le statut d'une FICHE (adversaire ou otage), propage
     * vers la photo `_sync`, journalise (C5-statut) et re-rend.
     */
    setItemStatus(key: string, id: string, status: string): void;
    /** U25 — `promptDialog` async (ex-`prompt()` natif). */
    editPhotoTitle(id: string): Promise<void>;
    openLightbox(src: string, title?: string): void;
    closeLightbox(): void;

    /* --- modales d'édition --- */
    showEditAdversaryModal(id: string): Promise<void>;
    hideEditAdversaryModal(): void;
    handleAdversaryUpdate(): Promise<void>;
    showEditHostageModal(id: string): Promise<void>;
    hideEditHostageModal(): void;
    handleHostageUpdate(): Promise<void>;
    /** U13 — édition d'une fiche Ami (champs seuls, pas de photo). */
    showEditFriendModal(id: string): void;
    hideEditFriendModal(): void;
    handleFriendUpdate(): void;

    /** Handler `keydown` du lightbox, conservé pour pouvoir être retiré. */
    _lightboxKeydown?: ((e: KeyboardEvent) => void) | undefined;
}

/* =========================================================================
 * 12. PC-TAC — window.PlanMap  (modules/pctac/planMap.js:5596)
 * =========================================================================
 * L'objet `PlanMap` compte ~190 membres, dont l'immense majorité est privée
 * (préfixe `_`). L'interface ci-dessous décrit le CONTRAT INTER-MODULES —
 * c'est-à-dire STRICTEMENT ce qui est lu depuis l'extérieur de planMap.js :
 *   - `main.js:460`      → `initialized`, `refresh()`
 *   - `ui.js:108`        → `refresh()`
 *   - `pdfExport.js:402` → `captureToDataUrl()`
 *   - `pdfExport.js:412` → `map` (puis `map.resize()`)
 *   - `pdfExport.js:448` → `getPinsSummary()`
 *   - `tchapLive.js:226` → `initialized`, `init()`, `map`
 * Les membres internes restent typés DANS le module TS ; ils ne font pas
 * partie de la façade window (cf. docs/SPEC-CONTRATS.md).
 */

/** Ligne du résumé de pings pour l'export PDF — CONTRAT C2 (planMap.js:5025). */
export interface PlanMapPinSummary {
    /** Libellé effectif (entité liée ou ping libre) ; `''` si indéterminable. */
    label: string;
    lat: number;
    lng: number;
    /** Diamètre en mètres si > 0, sinon `null`. */
    diameterM: number | null;
}

export interface PlanMapContract {
    /** Instance MapLibre, `null` tant que `init()` n'a pas abouti. */
    map: MapLibreMap | null;
    /** Passe à `true` en fin d'`init()` réussi. */
    initialized: boolean;
    /** Idempotent : sort immédiatement si déjà initialisé ou si `#plan_map`/MapLibre manquent. */
    init(): void;
    /** Initialise si besoin, sinon `map.resize()` différé (50 ms) + re-render des pings. */
    refresh(): void;
    /** CONTRAT C2 — `[]` en cas d'échec, jamais d'exception. */
    getPinsSummary(): PlanMapPinSummary[];
    /**
     * CONTRAT C2 — compose canvas WebGL + overlays et retourne un PNG en dataURL.
     * `null` si : carte non initialisée, html2canvas absent, vue Plan masquée,
     * canvas de largeur 0 après deux rAF, ou capture déjà en cours (`_captureBusy`).
     */
    captureToDataUrl(): Promise<string | null>;
}

/* =========================================================================
 * 13. PC-TAC — constantes posées sur window par config.js:310-317
 * =========================================================================
 * Aucune n'a de consommateur identifié (compat legacy).
 */
export interface PctacConfigGlobals {
    PIN_ICONS: PctacPinIcon[];
    /** Matching flou libellé → icônes, trié par score décroissant. `max` défaut 6. */
    suggestPinIcons(label: string, max?: number): PctacPinIcon[];
    /** Vaut `'pcTacLogData'` — la clé du journal, PAS un préfixe global. */
    LOCAL_STORAGE_KEY: string;
    PHOTO_CATEGORIES: PctacPhotoCategory[];
    FREE_MODE_COLORS: PctacNamedColor[];
    /** Indexé par libellé de PAX standard (`'Adversaire'`, `'Otage'`, …). */
    PDF_PAX_COLORS: Record<string, PctacPaxColorEntry>;
}

/* =========================================================================
 * 14. OI — modèles de données du Store  (modules/init.js)
 * ========================================================================= */

/** Membre PATRACDVR : reflet exact des `dataset` du bouton (patrac.js:1008-1021). */
export interface OiPatracMember {
    trigramme: string;
    fonction: string;
    cellule: string;
    principales: string;
    secondaires: string;
    afis: string;
    grenades: string;
    equipement: string;
    equipement2: string;
    tenue: string;
    gpb: string;
    /** Direction / poste dans la rame, `''` par défaut. */
    dir: string;
}

/** Ligne « véhicule » du PATRACDVR (formulaires.js:457). */
export interface OiPatracRow {
    vehicle: string;
    members: OiPatracMember[];
}

/** Un bloc MOICP (formulaires.js:475). */
export interface OiMoicpBlock {
    id: string;
    title: string;
    mission: string;
    objectif: string;
    itineraire: string;
    points_particuliers: string;
    cat: string;
    place_chef: string;
    /** Trigrammes des membres affectés. */
    members: string[];
}

/** Un bloc ZMSPCP (formulaires.js:488). */
export interface OiZmspcpBlock {
    id: string;
    title: string;
    zone: string;
    mission: string;
    secteur: string;
    points_particuliers: string;
    cat: string;
    place_chef: string;
    members: string[];
}

/** Une hypothèse d'un bloc Effraction (formulaires.js:518). */
export interface OiEffractionHypothesis {
    id: string;
    title: string;
    desc: string;
    effrac: string;
    degag: string;
    assaut: string;
}

/** Un bloc Effraction (formulaires.js:501). */
export interface OiEffractionBlock {
    id: string;
    title: string;
    mission: string;
    porte: string;
    structure: string;
    serrurerie: string;
    environnement: string;
    bati_a_bati: string;
    dormant_a_dormant: string;
    prof_linteaux: string;
    prof_bati: string;
    h_porte: string;
    h_marche: string;
    prof_marche: string;
    prof_moulure: string;
    members: string[];
    hypotheses: OiEffractionHypothesis[];
}

/** Un évènement de la chronologie T0-T4 (formulaires.js:466). */
export interface OiTimeEvent {
    type: string;
    hour: string;
    description: string;
}

/** Métadonnées d'une photo rattachée à un conteneur d'aperçu (formulaires.js:411). */
export interface OiPhotoMeta {
    /** Clé IndexedDB (store `images` de `OI_GeneratorLiteDB`). */
    id: string;
    /** JSON sérialisé d'un `OiAnnotation[]` — stocké en chaîne dans le dataset DOM. */
    annotations: string;
    /** JSON sérialisé de la liste d'outils d'effraction cochés. */
    tools: string;
    other_tools: string;
    customTitle: string;
}

/** Fiche adversaire : champs dynamiques `.adv-field` + 4 listes (formulaires.js:429). */
export interface OiAdversary {
    id: string;
    me_list: string[];
    etat_esprit_list: string[];
    volume_list: string[];
    vehicules_list: string[];
    /**
     * Modes d'action (MA1, MA2…) — dernier bloc de la fiche, rendus sur une
     * page PDF dédiée juste après la fiche adversaire (jamais dans la fiche
     * elle-même, cf. SPEC-2026-08-18-pdf-et-champs.md §3). Optionnel :
     * absent sur les fiches enregistrées avant l'ajout de ce champ — tout
     * lecteur doit replier sur `[]` (`adv.ma_list ?? []`), jamais y accéder nu.
     */
    ma_list?: string[] | undefined;
    /** Champs `data-field` du DOM, tous en `string`. */
    [key: string]: unknown;
}

/** Vue caméra persistée de la cartographie OI (oi_cartographie.js:374-383). */
export interface OiCartoView {
    /** `[lng, lat]`. */
    center: [number, number];
    zoom: number;
    bearing?: number | undefined;
    pitch?: number | undefined;
}

/** Bloc cartographie de `formData` (oi_cartographie.js:369). */
export interface OiCartographyState {
    view: OiCartoView | null;
    pins: Record<string, unknown>[];
    shapes: Record<string, unknown>[];
}

/**
 * `Store.state.formData` : DICTIONNAIRE de champs de formulaire (les clés sont
 * les `id`/`name` du DOM, donc ouvertes) + un petit nombre de sous-structures
 * connues, listées ici pour être typées correctement.
 */
export interface OiFormData {
    adversaries?: OiAdversary[] | undefined;
    patracdvr_rows?: OiPatracRow[] | undefined;
    patracdvr_unassigned?: OiPatracMember[] | undefined;
    moicp_blocks?: OiMoicpBlock[] | undefined;
    zmspcp_blocks?: OiZmspcpBlock[] | undefined;
    effraction_blocks?: OiEffractionBlock[] | undefined;
    rame_vl_order?: string[] | undefined;
    colonne_progression_order?: string[] | undefined;
    ordre_penetration_order?: string[] | undefined;
    time_events?: OiTimeEvent[] | undefined;
    hypotheses?: string[] | undefined;
    /** Indexé par `id` du conteneur d'aperçu (`.image-preview-container`). */
    dynamic_photos?: Record<string, OiPhotoMeta[]> | undefined;
    cartography?: OiCartographyState | undefined;
    /** Copie de `memberConfig` embarquée dans la sauvegarde (formulaires.js:533). */
    options?: OiMemberConfig | undefined;
    /** `'dark'` | `'light'` ; sinon, repli sur la classe `dark-mode` du body. */
    pdf_theme?: string | undefined;
    /**
     * Ordre persisté des sections réordonnables du PDF (ids du registre
     * `OI_PDF_SECTIONS`, `document-builder.ts`) — repli sur l'ordre par
     * défaut si absent, partiel, ou porteur d'ids inconnus
     * (`resolveOiPdfSectionOrder`). Alimenté par le panneau « Ordre des
     * sections » de `#presentationModal` (glisser-déposer + boutons
     * monter/descendre, `pdf-section-order.ts`, §2 SPEC-2026-08-18-pdf-et-
     * champs.md).
     */
    pdf_section_order?: string[] | undefined;
    /** Tous les autres champs texte du formulaire (situation, mission, environnement…). */
    [key: string]: unknown;
}

/** Outils du canvas d'annotation (`id="tool_<toolId>"`, dessin.js:setActiveTool). */
export type OiAnnotationTool = 'move' | 'location' | 'arrow' | 'box' | 'text' | 'member';

/** Annotation ponctuelle : texte libre ou puce de membre (dessin.js:744, 1127). */
export interface OiPointAnnotation {
    /** `Date.now() + Math.random()` → NUMBER, pas une chaîne. */
    id: number;
    type: 'text' | 'member';
    x: number;
    y: number;
    text: string;
    color: string;
    /** Radians. */
    rotation: number;
    size: number;
}

/** Annotation géométrique tracée à la souris/au doigt (dessin.js:763). */
export interface OiShapeAnnotation {
    id: number;
    type: 'location' | 'arrow' | 'box';
    startX: number;
    startY: number;
    endX: number;
    endY: number;
    /** Radians. */
    rotation: number;
    color: string;
    /** Posée par `updateStrokeWidth`. */
    thickness?: number | undefined;
    /** `location` seulement : libellé de zone (`updateZoneText`). */
    text?: string | undefined;
    /** `location` seulement : opacité de remplissage (`updateZoneOpacity`). */
    opacity?: number | undefined;
}

export type OiAnnotation = OiPointAnnotation | OiShapeAnnotation;

/** État global du Store (init.js:83-89). */
export interface OiStoreState {
    formData: OiFormData;
    /** Annotations du canvas ACTUELLEMENT ouvert (remises à plat à la fermeture). */
    annotations: OiAnnotation[];
    /** Index d'étape du wizard (0-7). */
    currentStep: number;
    compressedImages: Record<string, unknown>;
    /** `id` → object URL, révoqués par `cleanupObjectUrls`. */
    objectUrlsCache: Record<string, string>;
}

/**
 * `window.Store` (init.js:340). Proxy : l'accès à `state` renvoie un proxy
 * PROFOND dont chaque `set` déclenche `notify()` → `saveToStorage()`.
 * Les valeurs binaires (`Blob`, `File`, `ArrayBuffer`, TypedArray) NE sont
 * PAS proxyfiées (init.js:112-121) — invariant à préserver au portage.
 */
export interface OiStoreContract {
    state: OiStoreState;
    /** Retourne la fonction de désabonnement (`Set.delete`, donc `boolean`). */
    subscribe(listener: (state: OiStoreState) => void): () => boolean;
    /** Notifie tous les abonnés PUIS persiste. */
    notify(): void;
    /** Écrit `formData` sous `tactical_oi_data` ; toast d'erreur si quota dépassé. */
    saveToStorage(): void;
    /** Purge les références photo dont le blob a disparu d'IndexedDB. */
    checkIntegrity(): Promise<void>;
    /** Peuple `state.formData` directement (contourne le proxy à l'init). */
    loadFromStorage(): void;
    /** Écrit immédiatement `saveToStorage()` si un flush est en attente (débounce `notify`). */
    flush(): void;
}

/** `window.dbManager` (init.js:341) — IndexedDB `OI_GeneratorLiteDB` / store `images`. */
export interface OiDbManagerContract {
    readonly dbName: string;
    readonly storeName: string;
    db: IDBDatabase | null;
    init(): Promise<void>;
    /** Résout sur le COMMIT de transaction (garantie avant un `location.reload()`). */
    putItem(key: string, blob: Blob): Promise<void>;
    /** `undefined` si la clé est absente. */
    getItem(key: string): Promise<Blob | undefined>;
    getAllKeys(): Promise<IDBValidKey[]>;
    /** Révoque aussi l'object URL en cache pour cette clé. */
    deleteItem(key: string): Promise<void>;
    clearAllImages(): Promise<void>;
}

/** `window.memberConfig` (init.js:343) — listes d'options du PATRACDVR. */
export interface OiMemberConfig {
    fonctions: string[];
    cellules: string[];
    principales: string[];
    afis: string[];
    secondaires: string[];
    grenades: string[];
    equipements: string[];
    equipements2: string[];
    tenues: string[];
    gpbs: string[];
}

/** `window.DEFAULTS` (init.js:356) — textes pré-remplis MOICP / ZMSPCP / Effraction. */
export interface OiDefaults {
    missions: {
        moicp: string;
        zmspcp: string;
        effraction: string;
    };
    cat: {
        moicp: string;
        zmspcp: string;
        generales: string;
    };
}

/* =========================================================================
 * 15. OI — window.PDFEngineV2  (modules/pdf_engine_v2.js:1154)
 * ========================================================================= */

/** Données consolidées produites par `collectAllData` (pdf_engine_v2.js:396). */
export interface OiPdfCollectedData {
    /** Copie PROFONDE (`JSON.parse(JSON.stringify(...))`) de `Store.state.formData`. */
    formData: OiFormData;
    /** `photoId` → data URL base64 (annotations déjà aplaties). */
    photosBase64: Record<string, string>;
    isDark: boolean;
}

// R4-a (D2, « une seule voie d'output PDF ») : `options` (config html2canvas/
// jsPDF, morte depuis PDF.INTEG) et `generateHTML`/`OiPdfPageOptions` (gabarit
// HTML de l'aperçu/présentation, remplacé par le blob pdfmake réel — voir
// `openPreview`/`openPresentInPlace` ci-dessous) sont RETIRÉS du contrat.
export interface PdfEngineV2Contract {
    /** Construit le blob PDF vectoriel (même moteur que le téléchargement,
     * `@oi/pdf/engine-v3.js::buildOiPdfBlob`) et le rend PAGE PAR PAGE dans
     * des `<canvas>` (pdf.js embarqué, worker local) à l'intérieur de
     * `#presentation-content` — SPEC-2026-08-18-pdf-et-champs.md §1 : aucune
     * URL `blob:`, aucun `<iframe>`, fonctionne sur un parc verrouillé/hors
     * ligne où le lecteur PDF natif du navigateur est indisponible. */
    openPreview(): Promise<void>;
    /** Ouvre le même blob PDF vectoriel dans un nouvel onglet (visualiseur
     * PDF natif du navigateur : zoom, plein écran, impression) ; si
     * `window.open` échoue ou est bloqué, retombe sur l'aperçu intégré
     * (`openPreview`) plutôt que de laisser un simple message d'erreur. */
    openPresentInPlace(): Promise<void>;
    // downloadOiPdf() RETIRÉE (PDF.INTEG, SPEC-PDF-V3.md §4) : le téléchargement
    // rastérisait via html2canvas + jsPDF ; remplacé par `downloadOiPdfV3()`
    // (`@oi/pdf/engine-v3.js`, moteur vectoriel pdfmake), câblé directement
    // depuis `src/apps/oi/main.ts`, hors de ce contrat.
    collectAllData(): Promise<OiPdfCollectedData>;
    blobToBase64(blob: Blob): Promise<string>;
}

/* =========================================================================
 * 16. OI — window.OICarto  (modules/oi_cartographie.js:1669)
 * =========================================================================
 * Auto-câblé sur `#cartographyBtn` (oi_cartographie.js:1673) : aucun autre
 * consommateur du global. Réécriture indépendante de `planMap.js` (aucun code
 * partagé). Même politique que PlanMap : seule la surface publique est typée.
 */
export interface OICartoContract {
    map: MapLibreMap | null;
    initialized: boolean;
    is3D: boolean;
    /** `pinId` → couple de markers MapLibre (pin + libellé). */
    markers: Map<string, unknown>;
    labelsVisible: boolean;
    /** Ouvre `#cartographyModal` et initialise la carte au premier appel. */
    open(): void;
    close(): void;
}

/* =========================================================================
 * 17. OI — globaux fonctionnels des modules classiques
 * =========================================================================
 * Les 16 modules de 4.html sont des scripts CLASSIQUES : toute
 * `function foo()` de premier niveau devient `window.foo`. Les interfaces
 * ci-dessous regroupent, PAR MODULE D'ORIGINE, les globaux réellement
 * consommés depuis l'extérieur du module (HTML inline, `innerHTML` généré,
 * autre module). Elles sont agrégées sur `Window` dans `global.d.ts`.
 *
 * NB : les `let`/`const` de premier niveau (`steps`, `prevBtn`, `canvas`,
 * `memberConfig`, `activeMemberId`…) créent des liaisons LEXICALES globales,
 * PAS des propriétés de `window` — elles ne figurent donc pas ici (sauf quand
 * le code les re-pose explicitement, ex. `window.memberConfig`).
 */

/** `modules/navigation.js` — wizard 8 étapes (globaux implicites). */
export interface OiWizardGlobals {
    /** Affiche l'étape `n` ; sur la dernière, flush + `checkCoherence()`. */
    showStep(n: number): void;
    /** Va à l'étape `n` (borné), marque l'intervalle visité, persiste. */
    goToStep(n: number): void;
    /** Navigation relative (`-1` / `+1`). */
    changeStep(n: number): void;
    /**
     * Étapes déjà visitées (`init.js:342`). `Set` MUTÉ en place, jamais
     * réassigné : la référence posée sur `window` reste valide à vie.
     */
    visitedSteps: Set<number>;
}

/** `modules/outils.js` — utilitaires transverses exposés implicitement. */
export interface OiToolsGlobals {
    /** Révoque tous les object URLs du cache (outils.js:25, exposé explicitement). */
    cleanupObjectUrls(): void;
    /** Bascule clair/sombre + persiste `theme`. */
    handleThemeToggle(): void;
    /** Replie/déplie `#dockMenu` + persiste `dockCollapsed`. */
    toggleDock(): void;
    toggleFullscreen(): void;
}

/** `modules/formulaires.js` — cœur de la persistance OI. */
export interface OiFormGlobals {
    /**
     * ⚠ Version DÉBOUNCÉE (500 ms) : `window.syncDomToStore = debouncedSync`
     * ÉCRASE la fonction homonyme (formulaires.js:386-392).
     */
    syncDomToStore(): void;
    /** Version immédiate (non débouncée), capturée avant l'écrasement. */
    syncDomToStoreImmediate(): void;
    /** Alias de la version débouncée (formulaires.js:842-843). */
    saveToStorage(): void;
    /** Alias de la version débouncée. */
    saveFormData(): void;
    /** Alias de la version IMMÉDIATE — utilisé pour les flush de fin de cycle de vie. */
    flushFormData(): void;
    /** Reconstruit tout le DOM du formulaire depuis `tactical_oi_data`. */
    loadFormData(): Promise<void>;
    /** Alimente `#coherence_alerts_container` (appelé à la dernière étape). */
    checkCoherence(): void;

    addDynamicField(containerId: string, value?: string): void;
    initChipContainer(containerId: string, selectedValues?: readonly string[]): void;
    /** Libellés des puces sélectionnées du conteneur. */
    getChipData(containerId: string): string[];
    /** `fromLoad` lève la limite UX de 3 « Moyens Employés » (restauration fidèle). */
    addMeField(value?: string, containerId?: string, fromLoad?: boolean): void;
    /** Ligne « Modes d'action » (MA1, MA2…) de la fiche adversaire — pas de plafond de saisie. */
    addMaField(value?: string, containerId?: string): void;
    addTimeEvent(type_from_load?: string, hour_from_load?: string, desc_from_load?: string): void;
    updateAdvTitle(id: string, val: string): void;
    /** `null` = création manuelle (section dépliée) ; objet = restauration. */
    addAdversary(data?: OiAdversary | null): void;
    removeAdversary(id: string): void;
    toggleAdvSection(btn: HTMLElement): void;
    addHypothesis(val?: string): void;

    /** Dump JSON brut de `tactical_oi_data` (sans les photos). */
    exportSession(): void;
    importSession(file: File): void;
    /** Archive `.oi.zip` complète (champs + photos HD + cartographie). */
    exportArchive(): Promise<void>;
    /** Import avec sélection catégorielle, fusion non destructive, rollback quota. */
    importArchive(file: File): Promise<void>;
    /** Validation pure d'une archive : ne modifie RIEN. */
    parseArchive(file: File): Promise<OiParsedArchive>;
    detectImportCategories(parsed: OiParsedArchiveOk): OiImportCategory[];
    /** Résout avec les ids cochés, ou `null` si annulé. */
    showImportSelectModal(cats: readonly OiImportCategory[]): Promise<string[] | null>;

    resetActivePage(): Promise<void>;
    /** `keepPatrac` défaut `true` : conserve le PATRACDVR. */
    resetAllData(keepPatrac?: boolean): Promise<void>;

    /** Drapeau anti-réentrance : `true` pendant une restauration de formulaire. */
    isFormLoading: boolean;
}

/** Archive `.oi.zip` refusée par `parseArchive`. */
export interface OiParsedArchiveError {
    ok: false;
    /** Message utilisateur prêt à afficher. */
    error: string;
}

/** Archive `.oi.zip` validée par `parseArchive`. */
export interface OiParsedArchiveOk {
    ok: true;
    /** Instance JSZip chargée (typée `unknown` : JSZip n'est pas dans le contrat). */
    zip: unknown;
    /** Contenu de `data.json` : clé localStorage → chaîne JSON. */
    dataJson: Record<string, string>;
    /** Contenu best-effort de `images.json` : `imgId` → type MIME. */
    imageMeta: Record<string, string>;
}

export type OiParsedArchive = OiParsedArchiveOk | OiParsedArchiveError;

/** Catégorie proposée à l'import sélectif (formulaires.js:IMPORT_CATEGORIES). */
export interface OiImportCategory {
    id: string;
    label: string;
    icon: string;
    /** Clés `formData` couvertes par la catégorie. Absent pour la catégorie « reste ». */
    keys?: string[] | undefined;
    /** `true` pour la catégorie fourre-tout « champs texte ». */
    rest?: boolean | undefined;
    /** `true` si la catégorie embarque des images du zip. */
    images?: boolean | undefined;
    /** Unité affichée dans le compteur (« adversaire », « photo »…). */
    unit?: string | undefined;
    /** Nombre d'éléments détectés (ajouté par `detectImportCategories`). */
    count?: number | undefined;
    /** Clés restantes, uniquement pour la catégorie « reste ». */
    restKeys?: string[] | undefined;
}

/** `modules/patrac.js` — tableau PATRACDVR. */
export interface OiPatracGlobals {
    initPatracQuickEditUi(): void;
    /** Renomme un véhicule depuis son champ éditable. */
    renameVehicle(element: HTMLElement): void;
    addManualVehicle(): void;
    addManualMember(): void;
    /** Création de cellule en lot : `'India'` (max 5), `'AO'` (max 8), `'Effrac'`. */
    addCellBatch(type: string): void;
    addPatracdvrRow(vehicleName: string, members?: readonly Partial<OiPatracMember>[]): void;
    /** Retourne le bouton créé, ou `undefined` si `containerElement` est falsy. */
    addPatracdvrMember(
        containerElement: HTMLElement | null,
        data?: Partial<OiPatracMember>,
    ): HTMLButtonElement | undefined;
    /** Reconstruit tout le PATRACDVR ; `{}` vide l'affichage. */
    initializePatracdvr(dataFromStorage?: OiFormData | Record<string, never>): void;
    updateMemberButtonVisuals(btn: HTMLElement): void;
    populateQuickEditPanel(memberId: string): void;
    saveQuickEditChanges(): void;
    updateArticulationDisplay(): void;
    /** Utilise `window.contextMemberId` posé par le menu contextuel. */
    cloneMemberFromContext(): void;
    deleteMemberFromContext(): void;
    /** Réinitialisation isolée du PATRACDVR (avec `confirm()`). */
    resetPatracdvrUI(): void;
    /** Applique `config.options` (merge dans `memberConfig`) et `config.members`. */
    loadConfigObject(config: { options?: Partial<OiMemberConfig>; members?: readonly Partial<OiPatracMember>[] }): void;
    /** Sans argument : bascule. Avec `force`: impose l'état. */
    togglePatracBatchMode(force?: boolean): void;
    patracBatchSelectWholeCell(): void;
    patracBatchShowTargets(): void;
    patracBatchMoveTo(container: HTMLElement): void;
    patracBatchUnassign(): void;
    patracBatchClear(): void;
    openUniteConfigModal(): void;
    saveUniteConfig(): void;
    /** PDF PATRACDVR autonome (pdf-lib, A4 paysage, neutralisation non-WinAnsi). */
    generatePatracdvrPdf(): Promise<void>;
    /** Id du bouton membre visé par le menu contextuel (patrac.js:241). */
    contextMemberId: string;
}

/** `modules/articulation.js` — MOICP / ZMSPCP / Effraction. */
export interface OiArticulationGlobals {
    /** `undefined`/`null` = ajout manuel (bloc déplié) ; objet = restauration. */
    addMoicp(data?: Partial<OiMoicpBlock> | null): void;
    addZmspcp(data?: Partial<OiZmspcpBlock> | null): void;
    addEffraction(data?: Partial<OiEffractionBlock> | null): void;
    addEffractionHypothesis(blockId: string, data?: Partial<OiEffractionHypothesis> | null): void;
    /** Modale « outils d'effraction » rattachée à une photo. */
    openEffractionToolsModal(imgId: string): void;
    saveEffractionTools(): void;
    /** Synchronisation INCRÉMENTALE et NON DESTRUCTIVE depuis le PATRACDVR. */
    refreshArticulationFromPatracdvr(): void;
    refreshRameVL(savedData?: readonly string[]): void;
    refreshColonneProgression(savedOrder?: readonly string[]): void;
    refreshOrdrePenetration(savedOrder?: readonly string[]): void;
    /** Supprime le bloc `btn.closest(selector)` + purge IndexedDB de ses photos. */
    removeBlockEl(btn: HTMLElement, selector: string): void;
}

/** `modules/drag.js` — drag&drop natif + émulation tactile. */
export interface OiDragGlobals {
    initializeDragDropListeners(): void;
    initDocumentDragTransfer(): void;
}

/** `modules/medias.js` — photos et fond PDF personnalisé. */
export interface OiMediaGlobals {
    /** Upload + compression + vignette. `isSingle` remplace au lieu d'ajouter. */
    handleFileChange(
        input: HTMLInputElement,
        previewContainerId: string,
        isSingle: boolean,
    ): Promise<void>;
    removeImage(imgId: string, itemElement: HTMLElement): Promise<void>;
    /** Re-génère toutes les vignettes depuis IndexedDB. */
    syncAllThumbnails(): void;
    handleCustomBackgroundChange(input: HTMLInputElement): Promise<void>;
    removeCustomBackground(): Promise<void>;
    updateCustomBgPreview(): Promise<void>;
}

/** `modules/dessin.js` — moteur d'annotation canvas. */
export interface OiAnnotationGlobals {
    /** Ouvre la modale d'annotation pour la photo `previewImgId`. */
    openAnnotationModal(previewImgId: string): Promise<void>;
    /** Aplatit et ré-enregistre le blob annoté. */
    closeAnnotationModal(): Promise<void>;
    initAnnotationWorkspace(): void;
    setActiveTool(toolId: OiAnnotationTool): void;
    /** Valeur brute d'un `<input>` (parsée en interne par `parseInt`). */
    updateStrokeWidth(val: string): void;
    updateTextSize(val: string): void;
    updateZoneText(val: string): void;
    /** Parsé par `parseFloat`. */
    updateZoneOpacity(val: string): void;
    /** Lit `#rotation_input` (degrés) et écrit des RADIANS dans l'annotation. */
    updateAnnotationRotation(): void;
    /** `element` = pastille cliquée (mise à jour de l'état actif). */
    setAnnotationColor(color: string, element: HTMLElement): void;
    undoAnnotation(): void;
    redoAnnotation(): void;
    changeZoom(delta: number): void;
    resetZoom(): void;
    toggleMobileDock(): void;
    closeMobileSheet(): void;
    /** Ouvre le sélecteur de membre pour poser une puce aux coordonnées canvas. */
    populateMemberCanvasModal(x: number, y: number): void;
}

/** `modules/presentation.js` + `modules/pdf_engine_v2.js:1155-1156`. */
export interface OiPresentationGlobals {
    /** Ouvre `#presentationModal` et délègue à `PDFEngineV2.openPreview()`. */
    openPresentationMode(): void;
    // downloadOiPdf() RETIRÉE (PDF.INTEG, SPEC-PDF-V3.md §4) : le bouton
    // `#downloadPdfBtn` est désormais câblé directement sur `downloadOiPdfV3()`
    // (`src/apps/oi/main.ts`), sans passer par un raccourci `window`.
    /** Raccourci vers `PDFEngineV2.openPresentInPlace()`. */
    openPresentInPlace(): void;
}

/** Globaux définis dans les `<script>` inline de `4.html`. */
export interface OiInlineGlobals {
    /** Bascule A4 / 16:9 + persiste `pdfOutputFormat` (4.html:4795). */
    setPdfFormat(fmt: 'a4' | '16:9'): void;
    /** Format courant, miroir de la clé `pdfOutputFormat`. */
    pdfOutputFormat: 'a4' | '16:9';
    /** Ouvre la fenêtre de logs mobile (4.html:98). */
    openLogs(): void;
    /** Tampon circulaire de 500 lignes, persisté sous `gstart_captured_logs`. */
    __capturedLogs: string[];
}
