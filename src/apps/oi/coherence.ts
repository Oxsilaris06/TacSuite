/**
 * coherence.ts — U17/U18 : règles de cohérence par étape du wizard.
 * ===========================================================================
 *
 * Extraction de la partie « règles » de `checkCoherence` (formulaires.js:744-828,
 * porté dans `formulaires.ts`) en une source unique dont dérivent :
 *  - `checkCoherence` (formulaires.ts) — rendu des alertes onglet 8 + recap ;
 *  - le stepper (navigation.ts) — `.completed` honnête et point d'erreur par
 *    puce (U17/U18), sans dépendre du paquet lourd `formulaires`.
 *
 * Messages STRICTEMENT identiques à l'original (mêmes icônes, même ordre) :
 * `collectCoherence().alerts` reproduit l'ordre historique, `byStep` regroupe
 * les mêmes messages par index d'étape (0-based, onglet N = étape N-1).
 *
 * Comme l'original, la collecte RELIT localStorage et rafraîchit
 * `Store.state.formData` (source de vérité persistée, pas le DOM).
 */

import { Store } from '@oi/init.js';
import type { OiFormData, OiPatracMember } from '@shared/types/contracts.js';

/** Indices d'étape (0-based) des règles de cohérence. */
const STEP_SITUATION = 0;   // Onglet 1 — date_op
const STEP_ADVERSAIRE = 1;  // Onglet 2 — fiches adversaire
const STEP_EXECUTION = 4;   // Onglet 5 — chronologie
const STEP_PATRACDVR = 6;   // Onglet 7 — armement / affectations

export interface CoherenceResult {
    /** Alertes à plat, ordre historique de checkCoherence. */
    alerts: string[];
    /** Mêmes alertes regroupées par index d'étape du wizard. */
    byStep: Map<number, string[]>;
}

// formulaires.js:744-793 (partie règles, verbatim)
export function collectCoherence(): CoherenceResult {
    const key = window.LOCAL_STORAGE_KEY || 'tactical_oi_data';
    // NB : localStorage est ici la source de vérité qu'on RELIT pour rafraîchir
    // Store.state.formData (cf. en-tête du fichier) — PAS l'inverse. Un
    // `Store.flush()` avant cette lecture écraserait localStorage avec la copie
    // en mémoire (potentiellement plus VIEILLE que ce qui a pu y être écrit
    // directement ailleurs, ex. import de session) : contraire à l'intention.
    // Fenêtre de désynchronisation acceptée : jusqu'à 250ms (débounce
    // Store.notify -> saveToStorage, perf carto) entre une mutation Store très
    // récente et sa lecture ici — même compromis que l'indicateur autosave U21.
    const dataString = localStorage.getItem(key);
    Store.state.formData = JSON.parse(dataString || '{}') as OiFormData;
    const getVal = (id: string): string => (Store.state.formData[id] as string | undefined) || '';

    const alerts: string[] = [];
    const byStep = new Map<number, string[]>();
    const push = (step: number, msg: string): void => {
        alerts.push(msg);
        const list = byStep.get(step);
        if (list) list.push(msg);
        else byStep.set(step, [msg]);
    };

    const members: OiPatracMember[] = (Store.state.formData.patracdvr_rows || []).flatMap((row) => row.members);
    const indiaMembers = members.filter((m) => m.cellule && m.cellule.toLowerCase().startsWith('india'));
    const aoMembers = members.filter((m) => m.cellule && m.cellule.toLowerCase().startsWith('ao'));
    const allAssignedMembers = [...indiaMembers, ...aoMembers];

    if (!getVal('date_op')) { push(STEP_SITUATION, "La Date de l'opération est manquante. <span class='material-symbols-outlined'>event</span>"); }

    if (!Store.state.formData.adversaries || Store.state.formData.adversaries.length === 0) {
        push(STEP_ADVERSAIRE, "Aucun adversaire n'a été créé. (Onglet 2) <span class='material-symbols-outlined'>person</span>");
    } else {
        Store.state.formData.adversaries.forEach((adv, index) => {
            if (!adv.nom_adversaire) push(STEP_ADVERSAIRE, `Le Nom de l'adversaire n°${index + 1} est manquant. <span class='material-symbols-outlined'>person</span>`);
            if (!adv.domicile_adversaire) push(STEP_ADVERSAIRE, `Le Domicile de l'adversaire "${adv.nom_adversaire || index + 1}" est manquant. <span class='material-symbols-outlined'>home</span>`);
        });
    }

    allAssignedMembers.forEach((member) => {
        const hasNoPrimary = member.principales === 'Sans' || !member.principales;
        const hasNoSecondary = member.secondaires === 'Sans' || !member.secondaires;

        if (hasNoPrimary && hasNoSecondary && member.fonction !== 'Sans') {
            push(STEP_PATRACDVR, `Membre ${member.trigramme} est assigné mais n'a AUCUN armement principal/secondaire. (Cellule: ${member.cellule}) <span class='material-symbols-outlined'>local_fire_department</span>`);
        }
        if (member.afis !== 'Sans' && !member.afis) {
            push(STEP_PATRACDVR, `Membre ${member.trigramme} a un AFI non spécifié. <span class='material-symbols-outlined'>handgun</span>`);
        }
    });

    const chefInter = allAssignedMembers.find((m) => m.fonction && m.fonction.includes('Chef inter'));
    if (chefInter && !chefInter.cellule.toLowerCase().startsWith('india')) {
        push(STEP_PATRACDVR, `Le Chef inter (${chefInter.trigramme}) est assigné à la cellule ${chefInter.cellule} au lieu d'India. <span class='material-symbols-outlined'>group</span>`);
    }

    if (!Store.state.formData.time_events || Store.state.formData.time_events.length < 3) {
        push(STEP_EXECUTION, "La Chronologie (T0, T1, T4...) est incomplète. Au moins 3 étapes sont recommandées. (Onglet 5) <span class='material-symbols-outlined'>timeline</span>");
    } else {
        const t4 = Store.state.formData.time_events.find((e) => e.type === 'T4');
        if (!t4) push(STEP_EXECUTION, "Le TOP ACTION (T4) n'est pas défini dans la chronologie. <span class='material-symbols-outlined'>timer</span>");
    }

    const unassignedCount = (Store.state.formData.patracdvr_unassigned || []).length;
    if (unassignedCount > 0) {
        push(STEP_PATRACDVR, `${unassignedCount} membres ne sont PAS assignés à un véhicule/équipe. <span class='material-symbols-outlined'>groups_2</span>`);
    }

    return { alerts, byStep };
}

/** U17 — incohérences par étape (Map vide de l'étape = étape complète). */
export function coherenceIssuesByStep(): Map<number, string[]> {
    return collectCoherence().byStep;
}
