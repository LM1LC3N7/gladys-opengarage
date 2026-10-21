// -----------------------------------------------------------------------------
// The texts shown to the user (feature names, connection status, action
// answers, command refusals), in English and French.
// -----------------------------------------------------------------------------

const both = (en, fr) => ({ en, fr });

/** The text of a `{ en, fr }` in a language (French when missing). */
export const word = (text, language) => text?.[language] ?? text?.fr ?? String(text ?? '');

/** `{ en, fr }` -> one text with both, for the status and the action answers. */
export const join = (parts) => ({
  en: parts.map((p) => p.en).join(' '),
  fr: parts.map((p) => p.fr).join(' '),
});

export const FEATURE_NAMES = {
  door: both('Garage door', 'Porte de garage'),
  open: both('Open the garage door', 'Ouvrir la porte de garage'),
  close: both('Close the garage door', 'Fermer la porte de garage'),
  distance: both('Distance sensor', 'Capteur de distance'),
  vehicle: both('Vehicle in the garage', 'Voiture dans le garage'),
  signal: both('Wi-Fi signal', 'Signal Wi-Fi'),
  temperature: both('Temperature', 'Température'),
  humidity: both('Humidity', 'Humidité'),
};

export const T = {
  noAddress: both(
    'No OpenGarage controller yet: type their IP addresses in the configuration.',
    'Aucun contrôleur OpenGarage pour le moment : saisissez leurs adresses IP dans la configuration.',
  ),
  status: (answering, known) =>
    both(
      `${answering} of ${known} OpenGarage controller(s) answer.`,
      `${answering} contrôleur(s) OpenGarage sur ${known} répond(ent).`,
    ),
  waiting: both(
    'Waiting for the first read of the controllers.',
    'En attente de la première lecture des contrôleurs.',
  ),
  invalidAddresses: (list) =>
    both(
      `Ignored, not an address: ${list.join(', ')}.`,
      `Ignoré, ce n'est pas une adresse : ${list.join(', ')}.`,
    ),
  key: {
    missing: both(
      'No device key: the doors are only read (opening and closing need the key).',
      "Pas de clé de l'appareil : les portes sont seulement lues (ouvrir et fermer demandent la clé).",
    ),
    invalid: both(
      'The device key holds characters a controller cannot take: not used.',
      "La clé de l'appareil contient des caractères qu'un contrôleur ne peut pas prendre : non utilisée.",
    ),
  },
  keyRefused: (list) =>
    both(
      `Device key refused by ${list.join(', ')}: check it in the settings of the controller (openings refused for a while; saving another key tries again).`,
      `Clé de l'appareil refusée par ${list.join(', ')} : vérifiez-la dans les réglages du contrôleur (ouvertures refusées pendant un temps ; enregistrer une autre clé réessaie).`,
    ),
  paused: (list) =>
    both(
      `Asked to wait (HTTP 429 or 5xx): ${list.join(', ')}.`,
      `Demande d'attendre (HTTP 429 ou 5xx) : ${list.join(', ')}.`,
    ),
  notController: (list) =>
    both(
      `Not an OpenGarage controller (no MAC address in /jc): ${list.join(', ')}.`,
      `Pas un contrôleur OpenGarage (pas d'adresse MAC dans /jc) : ${list.join(', ')}.`,
    ),
  sameController: (id, list) =>
    both(
      `The same controller (${id}) answers at ${list.join(' and ')}: only the first one is used.`,
      `Le même contrôleur (${id}) répond à ${list.join(' et ')} : seule la première adresse sert.`,
    ),
  moved: (address, previous, next) =>
    both(
      `${address}: ${previous} was there, ${next} answers now. Give each controller a fixed address in your router.`,
      `${address} : ${previous} y était, ${next} y répond maintenant. Donnez une adresse fixe à chaque contrôleur dans votre box.`,
    ),
  check: {
    none: both(
      'No address in the configuration: type the IP addresses of your controllers.',
      'Aucune adresse dans la configuration : saisissez les adresses IP de vos contrôleurs.',
    ),
    result: (lines) => both(lines.map((l) => l.en).join('\n'), lines.map((l) => l.fr).join('\n')),
    ok: (address, id, name, age) =>
      both(
        `${address}: ${name ? `"${name}" ` : ''}${id}, read ${age} s ago.`,
        `${address} : ${name ? `« ${name} » ` : ''}${id}, lu il y a ${age} s.`,
      ),
    failed: (address, reason, age) =>
      both(
        `${address}: no answer (${reason}), ${age} s ago.`,
        `${address} : pas de réponse (${reason}), il y a ${age} s.`,
      ),
    pending: (address) => both(`${address}: not read yet.`, `${address} : pas encore lu.`),
    interval: (seconds) =>
      both(
        `(Never read sooner than every ${seconds} s.)`,
        `(Jamais lu plus souvent que toutes les ${seconds} s.)`,
      ),
  },
};

/** The command refusals and errors (one language, the configured one). */
export const ERRORS = {
  readOnly: both('This feature cannot be controlled.', 'Cette fonctionnalité ne se commande pas.'),
  badValue: both('Invalid value.', 'Valeur invalide.'),
  unknownDevice: both(
    'This controller is not known, or no longer at its address: nothing sent.',
    "Contrôleur inconnu, ou plus à son adresse : rien n'a été envoyé.",
  ),
  openDisabled: both(
    'Opening the garage door is disabled in the configuration ("Allow opening the garage door"): nothing sent.',
    "L'ouverture de la porte de garage est désactivée dans la configuration (« Autoriser l'ouverture de la porte de garage ») : rien n'a été envoyé.",
  ),
  noKey: both(
    'No usable device key in the configuration: nothing sent.',
    "Pas de clé de l'appareil utilisable dans la configuration : rien n'a été envoyé.",
  ),
  keyRefused: both(
    'The controller refused the device key just now: nothing sent. Check the key, then save it again.',
    "Le contrôleur a refusé la clé de l'appareil il y a peu : rien n'a été envoyé. Vérifiez la clé, puis enregistrez-la à nouveau.",
  ),
  keyRefusedNow: both(
    'The controller refused the device key: the door did not move. Check the key in the settings of the controller.',
    "Le contrôleur a refusé la clé de l'appareil : la porte n'a pas bougé. Vérifiez la clé dans les réglages du contrôleur.",
  ),
  cancelled: both(
    'Cancelled by a close command: nothing sent.',
    "Annulée par une commande de fermeture : rien n'a été envoyé.",
  ),
  configChanged: both(
    'The configuration changed meanwhile: nothing sent.',
    "La configuration a changé entre-temps : rien n'a été envoyé.",
  ),
  tooSlow: both(
    'The controller did not answer in time: nothing sent.',
    "Le contrôleur n'a pas répondu à temps : rien n'a été envoyé.",
  ),
  blocked: both(
    'The controller asked to wait: nothing sent.',
    "Le contrôleur a demandé d'attendre : rien n'a été envoyé.",
  ),
  unknownState: both(
    'The state of the door could not be read just now: nothing sent.',
    "L'état de la porte n'a pas pu être lu à l'instant : rien n'a été envoyé.",
  ),
  notClosed: both(
    'The door is not read closed (it may be moving, stopped or unknown): the pulse is a toggle and could stop or close it, so nothing was sent.',
    "La porte n'est pas lue fermée (elle bouge peut-être, est arrêtée ou inconnue) : l'impulsion est une bascule et pourrait l'arrêter ou la fermer, rien n'a donc été envoyé.",
  ),
  notOpen: both(
    'The door is not read open (it may be moving, stopped or unknown): the pulse is a toggle and could stop or open it, so nothing was sent. Use the wall button or the remote control.',
    "La porte n'est pas lue ouverte (elle bouge peut-être, est arrêtée ou inconnue) : l'impulsion est une bascule et pourrait l'arrêter ou l'ouvrir, rien n'a donc été envoyé. Utilisez le bouton mural ou la télécommande.",
  ),
  justCommanded: both(
    'The door was commanded just now and is not read where that pulse sends it yet: another pulse would stop or reverse it, so nothing was sent. Try again once it has moved, or use the wall button or the remote control.',
    "La porte vient d'être commandée et n'est pas encore lue là où cette impulsion l'envoie : une autre impulsion l'arrêterait ou l'inverserait, rien n'a donc été envoyé. Réessayez quand elle aura bougé, ou utilisez le bouton mural ou la télécommande.",
  ),
  notSent: (reason) => both(`Command not sent (${reason}).`, `Commande non envoyée (${reason}).`),
  refused: (code) =>
    both(
      `The controller refused the command (code ${code}): the door did not move.`,
      `Le contrôleur a refusé la commande (code ${code}) : la porte n'a pas bougé.`,
    ),
  refusedHttp: (reason) =>
    both(
      `The controller refused the command (${reason}).`,
      `Le contrôleur a refusé la commande (${reason}).`,
    ),
  sentUnconfirmed: (reason) =>
    both(
      `Command sent, without confirmation (${reason}): check the door in a few seconds.`,
      `Commande envoyée, sans confirmation (${reason}) : vérifiez la porte dans quelques secondes.`,
    ),
};
