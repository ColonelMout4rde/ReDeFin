"""Garde-fou : un sous-type de threading.Thread ne doit pas masquer un
attribut privé de Thread.

fbx-run.py et son test nommaient « _stop » l'Event d'arrêt de leurs threads.
Jusqu'à Python 3.12, Thread._stop() est une méthode que join() appelle : la
masquer fait échouer join() avec « 'Event' object is not callable », et
fbx-run.py sortait en erreur à la fermeture. Python 3.13 a supprimé cette
méthode, si bien que le défaut était invisible sur un poste en 3.13 et n'est
apparu qu'en CI (3.12). Ce test est statique : il protège quelle que soit la
version de Python qui l'exécute.
"""

import pathlib
import re
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
SOURCES = [ROOT / "tools" / "fbx-run.py", *sorted((ROOT / "tests" / "py").glob("*.py"))]

# Attributs privés de threading.Thread, toutes versions 3.8 à 3.13 confondues.
RESERVED = (
    "_stop", "_started", "_is_stopped", "_tstate_lock", "_target", "_args",
    "_kwargs", "_name", "_ident", "_native_id", "_daemonic", "_initialized",
    "_handle", "_invoke_excepthook", "_bootstrap", "_bootstrap_inner",
    "_delete", "_set_ident", "_set_native_id", "_set_tstate_lock",
    "_wait_for_tstate_lock", "_reset_internal_locks",
)
ASSIGN = re.compile(r"self\.(%s)\s*=[^=]" % "|".join(map(re.escape, RESERVED)))


class ThreadPrivateAttributeTest(unittest.TestCase):
    def test_no_thread_private_attribute_is_shadowed(self):
        offenders = []
        for path in SOURCES:
            if path.name == pathlib.Path(__file__).name:
                continue
            text = path.read_text(encoding="utf-8")
            if "threading.Thread" not in text:
                continue
            for number, line in enumerate(text.splitlines(), 1):
                if ASSIGN.search(line):
                    offenders.append("%s:%d: %s" % (path.relative_to(ROOT), number, line.strip()))
        self.assertEqual(offenders, [], "attribut privé de threading.Thread masqué")


if __name__ == "__main__":
    unittest.main()
