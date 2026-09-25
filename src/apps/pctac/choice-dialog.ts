/**
 * choice-dialog.ts — Fenêtre de CHOIX à N boutons (décision 32/33).
 *
 * `confirmDialog` (feedback.ts) ne sait faire que oui/non. Les doublons de
 * personnes demandent trois voies (« Ouvrir l'existante », « Fusionner »,
 * « Créer quand même »). Résout la `value` choisie, ou `null` sur Échap / clic
 * sur le fond. Le texte passe par `textContent` (jamais innerHTML).
 */

export interface ChoiceOption {
    value: string;
    label: string;
    /** Style de bouton de danger (destructif). */
    danger?: boolean;
}

export interface ChoiceDialogOptions {
    title?: string;
    message: string;
    options: ChoiceOption[];
}

export function choiceDialog(options: ChoiceDialogOptions): Promise<string | null> {
    return new Promise((resolve) => {
        const dlg = document.createElement('dialog');
        dlg.className = 'modal tac-choice-dialog';

        if (options.title) {
            const h = document.createElement('h3');
            h.textContent = options.title;
            dlg.appendChild(h);
        }
        const p = document.createElement('p');
        p.className = 'tac-choice-message';
        p.textContent = options.message;
        dlg.appendChild(p);

        const row = document.createElement('div');
        row.className = 'pctac-actions-row';

        let settled = false;
        const finish = (value: string | null): void => {
            if (settled) return;
            settled = true;
            try {
                if (typeof dlg.close === 'function') dlg.close();
            } catch { /* déjà fermé */ }
            dlg.remove();
            resolve(value);
        };

        options.options.forEach((option) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'add-btn';
            if (option.danger) btn.classList.add('pctac-btn-danger-bg');
            btn.dataset.choice = option.value;
            btn.textContent = option.label;
            btn.addEventListener('click', () => finish(option.value));
            row.appendChild(btn);
        });
        dlg.appendChild(row);

        dlg.addEventListener('cancel', (e) => { e.preventDefault(); finish(null); });
        dlg.addEventListener('click', (e) => { if (e.target === dlg) finish(null); });

        document.body.appendChild(dlg);
        if (typeof dlg.showModal === 'function') dlg.showModal();
        else dlg.setAttribute('open', '');
    });
}
