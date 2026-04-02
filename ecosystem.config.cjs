/**
 * PM2: arranque con marca de tiempo en cada línea de log.
 *
 * Uso:
 *   pm2 start ecosystem.config.cjs
 *   pm2 save
 *
 * Si ya tenías el proceso con otro nombre/comando:
 *   pm2 delete condominio360
 *   pm2 start ecosystem.config.cjs
 */
module.exports = {
    apps: [
        {
            name: 'condominio360',
            script: 'src/app.js',
            cwd: __dirname,
            instances: 1,
            exec_mode: 'fork',
            autorestart: true,
            watch: false,
            max_memory_restart: '500M',
            log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
            merge_logs: true,
        },
    ],
};
