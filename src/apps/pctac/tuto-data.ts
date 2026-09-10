/* ============================================================================
 * PC Tac — données du tutoriel interactif (généré, ne pas éditer à la main).
 * Alimente le moteur autonome modules/tuto-engine.js (window.PocheTuto).
 * Les libellés du champ "terms" et les citations de "body" sont VERBATIM
 * (repris exactement de l'interface).
 * ==========================================================================*/

import type { TutoData } from '../../shared/types/tuto';

export const pctacTutoData: TutoData = {
  intro: {
    title: "Bienvenue dans PC Tac",
    text: "PC Tac est le poste de commandement tactique de terrain : une application web installable (PWA) qui fonctionne hors-ligne pour tenir la main courante, ficher les acteurs d'une crise, annoter une carte et suivre vos équipes en temps réel. Ce tutoriel vous guide pas à pas, de la prise en main jusqu'aux exports, en reprenant exactement les libellés affichés à l'écran. Suivez les chapitres dans l'ordre pour découvrir chaque onglet, chaque outil et chaque geste."
  },
  chapters: [
    {
      id: "prise-en-main-pctac",
      icon: "grid_view",
      title: "Prise en main de PC Tac",
      summary: "Lancer l'application, comprendre l'en-tête, naviguer entre les sept onglets et ouvrir le dock d'outils globaux.",
      steps: [
        {
          title: "Lancer PC Tac et repérer l'en-tête",
          body: "Au chargement, la page affiche le grand titre PC TAC en haut. Le badge BETA, en haut a gauche, signale la version beta et bascule vers la version classique (pctac.html) si on clique dessus. L'application s'installe comme PWA et reste utilisable hors-ligne.",
          selector: "#version-toggle-btn",
          terms: [
            "PC TAC",
            "BETA"
          ],
          tip: "Le pied de page affiche « © PC Tac by G/ Maheux ». L'appli memorise votre theme et votre dernier onglet d'une session a l'autre."
        },
        {
          title: "Basculer entre les onglets",
          body: "La barre d'onglets, sous le titre, regroupe sept vues : Main Courante, Adversaires, Otages, Amis, Photos, Plan et Liens. Cliquer sur un onglet affiche la vue correspondante et met l'onglet en surbrillance (etat actif). Les fleches du clavier permettent aussi de passer d'un onglet a l'autre.",
          selector: null,
          terms: [
            "Main Courante",
            "Adversaires",
            "Otages",
            "Amis",
            "Photos",
            "Plan",
            "Liens"
          ],
          tip: "Un seul onglet est actif a la fois ; la vue precedente est masquee, pas fermee, donc vos saisies restent enregistrees."
        },
        {
          title: "Onglet Main Courante",
          body: "L'onglet Main Courante est la vue par defaut a l'ouverture. Il contient le formulaire de saisie et le journal chronologique des evenements, alimente par le bouton Ajouter au Log.",
          selector: null,
          terms: [
            "Main Courante",
            "Ajouter au Log"
          ],
          tip: null
        },
        {
          title: "Onglets Adversaires, Otages, Amis",
          body: "Ces trois onglets ouvrent les repertoires de personnes : Adversaires (fiches des mis en cause), Otages (personnes menacees) et Amis (forces amies engagees). Chaque onglet affiche son propre tableau de fiches et se remplit independamment.",
          selector: null,
          terms: [
            "Adversaires",
            "Otages",
            "Amis"
          ],
          tip: null
        },
        {
          title: "Onglets Photos, Plan et Liens",
          body: "Photos ouvre la galerie d'images de l'intervention, Plan affiche la carte tactique, et Liens regroupe les OUTILS CARTOGRAPHIQUES externes ainsi que les raccourcis de COMMUNICATION vers TCHAP et WHATSAPP.",
          selector: null,
          terms: [
            "Photos",
            "Plan",
            "Liens",
            "OUTILS CARTOGRAPHIQUES",
            "COMMUNICATION",
            "TCHAP",
            "WHATSAPP"
          ],
          tip: null
        },
        {
          title: "Reprise automatique du dernier onglet",
          body: "A chaque reouverture, PC Tac reaffiche automatiquement le dernier onglet consulte ; au tout premier lancement, c'est Main Courante qui s'affiche. Le choix est enregistre localement a chaque changement de vue.",
          selector: null,
          terms: [
            "Main Courante"
          ],
          tip: null
        },
        {
          title: "Ouvrir ou reduire le dock d'outils",
          body: "En bas de l'ecran, un dock d'outils globaux est reduit par defaut. Le bouton fleche (infobulle Ouvrir/Reduire) le deploie ou le replie, et son etat est memorise. Le dock regroupe le raccourci Generateur d'OI, l'export et l'import d'archive, la passerelle depuis l'Ordre Initial, le theme, le plein ecran, l'export PDF et la reinitialisation.",
          selector: "#dockToggleBtn",
          terms: [
            "Ouvrir/Réduire",
            "Générateur d'OI",
            "Exporter une archive .pctac.zip (données + photos)",
            "Importer une archive .pctac.zip",
            "Importer l'équipe et les adversaires depuis l'Ordre Initial (.oi.zip)",
            "Générer et télécharger le PDF",
            "Réinitialiser toutes les données"
          ],
          tip: "Les libelles cites apparaissent en infobulle au survol de chaque icone du dock."
        },
        {
          title: "Basculer le theme clair / sombre",
          body: "Dans le dock, le bouton Changer le theme alterne entre le mode sombre (actif par defaut) et le mode clair ; l'icone passe de nightlight a clear_day. Le choix est conserve pour les prochaines ouvertures.",
          selector: "#darkModeToggle",
          terms: [
            "Changer le thème"
          ],
          tip: null
        },
        {
          title: "Passer en plein ecran",
          body: "Toujours dans le dock, le bouton Plein ecran fait passer l'application en affichage plein ecran ; l'icone bascule alors en fullscreen_exit et un nouvel appui restaure la fenetre.",
          selector: "#fullscreenToggle",
          terms: [
            "Plein écran"
          ],
          tip: null
        }
      ]
    },
    {
      id: "carte-points-annotations",
      icon: "place",
      title: "Points et annotations sur la carte",
      summary: "Chercher un lieu, poser, deplacer et gerer des points, afficher rues, legende, capture et plein ecran.",
      steps: [
        {
          title: "Rechercher une adresse ou des coordonnees GPS",
          body: "Dans la barre d'outils de la carte, le bouton loupe (titre \"Recherche adresse / coordonnees GPS\") ouvre un bandeau avec le champ de saisie (placeholder \"Adresse ou coordonnees GPS (lat, lng)\"). Tape une adresse puis Entree ou le bouton loupe : la carte se recentre (zoom 17) et pose un pointeur bleu pulsant. Si tu entres des coordonnees decimales (ex \"48.8566, 2.3522\", la virgule decimale francaise est acceptee), le point est centre immediatement et affiche \"Point GPS centre : {lat}, {lng}\".",
          selector: "#plan_btn_search",
          terms: [
            "Recherche adresse / coordonnées GPS",
            "Adresse ou coordonnées GPS (lat, lng)",
            "Ex : « 12 rue de la Paix, Paris » ou « 48.8566, 2.3522 »",
            "Point GPS centré : {lat}, {lng}",
            "Recherche…",
            "Aucun résultat.",
            "Erreur réseau. Vérifie ta connexion."
          ],
          tip: "La recherche d'adresse passe par Nominatim (reseau requis) ; les coordonnees GPS, elles, fonctionnent hors-ligne. Le bouton croix ferme le bandeau."
        },
        {
          title: "Ajouter un point (clic long ou bouton Ping)",
          body: "Deux facons de creer un point : soit un clic long (environ 0,5 s) directement sur la carte a l'endroit voulu, ou un cercle de progression apparait sous le doigt puis la roue de creation \"Nouveau ping\" s'ouvre a ce point ; soit le bouton \"Ajouter un point (entite ou libre)\" de la barre d'outils, qui ouvre la meme roue au centre de la vue courante.",
          selector: "#plan_btn_ping",
          terms: [
            "Ajouter un point (entité ou libre)",
            "Nouveau ping"
          ],
          tip: "Pour le clic long, ne bouge pas le doigt : un deplacement de plus de ~8 px annule la creation. Le pincer-zoom l'annule aussi."
        },
        {
          title: "Deplacer un pin",
          body: "Appuie sur un pin existant et glisse-le : le marqueur suit le doigt (le pin devient semi-transparent pendant le deplacement), son libelle, son cercle de diametre eventuel suivent, et la nouvelle position est enregistree au relacher.",
          selector: null,
          terms: [],
          tip: "Le glisser est desactive si le pin est verrouille individuellement (\"Verrouiller\") ou si le verrou global des positions est actif."
        },
        {
          title: "Rouvrir la roue d'options d'un pin",
          body: "Un double-appui rapide sur un pin (deux taps en moins de ~0,35 s) rouvre sa roue d'options, ou l'on retrouve texte, diametre, icone, couleur, verrou, copie des coordonnees et suppression. Un simple tap ne fait que memoriser le pin pour le double-tap.",
          selector: null,
          terms: [],
          tip: "Cette meme roue s'ouvre aussi automatiquement juste apres avoir pose un nouveau ping, pour un ajustement immediat."
        },
        {
          title: "Verrouiller les positions",
          body: "Dans le dock de dessin, le bouton cadenas (titre \"Verrouiller la position des pings/dessins\") fige d'un coup tous les pings et dessins : l'icone passe a lock, le titre devient \"Positions verrouillees (cliquer pour deverrouiller)\" et un message \"Positions verrouillees : pings et dessins figes\" apparait. Un second clic reaffiche \"Positions deverrouillees : deplacement reactive\".",
          selector: "#plan_draw_lock",
          terms: [
            "Verrouiller la position des pings/dessins",
            "Positions verrouillées (cliquer pour déverrouiller)",
            "Positions verrouillées : pings et dessins figés",
            "Positions déverrouillées : déplacement réactivé"
          ],
          tip: "C'est un verrou GLOBAL, distinct du verrou par annotation \"Verrouiller\"/\"Deverrouiller\" de la roue d'un pin."
        },
        {
          title: "Ouvrir le panneau Calques",
          body: "Le bouton 'Calques et fond de carte' (icone 'layers') ouvre un panneau qui regroupe les reglages d'affichage de la carte : fond de carte, surimpressions (LiDAR HD, courbes de niveau, noms de rues) et vue. Ouvre ce panneau pour acceder aux boutons decrits dans les etapes suivantes ; un clic hors du panneau (ou la touche Echap) le referme.",
          terms: [
            "Calques et fond de carte"
          ],
          selector: "#plan_btn_layers",
          tip: "Les etapes suivantes vivent dans ce panneau : ouvre-le d'abord pour reperer les boutons sur la carte."
        },
        {
          title: "Afficher ou masquer les noms de rues",
          body: "Le bouton panneau (titre \"Afficher les noms de rues\") superpose les libelles de voirie et de lieux sur la carte. Une fois actif, son titre devient \"Masquer les noms de rues\" et l'etat est memorise entre les sessions.",
          selector: "#plan_btn_labels",
          terms: [
            "Afficher les noms de rues",
            "Masquer les noms de rues"
          ],
          tip: null
        },
        {
          title: "Afficher l'ombrage LiDAR HD",
          body: "Le bouton 'Ombrage LiDAR HD' (icone 'landslide') superpose a l'imagerie les ombrages LiDAR HD de l'IGN. Chaque appui passe a la couche suivante : MNT (sol nu : relief reel SOUS la vegetation, chemins, talus, fosses), puis MNS (sursol : bati et canopee), puis MNH (hauteur de vegetation), puis extinction. La pastille du bouton rappelle la couche affichee et le choix est memorise entre les sessions.",
          selector: "#plan_btn_lidar",
          terms: [
            "Ombrage LiDAR HD (relief sous la végétation)",
            "LiDAR HD — MNT (sol nu)",
            "LiDAR HD — MNS (sursol)",
            "LiDAR HD — MNH (hauteur)",
            "Ombrage LiDAR HD masqué"
          ],
          tip: "Le programme LiDAR HD est deploye par blocs : hors zone couverte l'ombrage n'apparait pas et l'imagerie reste visible. L'ombrage actif au moment d'un telechargement hors-ligne part avec la zone."
        },
        {
          title: "Fond topographique couleur et courbes de niveau",
          body: "L'IGN ne diffuse le LiDAR HD qu'en niveaux de gris : la couleur vient de ce qu'on met dessous. Le bouton 'Fond Plan IGN' (icone 'map') remplace l'imagerie satellite par la carte topographique couleur de l'IGN ; le bouton 'Courbes de niveau' (icone 'altitude') superpose les courbes, aussi bien sur l'imagerie que sur le fond topo. Les trois bascules se composent librement : Plan IGN + ombrage MNT + courbes donne la carte de terrain ombree classique. Sur le fond topo, l'ombrage LiDAR s'attenue automatiquement pour laisser lire les couleurs et les figures de la carte.",
          selector: "#plan_btn_topo",
          terms: [
            "Fond Plan IGN (carte topographique couleur)",
            "Revenir au fond imagerie satellite",
            "Afficher les courbes de niveau",
            "Masquer les courbes de niveau"
          ],
          tip: "Chaque bascule est memorisee separement, et seules les couches actives partent dans un telechargement hors-ligne."
        },
        {
          title: "Consulter la legende",
          body: "En bas a droite de la carte, le volet \"Legende\" (depliable) explique le code couleur des points d'equipe : \"Nouveau\", \"En mouvement\", \"Immobile\", \"Deco imminente\".",
          selector: "#plan_legend",
          terms: [
            "Légende",
            "Nouveau",
            "En mouvement",
            "Immobile",
            "Déco imminente"
          ],
          tip: null
        },
        {
          title: "Capturer le plan",
          body: "Le bouton appareil photo (titre \"Capture haute qualite du plan\") compose la carte et ses annotations en une image et declenche le telechargement d'un fichier nomme pctac-plan-{horodatage}.png.",
          selector: "#plan_btn_capture",
          terms: [
            "Capture haute qualité du plan"
          ],
          tip: "La capture s'appuie sur la librairie html2canvas ; un message d'erreur s'affiche si elle est indisponible (probleme reseau)."
        },
        {
          title: "Passer en plein ecran",
          body: "Le bouton \"Plein ecran\" agrandit la carte a tout l'ecran ; son icone passe alors a fullscreen_exit et un nouveau clic (ou la touche Echap) revient a l'affichage normal.",
          selector: "#plan_btn_fullscreen",
          terms: [
            "Plein écran"
          ],
          tip: null
        }
      ]
    },
    {
      id: "roue-options-coordonnees",
      icon: "donut_large",
      title: "Roue d'options et coordonnees",
      summary: "La roue radiale : creer un point OTAN ou catalogue, editer texte/diametre/icone/couleur, verrouiller, copier les coordonnees, supprimer.",
      steps: [
        {
          title: "Ouvrir la roue de creation \"Nouveau ping\"",
          body: "Le clic long sur la carte (ou le bouton Ping) ouvre la roue radiale titree \"Nouveau ping\". Au centre, un bouton rond affiche \"FERMER\" (titre \"Fermer\") pour abandonner ; dans un sous-menu ce bouton devient \"RETOUR\" (titre \"Retour\"). Un tap en dehors de la roue ou la touche Echap la ferme aussi.",
          selector: null,
          terms: [
            "Nouveau ping",
            "FERMER",
            "Fermer",
            "RETOUR",
            "Retour"
          ],
          tip: "Les libelles des options sont toujours affiches sous chaque bouton de la roue, meme sur mobile."
        },
        {
          title: "Poser un point d'un type OTAN",
          body: "La roue \"Nouveau ping\" propose cinq segments colores correspondant aux categories : \"Adv\" (rouge), \"Otage\" (jaune), \"Inter\" (bleu), \"Oscar\" (vert), \"Inconnu\" (gris). Un tap sur l'un d'eux pose immediatement le point avec l'icone et la couleur par defaut de ce type, puis ouvre sa roue d'options.",
          selector: null,
          terms: [
            "Adv",
            "Otage",
            "Inter",
            "Oscar",
            "Inconnu"
          ],
          tip: null
        },
        {
          title: "Choisir une icone dans le Catalogue",
          body: "Le segment \"Catalogue\" (icone apps) de la roue de creation ouvre un panneau de choix d'icone plus complet, avec un champ de filtre (placeholder \"Filtrer (police, pompier, drogue…)\") pour retrouver rapidement un symbole. La couleur du type reste appliquee. Le catalogue comprend notamment \"Derniere position connue\" (categorie Obs), \"Parking\" et \"Point de rassemblement des forces\" (categorie Lieu).",
          selector: null,
          terms: [
            "Catalogue",
            "Filtrer (police, pompier, drogue…)",
            "Dernière position connue",
            "Parking",
            "Point de rassemblement des forces"
          ],
          tip: null
        },
        {
          title: "Copier les coordonnees",
          body: "L'option \"Copier coords\" (icone my_location) copie dans le presse-papier les coordonnees du point en trois formats a la fois : decimal WGS84, DMS (degres/minutes/secondes) et MGRS. Un message \"Coordonnees copiees — {MGRS}\" confirme ; si la copie echoue, il affiche \"Copie impossible — {MGRS}\".",
          selector: null,
          terms: [
            "Copier coords",
            "Coordonnées copiées — {MGRS}",
            "Copie impossible — {MGRS}"
          ],
          tip: "\"Copier coords\" est disponible a la fois dans la roue de creation (coords du point vise) et dans la roue d'options d'un pin existant (coords du pin)."
        },
        {
          title: "Ajouter ou modifier le texte d'un pin",
          body: "Dans la roue d'options d'un pin, l'option texte affiche \"Ajouter texte\" (ou \"Modifier texte\" s'il en a deja) et ouvre un mini-panneau avec un champ (placeholder \"Texte du ping…\"), un bouton de validation (titre \"Enregistrer\") et un bouton (titre \"Effacer\") qui retire le texte.",
          selector: null,
          terms: [
            "Ajouter texte",
            "Modifier texte",
            "Texte du ping…",
            "Enregistrer",
            "Effacer"
          ],
          tip: "Entree valide directement la saisie du texte."
        },
        {
          title: "Ajouter ou modifier le diametre",
          body: "L'option diametre affiche \"Ajouter diametre\" (ou \"Modifier diametre\") et ouvre un panneau avec des tailles predefinies \"50 m\", \"100 m\", \"250 m\", \"500 m\", \"1 km\", un champ libre (placeholder \"custom (m)\"), un bouton oeil pour masquer/afficher le cercle (\"Cercle visible (cliquer pour masquer)\" / \"Cercle masque (cliquer pour afficher)\") et un bouton (titre \"Retirer completement\").",
          selector: null,
          terms: [
            "Ajouter diamètre",
            "Modifier diamètre",
            "custom (m)",
            "Cercle visible (cliquer pour masquer)",
            "Cercle masqué (cliquer pour afficher)",
            "Retirer complètement"
          ],
          tip: "Le cercle de diametre est dessine autour du pin et suit ses deplacements."
        },
        {
          title: "Changer l'icone ou la couleur",
          body: "Deux options distinctes de la roue : \"Changer icone\" ouvre le catalogue d'icones pour remplacer le symbole du pin, et \"Couleur\" ouvre un panneau de choix de couleur. Le catalogue d'edition dispose aussi d'un filtre (placeholder \"Filtrer…\").",
          selector: null,
          terms: [
            "Changer icône",
            "Couleur",
            "Filtrer…"
          ],
          tip: null
        },
        {
          title: "Verrouiller ou deverrouiller un pin",
          body: "L'option verrou de la roue affiche \"Verrouiller\" (icone lock_open) et, une fois active, devient \"Deverrouiller\" (icone lock) : un pin verrouille ne peut plus etre deplace au glisser. Un message \"Ping verrouille\" ou \"Ping deverrouille\" confirme l'action.",
          selector: null,
          terms: [
            "Verrouiller",
            "Déverrouiller",
            "Ping verrouillé",
            "Ping déverrouillé"
          ],
          tip: "Ce verrou est propre a CE pin, independamment du verrou global des positions du dock de dessin."
        },
        {
          title: "Supprimer un pin",
          body: "L'option \"Supprimer\" (icone delete, rouge) de la roue d'options retire definitivement le pin de la carte.",
          selector: null,
          terms: [
            "Supprimer"
          ],
          tip: null
        }
      ]
    },
    {
      id: "dessin-annotations",
      icon: "draw",
      title: "Dessin & annotations",
      summary: "Tracer traits, formes et textes sur la carte, les modifier, verrouiller et effacer.",
      steps: [
        {
          title: "Ouvrir les outils de dessin",
          body: "Dans la barre d'outils de la carte, clique le FAB Dessin (icone 'draw', bulle 'Outils de dessin'). Il ouvre/ferme le dock reductible qui regroupe tous les outils. Refermer le dock desactive automatiquement l'outil de dessin en cours.",
          terms: [
            "Outils de dessin"
          ],
          selector: "#plan_btn_draw",
          tip: "Re-cliquer sur le FAB replie le dock et coupe l'outil actif."
        },
        {
          title: "Choisir un outil de trace",
          body: "Dans le dock, choisis l'outil voulu : 'Tracer un trait a main levee', 'Tracer une ligne droite', 'Tracer un rectangle', 'Tracer un cercle', 'Texte libre (clic sur la carte)' ou 'Mesurer distance / azimut'. L'outil selectionne se colore avec la couleur active. Re-cliquer sur l'outil actif le desactive.",
          terms: [
            "Tracer un trait à main levée",
            "Tracer une ligne droite",
            "Tracer un rectangle",
            "Tracer un cercle",
            "Texte libre (clic sur la carte)",
            "Mesurer distance / azimut"
          ],
          selector: "#plan_draw_dock",
          tip: "Le trait a main levee suit le doigt en cheminement libre ; la ligne droite joint deux points par un simple glisser, comme le rectangle et le cercle."
        },
        {
          title: "Choisir la couleur du trace",
          body: "Dans le selecteur de couleurs du dock, clique une pastille : 'Rouge', 'Jaune', 'Bleu', 'Vert' ou 'Blanc'. La pastille choisie se cercle de blanc et devient la couleur des prochaines formes et mesures. Changer de couleur re-colore l'outil actif.",
          terms: [
            "Rouge",
            "Jaune",
            "Bleu",
            "Vert",
            "Blanc"
          ],
          selector: "#plan_draw_color_picker",
          tip: null
        },
        {
          title: "Tracer une forme (souris ou mode precision)",
          body: "Sur PC, glisse directement sur la carte pour tracer trait, rectangle ou cercle. Sur mobile/tactile, le mode precision s'active : un reticule de visee apparait au centre et une barre affiche 'Debuter trace', puis 'Valider' et 'Annuler'. On vise avec le reticule en deplacant la carte, puis on valide.",
          terms: [
            "Debuter trace",
            "Valider",
            "Annuler"
          ],
          selector: "#plan_draw_precision_controls",
          tip: "L'outil trait a main levee n'utilise pas le mode precision : il se dessine au doigt en continu. La ligne droite, elle, en beneficie comme le rectangle et le cercle."
        },
        {
          title: "Ajouter et annoter du texte",
          body: "Avec l'outil 'Texte libre (clic sur la carte)', clique un point pour ouvrir la modale 'Texte libre' (ou 'Annoter le dessin' sur une forme). Saisis le contenu dans le champ 'Texte (laisser vide pour supprimer l'annotation)' (placeholder 'Ex : Cellule 1 - 4 pax, ZRA, etc.'), choisis la 'Couleur du texte' et la 'Taille' avec 'Reduire'/'Agrandir', puis 'Enregistrer'.",
          terms: [
            "Annoter le dessin",
            "Texte libre",
            "Texte (laisser vide pour supprimer l'annotation)",
            "Ex : Cellule 1 - 4 pax, ZRA, etc.",
            "Couleur du texte",
            "Taille",
            "Reduire",
            "Agrandir",
            "Enregistrer",
            "Annuler"
          ],
          selector: "#plan_text_input",
          tip: "Laisser le champ texte vide puis Enregistrer supprime l'annotation."
        },
        {
          title: "Modifier une forme via le menu radial",
          body: "Un appui court sur une forme ouvre une roue contextuelle titree selon le type ('Trait', 'Rectangle', 'Cercle', 'Texte' ou 'Forme'). Elle propose 'Ajouter texte'/'Modifier texte', l'epaisseur du trait ('Epaisseur -' / 'Epaisseur +') ou la police ('Taille -' / 'Taille +'), 'Verrouiller'/'Deverrouiller' et 'Supprimer'. Sur un cercle apparait aussi 'Afficher diametre'/'Masquer diametre'.",
          terms: [
            "Ajouter texte",
            "Modifier texte",
            "Epaisseur -",
            "Epaisseur +",
            "Taille -",
            "Taille +",
            "Afficher diametre",
            "Masquer diametre",
            "Verrouiller",
            "Deverrouiller",
            "Supprimer",
            "Trait",
            "Rectangle",
            "Cercle",
            "Texte",
            "Forme"
          ],
          selector: null,
          tip: "Un glisser (>6 px) demarrant sur une forme la deplace directement au lieu d'ouvrir le menu."
        },
        {
          title: "Deplacer et faire tourner le nom d'un dessin",
          body: "Quand un dessin porte un texte, sa selection fait apparaitre deux poignees de part et d'autre du nom : 'Glisser pour deplacer le nom le long du trace' fait coulisser le nom comme sur un rail (au centre pour un rectangle ou un cercle), et 'Glisser pour faire tourner le nom' le pivote sur 360 degres. Les deux reglages sont conserves avec le dessin.",
          terms: [
            "Glisser pour déplacer le nom le long du tracé",
            "Glisser pour faire tourner le nom"
          ],
          selector: null,
          tip: "Utile pour poser un nom le long d'un axe de progression sans qu'il chevauche le trace, ou pour l'aligner sur une route."
        },
        {
          title: "Annuler, retablir et tout effacer",
          body: "Dans le dock, 'Annuler (Ctrl+Z)' revient en arriere et 'Retablir (Ctrl+Y)' rejoue l'action ; les boutons s'estompent quand l'historique est vide. 'Effacer tous les dessins' vide la carte apres la confirmation 'Effacer tous les dessins ?'.",
          terms: [
            "Annuler (Ctrl+Z)",
            "Retablir (Ctrl+Y)",
            "Effacer tous les dessins",
            "Effacer tous les dessins ?"
          ],
          selector: "#plan_draw_undo",
          tip: "Les raccourcis clavier Ctrl+Z / Ctrl+Y fonctionnent aussi."
        },
        {
          title: "Verrouiller les positions et gerer les diametres",
          body: "Le bouton verrou fige pings et dessins : au repos 'Verrouiller la position des pings/dessins', une fois actif l'icone passe au cadenas ferme et le titre devient 'Positions verrouillees (cliquer pour deverrouiller)'. Le bouton diametre bascule entre 'Diametres affiches (cliquer pour masquer)' et 'Diametres masques (cliquer pour afficher)' pour les cercles.",
          terms: [
            "Verrouiller la position des pings/dessins",
            "Positions verrouillees (cliquer pour deverrouiller)",
            "Diametres affiches (cliquer pour masquer)",
            "Diametres masques (cliquer pour afficher)",
            "Positions verrouillees : pings et dessins figes"
          ],
          selector: "#plan_draw_lock",
          tip: "Le verrou global n'empeche pas de verrouiller une forme seule via son menu radial."
        }
      ]
    },
    {
      id: "mesures-aoi-3d",
      icon: "straighten",
      title: "Mesures, zone d'interet & vue 3D",
      summary: "Mesurer distances et azimuts, poser des anneaux, telecharger une zone hors-ligne et basculer en relief 3D.",
      steps: [
        {
          title: "Mesurer distance et azimut",
          body: "Active 'Mesurer distance / azimut' dans le dock puis pose des points sur la carte : chaque segment affiche sa distance et son azimut vrai (ex '045°') et le total est prefixe par 'Σ'. La barre flottante propose 'Point' (pose sous reticule), 'Annuler dernier', 'Terminer' et 'Quitter'. Un double-clic termine aussi la mesure.",
          terms: [
            "Mesurer distance / azimut",
            "Point",
            "Annuler dernier",
            "Terminer",
            "Quitter",
            "Mesure : touche la carte pour poser des points. Double-clic ou « Terminer » pour finir."
          ],
          selector: "#plan_draw_dock",
          tip: "Sur tactile, vise avec le reticule central puis appuie 'Point' pour poser chaque sommet."
        },
        {
          title: "Poser des anneaux d'engagement",
          body: "Un appui long sur l'outil mesure ('Mesurer distance / azimut — appui long : anneaux d'engagement 50/100/200 m') depose trois cercles concentriques autour du centre de la carte. Un message confirme 'Anneaux d'engagement poses : 50 / 100 / 200 m.'.",
          terms: [
            "Mesurer distance / azimut — appui long : anneaux d'engagement 50/100/200 m",
            "Anneaux d'engagement poses : 50 / 100 / 200 m."
          ],
          selector: "#plan_draw_dock",
          tip: "Les anneaux reprennent la couleur de dessin active."
        },
        {
          title: "Telecharger une zone hors-ligne (AOI)",
          body: "Le FAB 'Telecharger la carte d'une zone (hors-ligne)' arme un cadrage : trace un rectangle sur la carte ('Trace un rectangle sur la zone a telecharger (glisser-deposer). Echap pour annuler.'). Une confirmation resume l'emprise ('Telecharger la carte de cette zone pour usage hors-ligne ?', 'Zoom {minZ} → {maxZ}', nombre de tuiles et volume), puis une barre de progression avec un bouton 'Annuler' met les tuiles en cache.",
          terms: [
            "Telecharger la carte d'une zone (hors-ligne)",
            "Trace un rectangle sur la zone a telecharger (glisser-deposer). Echap pour annuler.",
            "Telecharger la carte de cette zone pour usage hors-ligne ?",
            "Zoom {minZ} → {maxZ}",
            "Annuler"
          ],
          selector: "#plan_btn_aoi",
          tip: "Une zone trop vaste est refusee ('Zone trop vaste : {n} tuiles') ; reduis le rectangle."
        },
        {
          title: "Basculer entre vue 2D et 3D relief",
          body: "Le FAB 'Basculer vue 2D / 3D relief' (icone 'deployed_code') active le relief : la camera s'incline a 60°, le terrain DEM et les batiments 3D apparaissent. Re-cliquer revient a plat (pitch 0, nord en haut). Si le reseau bloque, l'app previent 'Relief 3D indisponible (reseau ?).'.",
          terms: [
            "Basculer vue 2D / 3D relief",
            "Relief 3D indisponible (reseau ?). Les tuiles d'elevation AWS sont peut-etre bloquees."
          ],
          selector: "#plan_btn_3d",
          tip: "La vue 3D reste calee sur la zone visee : la camera est epinglee pendant le chargement du relief."
        }
      ]
    },
    {
      id: "traces-gpx",
      icon: "route",
      title: "Traces GPX",
      summary: "Importer des traces .gpx, les grouper par journee operationnelle, les colorer en lot et les rejouer en timelapse.",
      steps: [
        {
          title: "Ouvrir le panneau des traces",
          body: "Dans la barre d'outils de la carte, le FAB 'Plus d'outils (capture, zone hors-ligne)' deploie un tiroir ou se trouve le bouton 'Traces GPX importees' (icone 'route'). Il ouvre le panneau 'Traces GPX', qui liste tout ce qui est superpose a la carte.",
          terms: [
            "Plus d'outils (capture, zone hors-ligne)",
            "Traces GPX importées",
            "Traces GPX"
          ],
          selector: "#plan_btn_gpx",
          tip: "Hors plein ecran, le tiroir s'ouvre en seconde colonne a gauche de la barre d'outils ; en plein ecran il reste dans la colonne unique."
        },
        {
          title: "Importer un ou plusieurs fichiers .gpx",
          body: "Le bouton 'Importer un .gpx' ouvre un selecteur de fichiers qui accepte plusieurs traces d'un coup (rando OsmAnd, reconnaissance terrain). Chaque trace importee apparait dans la liste avec une couleur distincte, et la carte se recadre sur l'ensemble des traces visibles.",
          terms: [
            "Importer un .gpx",
            "Aucune trace importée."
          ],
          selector: "#plan_gpx_import",
          tip: "Les traces sont dessinees SOUS les dessins de l'operateur : une trace importee ne masque jamais une annotation. Elles apparaissent aussi dans la capture et dans le PDF."
        },
        {
          title: "Lire la liste : jours, heures et compteur",
          body: "Les traces sont regroupees par journee operationnelle. L'en-tete de chaque groupe donne le jour, un compteur 'affichees/total' et un bouton 'Replier'/'Deplier' ce jour. Chaque ligne affiche le nom de la trace et son heure de debut ; une trace dont le fichier ne porte aucun horodatage est marquee 'non datee' et regroupee sous 'Sans horodatage'.",
          terms: [
            "Replier",
            "Déplier",
            "non datée",
            "Sans horodatage"
          ],
          selector: "#plan_gpx_list",
          tip: "Une trace non datee reste affichable et colorable, mais aucune fonction de temps (tri, decoupage en jours, timelapse) ne l'atteint. Reimporter le fichier d'origine recupere ses heures."
        },
        {
          title: "Agir sur une trace",
          body: "Sur chaque ligne : la pastille de couleur ouvre 'Changer la couleur de cette trace', l'oeil bascule 'Masquer cette trace' / 'Afficher cette trace', et la corbeille declenche 'Supprimer cette trace' apres la confirmation 'Supprimer la trace importee ? Cette action est irreversible.'.",
          terms: [
            "Changer la couleur de cette trace",
            "Masquer cette trace",
            "Afficher cette trace",
            "Supprimer cette trace",
            "Supprimer"
          ],
          selector: "#plan_gpx_list",
          tip: null
        },
        {
          title: "Agir sur un jour entier",
          body: "Le bouton 'Actions sur ce jour' (icone more_horiz, dans l'en-tete du groupe) ouvre un sous-menu : 'Masquer ce jour' / 'Afficher ce jour', 'Colorer ce jour' et 'Supprimer ce jour'. La suppression demande confirmation et compte les traces concernees.",
          terms: [
            "Actions sur ce jour",
            "Masquer ce jour",
            "Afficher ce jour",
            "Colorer ce jour",
            "Supprimer ce jour"
          ],
          selector: null,
          tip: "Ces sous-menus sont transitoires : un clic hors du menu, ou la touche Echap, les referme sans rien changer."
        },
        {
          title: "La barre d'actions du panneau",
          body: "En haut du panneau, cinq boutons agissent sur l'ensemble : 'Masquer toutes les traces' (qui devient 'Afficher toutes les traces' quand tout est masque), 'Colorer les traces', 'Supprimer toutes les traces', 'Rejouer les traces (timelapse)' et 'Tri et decoupage des jours'.",
          terms: [
            "Masquer toutes les traces",
            "Afficher toutes les traces",
            "Colorer les traces",
            "Supprimer toutes les traces",
            "Rejouer les traces (timelapse)",
            "Tri et découpage des jours"
          ],
          selector: "#plan_gpx_all",
          tip: null
        },
        {
          title: "Colorer plusieurs traces d'un coup",
          body: "Le bouton palette ouvre le sous-menu 'Colorer les traces'. 'Une couleur par jour' attribue automatiquement une teinte distincte a chaque journee operationnelle ; sous 'Toutes de la meme couleur', une pastille applique la meme couleur a toutes les traces.",
          terms: [
            "Colorer les traces",
            "Une couleur par jour",
            "Toutes de la même couleur"
          ],
          selector: "#plan_gpx_color",
          tip: "Colorer par jour est le reglage le plus lisible quand plusieurs equipes ont patrouille sur plusieurs jours."
        },
        {
          title: "Regler le tri et le debut de la journee",
          body: "Le bouton 'Tri et decoupage des jours' ouvre deux reglages. Sous 'Ordre de la liste', une bascule alterne 'Plus recentes d'abord' et 'Plus anciennes d'abord'. Sous 'Debut de la journee operationnelle', un champ en heures decide ou la journee bascule : 'Une intervention de nuit reste entiere dans le meme jour. Mettre 0 pour retrouver le jour civil.'.",
          terms: [
            "Tri et découpage des jours",
            "Ordre de la liste",
            "Plus récentes d'abord",
            "Plus anciennes d'abord",
            "Début de la journée opérationnelle",
            "Une intervention de nuit reste entière dans le même jour. Mettre 0 pour retrouver le jour civil."
          ],
          selector: "#plan_gpx_settings",
          tip: "Le decoupage vaut 6 h par defaut : une intervention commencee a 22 h et terminee a 3 h du matin reste un seul jour au lieu d'etre coupee a minuit."
        },
        {
          title: "Rejouer les traces en timelapse",
          body: "Le bouton 'Rejouer les traces (timelapse)' ouvre une barre de lecture au pied de la carte : 'Lecture / pause', un curseur de position, une horloge, 'Changer la vitesse' (x0.5, x1, x2, x4), 'Basculer entre temps reel et progression' et 'Fermer la lecture'. Les traces se dessinent progressivement, une tete de lecture marquant la position de chacune.",
          terms: [
            "Rejouer les traces (timelapse)",
            "Lecture / pause",
            "Changer la vitesse",
            "Basculer entre temps réel et progression",
            "Fermer la lecture",
            "Temps réel",
            "Progression"
          ],
          selector: "#plan_gpx_player",
          tip: "En 'Temps reel', toutes les traces partagent une meme horloge : deux patrouilles eloignees dans le temps laissent donc du temps mort, c'est la chronologie reelle. En 'Progression', chaque trace se dessine sur la meme duree, pour comparer des itineraires."
        },
        {
          title: "Les traces voyagent dans l'archive",
          body: "L'export d'archive .pctac.zip embarque un dossier 'gpx/' avec une entree par trace. A l'import, les traces de l'archive FUSIONNENT avec celles deja presentes : rien n'est efface, et une trace de meme identifiant est remplacee par la version de l'archive. Le bouton 'Reinitialiser toutes les donnees' supprime aussi les traces importees.",
          terms: [
            "Exporter une archive .pctac.zip (données + photos)",
            "Importer une archive .pctac.zip",
            "Réinitialiser toutes les données"
          ],
          selector: null,
          tip: "La fusion ne detruit jamais : si une trace importee est en trop, elle se supprime ligne par ligne, par jour ou d'un bloc depuis le panneau."
        }
      ]
    },
    {
      id: "suivi-temps-reel-tchap",
      icon: "share_location",
      title: "Suivi temps réel (Tchap)",
      summary: "Connecter un salon Tchap pour suivre en direct la position des équipes sur la carte, et synchroniser la main courante par QR hors-réseau.",
      steps: [
        {
          title: "Ouvrir le panneau Géoloc équipe",
          body: "Sous la carte, le bouton « Géoloc équipe (Tchap) » (icône de partage de position) ouvre et referme le panneau de configuration. La pastille ronde à droite du libellé indique l'état de connexion en permanence : grise à l'arrêt, jaune pendant la connexion, verte quand la session est à jour, rouge hors-réseau.",
          terms: [
            "Géoloc équipe (Tchap)"
          ],
          selector: "#tl_toggle",
          tip: "La pastille reste visible même panneau fermé, pour surveiller la connexion d'un coup d'œil."
        },
        {
          title: "Renseigner le salon Tchap (Forum non chiffré)",
          body: "Dans le panneau, saisir l'adresse du serveur dans « Homeserver » (par défaut https://matrix.agent.interieur.tchap.gouv.fr), puis l'identifiant du salon dans « Room ID du salon (Forum non chiffré) » (format !xxxxx:agent.interieur.tchap.gouv.fr). Le salon doit être un Forum non chiffré : un salon chiffré fait apparaître « ⚠ salon chiffré : il faut un Forum non chiffré ».",
          terms: [
            "Homeserver",
            "Room ID du salon (Forum non chiffré)",
            "!xxxxx:agent.interieur.tchap.gouv.fr",
            "⚠ salon chiffré : il faut un Forum non chiffré"
          ],
          selector: "#tl_room",
          tip: "Un seul token (le tien) reçoit toutes les positions du salon ; inutile que chaque équipier partage avec toi individuellement."
        },
        {
          title: "Se connecter via ProConnect",
          body: "Le bouton « Se connecter via ProConnect ↻ » lance l'authentification par device-code : le statut passe à « Authentification ProConnect… » et un encart affiche « Autorise PC-Tac via ProConnect : ouvre {verification_uri} et saisis le code {user_code} ». On ouvre le lien, on saisit le code, et la session se renouvelle ensuite automatiquement (elle survit aux rafraîchissements).",
          terms: [
            "Se connecter via ProConnect ↻",
            "Authentification ProConnect…",
            "Autorise PC-Tac via ProConnect : ouvre {verification_uri} et saisis le code {user_code}"
          ],
          selector: "#tl_oidc",
          tip: "En cas d'échec, le statut indique « Auth refusée — relance ProConnect. » ou « ProConnect échoué : {message} — repli token manuel possible. »."
        },
        {
          title: "Repli : token manuel et client_id",
          body: "Déplier « Repli / avancé (token manuel, client_id) » pour coller un « Token manuel (repli — Tchap Web → Aide & à propos → Token, ~5 min, non renouvelé) » (préfixe mat_… ou syt_…), et éventuellement un « client_id OAuth (optionnel — fourni par l'admin DNUM si l'auto-enregistrement est bloqué) », puis cliquer sur « Token manuel ». Ce mode n'est pas renouvelé et expire vite.",
          terms: [
            "Repli / avancé (token manuel, client_id)",
            "Token manuel (repli — Tchap Web → Aide & à propos → Token, ~5 min, non renouvelé)",
            "mat_… ou syt_…",
            "client_id OAuth (optionnel — fourni par l'admin DNUM si l'auto-enregistrement est bloqué)",
            "laisser vide pour auto-enregistrement",
            "Token manuel"
          ],
          selector: "#tl_connect",
          tip: "Champs incomplets : « Renseigne homeserver + token + room. » ; token périmé : « Token invalide/expiré — recopie-le. »."
        },
        {
          title: "Suivre l'état de connexion et le journal",
          body: "La ligne de statut sous les boutons affiche l'état courant : « Prêt. », puis « Connexion… », « Connecté : {user_id} », et en régime « À jour — {heure} · {n} opérateur(s) ». Le journal en bas horodate chaque événement, par exemple « connecté : {user_id} », « 👤 {nom} connecté » ou « token renouvelé automatiquement ».",
          terms: [
            "Prêt.",
            "Connexion…",
            "Connecté : {user_id}",
            "À jour — {heure} · {n} opérateur(s)",
            "connecté : {user_id}",
            "👤 {nom} connecté",
            "token renouvelé automatiquement"
          ],
          selector: "#tl_status",
          tip: "Coupure réseau : « Hors-réseau — reprise dans {n}s ({message}) » puis « Hors-réseau depuis {âge} — reprise auto… » (reconnexion automatique, sans action)."
        },
        {
          title: "Lire les positions sur la carte",
          body: "Chaque opérateur apparaît comme un marqueur animé libellé « [FONCTION] Nom », dont la couleur suit son état : « bleu=nouveau · vert=déplacement · gris=actif immobile · rouge=déconnexion imminente ». Le compteur affiche « {n} opérateur(s) » et le bouton « Centrer » recadre la carte sur l'ensemble des équipes visibles.",
          terms: [
            "[FONCTION] Nom",
            "bleu=nouveau · vert=déplacement · gris=actif immobile · rouge=déconnexion imminente",
            "{n} opérateur(s)",
            "Centrer"
          ],
          selector: "#tl_center",
          tip: "Si la vue carte n'est pas ouverte, la position n'est pas perdue : « ⚠ carte indisponible — position mise en tampon (ouvre la vue Plan tactique) »."
        },
        {
          title: "Piloter la liste « Opérateurs connectés »",
          body: "Sous « Opérateurs connectés », la liste regroupe les équipiers par fonction en sections repliables avec jauge d'état. Sur chaque ligne, le menu déroulant « Fonction » affecte un rôle, le bouton « Suivre (centrage live) » (◎/◉) verrouille le recadrage sur cet opérateur, et le bouton « Centrer ce groupe » (⊙) de l'en-tête cadre tout le groupe. Liste vide : « Aucun opérateur connecté. ».",
          terms: [
            "Opérateurs connectés",
            "Aucun opérateur connecté.",
            "Fonction",
            "Suivre (centrage live)",
            "Centrer ce groupe"
          ],
          selector: "#tl_ops",
          tip: "Fonctions proposées : Chef inter, Chef dispo, Chef Oscar, Négociateur, PC, Cyno, Inter, Effrac, AO, Medic, Pompier, Sans."
        },
        {
          title: "Affecter en lot (mode « Lot »)",
          body: "Le bouton « Lot » (« Mode lot : affecter une fonction à plusieurs opérateurs ») fait apparaître une case à cocher par opérateur ; « Tout » (dé)sélectionne l'ensemble, le menu choisit la fonction, puis « Affecter ({n}) » l'applique aux sélectionnés. Le bandeau récapitule les états globaux : « Nouveau », « En mouvement », « Immobile », « Déco imminente ».",
          terms: [
            "Lot",
            "Mode lot : affecter une fonction à plusieurs opérateurs",
            "Tout",
            "Affecter ({n})",
            "Nouveau",
            "En mouvement",
            "Immobile",
            "Déco imminente"
          ],
          selector: "#tl_ops",
          tip: "Sans sélection : « aucun opérateur sélectionné » ; sinon « fonction « {val} » affectée à {n} opérateur(s) »."
        },
        {
          title: "Arrêter le suivi (« Stop »)",
          body: "Le bouton « Stop » coupe le flux, purge les marqueurs et l'état persisté, et le statut passe à « Arrêté. ». Sans Stop explicite, la session reprend seule après un rafraîchissement de page ; au démarrage, les dernières positions connues sont réaffichées en gris avec leur âge (« ↻ {n} position(s) réhydratée(s) (dernière connue, hors-ligne) »).",
          terms: [
            "Stop",
            "Arrêté.",
            "↻ {n} position(s) réhydratée(s) (dernière connue, hors-ligne)"
          ],
          selector: "#tl_stop",
          tip: "Onglet masqué : la boucle se met en pause (« En pause (onglet masqué) — reprise au retour… ») pour économiser batterie et données, puis reprend au retour."
        },
        {
          title: "Synchroniser la main courante par QR (hors-réseau)",
          body: "Indépendamment de Tchap, la modale « Export/Import (QR Local) » transfère les entrées de main courante entre deux appareils sans réseau. L'onglet « Exporter (QR Séquentiel) » affiche les QR paginés (« Page {index} sur {total} - {n} entrées. » avec les flèches de navigation), l'onglet « Importer (Scan) » ouvre la caméra pour les scanner. « Terminer » ferme la modale.",
          terms: [
            "Export/Import (QR Local)",
            "Exporter (QR Séquentiel)",
            "Importer (Scan)",
            "Page {index} sur {total} - {n} entrées.",
            "{n} entrées prêtes au transfert.",
            "Scanner les QR codes séquentiellement pour importer.",
            "Terminer"
          ],
          selector: null,
          tip: "Rien à envoyer affiche « Aucune donnée à transférer. » ; à l'import, une alerte confirme « {n} entrées ajoutées. » (les doublons d'identifiant sont ignorés)."
        }
      ]
    },
    {
      id: "sauvegarde-archive-export",
      icon: "save",
      title: "Sauvegarde, archive & export",
      summary: "Sauvegarde locale automatique, archive .pctac.zip (export/import/restauration), passerelle OI, export PDF et réinitialisation.",
      steps: [
        {
          title: "Ouvrir le dock flottant",
          body: "En bas de l'écran, le dock flottant est replié par défaut ; le bouton de bascule (icône expand_less, infobulle « Ouvrir/Réduire ») le déploie. Il regroupe tous les outils de sauvegarde, d'import et d'export.",
          selector: "#dockToggleBtn",
          terms: [
            "Ouvrir/Réduire"
          ],
          tip: null
        },
        {
          title: "Comprendre la sauvegarde automatique",
          body: "Il n'y a aucun bouton « Enregistrer » : chaque log, fiche, intervenant, point ou dessin du plan est écrit automatiquement dans le stockage local du navigateur, et les photos dans une base IndexedDB dédiée. Tout reste hors-ligne sur l'appareil ; si le stockage est saturé, l'écriture est abandonnée proprement sans planter l'application.",
          selector: null,
          terms: [],
          tip: "Ce stockage local est propre au navigateur et à l'appareil : effacer les données du site ou changer d'appareil perd l'opération. Exportez une archive pour la transporter."
        },
        {
          title: "Exporter une archive .pctac.zip",
          body: "Dans le dock, le bouton à icône archive (infobulle « Exporter une archive .pctac.zip (données + photos) ») génère et télécharge un fichier unique portable nommé « PC-TAC-{horodatage}.pctac.zip » qui contient toute l'opération.",
          selector: "#exportJsonDockBtn",
          terms: [
            "Exporter une archive .pctac.zip (données + photos)"
          ],
          tip: "Nécessite la librairie JSZip chargée ; sinon le message « JSZip indisponible (réseau ?). Impossible de générer l'archive. » s'affiche."
        },
        {
          title: "Connaître le contenu de l'archive",
          body: "L'archive .pctac.zip renferme « manifest.json » (identité « PC TAC », version, date de création), « data.json » (toutes les collections : logs, adversaires, otages, forces amies, photos, intervenants/Pax, points et dessins du plan, board), un dossier « images/ » avec une entrée par photo et un dossier « gpx/ » avec une entrée par trace importée. À l'import, ce manifeste est vérifié pour refuser toute archive d'une autre application.",
          selector: null,
          terms: [
            "manifest.json",
            "data.json",
            "images/",
            "gpx/",
            "PC TAC"
          ],
          tip: "Une archive dont le manifeste indique une autre application (ex. « OI ») est refusée sans modifier vos données."
        },
        {
          title: "Importer / restaurer une archive",
          body: "Le bouton à icône unarchive (infobulle « Importer une archive .pctac.zip ») ouvre un sélecteur de fichier (.pctac.zip, ou un ancien journal .json). Une confirmation « Importer cette archive ? Les données actuelles seront remplacées. » apparaît ; après accord, l'opération courante est remplacée puis « Archive importée avec succès. » confirme la restauration.",
          selector: "#importJsonDockBtn",
          terms: [
            "Importer une archive .pctac.zip",
            "Importer cette archive ? Les données actuelles seront remplacées.",
            "Archive importée avec succès."
          ],
          tip: "L'import est atomique : en cas de stockage insuffisant, un retour arrière restaure l'état précédent (message « Échec de l'import (stockage insuffisant). Vos données précédentes ont été conservées. »)."
        },
        {
          title: "Importer depuis l'Ordre Initial (passerelle OI)",
          body: "Le bouton bleu à icône move_to_inbox (infobulle « Importer l'équipe et les adversaires depuis l'Ordre Initial (.oi.zip) ») importe directement les adversaires (avec photo) et les membres PATRACDVR d'une archive .oi.zip (ou session .json) du Générateur d'Ordre Initial. La fusion n'écrase jamais l'existant : les doublons (même nom / même trigramme) sont ignorés.",
          selector: "#importOiDockBtn",
          terms: [
            "Importer l'équipe et les adversaires depuis l'Ordre Initial (.oi.zip)"
          ],
          tip: "Le bilan s'affiche sous la forme « Passerelle OI → PC TAC : {n} adversaire(s), {n} photo(s), {n} intervenant(s) importé(s) avec succès. » suivi le cas échéant de « {n} doublon(s) déjà présent(s) ignoré(s). »."
        },
        {
          title: "Générer et télécharger le PDF",
          body: "Le bouton à icône picture_as_pdf (infobulle « Générer et télécharger le PDF ») construit puis télécharge immédiatement un dossier de synthèse nommé « PC-TAC-EXPORT-{horodatage}.pdf ». Le PDF adopte automatiquement le thème actif (clair ou sombre).",
          selector: "#previewPdfDockBtn",
          terms: [
            "Générer et télécharger le PDF"
          ],
          tip: "Nécessite la librairie pdf-lib chargée ; sinon « Librairie pdf-lib non chargée (réseau ?). Réessaie dans quelques secondes. »."
        },
        {
          title: "Comprendre le contenu du PDF",
          body: "Le PDF enchaîne dans l'ordre : « MAIN COURANTE - JOURNAL D'INTERVENTION » (colonnes « Heure », « Pax », « Localisation », « Remarques »), « FICHIER ADVERSAIRES », « FICHIER OTAGES / VICTIMES », « FORCES AMIES / UNITÉS », les galeries « GALERIE : {CATÉGORIE} », le « PLAN TACTIQUE » avec sa « PLAN TACTIQUE - LISTE DES POINTS », et le « BOARD RELATIONNEL ». Chaque page porte en pied de page la mention « DIFFUSION RESTREINTE », l'horodatage d'export et la pagination.",
          selector: null,
          terms: [
            "MAIN COURANTE - JOURNAL D'INTERVENTION",
            "Heure",
            "Pax",
            "Localisation",
            "Remarques",
            "FICHIER ADVERSAIRES",
            "FICHIER OTAGES / VICTIMES",
            "FORCES AMIES / UNITÉS",
            "GALERIE : {CATÉGORIE}",
            "PLAN TACTIQUE",
            "PLAN TACTIQUE - LISTE DES POINTS",
            "BOARD RELATIONNEL",
            "DIFFUSION RESTREINTE"
          ],
          tip: "Les galeries photo, le plan tactique et le board relationnel sont mis en page A4 paysage ; les sections sans donnée sont automatiquement omises."
        },
        {
          title: "Réinitialiser toutes les données",
          body: "Le bouton rouge à icône delete_forever (infobulle « Réinitialiser toutes les données ») ouvre la modale « RESET COMPLET », qui avertit que « toutes les données (logs, adversaires, otages, photos) seront définitivement supprimées. Cette action est irréversible. ». « CONFIRMER LE RESET » efface tout (stockage local + photos) puis recharge la page ; « ANNULER » referme sans rien supprimer.",
          selector: "#resetDataDockBtn",
          terms: [
            "Réinitialiser toutes les données",
            "RESET COMPLET",
            "Attention, toutes les données (logs, adversaires, otages, photos) seront définitivement supprimées. Cette action est irréversible.",
            "CONFIRMER LE RESET",
            "ANNULER"
          ],
          tip: "À faire de préférence après avoir exporté une archive .pctac.zip : la réinitialisation est définitive et sans corbeille."
        }
      ]
    }
  ]
};
