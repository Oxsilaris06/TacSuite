/**
 * pin-icons.ts — Catalogue d'icônes génériques pour pings tactiques.
 * ===========================================================================
 *
 * Extrait VERBATIM de `PIN_ICONS` (`@pctac/config.ts`, ex-port TypeScript de
 * `modules/pctac/config.js`, GStart-main) pour partage entre PC-Tac et la
 * roue de création de ping OI (parité de présentation, chantier roue OI).
 * `@pctac/config.ts` réexporte cette même constante (redirection d'import,
 * aucune valeur ni API modifiée) ; OI consomme directement `@shared/pin-icons.js`.
 *
 * Structure : id = nom Material Symbols Outlined, label = affichage UI,
 * tags = mots-clés pour la suggestion automatique d'après l'intitulé.
 */
import type { PctacPinIcon } from '@shared/types/contracts.js';

export const PIN_ICONS: PctacPinIcon[] = [
    // --- Forces de l'ordre ---
    // Gendarmerie = bouclier étoile (local_police), Armée = médaille (military_tech),
    // Police = bouclier silhouette (shield_person). Mêmes id Material qu'avant,
    // libellés permutés (décision Nico 2026-08-17).
    { id: 'local_police', label: 'Gendarmerie', cat: 'Forces', tags: ['gendarmerie', 'gendarme', 'brigade', 'psig', 'bta'] },
    { id: 'military_tech', label: 'Armée', cat: 'Forces', tags: ['armee', 'militaire', 'soldat'] },
    { id: 'security', label: 'Sécurité', cat: 'Forces', tags: ['securite', 'garde', 'protection'] },
    { id: 'shield_person', label: 'Police', cat: 'Forces', tags: ['police', 'policier', 'agent', 'pn'] },

    // --- Pompiers / secours ---
    { id: 'local_fire_department', label: 'Pompier', cat: 'Secours', tags: ['pompier', 'sapeur', 'sdis', 'feu', 'spp'] },
    { id: 'fire_truck', label: 'FPT/VSAV', cat: 'Secours', tags: ['pompier', 'fpt', 'vsav', 'camion pompier', 'vehicule pompier'] },
    { id: 'medical_services', label: 'SAMU', cat: 'Secours', tags: ['samu', 'medecin', 'medical', 'medic', 'ambulance', 'soin', 'soins'] },
    { id: 'ambulance', label: 'Ambulance', cat: 'Secours', tags: ['ambulance', 'smur', 'vsav'] },
    { id: 'health_and_safety', label: 'PRV', cat: 'Secours', tags: ['prv', 'victimes', 'regroupement', 'secours'] },
    { id: 'monitor_heart', label: 'Réa', cat: 'Secours', tags: ['rea', 'reanimation', 'urgence'] },

    // --- Cyno ---
    { id: 'pets', label: 'Cyno', cat: 'Cyno', tags: ['cyno', 'chien', 'k9', 'canin'] },

    // --- Négociateur / com ---
    { id: 'record_voice_over', label: 'Négociateur', cat: 'Com', tags: ['negociateur', 'nego', 'negoc', 'dialogue', 'parole', 'com'] },
    { id: 'headset_mic', label: 'Opérateur radio', cat: 'Com', tags: ['operateur', 'radio', 'com', 'transmission', 'tg'] },
    { id: 'forum', label: 'Réunion', cat: 'Com', tags: ['reunion', 'debrief', 'meeting', 'briefing'] },

    // --- Autorité civile ---
    { id: 'account_balance', label: 'Maire / Préfet', cat: 'Autorité', tags: ['maire', 'prefet', 'autorite', 'mairie', 'prefecture', 'institution'] },
    { id: 'gavel', label: 'Magistrat', cat: 'Autorité', tags: ['magistrat', 'procureur', 'juge', 'justice'] },
    { id: 'corporate_fare', label: 'Institution', cat: 'Autorité', tags: ['institution', 'admin', 'administration'] },

    // --- Adversaire / otage / victime ---
    { id: 'person_alert', label: 'Adversaire', cat: 'Acteurs', tags: ['adversaire', 'adv', 'hostile', 'suspect', 'forcene', 'dangereux'] },
    { id: 'person_off', label: 'Otage', cat: 'Acteurs', tags: ['otage', 'hostage', 'prisonnier'] },
    { id: 'personal_injury', label: 'Blessé / Victime', cat: 'Acteurs', tags: ['blesse', 'victime', 'injury', 'injury'] },
    { id: 'group', label: 'Groupe / Foule', cat: 'Acteurs', tags: ['groupe', 'foule', 'population', 'public', 'civils'] },
    { id: 'face', label: 'Témoin', cat: 'Acteurs', tags: ['temoin', 'witness', 'riverain'] },
    { id: 'person', label: 'Individu', cat: 'Acteurs', tags: ['individu', 'personne', 'pieton', 'piéton', 'pax'] },

    // --- Armes / menace ---
    { id: 'swords', label: 'Armes', cat: 'Armes', tags: ['arme', 'armes', 'melee', 'sabre', 'epee'] },
    { id: 'target', label: 'Cible / Objectif', cat: 'Armes', tags: ['cible', 'target', 'objectif', 'obj'] },
    { id: 'crisis_alert', label: 'Menace', cat: 'Armes', tags: ['menace', 'danger', 'alerte', 'alarm'] },
    { id: 'gps_fixed', label: 'Tireur', cat: 'Armes', tags: ['tireur', 'sniper', 'tir', 'tireur isole'] },

    // --- Explosif / pièges ---
    { id: 'bomb', label: 'Explosif', cat: 'EOD', tags: ['bombe', 'explosif', 'ied', 'engin', 'tnt', 'eod', 'dni'] },
    { id: 'dangerous', label: 'Piège', cat: 'EOD', tags: ['piege', 'trap', 'danger', 'engin piege'] },
    { id: 'warning', label: 'Danger', cat: 'EOD', tags: ['danger', 'attention', 'warning', 'risque', 'alerte'] },
    { id: 'bolt', label: 'Énergie/Élec', cat: 'EOD', tags: ['electrique', 'elec', 'tension', 'court circuit'] },

    // --- Drogue / produits ---
    { id: 'vaccines', label: 'Drogue', cat: 'Stup', tags: ['drogue', 'stup', 'seringue', 'heroine', 'cocaine'] },
    { id: 'medication', label: 'Médicament', cat: 'Stup', tags: ['medicament', 'pilule', 'medic'] },
    { id: 'science', label: 'Labo', cat: 'Stup', tags: ['labo', 'chimie', 'produit', 'laboratoire'] },

    // --- Surveillance / observation ---
    { id: 'videocam', label: 'Caméra', cat: 'Obs', tags: ['camera', 'video', 'surveillance', 'cctv', 'videosurveillance'] },
    { id: 'photo_camera', label: 'Photo', cat: 'Obs', tags: ['photo', 'appareil', 'cliche'] },
    { id: 'visibility', label: 'Observation', cat: 'Obs', tags: ['observation', 'vue', 'watch', 'spotter', 'jumelles', 'obs', 'surveillance', 'vigie', 'planque'] },

    // --- Véhicules ---
    { id: 'directions_car', label: 'Voiture', cat: 'Véhicule', tags: ['voiture', 'vl', 'car', 'vehicule', 'vehicule leger'] },
    { id: 'local_taxi', label: 'Taxi', cat: 'Véhicule', tags: ['taxi'] },
    { id: 'directions_bus', label: 'Bus / Car', cat: 'Véhicule', tags: ['bus', 'car', 'autocar'] },
    { id: 'local_shipping', label: 'Camion / PL', cat: 'Véhicule', tags: ['camion', 'poids lourd', 'pl', 'truck', 'remorque'] },
    { id: 'two_wheeler', label: 'Moto', cat: 'Véhicule', tags: ['moto', 'scooter', '2 roues', 'deux roues'] },
    { id: 'pedal_bike', label: 'Vélo', cat: 'Véhicule', tags: ['velo', 'bike', 'cycliste'] },
    { id: 'directions_boat', label: 'Bateau', cat: 'Véhicule', tags: ['bateau', 'navire', 'boat', 'embarcation'] },
    { id: 'flight', label: 'Avion / Hélico', cat: 'Véhicule', tags: ['avion', 'plane', 'helico', 'helicoptere'] },

    // --- Lieux / structures ---
    { id: 'home', label: 'Maison', cat: 'Lieu', tags: ['maison', 'home', 'habitation', 'domicile'] },
    { id: 'apartment', label: 'Immeuble', cat: 'Lieu', tags: ['immeuble', 'batiment', 'apartment', 'residence'] },
    { id: 'dvr', label: 'PC opérationnel', cat: 'Lieu', tags: ['pc', 'poste', 'commandement', 'pc op', 'pc tac', 'pco'] },
    { id: 'door_front', label: 'Accès / Porte', cat: 'Lieu', tags: ['porte', 'entree', 'acces', 'door'] },
    { id: 'fence', label: 'Clôture', cat: 'Lieu', tags: ['cloture', 'barriere', 'fence', 'grille'] },
    { id: 'flag', label: 'Repère', cat: 'Lieu', tags: ['repere', 'flag', 'marker', 'drapeau'] },
];
