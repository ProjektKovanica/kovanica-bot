import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config();

const execAsync = promisify(exec);
const BACKUP_DIR = './backups';
const MAX_BACKUPS = 30;

async function ensureBackupDir() {
    if (!fs.existsSync(BACKUP_DIR)) {
        fs.mkdirSync(BACKUP_DIR, { recursive: true });
    }
}

async function cleanupOldBackups() {
    const files = fs.readdirSync(BACKUP_DIR)
        .filter(f => f.endsWith('.sql'))
        .map(f => ({
            name: f,
            time: fs.statSync(path.join(BACKUP_DIR, f)).mtime.getTime()
        }))
        .sort((a, b) => b.time - a.time);

    if (files.length > MAX_BACKUPS) {
        const toDelete = files.slice(MAX_BACKUPS);
        for (const file of toDelete) {
            fs.unlinkSync(path.join(BACKUP_DIR, file.name));
            console.log(`🗑️ Obrisan stari backup: ${file.name}`);
        }
    }
}

async function backupDatabase() {
    try {
        await ensureBackupDir();

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `backup_${timestamp}.sql`;
        const filepath = path.join(BACKUP_DIR, filename);

        const dbUrl = process.env.DATABASE_URL || '';
        const match = dbUrl.match(/postgresql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/(.+)/);
        
        if (!match) {
            throw new Error('Ne mogu parsirati DATABASE_URL');
        }

        const [, user, password, host, port, database] = match;

        console.log(`🔄 Kreiranje backup-a: ${filename}`);

        const { stdout, stderr } = await execAsync(
            `PGPASSWORD="${password}" pg_dump -h ${host} -p ${port} -U ${user} -d ${database} > ${filepath}`
        );

        if (stderr && !stderr.includes('WARNING')) {
            throw new Error(stderr);
        }

        const stats = fs.statSync(filepath);
        const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);

        console.log(`✅ Backup kreiran: ${filename} (${sizeMB} MB)`);

        await cleanupOldBackups();

        return {
            success: true,
            filename,
            size: sizeMB,
            path: filepath
        };
    } catch (error: any) {
        console.error('❌ Greška pri backup-u:', error);
        return {
            success: false,
            error: error.message || 'Nepoznata greška'
        };
    }
}

const isMainModule = process.argv[1] && require.main === module;
if (isMainModule) {
    backupDatabase()
        .then(result => {
            if (result.success) {
                console.log('✅ Backup uspješan!');
                process.exit(0);
            } else {
                console.error('❌ Backup neuspješan:', result.error);
                process.exit(1);
            }
        })
        .catch(console.error);
}

export { backupDatabase, cleanupOldBackups };
