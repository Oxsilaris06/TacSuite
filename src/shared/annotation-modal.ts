/**
 * annotation-modal.ts — Fenêtre d'annotation des photos, commune à l'OI et au
 * PC-Tac (décision 25). Le balisage vivait dans oi/index.html : il est inséré
 * ici, à l'identique, par les deux applications ; le moteur (`@oi/dessin.js`)
 * s'y câble par identifiants comme avant. Styles : styles/annotation.css.
 *
 * Les actions de la fenêtre (fermer, couleur, dock mobile, rotation) sont
 * câblées sur la fenêtre elle-même : le répartiteur global de l'OI n'existe
 * pas dans le PC-Tac.
 */

const MARKUP = `
<dialog id="annotationModal" aria-labelledby="annotationModalTitle">
    <div class="modal-form">
        <div class="modal-header">
            <h3 id="annotationModalTitle" style="color: var(--accent-blue); display: flex; align-items: center; gap: 10px;">
                <span class="material-symbols-outlined">edit</span> Annotation Photo
            </h3>
            <div class="header-actions" style="display: flex; gap: 10px; margin-left: auto;">
                <button type="button" id="annotation_cancel_header" class="btn-cancel compact wizard-nav-btn annotation-header-btn" data-action="close-annotation-modal">Annuler</button>
                <button type="button" id="annotation_save_header" class="btn-save compact wizard-nav-btn annotation-header-btn">Enregistrer</button>
            </div>
        </div>
        
        <div class="modal-body annotation-wrapper">
            <button id="mobile-dock-fab" type="button" data-action="toggle-mobile-dock" class="tool-btn icon-only" title="Outils" style="position: absolute; bottom: 20px; left: 50%; transform: translateX(-50%); z-index: 1000; width: 50px; height: 50px; border-radius: 50%; padding: 0; display: flex; justify-content: center; align-items: center; background: var(--accent-blue); box-shadow: 0 4px 15px rgba(0,0,0,0.5);" aria-label="Afficher le menu d'outils">
                <span class="material-symbols-outlined dock-fab-icon">build</span>
            </button>
            
            <div class="annotation-toolbar triple-dock-ui" id="annotation-toolbar-panel">
                <!-- 1. Outils Principaux (Gauche) -->
                <div id="dock-left" class="mobile-dock vertical">
                    <div class="toolbar-vertical-group">
                        <button type="button" id="tool_move" class="tool-btn active" title="Bouger"><span class="material-symbols-outlined" aria-hidden="true">pan_tool</span><span class="btn-text">Bouger</span></button>
                        <button type="button" id="tool_location" class="tool-btn" title="Zone"><span class="material-symbols-outlined" aria-hidden="true">pin_drop</span><span class="btn-text">Zone</span></button>
                        <button type="button" id="tool_arrow" class="tool-btn" title="Axe"><span class="material-symbols-outlined" aria-hidden="true">north_east</span><span class="btn-text">Axe</span></button>
                        <button type="button" id="tool_box" class="tool-btn" title="Box"><span class="material-symbols-outlined" aria-hidden="true">crop_square</span><span class="btn-text">Box</span></button>
                        <button type="button" id="tool_text" class="tool-btn" title="Texte"><span class="material-symbols-outlined" aria-hidden="true">title</span><span class="btn-text">Texte</span></button>
                        <button type="button" id="tool_member" class="tool-btn" title="Membre"><span class="material-symbols-outlined" aria-hidden="true">badge</span><span class="btn-text">Membre</span></button>
                    </div>
                </div>

                <!-- 2. Réglages Contextuels (Droite / Bottom-sheet mobile) -->
                <div id="dock-right" class="mobile-dock vertical">
                    <div class="sheet-grabber" aria-hidden="true"></div>
                    <div class="sheet-title">Réglages</div>
                    <button type="button" data-action="close-mobile-sheet" class="tool-btn icon-only danger close-dock-btn mobile-sheet-close-btn" title="Fermer" aria-label="Fermer le panneau de réglages">
                        <span class="material-symbols-outlined mobile-sheet-close-icon">close</span>
                    </button>
                    <div id="contextual_tools" class="toolbar-vertical-group" style="margin-top: 45px; width: 100%; display: flex; flex-direction: column; align-items: center;">
                        <div class="tool-settings-group vertical-slider-group" title="Rotation">
                            <span class="material-symbols-outlined tool-settings-icon">rotate_right</span>
                            <input type="range" id="rotation_input_slider" aria-label="Rotation" min="0" max="360" value="0" class="vertical-slider" data-action="sync-rotation-slider">
                            <input type="hidden" id="rotation_input" value="0">
                        </div>
                        <div class="tool-settings-group vertical-slider-group" title="Trait">
                            <span class="material-symbols-outlined tool-settings-icon">line_weight</span>
                            <input type="range" id="stroke_width_edit" aria-label="Épaisseur du trait" min="1" max="20" value="5" class="vertical-slider">
                        </div>
                        
                        <div id="text_size_control" class="tool-settings-group vertical-slider-group" style="display: none;" title="Taille">
                            <span class="material-symbols-outlined tool-settings-icon">format_size</span>
                            <input type="range" id="text_size_edit" aria-label="Taille du texte" min="10" max="200" step="5" value="30" class="vertical-slider">
                        </div>
                        <div id="zone_settings" class="tool-settings-group vertical-slider-group" style="display: none;" title="Opacité">
                            <span class="material-symbols-outlined tool-settings-icon">opacity</span>
                            <input type="range" id="circle_opacity" aria-label="Opacité de la zone" min="0" max="1" step="0.1" value="0.5" class="vertical-slider">
                        </div>
                        <input type="hidden" id="text_size_tool" value="30">

                        <button type="button" id="edit_text_btn" class="tool-btn icon-only" title="Modifier le texte" aria-label="Modifier le texte"><span class="material-symbols-outlined">edit_note</span></button>
                    </div>
                </div>

                <!-- 3. Couleurs et Actions (Bas) -->
                <div id="dock-bottom" class="mobile-dock horizontal">
                    <div class="color-picker horizontal" style="display: flex; gap: 10px; justify-content: center; align-items: center;">
                        <button type="button" class="color-circle active color-circle-red" data-action="set-annotation-color" data-color="#c0392b" aria-label="Rouge" aria-pressed="true"></button>
                        <button type="button" class="color-circle color-circle-green" data-action="set-annotation-color" data-color="#2ecc71" aria-label="Vert" aria-pressed="false"></button>
                        <button type="button" class="color-circle color-circle-blue" data-action="set-annotation-color" data-color="#3498db" aria-label="Bleu" aria-pressed="false"></button>
                        <button type="button" class="color-circle color-circle-yellow" data-action="set-annotation-color" data-color="#f1c40f" aria-label="Jaune" aria-pressed="false"></button>
                        <button type="button" class="color-circle color-circle-white" data-action="set-annotation-color" data-color="#ffffff" aria-label="Blanc" aria-pressed="false"></button>
                    </div>
                    
                    <div style="width: 1px; height: 30px; background: rgba(255,255,255,0.2); margin: 0 10px;"></div>

                    <div class="toolbar-horizontal-group" style="display: flex; gap: 10px; align-items: center;">
                        <button type="button" id="annotation_undo" class="tool-btn icon-only" title="Annuler (Ctrl+Z)" aria-label="Annuler la dernière action"><span class="material-symbols-outlined">undo</span></button>
                        <button type="button" id="annotation_redo" class="tool-btn icon-only" title="Rétablir (Ctrl+Y)" aria-label="Rétablir l'action annulée"><span class="material-symbols-outlined">redo</span></button>
                        <button type="button" id="delete_btn" class="tool-btn icon-only danger" title="Supprimer l'objet" aria-label="Supprimer l'objet sélectionné"><span class="material-symbols-outlined">delete</span></button>
                        <button type="button" id="tool_reset" class="tool-btn icon-only danger tool-reset-btn" title="Réinitialiser tout" aria-label="Réinitialiser toute l'annotation"><span class="material-symbols-outlined">delete_sweep</span></button>
                    </div>
                </div>
            </div>

            <div class="annotation-canvas-container">
                <canvas id="annotationCanvas"></canvas>
            </div>
        </div>
    </div>
</dialog>
`;

type ActionWindow = {
    closeAnnotationModal?: () => Promise<void> | void;
    toggleMobileDock?: () => void;
    closeMobileSheet?: () => void;
    setAnnotationColor?: (color: string, el: HTMLElement) => void;
};

/**
 * Insère la fenêtre si elle n'y est pas encore et câble ses actions.
 * `memberTool` : outil « Membre » (trigramme du PATRACDVR), OI seulement.
 */
export function mountAnnotationModal(opts: { memberTool: boolean }): HTMLDialogElement {
    const existing = document.getElementById('annotationModal') as HTMLDialogElement | null;
    if (existing) return existing;
    document.body.insertAdjacentHTML('beforeend', MARKUP);
    const modal = document.getElementById('annotationModal') as HTMLDialogElement;
    if (!opts.memberTool) document.getElementById('tool_member')?.remove();
    const w = window as unknown as ActionWindow;
    modal.addEventListener('click', (e) => {
        const el = (e.target as HTMLElement).closest<HTMLElement>('[data-action]');
        switch (el?.dataset.action) {
            case 'close-annotation-modal': void w.closeAnnotationModal?.(); break;
            case 'toggle-mobile-dock': w.toggleMobileDock?.(); break;
            case 'close-mobile-sheet': w.closeMobileSheet?.(); break;
            case 'set-annotation-color':
                if (el.dataset.color) w.setAnnotationColor?.(el.dataset.color, el);
                break;
            default:
        }
    });
    modal.addEventListener('input', (e) => {
        const el = (e.target as HTMLElement).closest<HTMLInputElement>('[data-action="sync-rotation-slider"]');
        const rotation = document.getElementById('rotation_input') as HTMLInputElement | null;
        if (!el || !rotation) return;
        rotation.value = el.value;
        rotation.dispatchEvent(new Event('change'));
    });
    return modal;
}
