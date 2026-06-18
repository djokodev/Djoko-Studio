# DS-063 Open-source Recording References

## OBS Studio
- **Patterns étudiés** :
  - Séparation stricte entre la source média, l'encodeur, la sortie (output) et l'UI d'état.
  - Cycle de vie d'un enregistrement avec états de transition explicites (`preparing`, `recording`, `stopping`, `stopped`, `failed`).
- **Ce qu’on adopte** :
  - La logique de machine à états stricte pour découpler l'état de l'enregistreur (`MediaRecorder`) de l'état de l'UI.
  - La gestion robuste des erreurs de l'encodeur / enregistreur pour afficher des erreurs claires à l'utilisateur plutôt que d'échouer silencieusement.
- **Ce qu’on ne reprend pas** :
  - L'implémentation bas niveau C/C++ (OBS Studio étant une application desktop native).
- **Pourquoi** :
  - DNA STUDIO est une application web s'appuyant sur les APIs standard du navigateur comme `MediaRecorder` et `IndexedDB`.

## VDO.Ninja
- **Patterns étudiés** :
  - Flux d'invité simplifié sans compte (Guest flow).
  - Indépendance vis-à-vis du serveur pour la capture des flux médias (WebRTC Peer-to-Peer).
  - Rendre l'état de préparation de l'invité visible à l'hôte.
- **Ce qu’on adopte** :
  - Capture locale et autonome de chaque flux participant sans dépendre d'un serveur d'enregistrement central (conception local-first).
  - Parcours utilisateur simplifié : l'invité clique sur son lien, prévisualise ses périphériques et rejoint la session en un clic.
- **Ce qu’on ne reprend pas** :
  - Le modèle d'intégration OBS direct et la complexité des paramètres d'URL avancés.
- **Pourquoi** :
  - Notre focus dans DNA STUDIO v0.1 est plus restreint : nous voulons un produit clé en main avec récupération locale automatique (recovery) et export propre en 1080p géré côté serveur ultérieurement.

## Jitsi / lib-jitsi-meet
- **Patterns étudiés** :
  - Événements nommés pour exprimer chaque changement d'état du cycle de vie des flux et des participants.
  - Utilisation du mode Peer-to-Peer direct lorsqu'il n'y a que deux participants.
- **Ce qu’on adopte** :
  - Découplage clair de la couche de transport WebRTC/signaling et de la couche UI grâce à un modèle d'état et d'événements bien défini.
  - Utilisation du mode P2P direct pour la connexion Host/Guest.
- **Ce qu’on ne reprend pas** :
  - La gestion des ponts médias SFU (Jitsi Videobridge) et les appels multi-participants complexes.
- **Pourquoi** :
  - DNA STUDIO v0.1 est strictement limité à 1 Hôte + 1 Invité, ce qui simplifie grandement la topologie réseau.

## Application à DNA STUDIO DS-063

### Recording lifecycle retenu :
- `idle` : Prêt à démarrer l'enregistrement.
- `preparing` : Initialisation des encodeurs et du flux.
- `recording` : Enregistrement actif, morceaux (chunks) générés et sauvegardés périodiquement.
- `stopping` : Arrêt en cours, finalisation du blob final et du manifest.
- `stopped` (ou `saved locally`) : Enregistrement terminé avec succès et persistant localement.
- `failed` (ou `error`) : Une erreur est survenue lors de la capture ou de la persistance.

### Recovery lifecycle retenu :
- Au chargement du studio ou du lien guest, l'application vérifie la présence de sessions/participants enregistrés localement dans IndexedDB.
- Si des enregistrements sont trouvés : l'état passe à `recoverable`. L'UI affiche un message et propose à l'utilisateur de prévisualiser, télécharger le fichier brut local, ou de nettoyer/supprimer explicitement cet enregistrement.

### UI states retenus :
- Boutons de contrôle de l'enregistrement (Démarrer/Arrêter/Réinitialiser) liés à l'état du MediaRecorder.
- Section "Recovery" dédiée listant les enregistrements récupérables trouvés dans IndexedDB avec leurs métadonnées (durée, taille, sessionId, rôle).
- Badge de statut de téléversement : marqué comme "Non téléversé (Local uniquement)" puisque la partie téléversement sera implémentée dans la tâche suivante.

### Tests à ajouter :
- Tests unitaires pour la machine à états de recording.
- Tests pour la création du manifest (inclusion de `sessionId`, `participantId`, `role` et métadonnées).
- Tests de persistance IndexedDB (simulée via mock) pour valider l'enregistrement, la récupération et la suppression de blobs/manifests.
