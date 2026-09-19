# ReDeFin-CM

> [!IMPORTANT]
> **Ceci n'est pas ReDeFin.** ReDeFin-CM est un fork personnel et non officiel de
> [ReDeFin](https://github.com/laborantine/ReDeFin), le client Jellyfin pour
> Freebox Player développé par **Laborantine**.
>
> - Vous cherchez l'application, la bêta ou le support : tout se passe sur le
>   [dépôt officiel](https://github.com/laborantine/ReDeFin).
> - Ce fork n'est **pas distribué publiquement**, n'a pas de programme de
>   bêta-test et n'offre aucun support.
> - Un problème constaté avec ReDeFin-CM ne doit **pas** être signalé à
>   Laborantine : il peut venir des modifications de ce fork.

## Pourquoi ce fork

ReDeFin ne s'installe que par le Free Store. Il n'existe aucun moyen d'installer
un paquet sur un Freebox Player en dehors du Free Store : le mode développeur ne
permet qu'un lancement éphémère depuis un PC. Pour utiliser au quotidien des
correctifs qui ne sont pas (ou pas encore) dans la version officielle, il faut
donc déposer un paquet distinct sur le Free Factory.

ReDeFin-CM est ce paquet. Il porte sa propre identité afin de cohabiter avec le
ReDeFin officiel dans « Mes Applications », sans partager ni tuile ni réglages :

| | ReDeFin (officiel) | ReDeFin-CM (ce fork) |
|---|---|---|
| Auteur | Laborantine | ColonelMout4rde |
| Identifiant Free Store | `com.lab.redefin` | `com.cm.redefin` |
| Disponibilité | bêta fermée, sur candidature auprès de Laborantine | bêta privée, réservée à la Freebox de l'auteur |
| Annonce de mise à jour | `updates/manifest.json` du dépôt officiel | `updates/manifest.json` de cette branche |

## Ce qui change par rapport à ReDeFin

Le détail est dans [CHANGELOG.md](CHANGELOG.md). En résumé :

- l'écran « Qui regarde ? » réagit au premier appui sur OK ;
- changer de piste audio, de sous-titres ou de qualité pendant une pause ne
  bloque plus la lecture sur un chargement infini ;
- un réglage « Sortie audio » (Multicanal / Stéréo) pour les installations sans
  système 5.1 ;
- les sous-titres forcés français sont conservés quel que soit le chemin de
  lecture.

Les correctifs d'intérêt général sont proposés à Laborantine. Ce fork n'a pas
vocation à diverger : il suit les versions officielles et ne garde en propre
que ce qui n'a pas été repris.

## Branches

| Branche | Rôle |
|---|---|
| `main` | miroir des sources officielles (extraites des paquets `.fbxqml` publiés) et correctifs proposés à Laborantine ; conserve l'identité `com.lab.redefin` |
| `dev` | fonctionnalités en cours de validation |
| `CM/factory` | **production** : le paquet ReDeFin-CM déposé sur le Free Factory |

Les fusions vont toujours de `main` ou `dev` vers `CM/factory`, jamais l'inverse.

## Construire et tester

Rien n'est compilé : un paquet `.fbxqml` est une archive des sources QML/JS.

```bash
./check.sh                                    # lint, tests Node, Qt Quick et Python
./build.sh -o build/ReDeFin-CM_0.9.7.fbxqml   # paquet à déposer sur le Free Factory
python3 tools/fbx-run.py -t <ip-du-player>    # lancement direct sur un Player en mode développeur
```

[CONTRIBUTING.md](CONTRIBUTING.md) décrit les prérequis, les tests et le mode
développeur du Player (Réglages > Système > Mode développeur).

## Crédits et licence

ReDeFin est l'œuvre de **Laborantine**, que ce fork ne fait que prolonger :
[github.com/laborantine/ReDeFin](https://github.com/laborantine/ReDeFin). Si
l'application vous est utile, c'est ce projet qu'il faut soutenir.

Les modifications propres à ce fork ont été réalisées par ColonelMout4rde avec
l'aide de Claude Code.

Distribué sous licence GPL-3.0, comme le projet d'origine. Voir [LICENSE](LICENSE).

ReDeFin et ReDeFin-CM sont des projets non officiels, sans lien avec Jellyfin
ni avec Free.
