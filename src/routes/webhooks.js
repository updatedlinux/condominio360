const express = require('express');
const MailgunWebhookController = require('../controllers/MailgunWebhookController');

const router = express.Router();

router.post('/mailgun', MailgunWebhookController.handle);

module.exports = router;
