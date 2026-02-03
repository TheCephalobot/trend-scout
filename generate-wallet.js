const crypto = require('crypto');

// Generate a random private key
const privateKey = '0x' + crypto.randomBytes(32).toString('hex');

// Derive address from private key (simplified - just for display)
const { createHash } = require('crypto');

console.log('=== NEW WALLET FOR TREND SCOUT ===\n');
console.log('Private Key (KEEP SECRET):');
console.log(privateKey);
console.log('\nTo get your public address, import this private key into:');
console.log('- MetaMask, Rainbow, or any EVM wallet');
console.log('- Then copy the address\n');
console.log('Recommended network: Base (low fees)');
