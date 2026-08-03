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
 * la CHAÎNE DE CARACTÈRES elle-même, sous forme d'un caractère invisible que
 * l'algorithme de repli à la ligne de pdfmake reconnaît comme opportunité de
 * coupure.
 *
 * CHOIX DU CARACTÈRE — ESPACE FINE SANS CHASSE `​` (ZERO WIDTH SPACE,
 * classe Unicode `ZW` de l'algorithme UAX#14) plutôt qu'un espace normal :
 * pdfmake délègue son repli à la ligne au module npm `linebreak` (implémente
 * UAX#14, cf. `node_modules/pdfmake/js/TextBreaker.js`), qui reconnaît U+200B
 * comme point de coupure valide (vérifié directement contre le module :
 * `new LineBreaker('a'.repeat(20)+'​'+'b'.repeat(20))` casse bien juste
 * après le ZWSP). Un espace normal aurait aussi fonctionné mais aurait ajouté
 * un espace VISIBLE dans le texte rendu (et dans le calque texte du PDF,
 * modifiant la chaîne exacte retrouvée par `pdftotext`) — U+200B est
 * invisible à l'écran/à l'impression tout en étant un point de coupure
 * fonctionnel, ce qui préserve au maximum l'apparence et le contenu du champ
 * saisi (« aucune contrainte de saisie », arbitrage #2 : la donnée du Store
 * n'est JAMAIS modifiée, seule la représentation `Content` passée à pdfmake
 * l'est, au moment du rendu).
 *
 * PORTÉE — TOUT texte entrant du document-builder (arbitrage #2) : appliqué
 * par `document-builder.ts::str()` (le point de passage de la quasi-totalité
 * des champs `unknown` du Store) et par les primitives `blocks.ts` qui
 * reçoivent du texte libre (`labelValue`, `pill`, `kvTable`, `h2`) — double
 * filet, cf. leur JSDoc respective.
 */

/** Longueur maximale d'un token (suite de caractères sans espace) avant insertion d'un point de coupure — cf. seuil mesuré §4 `matrice-rupture.md` (crash confirmé à 80 car., sain à 75). */
export const MAX_UNBROKEN_TOKEN_LENGTH = 40;

/** U+200B ZERO WIDTH SPACE — cf. JSDoc de fichier ci-dessus (choix du caractère). */
const ZERO_WIDTH_SPACE = '​';

/**
 * Sépare toute paire de `/` ADJACENTS (`//`, `///`…, motif classique d'une URL
 * `http://…`) par un `ZERO_WIDTH_SPACE` — cassure CONFIRMÉE PAR CONTRE-ÉPREUVE
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
    return text.replace(/\/(?=\/)/g, `/${ZERO_WIDTH_SPACE}`);
}

/**
 * Insère un `ZERO_WIDTH_SPACE` tous les `maxLen` caractères À L'INTÉRIEUR d'un
 * token isolé (pas de découpe du texte lui-même — jamais de perte, jamais de
 * caractère supprimé, uniquement des points de coupure insérés).
 */
function insertBreakPoints(token: string, maxLen: number): string {
    const chunks: string[] = [];
    for (let i = 0; i < token.length; i += maxLen) {
        chunks.push(token.slice(i, i + maxLen));
    }
    return chunks.join(ZERO_WIDTH_SPACE);
}

/**
 * Coupe automatiquement, POUR LE RENDU SEULEMENT, tout token (suite de
 * caractères SANS espace — mot, URL, identifiant…) de plus de `maxLen`
 * caractères en y insérant des `ZERO_WIDTH_SPACE` réguliers. `text` vide/
 * falsy renvoyé tel quel (`''`/`undefined`/`null` → `''`, jamais d'exception).
 * Contenu intégral préservé : seuls des caractères INVISIBLES sont AJOUTÉS,
 * aucun caractère du texte source n'est retiré ni modifié.
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
