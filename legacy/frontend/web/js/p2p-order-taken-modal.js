/**
 * Modal "Tu orden fue tomada" - P2P
 * Se muestra cuando un Maker tiene un trade activo reciente (48h) y no lo ha descartado.
 *
 * Uso:
 *   initOrderTakenModal({
 *     tradeViewUrl: (tradeId) => '/p2p-trade?tradeId=' + tradeId,
 *     containerId: 'p2pOrderTakenModalContainer',
 *     apiBaseUrl: '' // opcional, por defecto ''
 *   });
 */

/**
 * El modal se muestra siempre que exista un trade activo (WAITING_PAYMENT, PAYMENT_CONFIRMED, DISPUTED).
 * No se persiste el cierre en localStorage: al recargar la página volverá a mostrarse si el trade sigue activo.
 */

function initOrderTakenModal(options) {
  const {
    tradeViewUrl = (id) => '/p2p-trade?tradeId=' + id,
    containerId = 'p2pOrderTakenModalContainer',
    apiBaseUrl = '',
  } = options || {};

  const container = document.getElementById(containerId);
  if (!container) return;

  const overlay = container.querySelector('.p2p-order-taken-overlay');
  const closeBtn = container.querySelector('.modal-close-btn');
  const goTradeBtn = container.querySelector('.btn-go-trade');

  function hide() {
    if (overlay) overlay.classList.remove('show');
  }

  function show(trade) {
    if (!overlay) return;

    const typeLabel = (trade.orderType || '').toUpperCase() === 'SELL' ? 'Venta' : 'Compra';
    const takerName = trade.taker?.profile?.firstName
      ? `${trade.taker.profile.firstName} ${trade.taker.profile.lastName || ''}`.trim()
      : (trade.taker?.email || 'Usuario');

    container.querySelector('.trade-type').textContent = typeLabel;
    container.querySelector('.trade-asset').textContent = `${trade.cryptoAsset} / ${trade.fiatCurrency}`;
    container.querySelector('.trade-amount').textContent =
      Number(trade.cryptoAmount).toLocaleString('es', { minimumFractionDigits: 2 }) + ' ' + trade.cryptoAsset;
    container.querySelector('.trade-fiat').textContent =
      Number(trade.fiatAmount).toLocaleString('es', { minimumFractionDigits: 2 }) + ' ' + trade.fiatCurrency;
    container.querySelector('.trade-taker').textContent = takerName;

    if (goTradeBtn) {
      goTradeBtn.href = tradeViewUrl(trade.id);
    }

    overlay.classList.add('show');
  }

  if (closeBtn) {
    closeBtn.addEventListener('click', hide);
  }

  overlay?.addEventListener('click', function (e) {
    if (e.target === overlay) hide();
  });

  return {
    checkAndShow: async function () {
      const token = localStorage.getItem('accessToken');
      if (!token) return;

      try {
        const res = await fetch(apiBaseUrl + '/api/p2p/notifications/order-taken', {
          headers: { Authorization: 'Bearer ' + token },
        });
        if (!res.ok) return;

        const data = await res.json();
        const trade = data.trade;
        if (!trade || !trade.id) return;

        overlay.dataset.tradeId = trade.id;
        show(trade);
      } catch {
        // Silencioso
      }
    },
    hide,
  };
}
