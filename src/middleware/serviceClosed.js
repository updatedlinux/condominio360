const { SERVICE_CLOSED } = require('../config/siteStatus');

const CLOSED_MESSAGE = 'El servicio de Condominio360 está cerrado hasta nuevo aviso.';

function rejectIfServiceClosed(req, res, next) {
    if (!SERVICE_CLOSED) return next();
    return res.status(503).json({ success: false, error: CLOSED_MESSAGE });
}

module.exports = { rejectIfServiceClosed, SERVICE_CLOSED, CLOSED_MESSAGE };
