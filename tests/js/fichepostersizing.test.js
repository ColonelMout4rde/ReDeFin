'use strict';
// F5 (audit-fiches.md) : le logo de fiche (movieLogoUrl / seriesLogoUrl)
// demandait maxWidth/maxHeight 900 alors qu'il n'est jamais affiché à plus
// de 207x297. Ce test vérifie par lecture du source (les pages ne
// s'instancient pas en test) que :
//   - la taille demandée pour l'affichage courant passe par
//     PosterSizing.requestedImageSize(), pas une constante 900 ;
//   - une URL séparée, à 900x900, reste réservée au plein écran
//     (openPosterOverlay) ;
//   - sourceSize est posé sur l'Image du logo.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function readPage(file) {
    return fs.readFileSync(path.join(__dirname, '..', '..', 'qml', 'pages', file), 'utf8');
}

const movie = readPage('detailMoviePage.qml');
const serie = readPage('detailSeriePage.qml');

test('les deux pages importent PosterSizing.js', () => {
    assert.match(movie, /import "\.\.\/js\/PosterSizing\.js" as PosterSizing/);
    assert.match(serie, /import "\.\.\/js\/PosterSizing\.js" as PosterSizing/);
});

test('movieLogoUrl / seriesLogoUrl utilisent la taille calculée, pas 900 en dur', () => {
    const movieLogo = movie.slice(movie.indexOf('property string movieLogoUrl'), movie.indexOf('property string movieLogoOverlayUrl'));
    assert.match(movieLogo, /maxWidth:\s*_logoReqSize\.width,\s*maxHeight:\s*_logoReqSize\.height/);
    assert.equal(/900/.test(movieLogo), false);

    const serieLogo = serie.slice(serie.indexOf('property string seriesLogoUrl'), serie.indexOf('property string seriesLogoOverlayUrl'));
    assert.match(serieLogo, /maxWidth:_logoReqSize\.width,\s*maxHeight:_logoReqSize\.height/);
    assert.equal(/900/.test(serieLogo), false);
});

test('une URL séparée à 900x900 reste réservée au plein écran', () => {
    assert.match(movie, /property string movieLogoOverlayUrl:[\s\S]{0,300}?maxWidth:\s*900,\s*maxHeight:\s*900/);
    assert.match(serie, /property string seriesLogoOverlayUrl:[\s\S]{0,300}?maxWidth:900,\s*maxHeight:900/);
});

test("_currentArtUrl() (film, plein écran) sert la grande variante du logo", () => {
    const fn = movie.slice(movie.indexOf('function _currentArtUrl()'), movie.indexOf('function openOverlay('));
    assert.match(fn, /movieLogoOverlayUrl/);
    assert.equal(/return movieLogoUrl\b/.test(fn), false);
});

test('openPosterOverlay (série, plein écran) sert la grande variante du logo', () => {
    const fn = serie.slice(serie.indexOf('function openPosterOverlay()'), serie.indexOf('function _overviewReaderImageUrl()'));
    assert.match(fn, /effectivePosterOverlayUrl/);
});

test("l'Image du logo pose sourceSize sur les deux pages", () => {
    for (const src of [movie, serie]) {
        const idx = src.indexOf('id: posterLogo');
        assert.notEqual(idx, -1);
        const block = src.slice(idx, idx + 650);
        assert.match(block, /sourceSize\.width:\s*_logoReqSize\.width/);
        assert.match(block, /sourceSize\.height:\s*_logoReqSize\.height/);
    }
});
