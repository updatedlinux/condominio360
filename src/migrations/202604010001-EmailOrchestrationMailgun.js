const Migration = require('./Migration');

/**
 * Orquestación de correo vía Mailgun API: jobs, destinatarios, logs, plantillas.
 * Tenants.mailgun_domain: dominio verificado en Mailgun por tenant (subdominio).
 */
class EmailOrchestrationMailgun extends Migration {
    async up() {
        if (!(await this.tableExists('Tenants'))) {
            console.log('   ⚠️ Tenants no existe, omitiendo EmailOrchestrationMailgun');
            return;
        }

        if (!(await this.columnExists('Tenants', 'mailgun_domain'))) {
            await this.query(`
                ALTER TABLE Tenants ADD mailgun_domain NVARCHAR(255) NULL
            `);
            console.log('   ✅ Tenants.mailgun_domain añadido');
        }

        if (!(await this.tableExists('email_jobs'))) {
            await this.query(`
                CREATE TABLE email_jobs (
                    id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
                    tenant_id UNIQUEIDENTIFIER NULL,
                    message_type NVARCHAR(80) NOT NULL,
                    pipeline NVARCHAR(20) NOT NULL
                        CHECK (pipeline IN ('transactional', 'bulk')),
                    priority INT NOT NULL DEFAULT 0,
                    template_id UNIQUEIDENTIFIER NULL,
                    created_by UNIQUEIDENTIFIER NULL,
                    status NVARCHAR(20) NOT NULL
                        CHECK (status IN ('pending', 'processing', 'sent', 'failed', 'retry', 'cancelled', 'partial')),
                    total_recipients INT NOT NULL DEFAULT 1,
                    sent_count INT NOT NULL DEFAULT 0,
                    failed_count INT NOT NULL DEFAULT 0,
                    source_batch_id UNIQUEIDENTIFIER NULL,
                    idempotency_key NVARCHAR(500) NULL,
                    paused_at DATETIME2 NULL,
                    metadata NVARCHAR(MAX) NULL,
                    created_at DATETIME2 NOT NULL DEFAULT SYSDATETIME(),
                    updated_at DATETIME2 NOT NULL DEFAULT SYSDATETIME(),
                    CONSTRAINT FK_email_jobs_tenants FOREIGN KEY (tenant_id)
                        REFERENCES Tenants(id) ON DELETE NO ACTION
                )
            `);
            await this.query(`
                CREATE INDEX IX_email_jobs_status_pipeline ON email_jobs (status, pipeline, priority DESC, created_at)
            `);
            await this.query(`
                CREATE INDEX IX_email_jobs_tenant ON email_jobs (tenant_id, created_at DESC)
            `);
            console.log('   ✅ email_jobs creada');
        }

        if (!(await this.tableExists('email_job_recipients'))) {
            await this.query(`
                CREATE TABLE email_job_recipients (
                    id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
                    job_id UNIQUEIDENTIFIER NOT NULL,
                    tenant_id UNIQUEIDENTIFIER NULL,
                    recipient_email NVARCHAR(320) NOT NULL,
                    recipient_name NVARCHAR(255) NULL,
                    subject NVARCHAR(998) NULL,
                    html_body NVARCHAR(MAX) NULL,
                    text_body NVARCHAR(MAX) NULL,
                    payload NVARCHAR(MAX) NULL,
                    status NVARCHAR(20) NOT NULL
                        CHECK (status IN ('pending', 'processing', 'sent', 'failed', 'retry', 'cancelled', 'bounced', 'complained')),
                    provider_message_id NVARCHAR(255) NULL,
                    attempt_count INT NOT NULL DEFAULT 0,
                    last_attempt_at DATETIME2 NULL,
                    error_message NVARCHAR(MAX) NULL,
                    idempotency_key NVARCHAR(500) NOT NULL,
                    created_at DATETIME2 NOT NULL DEFAULT SYSDATETIME(),
                    updated_at DATETIME2 NOT NULL DEFAULT SYSDATETIME(),
                    CONSTRAINT FK_email_job_recipients_jobs FOREIGN KEY (job_id)
                        REFERENCES email_jobs(id) ON DELETE CASCADE,
                    CONSTRAINT FK_email_job_recipients_tenants FOREIGN KEY (tenant_id)
                        REFERENCES Tenants(id) ON DELETE NO ACTION
                )
            `);
            await this.query(`
                CREATE UNIQUE NONCLUSTERED INDEX UQ_email_job_recipients_idem
                ON email_job_recipients (idempotency_key)
            `);
            await this.query(`
                CREATE INDEX IX_email_job_recipients_job ON email_job_recipients (job_id, status)
            `);
            console.log('   ✅ email_job_recipients creada');
        }

        if (!(await this.tableExists('email_logs'))) {
            await this.query(`
                CREATE TABLE email_logs (
                    id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
                    recipient_id UNIQUEIDENTIFIER NULL,
                    job_id UNIQUEIDENTIFIER NOT NULL,
                    tenant_id UNIQUEIDENTIFIER NULL,
                    event_type NVARCHAR(40) NOT NULL,
                    provider_response NVARCHAR(MAX) NULL,
                    created_at DATETIME2 NOT NULL DEFAULT SYSDATETIME(),
                    CONSTRAINT FK_email_logs_jobs FOREIGN KEY (job_id)
                        REFERENCES email_jobs(id) ON DELETE CASCADE,
                    CONSTRAINT FK_email_logs_recipients FOREIGN KEY (recipient_id)
                        REFERENCES email_job_recipients(id) ON DELETE NO ACTION
                )
            `);
            await this.query(`
                CREATE INDEX IX_email_logs_job ON email_logs (job_id, created_at)
            `);
            await this.query(`
                CREATE INDEX IX_email_logs_created ON email_logs (created_at)
            `);
            console.log('   ✅ email_logs creada');
        }

        if (!(await this.tableExists('email_templates'))) {
            await this.query(`
                CREATE TABLE email_templates (
                    id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
                    tenant_id UNIQUEIDENTIFIER NULL,
                    name NVARCHAR(200) NOT NULL,
                    subject NVARCHAR(500) NULL,
                    html_body NVARCHAR(MAX) NULL,
                    text_body NVARCHAR(MAX) NULL,
                    variables NVARCHAR(MAX) NULL,
                    active BIT NOT NULL DEFAULT 1,
                    created_at DATETIME2 NOT NULL DEFAULT SYSDATETIME(),
                    CONSTRAINT FK_email_templates_tenants FOREIGN KEY (tenant_id)
                        REFERENCES Tenants(id) ON DELETE CASCADE
                )
            `);
            console.log('   ✅ email_templates creada');
        }
    }

    async down() {
        if (await this.tableExists('email_logs')) {
            await this.query('DROP TABLE email_logs');
        }
        if (await this.tableExists('email_job_recipients')) {
            await this.query('DROP TABLE email_job_recipients');
        }
        if (await this.tableExists('email_jobs')) {
            await this.query('DROP TABLE email_jobs');
        }
        if (await this.tableExists('email_templates')) {
            await this.query('DROP TABLE email_templates');
        }
        if (await this.columnExists('Tenants', 'mailgun_domain')) {
            await this.query('ALTER TABLE Tenants DROP COLUMN mailgun_domain');
        }
    }
}

module.exports = EmailOrchestrationMailgun;
