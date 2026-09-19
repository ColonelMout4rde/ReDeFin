'use strict';
// Hygiène des tests Node eux-mêmes.
//
// node:test attend test(nom, options, fn). Écrit test({ todo: '…' }, nom, fn),
// le corps n'est JAMAIS exécuté : le test apparaît réussi en 0 ms, sous le nom
// « <anonymous> ». Trois tests todo ont vécu ainsi sans pouvoir échouer, donc
// sans rien prouver du défaut qu'ils décrivaient. Ce garde-fou lit les sources.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const DIR = __dirname;
const FILES = fs.readdirSync(DIR).filter((f) => f.endsWith('.test.js'));

function offenders(re) {
    const out = [];
    for (const file of FILES) {
        if (file === path.basename(__filename)) continue;
        const lines = fs.readFileSync(path.join(DIR, file), 'utf8').split('\n');
        lines.forEach((line, i) => { if (re.test(line)) out.push(file + ':' + (i + 1) + ': ' + line.trim()); });
    }
    return out;
}

test('aucun test ne passe ses options avant son nom', () => {
    // test({…}, …), it({…}, …), test.todo({…}, …) : corps jamais exécuté.
    assert.deepEqual(offenders(/^\s*(test|it|describe)(\.\w+)?\(\s*\{/), []);
});

test('un test todo cite le défaut qu\'il documente', () => {
    // « todo: true » ne dit rien : la règle du dépôt est un message qui
    // nomme le fichier et la ligne du défaut (voir tests/README.md).
    assert.deepEqual(offenders(/\btodo\s*:\s*true\b/), []);
});
