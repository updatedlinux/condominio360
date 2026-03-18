const express = require('express');
const router = express.Router();
const ConsultationController = require('../controllers/ConsultationController');
const { authenticate } = require('../middleware/auth');

router.use(authenticate);

// List Active (Filtered by user building)
router.get('/active', ConsultationController.listActive);

// List Closed (for owner to see results and print PDF)
router.get('/closed', ConsultationController.listClosed);

// Get Details
router.get('/:id', ConsultationController.getById);

// Vote
router.post('/:id/vote', ConsultationController.vote);

// Results
router.get('/:id/results', ConsultationController.getResults);

module.exports = router;
