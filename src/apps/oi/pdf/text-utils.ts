/**
 * text-utils.ts — Coupure automatique des tokens (mots/URLs) sans espace au
 * rendu (arbitrage BLIND.A #2, blindage PDF OI voie A pdfmake). Module PUR :
 * zéro DOM, zéro pdfmake en VALEUR.
 *
 * CASSURE ÉLIMINÉE (matrice-rupture.md §4) : un token ininterrompu (aucun
 * espace) de ≥ ~76-80 caractères posé `unbreakable:true` dans une colonne
 * étroite (`dashItemList`, `document-builder.ts`) fait CRASHER tout le rendu
 * pdfmake — `RangeError: Offset is outside the bounds of the DataView`
 * (fontkit, mesure glyphe par glyphe d'un run trop long). pdfmake n'a AUCUN
 * équivalent du CSS `overflow-wrap:anywhere` (voie B, `print-style.ts`) : le
 * seul moyen d'obtenir un point de coupure est de l'insérer directement dans
 * la CHAÎNE DE CARACTÈRES elle-même.
 *
 * RÉGRESSION BLIND.REFIX round 1 — CHOIX DU CARACTÈRE REVU : la version
 * précédente injectait U+200B (ZERO WIDTH SPACE). `linebreak` (module npm
 * derrière `node_modules/pdfmake/js/TextBreaker.js`) reconnaît bien U+200B
 * comme point de coupure UAX#14, MAIS ce caractère n'est pas pour autant
 * invisible AU RENDU : la police embarquée `fonts/jetbrains_mono_400.ttf`
 * n'a AUCUN glyphe pour U+200B (vérifié directement par fontkit,
 * `font.glyphForCodePoint(0x200B).id === 0`, càd `.notdef`) — pdfmake/
 * fontkit dessine donc le glyphe `.notdef` (carré ▯) à CHAQUE point de
 * coupure, y compris ceux qui ne tombent jamais en fin de ligne (preuve
 * `.tacsuite-prep/pdf-blindage/gate/png/full-iso-word60-06.png` et
 * `A-url-zoom-06.png`). Un balayage fontkit exhaustif des candidats
 * invisibles usuels (ZWSP U+200B, WORD JOINER U+2060, ZWNJ U+200C, THIN
 * SPACE U+2009, HAIR SPACE U+200A, NNBSP U+202F) montre qu'AUCUN n'est
 * mappé dans cette police (tous `.notdef`).
 *
 * PREMIÈRE PISTE ÉCARTÉE — RETOUR À LA LIGNE FORCÉ (`\n`) : `\n` EST bien
 * neutre au rendu (`TextBreaker.js::splitWords`, l. 30/53, le retire de la
 * chaîne avant dessin), mais c'est une coupure OBLIGATOIRE — contrairement à
 * ZWSP, il force TOUJOURS un saut de ligne tous les `maxLen` caractères, même
 * quand le token tiendrait sans problème sur la ligne courante d'une colonne
 * large. Constat direct (contre-épreuve `adv-atcd5.json`) : le token
 * `structure/serrurerie/environnement/cotes` (41 car., dépasse `maxLen` de
 * seulement 1 car.) se retrouvait cassé « cote / s » en PLEINE largeur de
 * page — un saut de ligne visible et une ligne de texte supplémentaire là où
 * l'ancien ZWSP (purement opportuniste) n'aurait rien changé. Écarté :
 * fonctionnellement correct (zéro crash, zéro glyphe parasite) mais dégrade
 * le rendu de tout token > 40 car. dans une colonne large, y compris ceux qui
 * n'ont jamais posé de problème.
 *
 * CORRECTIF RETENU — U+00AD SOFT HYPHEN : caractère UAX#14 classe `BA`
 * (coupure autorisée APRÈS, jamais obligatoire — même sémantique
 * qu'un ZWSP, opportuniste) ET MAPPÉ dans la police embarquée
 * (`font.glyphForCodePoint(0x00AD).id === 599`, glyphe trait d'union valide,
 * même bbox que le trait d'union U+002D). Vérifié EMPIRIQUEMENT par rendu
 * pdfmake réel (pas une supposition) : un mot de 41 car. avec SHY en position
 * 21 reste sur UNE SEULE ligne dans une colonne large (comportement
 * opportuniste identique à l'ancien ZWSP) ; un mot de 121 car. casse
 * PROPREMENT à la position du SHY dans une colonne étroite ; dans LES DEUX
 * cas, AUCUN glyphe visible n'apparaît à l'écran ni dans `pdftotext` — malgré
 * un glyphe mappé, le pipeline de mise en forme de texte de pdfmake/fontkit
 * ne dessine jamais ce caractère de catégorie Unicode `Cf` (format,
 * « par défaut ignorable »). U+00AD cumule donc EXACTEMENT les deux
 * propriétés recherchées : opportuniste comme un vrai point de coupure
 * typographique ET invisible au rendu comme au texte extrait — aucune
 * régression de mise en page par rapport à l'ancien ZWSP, contrairement à
 * `\n`, tout en corrigeant le glyphe `.notdef` (▯) qui était la régression
 * de ce round.
 *
 * PORTÉE — TOUT texte entrant du document-builder (arbitrage #2) : appliqué
 * par `document-builder.ts::str()` (le point de passage de la quasi-totalité
 * des champs `unknown` du Store) et par les primitives `blocks.ts` qui
 * reçoivent du texte libre (`labelValue`, `pill`, `kvTable`, `h2`) — double
 * filet, cf. leur JSDoc respective.
 */

/** Longueur maximale d'un token (suite de caractères sans espace) avant insertion d'un point de coupure — cf. seuil mesuré §4 `matrice-rupture.md` (crash confirmé à 80 car., sain à 75). */
export const MAX_UNBROKEN_TOKEN_LENGTH = 40;

/**
 * U+00AD SOFT HYPHEN — cf. JSDoc de fichier ci-dessus (choix du caractère,
 * régression round 1) : point de coupure opportuniste ET invisible au rendu
 * dans la police embarquée, vérifié par contre-épreuve directe contre
 * pdfmake (pas une supposition).
 */
export const SOFT_HYPHEN = '­';

/**
 * Sépare toute paire de `/` ADJACENTS (`//`, `///`…, motif classique d'une URL
 * `http://…`) par un `SOFT_HYPHEN` — cassure CONFIRMÉE PAR CONTRE-ÉPREUVE
 * DIRECTE contre pdfmake (pas une supposition) : `http://` + un domaine long
 * fait crasher le rendu (`RangeError: Offset is outside the bounds of the
 * DataView`, fontkit) INDÉPENDAMMENT de la longueur du token — reproduit avec
 * la seule chaîne `"//"` (2 caractères), et la coupure en tranches de
 * `maxLen` seule (`insertBreakPoints` ci-dessous) ne le corrige PAS : `//`
 * tombe généralement bien À L'INTÉRIEUR de la première tranche de `maxLen`
 * caractères (ex. position 5-6 de `http://AAAA…`, largement avant la coupure
 * à 40), jamais séparé par le découpage à intervalle fixe seul. Bug
 * apparemment propre à une paire de glyphes `/`/`/` consécutifs dans la
 * police JetBrainsMono embarquée (`fonts/jetbrains_mono_400.ttf`) — non
 * élucidé plus avant (hors police alternative, aucun contournement pdfmake
 * documented), mais neutralisé PAR CONSTRUCTION : aucune paire `//` ne
 * survit jamais jusqu'au rendu.
 */
function protectSlashPairs(text: string): string {
    return text.replace(/\/(?=\/)/g, `/${SOFT_HYPHEN}`);
}

/**
 * Insère un `SOFT_HYPHEN` tous les `maxLen` caractères À L'INTÉRIEUR d'un
 * token isolé (pas de découpe du texte lui-même — jamais de perte, jamais de
 * caractère supprimé, uniquement des points de coupure OPPORTUNISTES
 * insérés — cf. JSDoc de fichier, le caractère lui-même ne s'affiche jamais).
 */
function insertBreakPoints(token: string, maxLen: number): string {
    const chunks: string[] = [];
    for (let i = 0; i < token.length; i += maxLen) {
        chunks.push(token.slice(i, i + maxLen));
    }
    return chunks.join(SOFT_HYPHEN);
}

/**
 * Coupe automatiquement, POUR LE RENDU SEULEMENT, tout token (suite de
 * caractères SANS espace — mot, URL, identifiant…) de plus de `maxLen`
 * caractères en y insérant des `SOFT_HYPHEN` réguliers. `text` vide/
 * falsy renvoyé tel quel (`''`/`undefined`/`null` → `''`, jamais d'exception).
 * Contenu intégral préservé : seuls des caractères INVISIBLES (au rendu ET à
 * l'extraction, cf. JSDoc de fichier) sont AJOUTÉS, aucun caractère du texte
 * source n'est retiré ni modifié.
 */
export function breakLongTokens(text: string, maxLen: number = MAX_UNBROKEN_TOKEN_LENGTH): string {
    if (!text) {
        return text;
    }
    // `protectSlashPairs` s'applique sur le texte ENTIER, pas seulement les
    // tokens > `maxLen` (cf. sa JSDoc) : la cassure `//` a été reproduite avec
    // une chaîne de 2 caractères, indépendamment de tout token long.
    const slashProtected = protectSlashPairs(text);
    const tokenRe = new RegExp(`\\S{${maxLen + 1},}`, 'g');
    return slashProtected.replace(tokenRe, (token) => insertBreakPoints(token, maxLen));
}
