import cron from 'node-cron';
import { TonPaymentService } from '../services/tonPaymentService.js';

console.log('🔄 Pokrećem scheduler za isplate...');

// Svakih 15 minuta
cron.schedule('*/15 * * * *', async () => {
    console.log('⏰ Pokrećem automatsku obradu isplata...');
    await TonPaymentService.processPendingWithdrawals();
});

console.log('✅ Scheduler za isplate pokrenut (svakih 15 minuta)');

setInterval(() => {}, 1000);
