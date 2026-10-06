// Generuje pare kluczy Ed25519.
//  - PRYWATNY idzie do .env (SIGNING_PRIVATE_KEY) i NIGDY nie trafia do moda ani do nikogo.
//  - PUBLICZNY wklejasz do moda: License.java -> PUBLIC_KEY_B64
import crypto from 'node:crypto';

const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
const pub = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
const priv = privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64');

console.log('\n=== Wklej do pliku .env (TAJNE) ===');
console.log('SIGNING_PRIVATE_KEY=' + priv);
console.log('\n=== Wklej do moda: License.java -> PUBLIC_KEY_B64 ===');
console.log(pub + '\n');
