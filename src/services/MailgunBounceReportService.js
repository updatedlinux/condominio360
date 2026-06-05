const { sql, connectDB } = require('../config/database');

/**
 * Parsea export CSV de Mailgun y cruza correos con propietarios del condominio.
 */
class MailgunBounceReportService {
    static normalizeEmail(email) {
        return String(email || '').trim().toLowerCase();
    }

    /** Parser CSV mínimo (RFC4180) para exportes Mailgun */
    static parseCsv(text) {
        const rows = [];
        let row = [];
        let field = '';
        let inQuotes = false;

        for (let i = 0; i < text.length; i++) {
            const c = text[i];
            const next = text[i + 1];

            if (inQuotes) {
                if (c === '"' && next === '"') {
                    field += '"';
                    i++;
                } else if (c === '"') {
                    inQuotes = false;
                } else {
                    field += c;
                }
                continue;
            }

            if (c === '"') {
                inQuotes = true;
            } else if (c === ',') {
                row.push(field);
                field = '';
            } else if (c === '\n' || (c === '\r' && next === '\n')) {
                row.push(field);
                if (row.some((cell) => String(cell).trim() !== '')) {
                    rows.push(row);
                }
                row = [];
                field = '';
                if (c === '\r') i++;
            } else if (c !== '\r') {
                field += c;
            }
        }

        if (field.length || row.length) {
            row.push(field);
            if (row.some((cell) => String(cell).trim() !== '')) {
                rows.push(row);
            }
        }

        if (rows.length === 0) return [];
        const headers = rows[0].map((h) => String(h).trim());
        return rows.slice(1).map((cells) => {
            const obj = {};
            headers.forEach((h, idx) => {
                obj[h] = cells[idx] != null ? String(cells[idx]).trim() : '';
            });
            return obj;
        });
    }

    static pickRecipient(row) {
        return MailgunBounceReportService.normalizeEmail(
            row.recipient || row['message.headers.to'] || row['envelope.targets'] || ''
        );
    }

    static parseRowTimestamp(row) {
        const raw = row['@timestamp'] || row.timestamp || row['message.scheduledFor'] || '';
        const ts = Date.parse(String(raw || '').trim());
        return Number.isFinite(ts) ? ts : null;
    }

    static formatTimestampEsUtc(isoOrDate) {
        const d = isoOrDate instanceof Date ? isoOrDate : new Date(isoOrDate);
        if (Number.isNaN(d.getTime())) return '—';
        const pad = (n) => String(n).padStart(2, '0');
        const months = [
            'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
            'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'
        ];
        return `${d.getUTCDate()} de ${months[d.getUTCMonth()]} de ${d.getUTCFullYear()}, ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
    }

    /** Rango @timestamp del export CSV de Mailgun (todas las filas). */
    static computeCsvDateRange(rows) {
        let min = null;
        let max = null;

        for (const row of rows || []) {
            const ts = MailgunBounceReportService.parseRowTimestamp(row);
            if (ts == null) continue;
            if (min === null || ts < min) min = ts;
            if (max === null || ts > max) max = ts;
        }

        if (min === null || max === null) {
            return { from: null, to: null, label: null };
        }

        const from = new Date(min).toISOString();
        const to = new Date(max).toISOString();
        const fromLabel = MailgunBounceReportService.formatTimestampEsUtc(from);
        const toLabel = MailgunBounceReportService.formatTimestampEsUtc(to);
        const label = fromLabel === toLabel
            ? `${fromLabel} (UTC)`
            : `Del ${fromLabel} al ${toLabel} (UTC)`;

        return { from, to, label };
    }

    static _monthNamesEs() {
        return [
            'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
            'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'
        ];
    }

    static _parseMailgunExportTimePart(month, day, year, hour, minute, second, ampm) {
        let h = parseInt(hour, 10);
        const isPm = /p/i.test(String(ampm || ''));
        if (isPm && h !== 12) h += 12;
        if (!isPm && h === 12) h = 0;
        return {
            month: parseInt(month, 10),
            day: parseInt(day, 10),
            year: parseInt(year, 10),
            hour: h,
            minute: parseInt(minute, 10),
            second: parseInt(second, 10)
        };
    }

    static _formatFilterTimestampEs(part) {
        const months = MailgunBounceReportService._monthNamesEs();
        const h12 = part.hour % 12 || 12;
        const suffix = part.hour >= 12 ? 'p.m.' : 'a.m.';
        const pad = (n) => String(n).padStart(2, '0');
        return `${part.day} de ${months[part.month - 1]} de ${part.year}, ${h12}:${pad(part.minute)} ${suffix}`;
    }

    /**
     * Mailgun nombra el CSV: exported-logs-D-M-Y-H-M-S-a.m.-to-D-M-Y-...
     * (día-mes-año, como en el panel). Es el filtro del export, no el último evento.
     */
    static parseMailgunExportFilename(filename) {
        const m = String(filename || '').match(
            /exported-logs-(\d+)-(\d+)-(\d+)-(\d+)-(\d+)-(\d+)-(a\.?\s*m\.?|p\.?\s*m\.?)-to-(\d+)-(\d+)-(\d+)-(\d+)-(\d+)-(\d+)-(a\.?\s*m\.?|p\.?\s*m\.?)/i
        );
        if (!m) return null;

        const from = MailgunBounceReportService._parseMailgunExportTimePart(
            m[2], m[1], m[3], m[4], m[5], m[6], m[7]
        );
        const to = MailgunBounceReportService._parseMailgunExportTimePart(
            m[9], m[8], m[10], m[11], m[12], m[13], m[14]
        );
        const fromLabel = MailgunBounceReportService._formatFilterTimestampEs(from);
        const toLabel = MailgunBounceReportService._formatFilterTimestampEs(to);
        const label = fromLabel === toLabel
            ? fromLabel
            : `Del ${fromLabel} al ${toLabel}`;

        return {
            from,
            to,
            label,
            timezone_note: 'Hora del panel Mailgun (normalmente US/Eastern)'
        };
    }

    static buildDateRangeInfo(parsedRows, originalFilename) {
        const events = MailgunBounceReportService.computeCsvDateRange(parsedRows);
        const exportFilter = MailgunBounceReportService.parseMailgunExportFilename(originalFilename);

        const eventsLabel = events.label || null;
        const exportFilterLabel = exportFilter?.label || null;

        let note = null;
        if (exportFilterLabel && eventsLabel) {
            note = 'El filtro del export en Mailgun puede llegar más lejos en el calendario; aquí solo aparecen las fechas en que hubo rebotes en el archivo.';
        } else if (eventsLabel) {
            note = 'Rango calculado a partir de los timestamps (@timestamp) de las filas del CSV.';
        }

        return {
            events,
            export_filter: exportFilter,
            events_label: eventsLabel,
            export_filter_label: exportFilterLabel,
            label: eventsLabel,
            note
        };
    }

    static severityRank(row) {
        const sev = String(row.severity || '').toLowerCase();
        if (sev === 'permanent') return 3;
        if (sev === 'temporary') return 2;
        return 1;
    }

    static reasonRank(row) {
        const reason = String(row.reason || '').toLowerCase();
        if (reason === 'old') return 3;
        if (reason === 'generic') return 2;
        return 1;
    }

    /** Un registro por correo: el fallo más grave / reciente */
    static dedupeFailures(rows) {
        const byEmail = new Map();

        for (const row of rows) {
            const event = String(row.event || '').toLowerCase();
            if (event && event !== 'failed') continue;

            const email = MailgunBounceReportService.pickRecipient(row);
            if (!email || !email.includes('@')) continue;

            const ts = Date.parse(row['@timestamp'] || '') || 0;
            const current = byEmail.get(email);

            if (!current) {
                byEmail.set(email, { row, ts });
                continue;
            }

            const curRank = MailgunBounceReportService.severityRank(current.row) * 10
                + MailgunBounceReportService.reasonRank(current.row);
            const newRank = MailgunBounceReportService.severityRank(row) * 10
                + MailgunBounceReportService.reasonRank(row);

            if (newRank > curRank || (newRank === curRank && ts > current.ts)) {
                byEmail.set(email, { row, ts });
            }
        }

        return Array.from(byEmail.entries()).map(([email, { row, ts }]) => ({
            email,
            row,
            timestamp: ts ? new Date(ts).toISOString() : null
        }));
    }

    static isMailboxFull(row, msg, code) {
        const enhanced = String(row['deliveryStatus.enhancedCode'] || '').toLowerCase();
        const lastMsg = String(row['deliveryStatus.lastMessage'] || '').toLowerCase();
        const combined = `${msg} ${enhanced} ${lastMsg}`;
        return (
            /4\.2\.2/.test(combined)
            || combined.includes('out of storage')
            || combined.includes('overquota')
            || combined.includes('over quota')
            || combined.includes('mailbox full')
            || combined.includes('mailbox is full')
            || combined.includes('insufficient system storage')
            || combined.includes('quota exceeded')
            || combined.includes('user is over quota')
            || combined.includes('exceeded storage allocation')
            || code === '452'
            || code === '552'
        );
    }

    static mailboxFullHint(row, msg, domain) {
        const provider = String(row.recipientProvider || '').toLowerCase();
        const isGoogle = domain.includes('gmail')
            || msg.includes('gsmtp')
            || provider.includes('google');
        const isOutlook = domain.includes('outlook')
            || domain.includes('hotmail')
            || domain.includes('live.')
            || provider.includes('outlook');
        const isYahoo = domain.includes('yahoo') || provider.includes('yahoo');

        if (isGoogle) {
            return 'Buzón de Gmail sin espacio: el propietario debe liberar almacenamiento (correo, Drive o Fotos) en su cuenta Google.';
        }
        if (isOutlook) {
            return 'Buzón de Outlook/Hotmail lleno: el propietario debe liberar espacio en su cuenta Microsoft.';
        }
        if (isYahoo) {
            return 'Buzón de Yahoo lleno: el propietario debe eliminar correos antiguos o ampliar su almacenamiento.';
        }
        if (domain.includes('cantv')) {
            return 'Buzón @cantv.net sin espacio disponible: el propietario debe vaciar su bandeja en CANTV.';
        }
        return 'Buzón de correo lleno: el propietario debe liberar espacio (borrar mensajes viejos o vaciar papelera) en su proveedor de correo.';
    }

    static humanizeFailure(row) {
        const rawMsg = String(
            row['deliveryStatus.lastMessage']
            || row['deliveryStatus.message']
            || row.reason
            || ''
        );
        const msg = rawMsg.toLowerCase();
        const code = String(row['deliveryStatus.code'] || row['deliveryStatus.lastCode'] || '').trim();
        const domain = String(row.recipientDomain || '').toLowerCase();
        const severity = String(row.severity || '').toLowerCase();
        const bounceType = String(row['deliveryStatus.bounceType'] || '').toLowerCase();
        const reason = String(row.reason || '').toLowerCase();

        const hints = [];
        let handledCategory = false;

        if (MailgunBounceReportService.isMailboxFull(row, msg, code)) {
            hints.push(MailgunBounceReportService.mailboxFullHint(row, msg, domain));
            hints.push('Es un fallo temporal: cuando libere espacio, los próximos envíos deberían llegar.');
            handledCategory = true;
        } else if (msg.includes('mx lookup failed') || msg.includes('server misbehaving')) {
            hints.push('El dominio del correo no existe o está mal escrito (error de DNS).');
            if (domain.includes('yomail')) {
                hints.push('Parece un error tipográfico de «yopmail.com» (correo desechable).');
            }
        } else if (msg.includes('timeout') || code === '451') {
            hints.push('El servidor del destinatario no respondió a tiempo.');
            if (domain.includes('yopmail') || domain.includes('mailinator')) {
                hints.push('Correo temporal/desechable: no es apto para notificaciones oficiales.');
            }
        } else if (msg.includes('unable to connect') || msg.includes('i/o timeout') || code === '602' || code === '612') {
            hints.push('No se pudo conectar al servidor de correo del destinatario (buzón inaccesible o saturado).');
            if (domain.includes('cantv')) {
                hints.push('Buzón @cantv.net: suele fallar por saturación o buzón lleno/inactivo en CANTV.');
            }
        } else if (msg.includes('user unknown') || msg.includes('mailbox not found') || code === '550' || code === '551') {
            hints.push('La dirección de correo no existe en el servidor del destinatario.');
        } else if (msg.includes('blocked') || msg.includes('spam') || msg.includes('rejected')) {
            hints.push('El servidor del destinatario rechazó el mensaje (posible filtro anti-spam).');
        }

        if (reason === 'old' || msg.includes('too old')) {
            hints.push('Mailgun agotó los reintentos sin lograr entregar el mensaje.');
        }

        if (!handledCategory) {
            if (severity === 'permanent') {
                hints.push('Fallo permanente: conviene corregir o cambiar este correo en el sistema.');
            } else if (severity === 'temporary') {
                hints.push('Fallo temporal: puede reintentarse, pero si se repite hay que revisar el correo.');
            }
        }

        if (bounceType === 'soft') {
            hints.push('Rebote suave (el servidor aceptó el intento pero no entregó).');
        }

        const enhanced = String(row['deliveryStatus.enhancedCode'] || '').trim();
        const technical = [
            rawMsg.trim() || null,
            enhanced ? `SMTP ${enhanced}` : null,
            code ? `Código ${code}` : null,
            row.severity ? `Severidad: ${row.severity}` : null
        ].filter(Boolean).join(' · ');

        const summary = hints.length
            ? hints.join(' ')
            : (technical || 'No se pudo entregar el correo. Revise la dirección con el propietario.');

        return {
            summary,
            technical: technical || null,
            severity: row.severity || null,
            event: row.event || null,
            subject: row['message.headers.subject'] || null
        };
    }

    static formatProperties(properties) {
        if (!properties || !properties.length) return 'Sin inmueble asignado';
        return properties.map((p) => {
            const b = p.building_name ? `${p.building_name} — ` : '';
            return `${b}${p.property_name || p.name || 'Inmueble'}`;
        }).join('; ');
    }

    static async findOwnersByEmailsInTenant(tenantId, emails) {
        const normalized = [...new Set(emails.map((e) => MailgunBounceReportService.normalizeEmail(e)).filter(Boolean))];
        const map = new Map();
        if (!normalized.length) return map;

        const pool = await connectDB();
        const result = await pool.request()
            .input('tenant_id', sql.UniqueIdentifier, tenantId)
            .input('emails_json', sql.NVarChar(sql.MAX), JSON.stringify(normalized))
            .query(`
                WITH EmailList AS (
                    SELECT LOWER(LTRIM(RTRIM([value]))) AS email
                    FROM OPENJSON(@emails_json)
                ),
                OwnersInTenant AS (
                    SELECT DISTINCT user_id FROM (
                        SELECT tu.user_id
                        FROM TenantUsers tu
                        WHERE tu.tenant_id = @tenant_id AND tu.role = N'OWNER' AND tu.status = N'ACTIVE'
                        UNION
                        SELECT po.user_id
                        FROM PropertyOwners po
                        INNER JOIN Properties p ON p.id = po.property_id AND p.tenant_id = @tenant_id
                    ) AS owners_union
                ),
                OwnerEmails AS (
                    SELECT oit.user_id, LOWER(LTRIM(RTRIM(u.email))) AS email
                    FROM OwnersInTenant oit
                    INNER JOIN Users u ON u.id = oit.user_id
                    WHERE u.is_active = 1 AND u.email IS NOT NULL AND LTRIM(RTRIM(u.email)) != ''
                    UNION
                    SELECT oit.user_id, LOWER(LTRIM(RTRIM(ue.email)))
                    FROM OwnersInTenant oit
                    INNER JOIN UserEmails ue ON ue.user_id = oit.user_id
                    INNER JOIN Users u ON u.id = oit.user_id AND u.is_active = 1
                )
                SELECT
                    oe.email AS matched_email,
                    u.id AS owner_id,
                    u.first_name,
                    u.last_name,
                    u.email AS primary_email,
                    u.phone,
                    u.dni,
                    p.id AS property_id,
                    p.name AS property_name,
                    b.name AS building_name,
                    po.is_primary_owner
                FROM EmailList el
                INNER JOIN OwnerEmails oe ON oe.email = el.email
                INNER JOIN Users u ON u.id = oe.user_id
                LEFT JOIN PropertyOwners po ON po.user_id = u.id
                LEFT JOIN Properties p ON p.id = po.property_id AND p.tenant_id = @tenant_id
                LEFT JOIN Buildings b ON b.id = p.building_id
                ORDER BY oe.email, po.is_primary_owner DESC, p.name
            `);

        const ownerIds = new Set();
        for (const row of result.recordset || []) {
            const key = row.matched_email;
            ownerIds.add(String(row.owner_id));
            if (!map.has(key)) {
                map.set(key, {
                    owner_id: row.owner_id,
                    first_name: row.first_name,
                    last_name: row.last_name,
                    primary_email: row.primary_email,
                    phone: row.phone,
                    dni: row.dni,
                    properties: [],
                    other_tenants: []
                });
            }
            if (row.property_id) {
                const entry = map.get(key);
                const exists = entry.properties.some((p) => p.property_id === row.property_id);
                if (!exists) {
                    entry.properties.push({
                        property_id: row.property_id,
                        property_name: row.property_name,
                        building_name: row.building_name
                    });
                }
            }
        }

        if (ownerIds.size > 0) {
            const idsJson = JSON.stringify([...ownerIds]);
            const otherResult = await pool.request()
                .input('tenant_id', sql.UniqueIdentifier, tenantId)
                .input('ids_json', sql.NVarChar(sql.MAX), idsJson)
                .query(`
                    WITH OwnerIds AS (
                        SELECT CAST([value] AS UNIQUEIDENTIFIER) AS user_id
                        FROM OPENJSON(@ids_json)
                    ),
                    OtherTenants AS (
                        SELECT DISTINCT oi.user_id, t.id AS tenant_id, t.name AS tenant_name
                        FROM OwnerIds oi
                        INNER JOIN PropertyOwners po ON po.user_id = oi.user_id
                        INNER JOIN Properties p ON p.id = po.property_id
                        INNER JOIN Tenants t ON t.id = p.tenant_id AND t.active = 1 AND t.id <> @tenant_id
                        UNION
                        SELECT DISTINCT oi.user_id, t.id, t.name
                        FROM OwnerIds oi
                        INNER JOIN TenantUsers tu ON tu.user_id = oi.user_id AND tu.role = N'OWNER' AND tu.status = N'ACTIVE'
                        INNER JOIN Tenants t ON t.id = tu.tenant_id AND t.active = 1 AND t.id <> @tenant_id
                    )
                    SELECT user_id, tenant_name
                    FROM OtherTenants
                    ORDER BY tenant_name
                `);

            const otherByUser = new Map();
            for (const row of otherResult.recordset || []) {
                const uid = String(row.user_id);
                if (!otherByUser.has(uid)) otherByUser.set(uid, []);
                const list = otherByUser.get(uid);
                if (!list.includes(row.tenant_name)) list.push(row.tenant_name);
            }

            for (const entry of map.values()) {
                entry.other_tenants = otherByUser.get(String(entry.owner_id)) || [];
            }
        }

        return map;
    }

    static async analyzeCsvForTenant(tenantId, csvText, options = {}) {
        const parsed = MailgunBounceReportService.parseCsv(csvText);
        if (!parsed.length) {
            return {
                success: false,
                error: 'El archivo CSV está vacío o no tiene el formato esperado de Mailgun.'
            };
        }

        const failures = MailgunBounceReportService.dedupeFailures(parsed);
        const emails = failures.map((f) => f.email);
        const ownerMap = await MailgunBounceReportService.findOwnersByEmailsInTenant(tenantId, emails);

        const allRows = failures.map((f) => {
            const human = MailgunBounceReportService.humanizeFailure(f.row);
            const owner = ownerMap.get(f.email);
            return {
                email: f.email,
                last_failure_at: f.timestamp,
                error: human,
                owner: owner ? {
                    id: owner.owner_id,
                    name: `${owner.first_name || ''} ${owner.last_name || ''}`.trim(),
                    dni: owner.dni,
                    phone: owner.phone || null,
                    primary_email: owner.primary_email,
                    properties_label: MailgunBounceReportService.formatProperties(owner.properties),
                    properties: owner.properties,
                    other_tenants: owner.other_tenants || [],
                    also_in_other_condos: (owner.other_tenants || []).length > 0
                } : null,
                matched_in_tenant: !!owner
            };
        });

        const tenantRows = allRows.filter((r) => r.matched_in_tenant);
        const unmatchedRows = allRows.filter((r) => !r.matched_in_tenant);

        const sortRows = (list) => list.sort((a, b) =>
            (a.owner?.name || a.email).localeCompare(b.owner?.name || b.email, 'es')
        );
        sortRows(tenantRows);
        sortRows(unmatchedRows);

        return {
            success: true,
            data: {
                total_csv_rows: parsed.length,
                unique_failed_emails: failures.length,
                matched_in_tenant: tenantRows.length,
                not_in_tenant: unmatchedRows.length,
                date_range: MailgunBounceReportService.buildDateRangeInfo(
                    parsed,
                    options.originalFilename
                ),
                rows: tenantRows,
                other_rows: unmatchedRows
            }
        };
    }
}

module.exports = MailgunBounceReportService;
