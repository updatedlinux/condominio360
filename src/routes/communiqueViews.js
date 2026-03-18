const express = require('express');
const router = express.Router();
const CommuniqueModel = require('../models/CommuniqueModel');
const path = require('path');

/**
 * Rutas de vistas para Comunicados
 * NOTA: No usamos middleware authenticate aquí porque el token está en localStorage
 * La autenticación se maneja en el frontend (JavaScript)
 */

// Tenant Admin Views
router.get('/tenant-admin/communiques', (req, res) => {
    res.render('tenant-admin/communiques/list');
});

// Owner Views
router.get('/owner/communiques', (req, res) => {
    res.render('owner/communiques/list');
});

router.get('/owner/communiques/:id', async (req, res) => {
    try {
        const { id } = req.params;
        
        // Nota: Para las vistas EJS no verificamos tenantId en el servidor
        // El controlador de la API se encarga de eso cuando el frontend hace las peticiones
        const communique = await CommuniqueModel.findById(id);
        
        if (!communique) {
            return res.status(404).render('error', { 
                message: 'Comunicado no encontrado',
                error: { status: 404 }
            });
        }

        // Extraer el filename del storage_path
        const filename = communique.storage_path ? path.basename(communique.storage_path) : null;

        res.render('owner/communiques/detail', {
            communique: {
                ...communique,
                filename
            }
        });
    } catch (error) {
        console.error('Error loading communique view:', error);
        res.status(500).render('error', { 
            message: 'Error al cargar el comunicado',
            error: { status: 500 }
        });
    }
});

module.exports = router;
