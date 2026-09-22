/**
 * modes.ts — Situations opérationnelles de PC-Tac (Forcené, Tuerie planifiée,
 * Recherche de personnes, Événement d'ampleur) et le VOCABULAIRE qui va avec.
 *
 * SOURCE UNIQUE DE VÉRITÉ. Un mode ne crée AUCUN nouveau jeu de données : les
 * fiches, la main courante et les photos restent les mêmes d'un mode à l'autre
 * (décision Nico, 2026-09-22). Changer de mode change deux choses, et rien
 * de plus :
 *
 *   1. les LIBELLÉS (« Adversaire » devient « Ennemi », « Otage » devient
 *      « Otage / Victime »…), posés par `applyLexicon()` sur tout élément
 *      portant `data-lex` / `data-lex-attr` ;
 *   2. les CHAMPS DOCTRINAUX affichés sous les fiches, décrits ci-dessous et
 *      rendus par `renderModeBlocks()`.
 *
 * La palette ne bouge PAS d'un mode à l'autre : l'accent reste bleu, l'adverse
 * reste rouge, la partie protégée reste ambre. Ces couleurs sont déjà
 * sémantiques dans le thème Tactical Glass et servent de repère sous stress —
 * les recolorer par situation ferait joli et coûterait cher en relecture.
 *
 * Une fiche saisie en Forcené reste intacte si l'on passe en Tuerie planifiée :
 * elle devient simplement un Ennemi, et les champs propres au nouveau mode
 * s'ajoutent, vides. Les champs d'un mode qu'on quitte ne sont JAMAIS effacés —
 * ils cessent seulement d'être affichés, et reviennent si l'on revient. C'est
 * ce qui permet de requalifier un cas en cours sans rien ressaisir.
 *
 * Les clés de champ sont posées À PLAT sur la fiche (`position`, `qui`, `ou`…),
 * comme les champs historiques (`nom`, `attitude`, `armes`…) : l'archive, le QR
 * et le PDF les transportent sans traitement particulier. Aucune ne collisionne
 * avec une clé existante.
 *
 * DOCTRINE — ces intitulés sont métier, pas techniques. Ils viennent de Nico
 * (PNAVSA : Position, Nature, Attitude, Volume, Substance, Arme ; QQOCQPC
 * décliné selon la situation). Ils se corrigent ICI, à un seul endroit.
 */

/** Identifiant de situation. `forcene` est le mode historique de PC-Tac. */
export type PctacModeId = 'forcene' | 'tp' | 'recherche' | 'evenement';

export const PCTAC_MODE_KEY = 'pcTacMode';

/** Champ doctrinal propre à une situation, rendu sous les champs historiques. */
export interface PctacModeField {
    /** Clé de stockage, posée à plat sur la fiche. Jamais renommée après coup. */
    key: string;
    label: string;
    placeholder: string;
    /** Champ occupant toute la largeur de la grille (texte long). */
    wide?: boolean;
}

/** Bloc doctrinal titré (PNAVSA, QQOCQPC…) regroupant plusieurs champs. */
export interface PctacModeBlock {
    title: string;
    /** Rappel du sens de l'acronyme, affiché en petit sous le titre. */
    hint: string;
    fields: PctacModeField[];
}

/** Vocabulaire d'une entité (l'adverse ou la partie protégée) dans un mode. */
export interface PctacEntityLexicon {
    /** « Ennemi ». Sert aux titres de formulaire et aux boutons. */
    singular: string;
    /** « Ennemis ». Sert aux onglets et aux états vides. */
    plural: string;
    /** Article + nom, pour les phrases : « Modifier cet ennemi ». */
    demonstrative: string;
    /** Icône Material Symbols de l'onglet et du titre de formulaire. */
    icon: string;
    /** Libellé court de la pastille Pax dans la main courante. */
    paxChip: string;
    /**
     * Titre du formulaire de création. Écrit EN TOUTES LETTRES plutôt que
     * composé (« Nouvel » + nom) : le français impose l'accord, et « Nouvel
     * Menace » ou « Nouveau Victime » se verraient immédiatement. Trois
     * formes écrites valent mieux qu'une règle de genre à maintenir.
     */
    newLabel: string;
    /** Libellé du bouton d'enregistrement. */
    saveLabel: string;
    /** Phrase d'état vide de la liste. */
    emptyLabel: string;
    /**
     * Intitulé du champ qui relie une fiche à l'autre collection. Écrit à la
     * main plutôt que composé à partir du pluriel : « Lien otages et victimes »
     * déborde du champ, « Lien victimes » dit la même chose et tient.
     */
    linkLabel: string;
}

export interface PctacMode {
    id: PctacModeId;
    /** Libellé complet, pour l'infobulle et le PDF. */
    label: string;
    /** Libellé court du bouton de situation, en haut à droite. */
    short: string;
    icon: string;
    /** Phrase d'une ligne rappelant ce que la situation recouvre. */
    summary: string;
    adv: PctacEntityLexicon;
    host: PctacEntityLexicon;
    /** Blocs doctrinaux ajoutés à la fiche adverse. Vide en Forcené. */
    advBlocks: PctacModeBlock[];
    /** Blocs doctrinaux ajoutés à la fiche protégée. */
    hostBlocks: PctacModeBlock[];
}

/**
 * Décline le questionnement QQOCQPC pour une situation donnée. Les sept lettres
 * ne changent pas ; ce que l'on cherche derrière chacune, si (directive Nico :
 * « adapté à la situation sélectionnée »). Les clés de stockage sont communes
 * aux quatre modes : requalifier un cas conserve les réponses déjà saisies.
 */
function qqocqpc(hint: string, prompts: [string, string, string, string, string, string, string]): PctacModeBlock {
    const labels = ['Qui', 'Quoi', 'Où', 'Comment', 'Quand', 'Pourquoi', 'Combien'];
    const keys = ['qui', 'quoi', 'ou', 'comment', 'quand', 'pourquoi', 'combien'];
    return {
        title: 'QQOCQPC',
        hint,
        fields: labels.map((label, i) => ({
            key: keys[i] as string,
            label,
            placeholder: prompts[i] as string,
            wide: i >= 5,
        })),
    };
}

/**
 * PNAVSA — renseignement sur l'adverse. Trois des six lettres tombent sur des
 * champs que la fiche porte DÉJÀ (Attitude, Substance, Arme) : on ne les
 * duplique pas, le bloc n'ajoute que Position, Nature et Volume. Le rappel
 * ci-dessous donne les six pour que l'opérateur retrouve son acronyme entier.
 */
const PNAVSA: PctacModeBlock = {
    title: 'PNAVSA',
    hint: 'Position, Nature, Attitude, Volume, Substance, Arme — Attitude, Substance et Arme sont saisies plus haut.',
    fields: [
        { key: 'position', label: 'Position', placeholder: 'Point précis, étage, retranchement…' },
        { key: 'nature', label: 'Nature', placeholder: 'Isolé, groupe organisé, sympathisant…' },
        { key: 'volume', label: 'Volume', placeholder: 'Nombre estimé, certitude du décompte…' },
    ],
};

/** Signalement — commun aux situations où l'identification physique prime. */
const SIGNALEMENT: PctacModeBlock = {
    title: 'Signalement',
    hint: 'Ce qui permet de reconnaître la personne sur le terrain.',
    fields: [
        { key: 'signalement', label: 'Physique', placeholder: 'Taille, corpulence, cheveux, signes distinctifs…' },
        { key: 'tenue', label: 'Tenue', placeholder: 'Vêtements au moment des faits, couleurs…' },
        { key: 'vehicule', label: 'Véhicule', placeholder: 'Marque, modèle, couleur, immatriculation…' },
        { key: 'sante', label: 'État de santé', placeholder: 'Traitement, pathologie, vulnérabilité…', wide: true },
    ],
};

export const PCTAC_MODES: Record<PctacModeId, PctacMode> = {
    forcene: {
        id: 'forcene',
        label: 'Forcené',
        short: 'Forcené',
        // L'icône doit nommer la MENACE, pas l'action en cours : une personne
        // enfermée, pas une alerte générique (retour Nico, 2026-09-22).
        icon: 'lock_person',
        summary: 'Individu retranché, otages éventuels, négociation en cours.',
        adv: { singular: 'Adversaire', plural: 'Adversaires', demonstrative: 'cet adversaire', icon: 'groups', paxChip: 'Adversaire', linkLabel: 'Lien victimes', newLabel: 'Nouvel adversaire', saveLabel: 'Enregistrer l\'adversaire', emptyLabel: 'Aucun adversaire' },
        host: { singular: 'Otage', plural: 'Otages', demonstrative: 'cet otage', icon: 'person_off', paxChip: 'Otage', linkLabel: 'Lien adversaire', newLabel: 'Nouvel otage', saveLabel: 'Enregistrer l\'otage', emptyLabel: 'Aucun otage' },
        advBlocks: [],
        hostBlocks: [],
    },

    tp: {
        id: 'tp',
        label: 'Tuerie planifiée',
        short: 'TP',
        // Menace en MOUVEMENT, par opposition au forcené retranché. `swords`
        // disait « combat » sans dire lequel, et faisait doublon avec l'icône
        // de la fiche Ennemi juste en dessous.
        icon: 'directions_run',
        summary: 'Tuerie planifiée : adversaire en mouvement, priorité à la neutralisation de la menace.',
        adv: { singular: 'Ennemi', plural: 'Ennemis', demonstrative: 'cet ennemi', icon: 'swords', paxChip: 'Ennemi', linkLabel: 'Lien victimes', newLabel: 'Nouvel ennemi', saveLabel: 'Enregistrer l\'ennemi', emptyLabel: 'Aucun ennemi' },
        host: { singular: 'Otage / Victime', plural: 'Otages et victimes', demonstrative: 'cette victime', icon: 'personal_injury', paxChip: 'Victime', linkLabel: 'Lien ennemi', newLabel: 'Nouvel otage ou victime', saveLabel: 'Enregistrer la victime', emptyLabel: 'Aucun otage ni victime' },
        advBlocks: [
            PNAVSA,
            qqocqpc('Circonstances de la tuerie, telles qu\'établies à l\'instant T.', [
                'Auteur identifié ou décrit, complices éventuels',
                'Nature des faits, mode opératoire constaté',
                'Lieu exact, bâtiment, niveau, progression',
                'Moyens employés, arme, explosif, véhicule bélier',
                'Heure de déclenchement, dernier fait daté',
                'Revendication, mobile idéologique ou personnel',
                'Auteurs, victimes, personnes encore exposées',
            ]),
        ],
        hostBlocks: [],
    },

    recherche: {
        id: 'recherche',
        label: 'Recherche de personnes',
        short: 'Recherche',
        icon: 'person_search',
        summary: 'Disparition ou fuite : identifier, localiser, retrouver.',
        adv: { singular: 'Personne recherchée', plural: 'Personnes recherchées', demonstrative: 'cette personne', icon: 'person_search', paxChip: 'Recherché', linkLabel: 'Lien témoins', newLabel: 'Nouvelle personne recherchée', saveLabel: 'Enregistrer la personne', emptyLabel: 'Aucune personne recherchée' },
        host: { singular: 'Témoin', plural: 'Témoins', demonstrative: 'ce témoin', icon: 'record_voice_over', paxChip: 'Témoin', linkLabel: 'Personne recherchée', newLabel: 'Nouveau témoin', saveLabel: 'Enregistrer le témoin', emptyLabel: 'Aucun témoin' },
        advBlocks: [
            SIGNALEMENT,
            qqocqpc('Circonstances de la disparition ou de la fuite.', [
                'Identité, âge, lien avec les requérants',
                'Disparition inquiétante, fugue, soustraction, évasion',
                'Dernier lieu connu, secteur de recherche retenu',
                'À pied, en véhicule, accompagné ou non',
                'Heure et date de la dernière vue certaine',
                'Motif présumé, contexte familial ou judiciaire',
                'Nombre de personnes concernées, mineurs inclus',
            ]),
        ],
        hostBlocks: [],
    },

    evenement: {
        id: 'evenement',
        label: 'Événement d\'ampleur',
        short: 'Ampleur',
        icon: 'groups_3',
        summary: 'Événement d\'ampleur : menace diffuse, nombreuses victimes, coordination interservices.',
        adv: { singular: 'Menace', plural: 'Menaces', demonstrative: 'cette menace', icon: 'warning', paxChip: 'Menace', linkLabel: 'Lien victimes', newLabel: 'Nouvelle menace', saveLabel: 'Enregistrer la menace', emptyLabel: 'Aucune menace' },
        host: { singular: 'Victime', plural: 'Victimes', demonstrative: 'cette victime', icon: 'personal_injury', paxChip: 'Victime', linkLabel: 'Lien menace', newLabel: 'Nouvelle victime', saveLabel: 'Enregistrer la victime', emptyLabel: 'Aucune victime' },
        advBlocks: [
            qqocqpc('Caractérisation de la menace, réévaluée à chaque point de situation.', [
                'Origine de la menace, auteur, organisation, phénomène',
                'Nature : attentat, accident majeur, mouvement de foule, risque NRBC',
                'Emprise géographique, zones exposées, périmètre établi',
                'Vecteur, cinétique, facteurs aggravants',
                'Début des faits, évolution attendue, échéance',
                'Cause ou revendication, si établie',
                'Victimes estimées, impliqués, personnes à évacuer',
            ]),
            {
                title: 'Conséquences',
                hint: 'Ce que l\'événement produit, et qui doit être traité en parallèle.',
                fields: [
                    { key: 'position', label: 'Point de fixation', placeholder: 'Épicentre, foyer principal…' },
                    { key: 'volume', label: 'Ampleur', placeholder: 'Emprise, nombre de sites touchés…' },
                    { key: 'nature', label: 'Risques évolutifs', placeholder: 'Sur-accident, effondrement, propagation…', wide: true },
                ],
            },
        ],
        hostBlocks: [],
    },
};

export const PCTAC_MODE_ORDER: PctacModeId[] = ['forcene', 'tp', 'recherche', 'evenement'];

function isModeId(value: unknown): value is PctacModeId {
    return typeof value === 'string' && Object.prototype.hasOwnProperty.call(PCTAC_MODES, value);
}

/**
 * Situation courante. `forcene` par défaut — c'est le comportement historique
 * de PC-Tac, et un stockage illisible (quota, navigation privée, valeur
 * corrompue) ne doit jamais empêcher l'application de démarrer.
 */
export function currentModeId(): PctacModeId {
    try {
        const stored = localStorage.getItem(PCTAC_MODE_KEY);
        if (isModeId(stored)) return stored;
    } catch {
        // Stockage indisponible : on reste sur la situation par défaut.
    }
    return 'forcene';
}

export function currentMode(): PctacMode {
    return PCTAC_MODES[currentModeId()];
}

/** Persiste la situation. Rend `false` si le stockage a refusé l'écriture. */
export function persistModeId(id: PctacModeId): boolean {
    try {
        localStorage.setItem(PCTAC_MODE_KEY, id);
        return true;
    } catch {
        return false;
    }
}

/** Tous les champs doctrinaux d'une entité, blocs confondus. */
export function modeFieldsOf(blocks: PctacModeBlock[]): PctacModeField[] {
    return blocks.flatMap((b) => b.fields);
}

/**
 * Union des clés doctrinales de TOUS les modes. Sert à relire une fiche sans
 * savoir dans quel mode elle a été saisie (rendu, PDF, archive) : une fiche
 * requalifiée porte les clés de plusieurs situations à la fois.
 */
export function allModeFieldKeys(): string[] {
    const keys = new Set<string>();
    PCTAC_MODE_ORDER.forEach((id) => {
        const mode = PCTAC_MODES[id];
        modeFieldsOf(mode.advBlocks).forEach((f) => keys.add(f.key));
        modeFieldsOf(mode.hostBlocks).forEach((f) => keys.add(f.key));
    });
    return [...keys];
}
