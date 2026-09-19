/* PosterSizing.js — taille d'image à demander au serveur Jellyfin pour un
 * logo/affiche affiché en petit format sur une fiche de détail.
 *
 * Module pur, testable directement avec Node (tests/js/postersizing.test.js).
 *
 * F5 (audit-fiches.md) : le logo (PNG, transparent) était demandé en
 * maxWidth/maxHeight 900 alors qu'il n'est jamais affiché à plus de
 * 207x297 sur la fiche (90 % d'un cadre de 230x330) — 10x plus de pixels
 * que nécessaire à décoder sur l'Atom du Révolution, et cette image fait
 * partie de la garde gatePosterReady qui retient le rideau.
 */
.pragma library

/**
 * Calcule la taille à demander pour une image affichée à
 * displayWidth x displayHeight, majorée d'un facteur de suréchantillonnage
 * (netteté sur les scale de focus) et arrondie au palier supérieur, pour ne
 * pas multiplier les tailles distinctes demandées au serveur (donc les
 * variantes qu'il doit générer et mettre en cache).
 *
 * @param {number} displayWidth largeur affichée, en px.
 * @param {number} displayHeight hauteur affichée, en px.
 * @param {number} [oversample=1.3] facteur de suréchantillonnage.
 * @param {number} [step=80] palier d'arrondi, en px.
 * @returns {{width:number, height:number}}
 */
function requestedImageSize(displayWidth, displayHeight, oversample, step) {
    var os = (oversample === undefined || oversample === null || Number(oversample) <= 0)
        ? 1.3 : Number(oversample);
    var st = (step === undefined || step === null || Number(step) <= 0)
        ? 80 : Number(step);

    function roundedUp(v) {
        v = Math.max(0, Number(v) || 0);
        return Math.ceil((v * os) / st) * st;
    }

    return { width: roundedUp(displayWidth), height: roundedUp(displayHeight) };
}
