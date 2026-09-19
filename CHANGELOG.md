# Journal des modifications — ReDeFin-CM

Ce journal décrit ce qui distingue ReDeFin-CM du
[ReDeFin officiel](https://github.com/laborantine/ReDeFin) de Laborantine, vu
depuis la télécommande. L'outillage de développement (tests, scripts de build,
lanceur en mode développeur, traces de débogage) n'y figure pas : il n'a aucun
effet sur le paquet installé.

Les évolutions de ReDeFin lui-même sont décrites par Laborantine dans ses notes
de version ; elles ne sont pas recopiées ici.

Le numéro de version suit celui de la version officielle qui sert de base.

## 0.9.7 — 19 septembre 2026

Base : ReDeFin 0.9.7 officiel (paquet `ReDeFin_0.9.7_final`).
Validé sur Freebox Révolution. Non testé sur Freebox Delta / Devialet.

### Ajouté

- **Réglage « Sortie audio » : Multicanal | Stéréo** (panneau Paramètres,
  section Lecture ; Multicanal par défaut, réglage conservé entre deux
  lancements). Sur un téléviseur ou une installation stéréo, une piste 5.1
  envoyée telle quelle sonne faible, en particulier les dialogues. En mode
  Stéréo, c'est le serveur Jellyfin qui réalise le mixage vers deux canaux
  (AAC 2.0, 192 kb/s) et applique son rehaussement de volume.
  - Le réglage s'applique quel que soit le mode de lecture.
  - Une piste déjà en 2.0 que le Player sait lire n'est pas transcodée.
  - La vidéo reste copiée sans réencodage lorsqu'elle est compatible : seul
    l'audio est converti.
  - Modifié pendant qu'une vidéo est ouverte, le réglage prend effet à la
    lecture suivante.
- **Confirmation avant suppression d'un profil ou d'un serveur mémorisé.** Un
  appui long affiche « Appuyez encore sur OK pour supprimer » ; il faut un
  second appui long dans les quatre secondes. Auparavant, un OK maintenu une
  seconde de trop supprimait le profil et sa session sans prévenir.

### Modifié

- **Un réglage changé pendant une pause ne relance plus la lecture.** Piste
  audio, sous-titres côté serveur et qualité : le choix est mémorisé et affiché
  immédiatement, puis appliqué en une seule fois à la reprise, comme le fait le
  client officiel Jellyfin pour Android TV. Auparavant le flux était rouvert
  sur-le-champ, avec un éclat d'image et de son malgré la pause. En cours de
  lecture, rien ne change. Les sous-titres texte locaux en DirectPlay restent
  instantanés.
- **Resélectionner le réglage déjà actif ne fait plus rien.** Choisir la piste
  audio, le sous-titre ou la qualité déjà cochés relançait une négociation
  complète, donc plusieurs secondes de chargement pour un résultat identique,
  et pouvait faire perdre le DirectPlay.
- **Les touches reculer / avancer sont ignorées pendant un rechargement de
  flux** (environ 2,5 s sur Révolution). Des appuis à l'aveugle pendant le
  chargement provoquaient des sauts de −10 s ou −20 s et autant de
  renégociations concurrentes.

### Corrigé

- **Écran « Qui regarde ? » : le profil s'ouvre au premier appui sur OK.** Seuls
  les appuis de moins de 200 ms étaient pris en compte ; un appui normal sur
  une télécommande était ignoré sans aucun retour, d'où la dizaine d'essais
  nécessaires. Dans certains cas la tuile cessait même définitivement de
  répondre à OK. Le même défaut est corrigé dans la liste des serveurs
  mémorisés.
- **Une coupure réseau ne déconnecte plus le profil.** Si le serveur est
  injoignable au moment de choisir un profil, l'application affiche « Serveur
  injoignable, réessayez. » et conserve la session. Elle n'oublie la session
  que si le serveur la refuse réellement. Auparavant toute erreur, même un
  simple délai dépassé, effaçait la session et redemandait le mot de passe.
- **Chargement infini après un changement de piste audio en pause.** L'indicateur
  de chargement restait affiché indéfiniment par-dessus une vidéo pourtant
  prête ; il fallait quitter la lecture.
- **Focus après un choix dans les menus Audio, Sous-titres ou Qualité.** Le
  focus revient désormais toujours sur le bouton d'origine, y compris après un
  rechargement du flux. Il pouvait auparavant se retrouver sur la barre de
  progression.
- **Sous-titres forcés français perdus selon le chemin de lecture.** Lorsque la
  lecture passe par le serveur (remux ou transcodage), Jellyfin ne met aucun
  sous-titre dans le flux. Un même fichier démarrait donc sans ses sous-titres
  forcés, puis les retrouvait après un changement de piste audio. Ils sont
  maintenant demandés au serveur dans tous les cas de flux progressif.
  - Un choix explicite de l'utilisateur, y compris « Aucun », n'est jamais
    écrasé.
  - La coche du menu Sous-titres reflète le sous-titre réellement présent dans
    le flux.
  - Non concerné : mode Original, flux HLS.

### Propre à ce fork

- Identité distincte du paquet : « ReDeFin-CM », identifiant `com.cm.redefin`.
  L'application s'installe à côté du ReDeFin officiel et ne partage pas ses
  réglages ; il faut reconfigurer le serveur et se reconnecter une fois.
- L'annonce de mise à jour au démarrage lit le fichier `updates/manifest.json`
  de ce fork et non plus celui du dépôt officiel. Elle ne propose donc jamais
  une version officielle, et n'ouvre plus la fiche Free Store de ReDeFin.
- La version affichée dans « À propos » et transmise à Jellyfin est 0.9.7, en
  accord avec le paquet (la version officielle 0.9.7 affiche encore 0.9.6).
