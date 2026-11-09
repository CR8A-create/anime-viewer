// Compila el APK de Android (npm run app:build).
// Sincroniza Capacitor y lanza Gradle. Si JAVA_HOME no está definido usa el
// JDK que trae Android Studio, que es el que suele haber en Windows/macOS.
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const env = { ...process.env };

if (!env.JAVA_HOME) {
    const candidates = [
        'C:\\Program Files\\Android\\Android Studio\\jbr',
        '/Applications/Android Studio.app/Contents/jbr/Contents/Home',
        '/opt/android-studio/jbr',
    ];
    const found = candidates.find(p => fs.existsSync(p));
    if (!found) {
        console.error('No encuentro un JDK. Instala Android Studio o define JAVA_HOME.');
        process.exit(1);
    }
    env.JAVA_HOME = found;
    env.PATH = path.join(found, 'bin') + path.delimiter + env.PATH;
}

const run = (cmd, cwd) => execSync(cmd, { cwd, env, stdio: 'inherit' });

run('npx cap sync android', root);
run(process.platform === 'win32' ? 'gradlew.bat assembleDebug' : './gradlew assembleDebug', path.join(root, 'android'));

const apk = path.join(root, 'android', 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');
console.log(`\n✓ APK listo: ${apk}`);
