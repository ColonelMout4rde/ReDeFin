#!/usr/bin/env python3
"""
run_qml_tests.py - Exécute tous les tests Qt Quick Test (tests/qml/tst_*.qml)
en mode headless, via le module Python PySide6.QtQuickTest.

Usage :
    python3 tests/qml/run_qml_tests.py

Ce script est appelé par check.sh, mais peut aussi être lancé seul (il faut
alors que le venv Qt (voir tools/setup-qt-tools.sh) soit sur le PYTHONPATH,
ce qui est le cas si on utilise l'interpréteur du venv directement :

    ~/.cache/redefin-qttools/venv/bin/python3 tests/qml/run_qml_tests.py

QUICK_TEST_MAIN() découvre et exécute TOUS les fichiers tst_*.qml présents
dans le répertoire donné (ici : le répertoire de ce script), les agrège en
une seule session de test, et renvoie un code de sortie non nul si au moins
un test a échoué.

Limite connue : ceci exécute les tests sous Qt 6 (PySide6), alors que la
Freebox exécute Qt 5.15 sans les modules fbx.*. Voir tests/README.md.
"""
import os
import sys

# Headless obligatoire : pas de serveur d'affichage disponible en CI/sandbox.
os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
# Filet de sécurité : certains environnements sans GPU/logiciel Mesa complet
# n'arrivent pas à initialiser le backend RHI par défaut de QtQuick pour le
# rendu offscreen. Le backend logiciel évite ce genre de soucis.
os.environ.setdefault("QT_QUICK_BACKEND", "software")

TESTS_QML_DIR = os.path.dirname(os.path.abspath(__file__))


def main():
    try:
        from PySide6.QtQuickTest import QUICK_TEST_MAIN
    except ImportError as exc:
        sys.stderr.write(
            "Erreur : impossible d'importer PySide6.QtQuickTest ({}).\n"
            "Lancez d'abord tools/setup-qt-tools.sh, ou exécutez ce script "
            "avec l'interpréteur du venv Qt "
            "(ex: ~/.cache/redefin-qttools/venv/bin/python3).\n".format(exc)
        )
        return 1

    # "redefin-qml-tests" est juste un nom de session affiché dans les logs ;
    # le répertoire donné en 3e argument est celui où QUICK_TEST_MAIN va
    # chercher tous les fichiers tst_*.qml à exécuter (non récursif).
    return QUICK_TEST_MAIN("redefin-qml-tests", sys.argv, TESTS_QML_DIR)


if __name__ == "__main__":
    sys.exit(main())
