# Tests et vérifications ReDeFin

Ce dossier contient le harnais de test du dépôt. Il ne fait partie d'aucun
paquet `.fbxqml` : `build.sh` n'embarque que la liste blanche déclarée dans
`ReDeFin.fbxproject` (racine, `qml/components`, `qml/pages`, `qml/js`,
`qml/images`, `manifest.json`...), qui ne référence jamais `tests/` ni
`tools/`.

## Installation des outils

Aucun Qt système n'est requis. Un environnement virtuel Python autonome
fournit `qmllint`, le runtime `qml` et le module `QtQuickTest`, via le
paquet PyPI `PySide6-Essentials` :

```sh
./tools/setup-qt-tools.sh
```

Ceci crée (ou met à jour) un venv dans `~/.cache/redefin-qttools/venv`.
Pour utiliser un autre emplacement :

```sh
REDEFIN_QT_VENV=/chemin/vers/mon-venv ./tools/setup-qt-tools.sh
REDEFIN_QT_VENV=/chemin/vers/mon-venv ./check.sh
```

Node.js (avec `node --test` intégré, Node ≥ 18) doit être disponible dans le
`PATH` pour les étapes JavaScript.

## Lancer toutes les vérifications

Depuis la racine du dépôt :

```sh
./check.sh
```

Enchaîne : lint syntaxique de tous les `.qml`, vérification syntaxique de
tous les `.js` de `qml/js`, tests unitaires Node (`tests/js`) et tests
Qt Quick Test headless (`tests/qml`). Voir `./check.sh -h` pour les options
(`--no-lint`, `--no-tests`).

## Écrire un test Node (bibliothèques JS de qml/js)

Les bibliothèques `qml/js/*.js` utilisent la syntaxe QML (`.pragma
library`, `.import "Fichier.js" as Alias`), qui n'est pas du JavaScript
valide pour Node. Le chargeur `tests/js/qmljs.js` permet de les importer
tel quel, sans les modifier :

```js
const { loadQmlJs } = require('./qmljs');

const SafeLog = loadQmlJs('qml/js/SafeLog.js');
SafeLog.safeErrorCode('timeout'); // "timeout"
```

- `loadQmlJs(relPathFromRepoRoot, options?)` résout et charge récursivement
  les `.import` du module (relatifs au fichier qui les déclare), avec un
  cache pour ne charger chaque fichier qu'une fois.
- `options.stubs` permet d'injecter des globales absentes de Node mais
  fournies par le runtime QML (`Qt`, `XMLHttpRequest`, une horloge figée via
  un `Date` de substitution...) :

  ```js
  const mod = loadQmlJs('qml/js/UserStore.js', {
      stubs: {
          Qt: { md5: (s) => '...' },
          XMLHttpRequest: class { /* ... */ },
      },
  });
  ```

Voir `tests/js/qmljs.test.js` pour deux exemples complets : un module sans
`.import` (`SafeLog.js`) et un module avec résolution récursive
(`JellyfinPlaybackRouter.js`).

Pour lancer uniquement les tests Node :

```sh
node --test tests/js/*.test.js
```

(`node --test tests/js/` avec un simple chemin de répertoire n'est pas
fiable selon la version de Node installée : `check.sh` liste donc
explicitement les fichiers `*.test.js`.)

## Écrire un test QML (Qt Quick Test)

Un test QML est un fichier `tests/qml/tst_*.qml` basé sur `TestCase` de
`QtTest` :

```qml
import QtQuick 2.15
import QtTest 1.2

TestCase {
    name: "MonTest"
    function test_quelquechose() {
        compare(1 + 1, 2)
    }
}
```

`tests/qml/run_qml_tests.py` découvre et exécute tous les
`tests/qml/tst_*.qml` en une seule session, en headless
(`QT_QPA_PLATFORM=offscreen`), via `PySide6.QtQuickTest.QUICK_TEST_MAIN`, et
renvoie un code de sortie non nul si un test échoue. Voir
`tests/qml/tst_smoke.qml` pour un exemple minimal chargeant un composant
réel du projet (`qml/components/CircleDotsLoader.qml`).

Pour lancer uniquement les tests QML :

```sh
~/.cache/redefin-qttools/venv/bin/python3 tests/qml/run_qml_tests.py
```

## Limite connue

Le lint (`qmllint`) et les tests Qt Quick Test tournent sous **Qt 6**
(via PySide6), alors que la Freebox exécute le code sous **Qt 5.15**, sans
les modules `fbx.*` du firmware (`fbx.hardware`, etc., non disponibles hors
de la Freebox). Conséquences :

- `qmllint` émet un grand nombre d'avertissements non bloquants sur les
  fichiers de `main.qml`/`qml/**` : imports `fbx.*` introuvables
  (`[import]`), accès non qualifiés (`[unqualified]`), propriétés
  manquantes sur les objets fournis par le firmware (`[missing-property]`),
  etc. C'est attendu : `check.sh` ne fait échouer le lint que sur les
  véritables erreurs de syntaxe (`[syntax]`), qui sont indépendantes de la
  version de Qt.
- Un composant ou test QML qui dépend directement d'un module `fbx.*` ne
  peut pas être testé avec ce harnais headless (le module n'existe que sur
  le firmware Freebox). Les tests QML de ce dossier se limitent donc à des
  composants/bibliothèques qui n'en dépendent pas directement (ex:
  `CircleDotsLoader.qml`), ou nécessitent des stubs/mocks côté appelant.
- Ce harnais ne remplace donc pas un test sur Freebox réelle avant
  publication : il attrape les erreurs de syntaxe et les régressions de
  logique pure, pas les problèmes spécifiques au runtime Qt 5.15/fbx.*.
