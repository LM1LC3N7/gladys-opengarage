# OpenGarage pour Gladys Assistant

Cette intégration affiche vos contrôleurs OpenGarage dans Gladys et commande
votre porte de garage par leur API HTTP locale, sur votre réseau, sans le
cloud OpenGarage.

**Jamais testé avec un vrai appareil** : l'intégration suit l'API du
micrologiciel et la bibliothèque open-garage (celle de Home Assistant), mais
personne ne l'a encore essayée sur un contrôleur réel. Vos retours sont les
bienvenus.

Intégration non officielle, sans lien avec OpenGarage.

## Dans Gladys

| Fonctionnalité         | Détail                                                   |
| ---------------------- | -------------------------------------------------------- |
| Porte de garage        | ouverte / fermée (capteur d'ouverture, lecture seule)    |
| Ouvrir / Fermer        | deux boutons, jamais un interrupteur                     |
| Capteur de distance    | en cm                                                    |
| Voiture dans le garage | présente / absente (inconnue quand la porte est ouverte) |
| Signal Wi-Fi           | de 0 à 5                                                 |
| Température, humidité  | seulement si un capteur est monté sur le contrôleur      |

## Installation

1. Donnez à chaque contrôleur une adresse IP fixe dans votre box.
2. Dans les réglages du contrôleur, changez la clé de l'appareil
   (« opendoor » par défaut).
3. Dans Gladys, installez l'intégration OpenGarage depuis le store.
4. Saisissez les adresses IP des contrôleurs (séparées par des virgules) et
   la clé de l'appareil (la même pour tous les contrôleurs).
5. Ajoutez les appareils depuis l'onglet Découverte.

La lecture de l'état ne demande pas la clé ; ouvrir et fermer, si. La clé
est gardée par Gladys dans sa base, jamais réaffichée, envoyée seulement à vos
contrôleurs (en clair sur votre réseau local : ils n'ont pas de https). Elle
n'apparaît jamais dans les journaux, les statuts, les erreurs ni dans `/data`.

« Vérifier les contrôleurs » affiche ce que chaque adresse a répondu ; il ne
relit jamais un contrôleur plus vite que l'intervalle de rafraîchissement.

## Sécurité des commandes

Le relais d'un OpenGarage est une **bascule** : la même impulsion ouvre une
porte fermée, ferme une porte ouverte, et arrête ou inverse une porte en
mouvement. Gladys en tient compte :

- La porte n'est jamais un interrupteur : un « éteins tout » d'un assistant
  vocal ou d'une scène ne peut pas l'atteindre. Elle a deux boutons, Ouvrir
  et Fermer.
- Avant chaque impulsion, Gladys relit la porte et vérifie l'adresse MAC du
  contrôleur (une box qui redonne l'adresse IP à un autre contrôleur ne fait
  jamais bouger la mauvaise porte). « Ouvrir » n'est envoyé qu'à une porte
  lue fermée, « Fermer » qu'à une porte lue ouverte. Déjà dans l'état voulu :
  rien n'est envoyé. En mouvement, arrêtée à mi-course ou inconnue : refusé.
- **Ouvrir est désactivé par défaut** : activez « Autoriser l'ouverture de la
  porte de garage ». L'autorisation est vérifiée à l'arrivée de la commande,
  après la lecture et juste avant l'envoi.
- **Fermer est toujours permis**, passe avant les autres commandes, reste
  possible quand le contrôleur demande d'attendre (un seul essai) et annule
  une ouverture qui n'est pas encore partie.
- Après une impulsion, la suivante est refusée tant que la porte n'est pas
  lue là où elle a été envoyée (45 secondes au plus), même après un
  redémarrage : une seconde impulsion l'arrêterait ou l'inverserait.
  Utilisez le bouton mural ou la télécommande pour l'arrêter.
- Une commande qui ne peut pas partir en 3,5 secondes est refusée sans être
  envoyée ; une commande partie sans réponse est annoncée « envoyée, sans
  confirmation », et la porte est relue dans les secondes qui suivent. Le
  succès d'une commande veut dire que le contrôleur a accepté l'impulsion :
  la porte met ensuite 10 à 30 secondes à bouger.
- Entre la lecture et l'impulsion, une seconde s'écoule au plus : si la
  porte bouge pendant ce temps (télécommande), l'impulsion peut l'arrêter.

## Pannes

- Clé refusée par un contrôleur : les ouvertures vers ce contrôleur sont
  refusées sans être envoyées pendant 15 min, puis 1 h, 6 h et 24 h ;
  enregistrer une autre clé réessaie aussitôt. Les lectures continuent, et
  fermer reste possible.
- Un contrôleur qui demande d'attendre (HTTP 429 ou 5xx) est mis en pause
  d'une minute à six heures, même après un redémarrage.
- Un contrôleur qui ne répond pas est relu après 30 s, 1, 2 puis 5 min,
  jamais plus vite que l'intervalle de rafraîchissement. Une réponse sans
  adresse MAC lisible compte comme un échec, jamais comme un autre contrôleur.
- Après un redémarrage, Gladys attend un intervalle entier avant de relire.

## Limites

- Pas de recherche automatique : saisissez les adresses.
- Une seule clé pour tous les contrôleurs.
- Pas de lumière ni de verrou Security+ (micrologiciel 1.2.x), pas de
  compteur d'ouvertures, pas de cloud OpenGarage ni de MQTT.
