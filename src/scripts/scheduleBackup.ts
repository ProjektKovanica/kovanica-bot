import cron from 'node-cron';
import { backupDatabase } from './backupDatabase.js';

console.log('🔄 Pokrećem scheduler za backup...');

// Svaki dan u 3:00
cron.schedule('0 3 * * *', async () => {
    console.log('⏰ Pokrećem automatski backup...');
    const result = await backupDatabase();
    if (result.success) {
        console.log(`✅ Backup uspješan: ${result.filename}`);
    } else {
        console.error(`❌ Backup neuspješan: ${result.error}`);
    }
});

console.log('✅ Backup scheduler pokrenut (svaki dan u 3:00)');

// Drži proces živim
setInterval(() => {}, 1000);
