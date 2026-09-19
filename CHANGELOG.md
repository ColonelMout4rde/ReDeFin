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

### Navigation plus rapide

La navigation dans les menus a été mesurée sur une Freebox Révolution, écran
par écran, puis reprise. Temps entre l'appui sur OK et la page utilisable :

| Parcours | Premier relevé | Cette version |
| --- | --- | --- |
| Ouvrir la fiche d'un film (à partir du 2ᵉ de la session) | 2,6 s | 0,7 à 1,0 s |
| Ouvrir la fiche d'une série (à partir de la 2ᵉ) | 2,5 s | 0,6 s |
| Ouvrir une bibliothèque (à partir de la 2ᵉ) | 2,4 s | 1,1 s |
| Revenir d'une fiche à la bibliothèque | 2,2 s | 1,2 s |
| Revenir à l'accueil depuis une bibliothèque ou une fiche | 3,7 s | 1,4 s |
| Page d'une saison (1ʳᵉ de la session) | 3,4 s | 2,7 s |
| Accueil au lancement | 5,6 s | 5,2 s |

Le premier relevé a été fait après une première série de corrections : la
version officielle est au moins aussi lente que cette colonne. Non mesuré mais
corrigé : la fiche d'une série entièrement vue restait 2,6 s de plus sur
l'indicateur de chargement (voir « Corrigé »).

La toute première fiche film, fiche série, bibliothèque ou saison d'une session
reste plus longue (2 à 2,7 s) : le Player doit lire une fois chaque écran. Le
retour à l'accueil après la lecture d'une vidéo n'a pas changé (environ 3,8 s) :
l'accueil est libéré pendant la lecture pour laisser la mémoire au lecteur.

Ce qui a changé :

- **Les pages s'affichent dès qu'elles sont utilisables, les images arrivent
  ensuite.** L'indicateur de chargement attendait que tout soit décodé : fond,
  logo, affiches voisines, rangées secondaires. Il ne protège plus que ce qui
  gênerait vraiment : focus non posé, saut de mise en page. Les affiches et
  les fonds apparaissent en fondu dans la page déjà affichée.
- **Un écran déjà visité n'est plus relu à chaque fois.** Chaque film, chaque
  retour dans une bibliothèque faisait relire et préparer l'écran complet par
  le Player : 1,1 à 1,6 s mesurées à chaque navigation, contre 0,1 s
  désormais. C'est le gain le plus important.
- **L'accueil reste en mémoire** pendant la visite d'une bibliothèque ou d'une
  fiche et réapparaît tel qu'on l'a quitté, sans être reconstruit. Il est
  toujours libéré pendant la lecture et au changement de profil.
- **Accueil** : affiché dès que « Mes médias », « Reprendre » et « À suivre »
  sont prêts, les rangées « Récemment ajouté » arrivent ensuite en une fois ;
  une seconde d'attente fixe supprimée ; remonter vers une rangée « Récemment
  ajouté » éloignée n'affiche plus « Rechargement… ».
- **Bibliothèques** : au retour d'une fiche, la grille déjà consultée
  s'affiche depuis la mémoire puis se met à jour si quelque chose a changé
  (vu, reprise, nouveaux titres) ; l'attente de 1,1 s de stabilisation a
  disparu ; glissement plus régulier dans les grandes grilles, la rangée
  suivante est prête avant la fin du glissement.
- **Fiches film, série et collection** : affichées dès que l'en-tête est
  prêt ; « À suivre », Saisons, Distribution et Titres similaires
  apparaissent juste après, à leur place réservée ; le fond part 0,3 s plus
  tôt ; le logo est demandé à sa taille d'affichage (il l'était en 900 × 900) ;
  les saisons sont demandées en même temps que la série.
- **Page d'une saison** : affichée dès que les épisodes sont prêts, sans
  délai minimal ; les flèches répondent dès l'ouverture.
- **Moins de requêtes et de données** : une requête en moins pour les
  chapitres d'un film et pour les saisons d'une série ; la durée moyenne des
  épisodes ne télécharge plus la liste complète des épisodes à chaque
  ouverture (elle peut être très légèrement moins exacte) ; les informations
  techniques du titre sélectionné dans une bibliothèque passent par une
  requête bien plus légère ; les listes ne demandent que les types d'images
  affichés ; l'avatar du profil et les affiches de l'accueil sont demandés à
  leur taille d'affichage.

Non testé sur Freebox Delta / Devialet. Le lecteur vidéo n'est pas concerné.

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

- **Vidéo réencodée pour rien quand seul le son est illisible (Révolution).**
  En mode Automatique, une piste DTS, E-AC3 ou TrueHD faisait réencoder toute
  la vidéo en H.264 sur le serveur, alors que le mode Original se contentait de
  convertir le son. Une vidéo que la Révolution sait lire (H.264, 8 bits,
  1080p au plus) est maintenant copiée telle quelle et seul l'audio est
  converti en AC3 : démarrage plus rapide, image d'origine, serveur bien moins
  sollicité. Tout motif vidéo (HEVC, 10 bits, 4K, AV1…), plus de 6 canaux ou
  un débit imposé gardent le transcodage complet. Validé sur Révolution en
  sortie Stéréo (image fluide, son synchronisé, reprise et changement de piste
  compris) ; la sortie Multicanal suit le même chemin mais n'a pas été essayée.
- **Sous-titres ASS/SSA choisis sur Révolution.** Le profil envoyé à Jellyfin
  ne les déclarait pas, ce qui lui faisait préparer une incrustation dans
  l'image. Ils sont maintenant demandés embarqués dans le flux, comme les SRT.
  *Affichage à confirmer sur boîtier.*
- **Session perdue à cause d'un reverse proxy.** Une page d'erreur HTML ou une
  réponse tronquée, renvoyée avec un statut 200, était prise pour un refus du
  jeton : la session mémorisée était effacée et le mot de passe redemandé.
  L'application affiche désormais « Serveur injoignable, réessayez. » et garde
  la session.
- **« Derniers ajouts » rechargés à chaque retour sur l'accueil.** Ces rangées
  n'étaient gardées en mémoire que 2,5 s au lieu des 120 s prévues.
- **Lecture invisible pour Jellyfin quand la durée du média est inconnue**
  (direct, enregistrement en cours) : ni « en cours de lecture », ni point de
  reprise, ni marquage « vu ». Les rapports de lecture partent maintenant dans
  tous les cas.
- **Avance rapide pendant un changement de piste.** Appuyer sur avancer ou
  choisir un chapitre pendant que le flux se rouvre provoquait une seconde
  réouverture complète, ou faisait repartir la lecture du début après un
  « Reprendre ». La lecture vise maintenant directement la dernière position
  demandée.
- **Média sans piste audio à transcoder.** L'adresse de lecture demandait à la
  fois un transcodage et le fichier brut ; Jellyfin aurait renvoyé l'original,
  par exemple un HEVC 4K illisible sur Révolution.
- **Déconnexion d'un profil conservé.** La session restait utilisable en
  mémoire jusqu'à la fermeture de l'application.
- **Nom du serveur remplacé par son adresse** (`192.168.x.y:8096`) dans la
  liste des serveurs après la première connexion.
- **Serveur en double selon la casse de l'adresse.** `HTTP://Serveur:8096` et
  `http://serveur:8096` désignent maintenant le même serveur. Si l'adresse
  avait été saisie avec des majuscules, le mot de passe est redemandé une fois.
- **Fiche d'une série entièrement vue bloquée 2,6 s sur le chargement.** La
  fiche attendait la rangée « À suivre », vide dans ce cas, jusqu'à
  l'expiration d'un délai de garde. Elle s'affiche maintenant dès que la
  réponse est arrivée.
- **Bibliothèque en panne masquée dix minutes sur l'accueil.** Après une erreur
  du serveur sur une bibliothèque, sa rangée « Récemment ajouté » n'était plus
  redemandée pendant 10 min ; ce délai passe à 2 min.
- Corrections sans effet visible attendu : un seul paramètre
  d'authentification dans l'adresse de lecture, plafond de canaux audio aligné
  sur le boîtier pour les DVD avec sous-titres image, profil matériel retiré
  pour un modèle de boîtier inconnu.

### Propre à ce fork

- Identité distincte du paquet : « ReDeFin-CM », identifiant `com.cm.redefin`.
  L'application s'installe à côté du ReDeFin officiel et ne partage pas ses
  réglages ; il faut reconfigurer le serveur et se reconnecter une fois.
- L'annonce de mise à jour au démarrage lit le fichier `updates/manifest.json`
  de ce fork et non plus celui du dépôt officiel. Elle ne propose donc jamais
  une version officielle, et n'ouvre plus la fiche Free Store de ReDeFin.
- La version affichée dans « À propos » et transmise à Jellyfin est 0.9.7, en
  accord avec le paquet (la version officielle 0.9.7 affiche encore 0.9.6).
