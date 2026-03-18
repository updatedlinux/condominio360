const express = require('express');
const router = express.Router();
const TenantController = require('../controllers/TenantController');
const { authenticate } = require('../middleware/auth');

router.use(authenticate);

router.get('/current', TenantController.show);
router.put('/current', TenantController.update);

module.exports = router;
