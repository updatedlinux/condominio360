/**
 * Fondos de reserva + edición proveedores/contratos (requiere variables globales de billing.ejs: token, showToast, etc.)
 */
(function () {
    if (typeof window === 'undefined') return;

    function fmtContractDate(d) {
        if (!d) return '—';
        const s = String(d).split('T')[0];
        if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
        const [y, m, da] = s.split('-');
        return `${da}/${m}/${y}`;
    }

    window.renderVendorsWithActions = function (vendors) {
        window.allVendors = vendors || [];
        const container = document.getElementById('vendors-list');
        if (!container) return;
        if (!vendors.length) {
            container.innerHTML = '<div class="text-center py-8 text-[#9AA0A6]"><p>No hay proveedores registrados</p></div>';
            return;
        }
        container.innerHTML = vendors.map(v => `
            <div class="border border-[#E5E5E5] rounded-lg p-4 flex justify-between items-center gap-4">
                <div>
                    <h3 class="font-medium text-[#3C4043]">${escapeHtml(v.name)}</h3>
                    <p class="text-sm text-[#5F6368]">${escapeHtml(v.service_type || 'Sin tipo')} • ${v.active_contracts || 0} contratos activos</p>
                </div>
                <div class="flex items-center gap-2 shrink-0">
                    <span class="px-2 py-1 rounded text-xs ${getStatusClass(v.status)}">${v.status}</span>
                    <button type="button" onclick="openEditVendor('${v.id}')" class="text-xs text-[#f97316] hover:underline">Editar</button>
                </div>
            </div>
        `).join('');
    };

    window.renderContractsWithActions = function (contracts) {
        window.allContracts = contracts || [];
        const container = document.getElementById('contracts-list');
        if (!container) return;
        if (!contracts.length) {
            container.innerHTML = '<div class="text-center py-8 text-[#9AA0A6]"><p>No hay contratos registrados</p></div>';
            return;
        }
        container.innerHTML = contracts.map(c => `
            <div class="border border-[#E5E5E5] rounded-lg p-4 flex justify-between items-start gap-4">
                <div>
                    <h3 class="font-medium text-[#3C4043]">${escapeHtml(c.vendor_name)}</h3>
                    <p class="text-sm text-[#5F6368]">${escapeHtml(c.description)}</p>
                    <p class="text-sm mt-1"><b>${formatCurrency(c.amount, c.currency)}</b> • ${c.billing_frequency} • ${fmtContractDate(c.start_date)}</p>
                </div>
                <div class="flex items-center gap-2 shrink-0">
                    <span class="px-2 py-1 rounded text-xs ${getStatusClass(c.status)}">${c.status}</span>
                    <button type="button" onclick="openEditContract('${c.id}')" class="text-xs text-[#f97316] hover:underline">Editar</button>
                </div>
            </div>
        `).join('');
    };

    window.openEditVendor = function (id) {
        const v = (window.allVendors || []).find(x => String(x.id) === String(id));
        if (!v) return;
        document.getElementById('vendor-edit-id').value = v.id;
        document.getElementById('vendor-modal-title').textContent = 'Editar proveedor';
        document.getElementById('vendor-name').value = v.name || '';
        document.getElementById('vendor-service').value = v.service_type || '';
        document.getElementById('vendor-description').value = v.description || '';
        document.getElementById('vendor-contact-name').value = v.contact_name || '';
        document.getElementById('vendor-contact-email').value = v.contact_email || '';
        document.getElementById('vendor-contact-phone').value = v.contact_phone || '';
        showModal('vendor-modal');
    };

    window.openEditContract = async function (id) {
        const c = (window.allContracts || []).find(x => String(x.id) === String(id));
        if (!c) return;
        await openCreateContractModal();
        document.getElementById('contract-edit-id').value = c.id;
        document.getElementById('contract-modal-title').textContent = 'Editar contrato';
        document.getElementById('contract-vendor').value = c.vendor_id;
        document.getElementById('contract-description').value = c.description || '';
        document.getElementById('contract-amount').value = c.amount;
        document.getElementById('contract-currency').value = c.currency || 'VES';
        document.getElementById('contract-frequency').value = c.billing_frequency || 'MONTHLY';
        document.getElementById('contract-start').value = String(c.start_date || '').split('T')[0];
        document.getElementById('contract-end').value = c.end_date ? String(c.end_date).split('T')[0] : '';
        document.getElementById('contract-status').value = c.status || 'ACTIVE';
        document.getElementById('contract-status-wrap').classList.remove('hidden');
    };

    async function loadRfContractCheckboxes(selectedIds) {
        const sel = new Set((selectedIds || []).map(String));
        const res = await fetch('/api/tenant-admin/billing/contracts', {
            headers: { Authorization: `Bearer ${token}` }
        });
        const json = await res.json();
        const list = document.getElementById('rf-contracts-list');
        if (!list) return;
        const contracts = (json.data || []).filter(c => c.status === 'ACTIVE');
        if (!contracts.length) {
            list.innerHTML = '<p class="text-[#9AA0A6]">No hay contratos activos. Créelos en la pestaña Contratos.</p>';
            return;
        }
        list.innerHTML = contracts.map(c => `
            <label class="flex items-start gap-2 cursor-pointer">
                <input type="checkbox" class="rf-contract-cb mt-1 rounded" value="${c.id}" ${sel.has(String(c.id)) ? 'checked' : ''}>
                <span><b>${escapeHtml(c.vendor_name)}</b> — ${escapeHtml(c.description)} (${formatCurrency(c.amount, c.currency)})</span>
            </label>
        `).join('');
    }

    window.openReserveFundModal = async function (id) {
        if (billingConfig && billingConfig.billing_mode !== 'FULL') {
            showToast('Los fondos de reserva solo están disponibles en Modo Completo', 'error');
            return;
        }
        document.getElementById('reserve-fund-form').reset();
        document.getElementById('reserve-fund-edit-id').value = '';
        document.getElementById('reserve-fund-modal-title').textContent = 'Nuevo fondo de reserva';
        let selected = [];
        if (id) {
            const f = (window.allReserveFunds || []).find(x => String(x.id) === String(id));
            if (f) {
                document.getElementById('reserve-fund-edit-id').value = f.id;
                document.getElementById('reserve-fund-modal-title').textContent = 'Editar fondo de reserva';
                document.getElementById('rf-name').value = f.name || '';
                document.getElementById('rf-nature').value = f.fund_nature || 'ORDINARY_RESERVE';
                document.getElementById('rf-percentage').value = f.percentage;
                document.getElementById('rf-include-extra').checked = !!f.include_extraordinary;
                document.getElementById('rf-notes').value = f.notes || '';
                selected = f.contract_ids || [];
            }
        }
        await loadRfContractCheckboxes(selected);
        showModal('reserve-fund-modal');
    };

    window.deactivateReserveFund = async function (id) {
        if (!confirm('¿Desactivar este fondo?')) return;
        try {
            const res = await fetch(`/api/tenant-admin/billing/reserve-funds/${id}`, {
                method: 'DELETE',
                headers: { Authorization: `Bearer ${token}` }
            });
            const json = await res.json();
            if (res.ok && json.success) {
                showToast('Fondo desactivado');
                loadReserveFunds();
            } else {
                showToast(json.error || 'Error', 'error');
            }
        } catch (e) {
            showToast('Error de conexión', 'error');
        }
    };

    window.syncReserveFundPreliminaryItems = async function () {
        if (!billingConfig || billingConfig.billing_mode !== 'FULL') return;
        const items = window.preliminaryItems || [];
        window.preliminaryItems = items.filter(i => !i._autoReserveFund);
        const payload = window.preliminaryItems.map(i => ({
            item_type: i.type,
            amount: i.amount,
            currency: i.currency,
            vendor_contract_id: i.contract_id || null
        }));
        try {
            const res = await fetch('/api/tenant-admin/billing/reserve-funds/preview', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                body: JSON.stringify({ items: payload })
            });
            const json = await res.json();
            if (!res.ok || !json.success) {
                showToast(json.error || 'No se pudo calcular el fondo de reserva', 'error');
                return;
            }
            let added = 0;
            (json.data.previews || []).forEach(p => {
                if (!p.amount_ves || p.amount_ves <= 0) return;
                added += 1;
                const baseUsd = Number(p.base_usd || 0);
                window.preliminaryItems.push({
                    type: 'FUND',
                    description: `${p.fund.name} (${p.percentage}% sobre $ ${baseUsd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD)`,
                    amount: p.amount_ves,
                    currency: 'VES',
                    reserve_fund_id: p.fund.id,
                    _autoReserveFund: true
                });
            });
            if (added === 0) {
                const hint = (json.data.previews || []).some(p => (p.fund.contract_ids || []).length > 0)
                    ? 'Ningún ítem del preliminar coincide con los contratos del fondo. Verifique contratos activos y montos.'
                    : 'Configure al menos un contrato en el fondo de reserva.';
                showToast(hint, 'warning');
            }
            renderPreliminaryItems();
        } catch (e) {
            console.error('syncReserveFundPreliminaryItems', e);
            showToast('Error al calcular fondos de reserva', 'error');
        }
    };

    document.addEventListener('DOMContentLoaded', function () {
        const rfForm = document.getElementById('reserve-fund-form');
        if (rfForm) {
            rfForm.addEventListener('submit', async function (e) {
                e.preventDefault();
                const contract_ids = Array.from(document.querySelectorAll('.rf-contract-cb:checked')).map(el => el.value);
                const body = {
                    name: document.getElementById('rf-name').value,
                    fund_nature: document.getElementById('rf-nature').value,
                    percentage: parseFloat(document.getElementById('rf-percentage').value),
                    include_extraordinary: document.getElementById('rf-include-extra').checked,
                    contract_ids,
                    notes: document.getElementById('rf-notes').value
                };
                const editId = document.getElementById('reserve-fund-edit-id').value;
                const url = editId
                    ? `/api/tenant-admin/billing/reserve-funds/${editId}`
                    : '/api/tenant-admin/billing/reserve-funds';
                const method = editId ? 'PUT' : 'POST';
                try {
                    const res = await fetch(url, {
                        method,
                        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                        body: JSON.stringify(body)
                    });
                    const json = await res.json();
                    if (json.success) {
                        showToast(editId ? 'Fondo actualizado' : 'Fondo creado');
                        closeModal('reserve-fund-modal');
                        loadReserveFunds();
                    } else {
                        showToast(json.error || 'Error', 'error');
                    }
                } catch (err) {
                    showToast('Error de conexión', 'error');
                }
            });
        }
    });
})();
