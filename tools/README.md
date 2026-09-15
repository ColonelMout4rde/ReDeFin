# tools/

## fbx-run.py

Lance à distance l'application QML sur un Freebox Player (Révolution) placé
en « mode développeur », sans passer par Qt Creator ni le FreeStore.

Portage Python 3 (stdlib uniquement, `zeroconf` optionnel) du script
`fbx-qml-run` (Python 2.7, dépôt Free `freebox-dev-utils`, 2014) et du
plugin QtCreator `freebox-qtcreator-plugin` (même année) — seules sources
connues documentant ce protocole non officiel.

### Usage

```
tools/fbx-run.py -t 192.168.1.42
```

Sert `manifest.json` (racine du dépôt, ou chemin donné en argument) et
lance le point d'entrée `main`. Ctrl-C arrête proprement le script.

Options utiles :

```
tools/fbx-run.py --help
```

- `-t/--target IP` : adresse du Player (sinon découverte mDNS
  `_fbx-devel._tcp.local.`, module `zeroconf` optionnel).
- `-p/--port PORT` : port du serveur HTTP local (défaut 8234).
- `-b/--bind IP` : adresse locale annoncée au Player (défaut : détectée
  automatiquement).
- `-e/--entry NOM` : point d'entrée du manifeste à lancer (défaut `main`).
- `--wait` : demande au Player d'attendre un débogueur.
- `-v/--verbose` : journalise chaque requête HTTP du Player (utile pour
  voir quels fichiers il charge réellement).
- `--timeout SECONDES` : délai JSON-RPC (défaut 10 s).
- `--player-port PORT` : port du protocole côté Player (défaut 80 ; ne
  sert qu'aux tests avec un faux Player sur un port libre).

### Protocole (déduit du code Free 2014, non documenté officiellement)

1. Le script détermine son adresse IP locale vue du Player (connexion TCP
   vers `<player>:80`, puis `getsockname()`), sauf si `-b` est fourni.
2. Il démarre un serveur HTTP local (threadé, sans cache) qui sert le
   répertoire du manifeste, en refusant `.git/`, `build/`, `tests/`,
   `tools/`, les fichiers cachés et tout chemin hors du répertoire.
3. Il valide le manifeste (mêmes règles que le packager FreeStore) puis
   envoie en POST sur `http://<player>/pub/devel` un JSON-RPC 2.0 :
   méthode `debug_qml_app`, params `manifest_url` (URL du manifeste servi
   à l'étape 2), `entry_point`, `wait`.
4. La réponse contient `qml_port`, `stdout_port`, `stderr_port` : trois
   ports TCP côté Player. Le script se connecte à `stdout_port` et
   `stderr_port` et relaie chaque ligne reçue sur le terminal, préfixée
   `[out]`/`[err]`.
5. Ctrl-C ferme les connexions et arrête le serveur HTTP local.

### WSL2

Le Player doit pouvoir joindre ce PC sur le réseau local pour récupérer le
manifeste et l'application. En réseau NAT (mode par défaut de WSL2), ce
n'est **pas** le cas : l'IP interne de WSL2 n'est pas jointe depuis le LAN.
Trois solutions :

1. Passer WSL2 en réseau miroir : ajouter `networkingMode=mirrored` dans
   `%UserProfile%\.wslconfig`, puis `wsl --shutdown` et rouvrir un
   terminal.
2. Lancer le script directement avec un interpréteur Python Windows (hors
   WSL2), sur le même réseau que le Player.
3. Rester sous WSL2 mais annoncer l'IP Windows avec `-b`, et rediriger le
   port HTTP local vers WSL2 avec, côté Windows en administrateur :
   `netsh interface portproxy add v4tov4 listenaddress=<ip_windows>
   listenport=<port> connectaddress=<ip_wsl2> connectport=<port>`.

### Limites

- Protocole déduit d'un dépôt Free de 2014 : non confirmé sur un firmware
  Player actuel, et **non testé sur un vrai Player** lors de l'écriture de
  ce script (uniquement contre un faux Player simulé dans
  `tests/py/test_fbx_run.py`).
- Ne concerne que le Freebox Player (Révolution) en mode développeur ; sans
  rapport avec le Freebox Pop.
- La découverte mDNS dépend du module tiers `zeroconf` (optionnel).

### Test

```
python3 -m unittest discover -s tests/py -v
```

Test d'intégration avec un faux Player local (aucun réseau externe requis).
