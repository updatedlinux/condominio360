const express = require('express');
const MailgunWebhookController = require('../controllers/MailgunWebhookController');
const OpenWAWebhookController = require('../controllers/OpenWAWebhookController');

const router = express.Router();

router.post('/mailgun', MailgunWebhookController.handle);
router.post('/openwa', OpenWAWebhookController.handle);

module.exports = router;
