const fs = require('fs');
const path = require('path');

// Čitaj Tact fajl
const tactCode = fs.readFileSync('./contracts/vault.tact', 'utf8');

console.log('📦 Tact kod:');
console.log(tactCode);

// Spremi za kasniju upotrebu
fs.writeFileSync('./contracts/vault.compiled.tact', tactCode);
console.log('✅ Vault kod spremljen!');
