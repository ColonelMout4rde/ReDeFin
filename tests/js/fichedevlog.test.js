'use strict';
// Instrumentation FICHE (chronométrage du rideau de detailMoviePage /
// detailSeriePage). Ces pages ne s'instancient pas en test (fetchs réseau,
// ~2900 lignes) : on vérifie donc le câblage par lecture du source, comme
// documenté dans CLAUDE.md pour un changement purement déclaratif.
//
// Contrat attendu :
//   - la page importe DevLog.js et n'appelle jamais console.log directement ;
//   - les sept étapes du chemin du rideau (onCompleted, arrivée item, source
//     et prêt du fond, libération de garde, hardLoading, fin du rideau) sont
//     tracées sous les tags FICHE1..FICHE7 ;
//   - chaque appel DevLog.log passe un message construit avec un delta
//     depuis _ficheT0, jamais une URL brute (toujours DevLog.maskUrl()).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PAGES = [
    { file: 'detailMoviePage.qml', label: 'movie' },
    { file: 'detailSeriePage.qml', label: 'serie' },
];

function readPage(file) {
    return fs.readFileSync(path.join(__dirname, '..', '..', 'qml', 'pages', file), 'utf8');
}

for (const page of PAGES) {
    const src = readPage(page.file);

    test(page.file + ' importe DevLog et n\'appelle jamais console.log', () => {
        assert.match(src, /import "\.\.\/js\/DevLog\.js" as DevLog/);
        assert.equal(/\bconsole\.log\s*\(/.test(src), false);
    });

    test(page.file + ' trace les sept étapes FICHE1..FICHE7 pour ' + page.label, () => {
        for (let n = 1; n <= 7; n++) {
            const tag = 'FICHE' + n;
            const re = new RegExp('DevLog\\.log\\("' + tag + '",\\s*"[^"]*' + page.label + '[^"]*"');
            assert.match(src, re, tag + ' doit apparaître dans un message citant ' + page.label);
        }
    });

    test(page.file + ' calcule un dt depuis _ficheT0 pour les étapes FICHE2..FICHE7', () => {
        for (let n = 2; n <= 7; n++) {
            const tag = 'FICHE' + n;
            const re = new RegExp('DevLog\\.log\\("' + tag + '",[^\\n]*\\(Date\\.now\\(\\)\\s*-\\s*_ficheT0\\)');
            assert.match(src, re, tag + ' doit tracer un dt depuis _ficheT0');
        }
    });

    test(page.file + ' initialise _ficheT0 dans Component.onCompleted', () => {
        const idx = src.indexOf('Component.onCompleted');
        assert.notEqual(idx, -1);
        const body = src.slice(idx, idx + 400);
        assert.match(body, /_ficheT0 = Date\.now\(\)/);
    });

    test(page.file + ' ne journalise jamais une URL sans DevLog.maskUrl()', () => {
        // Tout DevLog.log dont le message concatène une variable "ful"
        // (l'URL de fond calculée) doit passer par maskUrl().
        const calls = src.match(/DevLog\.log\([^\n]*/g) || [];
        for (const call of calls) {
            if (/\+\s*ful\b|\(\s*ful\s*\)|,\s*ful\b/.test(call)) {
                assert.match(call, /DevLog\.maskUrl\(/, 'appel suspect sans maskUrl(): ' + call);
            }
        }
    });
}
