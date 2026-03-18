const express = require('express');
const router = express.Router();
const RequestController = require('../controllers/RequestController');
const RequestTypeController = require('../controllers/RequestTypeController');
const { authenticate } = require('../middleware/auth');

router.use(authenticate);

// Request Types Routes
router.get('/types', RequestTypeController.index);
router.post('/types', RequestTypeController.create);

// Request Routes
router.get('/', RequestController.index);
router.post('/', RequestController.create);
router.put('/:id/status', RequestController.updateStatus);

module.exports = router;
