const express = require('express');
const router = express.Router();
const CommuniqueController = require('../controllers/OwnerCommuniqueController');
const { authenticate, requireOwner } = require('../middleware/auth');

// Todas las rutas requieren autenticación de Owner
router.use(authenticate, requireOwner);

// Rutas
router.get('/', CommuniqueController.getCommuniques);
router.get('/unread/count', CommuniqueController.getUnreadCount);
router.get('/:id', CommuniqueController.getCommuniqueById);
router.get('/:id/read', CommuniqueController.checkReadStatus);
router.post('/:id/read', CommuniqueController.markAsRead);

module.exports = router;
