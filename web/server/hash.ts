// Gebruik: npx tsx server/hash.ts 'wachtwoord'  → plak de uitvoer in ADMIN_PASSWORD_HASH
import { hashWachtwoord } from './auth.js';
const wachtwoord = process.argv[2];
if (!wachtwoord || wachtwoord.length < 12) { console.error('Geef een wachtwoord van minstens 12 tekens'); process.exit(1); }
console.log(hashWachtwoord(wachtwoord));
