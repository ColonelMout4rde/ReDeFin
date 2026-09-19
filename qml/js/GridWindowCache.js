/* GridWindowCache.js — cache pur (aucune dépendance Qt) de la dernière
 * fenêtre affichée d'une grille de bibliothèque (moviepage.qml).
 *
 * Constat (docs/audit-navigation/reseau.md F1, docs/audit-navigation/grilles.md
 * F1) : ShellPage recrée moviepage à chaque retour d'une fiche, qui refait
 * systématiquement sa requête et reconstruit toutes les vignettes. Mesuré sur
 * Freebox Révolution (MESURES.md) : 1,34 s de retour à la grille, dont 0,26 s
 * de réseau et 0,5 s de recréation des vignettes.
 *
 * Ce module contient TOUTE la décision (clé, fraîcheur, signature de contenu,
 * réaffectation ou non) ; moviepage.qml ne fait qu'appeler ces fonctions et
 * stocke les entrées via le mécanisme de mémoire bornée existant
 * (Jellyfin.putBoundedMemory, déjà utilisé par ShellPage/moviepage pour
 * focusMemory et les instantanés de fiche) — voir MAX_ENTRIES ci-dessous.
 *
 * Le cache vit dans shared.__focusState (un sous-objet à lui, voir
 * moviepage.qml::_windowCacheBucket), qui est déjà entièrement remis à zéro
 * par ShellPage._resetUiFocusStateForProfilePicker() à l'entrée sur
 * LoginPage.qml — donc à chaque changement de profil. Ce chemin ne couvre
 * PAS le changement de serveur passant par serverpage.qml (celui-ci est
 * explicitement exclu de ce reset). La clé inclut donc en plus serverUrl et
 * userId : une entrée d'un autre serveur ou d'un autre profil ne peut jamais
 * être choisie, elle attend simplement son éviction (LRU à 2 entrées ou TTL).
 */
.pragma library

// Nombre d'entrées conservées (une par grille visitée récemment dans la
// session). Volontairement petit : ce cache sert un retour immédiat, pas un
// historique de navigation.
var MAX_ENTRIES = 2;

// Durée de vie d'une entrée. Passé ce délai, elle est traitée comme absente
// (statut "stale") : mieux vaut un chargement normal qu'un très vieil état
// vu/non-vu affiché puis corrigé après coup.
var TTL_MS = 120000;

/**
 * Construit la clé d'une fenêtre de grille. Un tri ou un filtre différent
 * doit produire une clé différente : ils changent le contenu de la fenêtre.
 * filtersKey est une chaîne libre laissée à l'appelant (aucun filtre de
 * grille n'existe aujourd'hui dans moviepage.qml ; le paramètre existe pour
 * ne pas avoir à changer la forme de la clé le jour où il en existera un).
 */
function cacheKey(serverUrl, userId, folderId, libraryMode, sortMode, filtersKey) {
    return [
        String(serverUrl || ""),
        String(userId || ""),
        String(folderId || ""),
        String(libraryMode || ""),
        String((sortMode | 0)),
        String(filtersKey || "")
    ].join("|");
}

// Signature d'UN item, restreinte aux champs que LibraryPosterCard affiche
// réellement (voir moviepage.qml : movieLibraryDelegate.watched/unread/
// resumeRatio, eux-mêmes MediaCatalog.isPlayedItem/unreadCount/
// resumeProgressRatioFor) : vu, position de reprise, compteur de non-vus.
// Ni IsFavorite ni aucun autre champ UserData n'est lu par la carte de
// grille (contrairement à la fiche détail) : les inclure grossirait la
// signature sans jamais changer la décision de réaffectation.
function _itemSignature(it) {
    if (!it) return "";
    var ud = it.UserData || {};
    var played = (ud.Played === true || it.Played === true) ? 1 : 0;
    var pos = (ud.PlaybackPositionTicks !== undefined) ? ud.PlaybackPositionTicks : it.PlaybackPositionTicks;
    var unplayed = (ud.UnplayedItemCount !== undefined) ? ud.UnplayedItemCount
                 : (it.UnplayedItemCount !== undefined) ? it.UnplayedItemCount
                 : it.RecursiveUnplayedItemCount;
    pos = Number(pos) || 0;
    unplayed = Number(unplayed) || 0;
    return String(it.Id || "") + ":" + played + ":" + pos + ":" + unplayed;
}

/**
 * Signature du contenu affiché par une fenêtre d'items : deux fenêtres avec
 * la même signature affichent exactement la même chose à l'écran (mêmes
 * items, dans le même ordre, mêmes badges vu/reprise/non-vus). Le nombre
 * d'items fait partie de la signature pour distinguer un ajout/retrait.
 */
function computeSignature(items) {
    if (!items || !items.length) return "0|";
    var parts = [];
    for (var i = 0; i < items.length; i++) parts.push(_itemSignature(items[i]));
    return items.length + "|" + parts.join(",");
}

/**
 * Lit une entrée de cache. windowStartIndex est l'index de fenêtre attendu
 * (calculé par moviepage à partir de la cible de restauration courante) :
 * une entrée qui correspond à une autre portion de la bibliothèque est
 * traitée comme absente plutôt que comme périmée, ce n'est pas la même
 * fenêtre. Renvoie { status: "hit"|"miss"|"stale", entry }.
 */
function readEntry(bucket, key, nowMs, expectedWindowStart) {
    var entry = (bucket && key) ? bucket[key] : null;
    if (!entry) return { status: "miss", entry: null };

    var age = nowMs - (Number(entry.ts) || 0);
    if (!(age >= 0) || age >= TTL_MS) return { status: "stale", entry: null };

    if (expectedWindowStart !== undefined && expectedWindowStart !== null &&
            (Number(entry.windowStartIndex) | 0) !== (Number(expectedWindowStart) | 0)) {
        return { status: "miss", entry: null };
    }

    return { status: "hit", entry: entry };
}

/**
 * Construit l'entrée à stocker. items est la fenêtre déjà décorée telle
 * qu'elle vit dans moviepage._rawFolderItems (moviepage n'a donc rien à
 * recalculer pour écrire dans le cache).
 */
function buildEntry(nowMs, windowStartIndex, nextStart, hasMore, hasPrevious, items) {
    var win = items || [];
    return {
        ts: nowMs,
        windowStartIndex: windowStartIndex | 0,
        nextStart: nextStart | 0,
        hasMore: hasMore === true,
        hasPrevious: hasPrevious === true,
        rawItems: win,
        signature: computeSignature(win)
    };
}
