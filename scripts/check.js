// Comprueba la sintaxis de todos los .js versionados (npm run check).
const { execFileSync, execSync } = require('child_process');

const files = execSync('git ls-files "*.js"', { encoding: 'utf8' }).split(/\r?\n/).filter(Boolean);
let failed = 0;
for (const f of files) {
    try {
        execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' });
    } catch (e) {
        failed++;
        console.error(`✗ ${f}\n${e.stderr}`);
    }
}
console.log(failed ? `${failed} archivo(s) con errores` : `✓ Sintaxis OK (${files.length} archivos)`);
process.exit(failed ? 1 : 0);
