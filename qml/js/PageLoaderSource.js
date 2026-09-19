/* PageLoaderSource.js — décision pure « quelle source donner au Loader de
 * page » de ShellPage.qml.
 *
 * Constat mesuré sur Freebox Révolution (docs/audit-navigation, shell F1) :
 * le cache de types QML de Qt 5.15 est indexé par l'URL COMPLÈTE, query
 * comprise. ShellPage donnait au Loader « detailSeriePage.qml?ctx=1&itemId=… » :
 * chaque item, chaque « startIndex » de retour de grille était donc une URL
 * neuve, et le fichier de ~2 800 lignes était re-téléchargé, ré-analysé et
 * recompilé à chaque navigation (1,1 à 1,6 s mesurées entre Loader.Loading et
 * Loader.Ready). Avec une URL strictement identique à une visite précédente,
 * la même page était construite en ~110 ms.
 *
 * Les paramètres de la query ne servent à rien pour le Loader : ShellPage les
 * réinjecte en propriétés dans onLoaded (_loadedPageParams). On charge donc la
 * page par son URL de base. Deux conséquences que ce module gère :
 *  - même composant, autres paramètres (film A -> film B) : la source ne
 *    change plus, il faut donc vider le Loader puis le recharger (blankFirst) ;
 *  - un type en cache se construit sans que le Loader passe par l'état
 *    Loading : le rideau de page ne peut plus être armé sur ce signal, il est
 *    armé explicitement à chaque changement de page (arm).
 * Le retour du lecteur (seul playerActive change) ne réarme pas le rideau :
 * comportement historique conservé.
 *
 * Aucun état global mutable : l'appelant conserve { source, page } et le
 * repasse à chaque appel.
 */
.pragma library

function _trim(value) {
    return String(value === undefined || value === null ? "" : value).replace(/^\s+|\s+$/g, "");
}

function baseOf(url) {
    return _trim(url).split("?")[0];
}

/* URL donnée au Loader pour une page de navigation. useBaseUrl=false rend
 * l'ancien comportement (URL complète), pour un retour arrière en une ligne. */
function sourceFor(page, useBaseUrl) {
    var p = _trim(page);
    if (!p.length) return "";
    return useBaseUrl === false ? p : baseOf(p);
}

function createState() {
    return { source: "", page: "" };
}

/*
 * plan(state, page, playerActive, useBaseUrl)
 *   -> { source, page, blankFirst, arm, noop }
 *
 * state        : { source, page } tels que renvoyés par l'appel précédent.
 * page         : currentPage du shell (déjà débarrassée des paramètres sensibles).
 * playerActive : le lecteur occupe l'écran, le Loader doit être vide.
 *
 * source/page  : nouvel état à conserver (si blankFirst, c'est l'état VIDE
 *                intermédiaire ; l'appelant rappelle plan() au tour suivant).
 * blankFirst   : vider le Loader maintenant, recharger au tour suivant.
 * arm          : armer le rideau de page avant d'affecter la source.
 * noop         : rien à faire.
 */
function plan(state, page, playerActive, useBaseUrl) {
    var curSource = _trim(state && state.source);
    var curPage = _trim(state && state.page);
    var nextPage = _trim(page);
    var want = playerActive === true ? "" : sourceFor(nextPage, useBaseUrl);

    if (!want.length) {
        // Lecteur actif : on garde la page mémorisée, pour que son retour ne
        // soit pas pris pour une navigation. Page vide : on l'oublie.
        return {
            source: "",
            page: playerActive === true ? curPage : "",
            blankFirst: false,
            arm: false,
            noop: !curSource.length && (playerActive === true || !curPage.length)
        };
    }

    if (curSource === want) {
        if (curPage === nextPage)
            return { source: curSource, page: curPage, blankFirst: false, arm: false, noop: true };
        // Même composant, autres paramètres : rechargement forcé en deux temps.
        return { source: "", page: curPage, blankFirst: true, arm: false, noop: false };
    }

    return {
        source: want,
        page: nextPage,
        blankFirst: false,
        arm: curPage !== nextPage,
        noop: false
    };
}
