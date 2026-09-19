/* HomeResidency.js — décision pure « que faire de l'accueil résident » de
 * ShellPage.qml.
 *
 * Constat mesuré sur Freebox Révolution (docs/audit-navigation, shell F2) :
 * même avec son type QML en cache, reconstruire l'accueil à chaque retour
 * coûte ~3,7 s : 1,3 s de recréation synchrone des cartes, 1,5 s de
 * restauration du focus et de minuteries, 0,5 s d'attente des affiches. Or
 * l'accueil est le carrefour de toute la navigation.
 *
 * ShellPage garde donc HomePage dans un second Loader, caché et désactivé
 * pendant qu'une grille ou une fiche occupe l'écran. HomePage sait déjà être
 * réaffichée (son onVisibleChanged traite le « retour externe » : rideau,
 * rafraîchissement différé, focus).
 *
 * Règles :
 *  - l'accueil n'est chargé que lorsqu'on y navigue ;
 *  - il est DÉTRUIT quand le lecteur s'ouvre (la mémoire va au lecteur, comme
 *    pour toute page) et aux frontières de session (splash, serveur, choix du
 *    profil) : un autre profil ne doit jamais hériter de cet accueil ;
 *  - un accueil d'identité différente (autre ageMax, voir homeKey) est
 *    reconstruit ; deux écritures de la même URL d'accueil ne le sont pas ;
 *  - une page vide (rechargement forcé transitoire de ShellPage) ne change rien.
 *
 * Aucun état global mutable : l'appelant conserve { source, page }.
 */
.pragma library

var HOME_BASE = "homepage.qml";
var BOUNDARY_BASES = ["splashpage.qml", "loginpage.qml", "serverpage.qml"];

function _trim(value) {
    return String(value === undefined || value === null ? "" : value).replace(/^\s+|\s+$/g, "");
}

function baseOf(url) {
    return _trim(url).split("?")[0];
}

function isHomePage(page) {
    return baseOf(page).toLowerCase() === HOME_BASE;
}

/* Identité d'un accueil : seuls les paramètres qui changent ce qu'il affiche
 * comptent. ShellPage navigue vers « HomePage.qml?ctx=1 » (login, grille) ou
 * vers « HomePage.qml?ctx=1&ageMax=99 » (retour arrière sur pile vide) : c'est
 * le même accueil, il ne doit pas être reconstruit. ageMax vaut 99 par défaut. */
function homeKey(page) {
    var p = _trim(page);
    var q = p.indexOf("?");
    var ageMax = "99";
    if (q >= 0) {
        var parts = p.substring(q + 1).split("&");
        for (var i = 0; i < parts.length; ++i) {
            var kv = parts[i].split("=");
            if (kv[0] === "ageMax" && kv.length > 1 && kv[1].length) ageMax = kv[1];
        }
    }
    return "ageMax=" + ageMax;
}

function createState() {
    return { source: "", page: "" };
}

function _isBoundary(baseLower) {
    for (var i = 0; i < BOUNDARY_BASES.length; ++i)
        if (BOUNDARY_BASES[i] === baseLower) return true;
    return false;
}

function _result(source, page, shown, blankFirst, arm, resumed) {
    return {
        source: source,       // source du Loader d'accueil ("" = détruit)
        page: page,           // URL d'accueil qui a construit l'instance
        shown: shown,         // l'accueil occupe l'écran
        blankFirst: blankFirst, // détruire maintenant, rappeler plan() au tour suivant
        arm: arm,             // armer le rideau de page avant de charger
        resumed: resumed      // instance existante simplement réaffichée
    };
}

/*
 * plan(state, page, playerActive, enabled)
 *   page : currentPage du shell, sans paramètres sensibles.
 */
function plan(state, page, playerActive, enabled) {
    var curSource = _trim(state && state.source);
    var curPage = _trim(state && state.page);
    var nextPage = _trim(page);
    var base = baseOf(nextPage);
    var baseLower = base.toLowerCase();

    if (enabled !== true || playerActive === true || _isBoundary(baseLower))
        return _result("", "", false, false, false, false);

    if (!baseLower.length)
        return _result(curSource, curPage, false, false, false, false);

    if (baseLower !== HOME_BASE)
        return _result(curSource, curPage, false, false, false, false);

    if (!curSource.length)
        return _result(base, nextPage, true, false, true, false);

    if (homeKey(curPage) === homeKey(nextPage))
        return _result(curSource, curPage, true, false, false, true);

    // Autres paramètres : on reconstruit, en deux temps.
    return _result("", "", false, true, false, false);
}
