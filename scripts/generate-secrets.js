'use strict';
// Generuje losowe sekrety do pliku .env
const crypto = require('crypto');
console.log('# Wklej do pliku .env (i zachowaj kopię ENCRYPTION_KEY w menedżerze haseł!)');
console.log(`SESSION_SECRET=${crypto.randomBytes(48).toString('base64url')}`);
console.log(`ENCRYPTION_KEY=${crypto.randomBytes(32).toString('hex')}`);
console.log(`ADMIN_PATH=/panel-${crypto.randomBytes(4).toString('hex')}`);
