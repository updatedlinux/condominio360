const express = require('express');
const router = express.Router();
const VisitorController = require('../controllers/VisitorController');
const { authenticate } = require('../middleware/auth');

router.use(authenticate);

router.get('/active', VisitorController.getActive);
router.get('/search', VisitorController.search);
router.post('/entry', VisitorController.registerEntry);
router.post('/passes', VisitorController.createPass); // New route for pre-authorization
router.put('/exit/:visitId', VisitorController.registerExit);

module.exports = router;
