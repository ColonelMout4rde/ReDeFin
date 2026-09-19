// qml/js/AudioOutputPolicy.js
// Politique pure de la sortie audio ReDeFin (réglage « Sortie audio »).
//
// Deux modes seulement :
//   - "multichannel" (défaut) : comportement historique, aucune contrainte
//     ajoutée à la négociation. Le 5.1 part intact vers le Player.
//   - "stereo" : l'installation de l'utilisateur est stéréo. On demande au
//     SERVEUR de faire le mixage, afin que Jellyfin applique son amplification
//     de downmix et son algorithme stéréo (dialogues plus audibles) au lieu de
//     laisser le boîtier/téléviseur réduire un 5.1 brut.
//
// Règle unique : on n'engage un transcodage audio QUE si la piste réellement
// envoyée au serveur a plus de 2 canaux. Une piste déjà stéréo/mono reste en
// copie (ou en lecture directe) exactement comme en mode multicanal, et un
// nombre de canaux inconnu ne déclenche jamais de transcodage — seul le
// plafond annoncé au serveur (MaxAudioChannels = 2) reste posé.
//
// Module pur : pas d'état global mutable, aucune dépendance Qt, ES5.

.pragma library

var MODE_MULTICHANNEL = "multichannel";
var MODE_STEREO = "stereo";

// Cible du mixage serveur. AAC 2.0 est lisible par les deux Players
// (Révolution comme Delta/Devialet) et par tous les conteneurs utilisés.
var STEREO_CHANNELS = 2;
var STEREO_CODEC = "aac";
// Débit du downmix stéréo. Constante nommée : c'est le seul point à changer
// pour monter/descendre la qualité du mixage.
var STEREO_BITRATE = 192000;

/** Normalise une valeur de réglage ; toute valeur inconnue retombe sur le défaut. */
function normalizeMode(value) {
    var mode = "";
    try {
        mode = (value === undefined || value === null) ? "" : String(value).toLowerCase().trim();
    } catch (e) {
        mode = "";
    }
    if (mode === MODE_STEREO || mode === "stereo2" || mode === "2.0" || mode === "downmix")
        return MODE_STEREO;
    return MODE_MULTICHANNEL;
}

/** true si le mode demande un mixage stéréo côté serveur. */
function isStereo(mode) {
    return normalizeMode(mode) === MODE_STEREO;
}

/**
 * Nombre de canaux d'une piste audio Jellyfin.
 * Accepte un objet MediaStream ou directement un nombre.
 * Renvoie 0 quand l'information est absente ou inexploitable.
 */
function channelsOf(audioStream) {
    var raw = null;
    if (audioStream === undefined || audioStream === null) return 0;
    if (typeof audioStream === "number" || typeof audioStream === "string") raw = audioStream;
    else {
        try {
            raw = (audioStream.Channels !== undefined && audioStream.Channels !== null)
                ? audioStream.Channels : audioStream.channels;
        } catch (e) {
            return 0;
        }
    }
    if (raw === undefined || raw === null || raw === "") return 0;
    var n = parseInt(String(raw), 10);
    if (!isFinite(n) || n <= 0) return 0;
    return Math.floor(n);
}

/** Plafond de canaux annoncé au serveur : 2 en stéréo, 0 (= aucun) sinon. */
function maxChannels(mode) {
    return isStereo(mode) ? STEREO_CHANNELS : 0;
}

/**
 * Abaisse un nombre de canaux déjà calculé par un chemin de transcodage
 * existant (TS entrelacé, DVD, burn-in...) au plafond du mode.
 * Un nombre inconnu (0) reste inconnu : ce n'est pas à cette fonction
 * d'inventer une valeur.
 */
function capChannels(mode, channels) {
    var n = channelsOf(channels);
    if (n <= 0) return channels;
    if (!isStereo(mode)) return n;
    return Math.min(n, STEREO_CHANNELS);
}

/**
 * Plan audio de la piste effectivement envoyée au serveur.
 *
 * @param mode         valeur du réglage « Sortie audio »
 * @param audioStream  MediaStream Jellyfin de la piste retenue (ou son nombre
 *                     de canaux), éventuellement absent
 * @return { mode, sourceChannels, downmix, channels, codec, bitrate, maxChannels }
 *         downmix=true  -> il faut un flux serveur dont l'audio est transcodé
 *                          en codec/channels/bitrate ci-dessus, la vidéo
 *                          restant copiée si elle est compatible ;
 *         downmix=false -> comportement strictement identique à aujourd'hui.
 */
function plan(mode, audioStream) {
    var normalized = normalizeMode(mode);
    var sourceChannels = channelsOf(audioStream);
    var stereo = (normalized === MODE_STEREO);
    var downmix = stereo && sourceChannels > STEREO_CHANNELS;
    return {
        mode: normalized,
        sourceChannels: sourceChannels,
        downmix: downmix,
        channels: downmix ? STEREO_CHANNELS : 0,
        codec: downmix ? STEREO_CODEC : "",
        bitrate: downmix ? STEREO_BITRATE : 0,
        maxChannels: stereo ? STEREO_CHANNELS : 0
    };
}

/** Résumé compact d'un plan pour la trace DevLog T17. */
function describe(p) {
    if (!p) return "audio-plan=none";
    return "mode=" + p.mode +
           " srcCh=" + p.sourceChannels +
           " downmix=" + (p.downmix ? "1" : "0") +
           " codec=" + (p.codec || "-") +
           " ch=" + (p.channels || 0) +
           " br=" + (p.bitrate || 0) +
           " maxCh=" + (p.maxChannels || 0);
}
