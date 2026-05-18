/**
 * Super Admin: deuda histórica pre-sistema (tenant-properties)
 */
(function () {
    let hdCsvRows = [];

    function fmtNum(n) {
        const x = parseFloat(n);
        return Number.isFinite(x) ? x.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 6 }) : '—';
    }

    window.loadHistoricalDebts = async function loadHistoricalDebts() {
        const tbody = document.getElementById('historical-debts-table');
        if (!tbody || typeof tenantId === 'undefined') return;
        try {
            const res = await fetch(`/api/admin/tenants/${tenantId}/historical-debts`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            const json = await res.json();
            if (!res.ok) throw new Error(json.error || 'Error al cargar');
            const rows = json.data || [];
            if (!rows.length) {
                tbody.innerHTML = '<tr><td colspan="6" class="px-4 py-6 text-center text-slate-400">Sin deudas históricas registradas</td></tr>';
                return;
            }
            tbody.innerHTML = rows.map((d) => {
                const st = d.status === 'ACTIVE' ? (d.invoice_status === 'PAID' ? 'Pagado' : 'Pendiente') : 'Anulada';
                const stClass = d.invoice_status === 'PAID' ? 'text-green-700' : (d.status !== 'ACTIVE' ? 'text-slate-500' : 'text-amber-700');
                const cancelBtn = d.status === 'ACTIVE' && d.invoice_status !== 'PAID'
                    ? `<button type="button" onclick="cancelHistoricalDebt('${d.id}')" class="text-red-600 hover:underline text-xs">Anular</button>`
                    : '';
                return `<tr>
                    <td class="px-4 py-3">${d.property_name || '—'}<br><span class="text-xs text-slate-400">${d.property_slug || ''}</span></td>
                    <td class="px-4 py-3 font-mono text-xs">${d.invoice_number || '—'}</td>
                    <td class="px-4 py-3 text-right">${fmtNum(d.balance_usd)}</td>
                    <td class="px-4 py-3 text-right">${fmtNum(d.balance_ves)}</td>
                    <td class="px-4 py-3 ${stClass}">${st}</td>
                    <td class="px-4 py-3 text-right">${cancelBtn}</td>
                </tr>`;
            }).join('');
        } catch (e) {
            tbody.innerHTML = `<tr><td colspan="6" class="px-4 py-6 text-center text-red-500">${e.message}</td></tr>`;
        }
    };

    window.downloadHistoricalDebtTemplate = async function () {
        if (!token) {
            if (typeof showPageToast === 'function') {
                showPageToast('Sesión expirada. Vuelva a iniciar sesión.', 'error');
            }
            return;
        }
        try {
            const res = await fetch(`/api/admin/tenants/${tenantId}/historical-debts/template.csv`, {
                headers: { Authorization: `Bearer ${token}` },
                credentials: 'same-origin'
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.error || 'Error al descargar plantilla');
            }
            const blob = await res.blob();
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = 'plantilla_deuda_historica.csv';
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(a.href);
            if (typeof showPageToast === 'function') {
                showPageToast('Plantilla descargada', 'success');
            }
        } catch (e) {
            if (typeof showPageToast === 'function') {
                showPageToast(e.message || 'Error al descargar plantilla', 'error');
            }
        }
    };

    async function loadPropertiesForHistoricalDebtSelect() {
        const sel = document.getElementById('hd-property-id');
        if (!sel || typeof tenantId === 'undefined') return;
        sel.innerHTML = '<option value="">Cargando inmuebles...</option>';
        try {
            const res = await fetch(`/api/admin/tenants/${tenantId}/properties?limit=10000`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            const data = await res.json();
            const list = data.properties || [];
            sel.innerHTML = '<option value="">Seleccione...</option>' + list.map((p) =>
                `<option value="${p.id}">${p.name}${p.building_name ? ' — ' + p.building_name : ''}</option>`
            ).join('');
        } catch (e) {
            sel.innerHTML = '<option value="">Error al cargar inmuebles</option>';
        }
    }

    window.openHistoricalDebtModal = function () {
        loadPropertiesForHistoricalDebtSelect();
        document.getElementById('historical-debt-modal')?.classList.remove('hidden');
        document.getElementById('historical-debt-modal')?.classList.add('flex');
        toggleHdFreezeFields();
    };

    window.closeHistoricalDebtModal = function () {
        document.getElementById('historical-debt-modal')?.classList.add('hidden');
        document.getElementById('historical-debt-modal')?.classList.remove('flex');
    };

    window.toggleHdFreezeFields = function () {
        const mode = document.getElementById('hd-freeze-mode')?.value || 'NONE';
        document.getElementById('hd-window-wrap')?.classList.toggle('hidden', mode !== 'WINDOW');
        document.getElementById('hd-migrate-wrap')?.classList.toggle('hidden', mode !== 'PERMANENT');
    };

    window.saveHistoricalDebt = async function (e) {
        e.preventDefault();
        const body = {
            property_id: document.getElementById('hd-property-id').value,
            amount: document.getElementById('hd-amount').value,
            currency: document.getElementById('hd-currency').value,
            description: document.getElementById('hd-description').value,
            rate_freeze_mode: document.getElementById('hd-freeze-mode').value,
            rate_freeze_window_days: document.getElementById('hd-window-days')?.value || null,
            rate_unpaid_migrate_after_month: document.getElementById('hd-migrate-month')?.checked || false
        };
        try {
            const res = await fetch(`/api/admin/tenants/${tenantId}/historical-debts`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                body: JSON.stringify(body)
            });
            const json = await res.json();
            if (!res.ok) throw new Error(json.error || 'Error al guardar');
            showPageToast(json.message || 'Deuda registrada', 'success');
            closeHistoricalDebtModal();
            loadHistoricalDebts();
        } catch (err) {
            showPageToast(err.message, 'error');
        }
    };

    window.openHistoricalDebtBulkModal = function () {
        hdCsvRows = [];
        document.getElementById('hd-csv-file').value = '';
        document.getElementById('hd-csv-preview').classList.add('hidden');
        document.getElementById('hd-bulk-submit').disabled = true;
        document.getElementById('historical-debt-bulk-modal')?.classList.remove('hidden');
        document.getElementById('historical-debt-bulk-modal')?.classList.add('flex');
    };

    window.closeHistoricalDebtBulkModal = function () {
        document.getElementById('historical-debt-bulk-modal')?.classList.add('hidden');
        document.getElementById('historical-debt-bulk-modal')?.classList.remove('flex');
    };

    function parseCsvLine(line) {
        const out = [];
        let cur = '';
        let inQ = false;
        for (let i = 0; i < line.length; i++) {
            const c = line[i];
            if (c === '"') { inQ = !inQ; continue; }
            if ((c === ',' && !inQ)) { out.push(cur.trim()); cur = ''; continue; }
            cur += c;
        }
        out.push(cur.trim());
        return out;
    }

    window.parseHistoricalDebtCsv = function (ev) {
        const file = ev.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
            const lines = String(reader.result).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
            const dataLines = lines.filter((l) => !l.startsWith('#') && !l.toLowerCase().startsWith('inmueble_slug'));
            hdCsvRows = dataLines.map((line) => {
                const p = parseCsvLine(line);
                return {
                    inmueble_slug: p[0],
                    monto: p[1],
                    moneda: p[2] || 'USD',
                    descripcion: p[3] || '',
                    congelamiento_tasa: p[4] || 'NONE',
                    dias_ventana: p[5] || '',
                    migrar_mes_impago: p[6] || '0'
                };
            });
            const prev = document.getElementById('hd-csv-preview');
            prev.classList.remove('hidden');
            prev.innerHTML = `<p class="font-medium mb-1">${hdCsvRows.length} fila(s)</p>` +
                hdCsvRows.slice(0, 8).map((r) => `${r.inmueble_slug}: ${r.monto} ${r.moneda}`).join('<br>') +
                (hdCsvRows.length > 8 ? '<br>...' : '');
            document.getElementById('hd-bulk-submit').disabled = hdCsvRows.length === 0;
        };
        reader.readAsText(file);
    };

    window.submitHistoricalDebtBulk = async function () {
        if (!hdCsvRows.length) return;
        const btn = document.getElementById('hd-bulk-submit');
        btn.disabled = true;
        try {
            const res = await fetch(`/api/admin/tenants/${tenantId}/historical-debts/bulk`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                body: JSON.stringify({ rows: hdCsvRows })
            });
            const json = await res.json();
            if (!res.ok) {
                const msg = json.errorDetails?.join(' ') || json.error || 'Error en carga masiva';
                throw new Error(msg);
            }
            showPageToast(json.message || 'Carga completada', 'success');
            closeHistoricalDebtBulkModal();
            loadHistoricalDebts();
        } catch (err) {
            showPageToast(err.message, 'error');
        } finally {
            btn.disabled = false;
        }
    };

    window.cancelHistoricalDebt = function (debtId) {
        const reason = prompt('Motivo de anulación (opcional):');
        if (reason === null) return;
        fetch(`/api/admin/tenants/${tenantId}/historical-debts/${debtId}/cancel`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ reason })
        }).then(async (res) => {
            const json = await res.json();
            if (!res.ok) throw new Error(json.error || 'Error');
            showPageToast('Deuda anulada', 'success');
            loadHistoricalDebts();
        }).catch((e) => showPageToast(e.message, 'error'));
    };
})();
