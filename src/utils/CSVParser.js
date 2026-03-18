/**
 * Utilidad para parsear archivos CSV
 * Soporta formatos:
 * - CSV de Unidades: name, type, building, floor, area_sqm, alicuota
 * - CSV de Propietarios: dni, first_name, last_name, email, phone, unit_name, percentage_ownership, is_primary
 */

class CSVParser {
    /**
     * Parse CSV string to array of objects
     * @param {string} csvString - Raw CSV content
     * @param {Object} options - Parsing options
     * @returns {Array} Parsed records
     */
    static parse(csvString, options = {}) {
        const {
            delimiter = ',',
            hasHeader = true,
            skipEmptyLines = true
        } = options;

        const lines = csvString.split('\n');
        const records = [];
        let headers = [];

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            
            // Skip empty lines
            if (!line && skipEmptyLines) continue;
            
            // Parse line
            const values = this._parseLine(line, delimiter);
            
            if (i === 0 && hasHeader) {
                headers = values.map(h => h.trim().toLowerCase().replace(/\s+/g, '_'));
                continue;
            }

            if (hasHeader) {
                const record = {};
                headers.forEach((header, index) => {
                    record[header] = values[index] ? values[index].trim() : null;
                });
                records.push(record);
            } else {
                records.push(values);
            }
        }

        return records;
    }

    /**
     * Parse a single CSV line handling quoted values
     * @param {string} line 
     * @param {string} delimiter 
     * @returns {Array}
     */
    static _parseLine(line, delimiter) {
        const values = [];
        let current = '';
        let inQuotes = false;

        for (let i = 0; i < line.length; i++) {
            const char = line[i];
            const nextChar = line[i + 1];

            if (char === '"') {
                if (inQuotes && nextChar === '"') {
                    // Escaped quote
                    current += '"';
                    i++; // Skip next quote
                } else {
                    // Toggle quote state
                    inQuotes = !inQuotes;
                }
            } else if (char === delimiter && !inQuotes) {
                values.push(current);
                current = '';
            } else {
                current += char;
            }
        }

        // Don't forget the last value
        values.push(current);

        return values;
    }

    /**
     * Parse CSV for Properties (Units)
     * Expected columns: name, type, building, floor, area_sqm, alicuota
     * @param {string} csvString 
     * @returns {Object} { valid: Array, errors: Array }
     */
    static parseProperties(csvString) {
        const records = this.parse(csvString);
        const valid = [];
        const errors = [];

        const requiredFields = ['name', 'type'];
        const validTypes = ['Apartment', 'House', 'Store', 'Lot', 'Office', 'Parking', 'Storage'];

        records.forEach((record, index) => {
            const lineNum = index + 2; // +2 because of header and 0-indexing
            const recordErrors = [];

            // Check required fields
            for (const field of requiredFields) {
                if (!record[field] || record[field].trim() === '') {
                    recordErrors.push(`Campo '${field}' es requerido`);
                }
            }

            // Validate type
            if (record.type && !validTypes.includes(record.type)) {
                recordErrors.push(`Tipo '${record.type}' no válido. Usar: ${validTypes.join(', ')}`);
            }

            // Parse numeric fields
            const area_sqm = record.area_sqm ? parseFloat(record.area_sqm) : null;
            const alicuota = record.alicuota ? parseFloat(record.alicuota) : 0;

            if (record.area_sqm && isNaN(area_sqm)) {
                recordErrors.push(`Área '${record.area_sqm}' no es un número válido`);
            }

            if (record.alicuota && isNaN(alicuota)) {
                recordErrors.push(`Alícuota '${record.alicuota}' no es un número válido`);
            }

            if (recordErrors.length > 0) {
                errors.push({ line: lineNum, record, errors: recordErrors });
            } else {
                valid.push({
                    name: record.name.trim(),
                    type: record.type.trim(),
                    building: record.building?.trim() || null,
                    floor: record.floor?.trim() || null,
                    area_sqm: area_sqm,
                    alicuota: alicuota
                });
            }
        });

        return { valid, errors, total: records.length };
    }

    /**
     * Parse CSV for Property Owners
     * Expected columns: dni, first_name, last_name, email, phone, unit_name, percentage_ownership, is_primary
     * @param {string} csvString 
     * @returns {Object} { valid: Array, errors: Array }
     */
    static parseOwners(csvString) {
        const records = this.parse(csvString);
        const valid = [];
        const errors = [];

        const requiredFields = ['dni', 'first_name', 'last_name', 'unit_name'];

        records.forEach((record, index) => {
            const lineNum = index + 2;
            const recordErrors = [];

            // Check required fields
            for (const field of requiredFields) {
                if (!record[field] || record[field].trim() === '') {
                    recordErrors.push(`Campo '${field}' es requerido`);
                }
            }

            // Validate DNI (cédula venezolana: solo números, 7-8 dígitos)
            if (record.dni) {
                const dniClean = record.dni.trim().replace(/\./g, '');
                if (!/^\d{7,8}$/.test(dniClean)) {
                    recordErrors.push(`DNI '${record.dni}' no tiene formato válido (7-8 dígitos)`);
                }
                record.dni = dniClean;
            }

            // Validate email if provided
            if (record.email && !this._isValidEmail(record.email)) {
                recordErrors.push(`Email '${record.email}' no tiene formato válido`);
            }

            // Parse percentage
            let percentage = 100.00;
            if (record.percentage_ownership) {
                percentage = parseFloat(record.percentage_ownership);
                if (isNaN(percentage) || percentage <= 0 || percentage > 100) {
                    recordErrors.push(`Porcentaje '${record.percentage_ownership}' debe ser entre 0 y 100`);
                }
            }

            // Parse is_primary
            let is_primary = true;
            if (record.is_primary !== undefined) {
                const val = record.is_primary.toString().toLowerCase().trim();
                is_primary = val === '1' || val === 'true' || val === 'yes' || val === 'si';
            }

            if (recordErrors.length > 0) {
                errors.push({ line: lineNum, record, errors: recordErrors });
            } else {
                valid.push({
                    dni: record.dni.trim(),
                    first_name: record.first_name.trim(),
                    last_name: record.last_name.trim(),
                    email: record.email?.trim() || null,
                    phone: record.phone?.trim() || null,
                    unit_name: record.unit_name.trim(),
                    percentage_ownership: percentage,
                    is_primary: is_primary
                });
            }
        });

        return { valid, errors, total: records.length };
    }

    /**
     * Parse combined CSV for Onboarding (Units + Owners)
     * Expected format includes both unit and owner info
     * @param {string} csvString 
     * @returns {Object} { units: Array, owners: Array, errors: Array }
     */
    static parseOnboardingCSV(csvString) {
        const records = this.parse(csvString);
        const units = new Map(); // Use map to avoid duplicates
        const owners = [];
        const errors = [];

        records.forEach((record, index) => {
            const lineNum = index + 2;
            const recordErrors = [];

            // Required: at least unit_name and owner dni/name
            if (!record.unit_name) {
                recordErrors.push('Campo unit_name es requerido');
            }
            if (!record.dni) {
                recordErrors.push('Campo dni es requerido');
            }
            if (!record.first_name || !record.last_name) {
                recordErrors.push('Campos first_name y last_name son requeridos');
            }

            if (recordErrors.length > 0) {
                errors.push({ line: lineNum, record, errors: recordErrors });
                return;
            }

            // Add/Update unit
            const unitName = record.unit_name.trim();
            if (!units.has(unitName)) {
                units.set(unitName, {
                    name: unitName,
                    type: record.unit_type?.trim() || 'Apartment',
                    building: record.building?.trim() || null,
                    floor: record.floor?.trim() || null,
                    area_sqm: record.area_sqm ? parseFloat(record.area_sqm) : null,
                    alicuota: record.alicuota ? parseFloat(record.alicuota) : 0
                });
            }

            // Parse percentage
            let percentage = 100.00;
            if (record.percentage_ownership) {
                percentage = parseFloat(record.percentage_ownership);
            }

            // Parse is_primary
            let is_primary = true;
            if (record.is_primary !== undefined) {
                const val = record.is_primary.toString().toLowerCase().trim();
                is_primary = val === '1' || val === 'true' || val === 'yes' || val === 'si';
            }

            // Clean DNI
            const dni = record.dni.trim().replace(/\./g, '');

            // Add owner
            owners.push({
                dni: dni,
                first_name: record.first_name.trim(),
                last_name: record.last_name.trim(),
                email: record.email?.trim() || null,
                phone: record.phone?.trim() || null,
                unit_name: unitName,
                percentage_ownership: percentage,
                is_primary: is_primary
            });
        });

        return {
            units: Array.from(units.values()),
            owners,
            errors,
            total: records.length
        };
    }

    /**
     * Generate sample CSV template for properties
     * @returns {string}
     */
    static getPropertiesTemplate() {
        return `name,type,building,floor,area_sqm,alicuota
Apto 101,Apartment,Torre A,1,85.50,1.2500
Apto 102,Apartment,Torre A,1,92.00,1.3400
Apto 201,Apartment,Torre A,2,85.50,1.2500
Casa 1,House,,,120.00,2.5000
Local 1,Store,Planta Baja,,45.00,0.8000`;
    }

    /**
     * Generate sample CSV template for owners
     * @returns {string}
     */
    static getOwnersTemplate() {
        return `dni,first_name,last_name,email,phone,unit_name,percentage_ownership,is_primary
12345678,Pedro,Pérez,pedro@email.com,04141234567,Apto 101,60,1
87654321,Anabel,Pérez,anabel@email.com,04149876543,Apto 101,40,0
23456789,Juan,García,juan@email.com,04142345678,Apto 102,100,1
34567890,María,López,maria@email.com,04143456789,Casa 1,50,1
45678901,Carlos,López,carlos@email.com,04144567890,Casa 1,50,0`;
    }

    /**
     * Generate sample CSV template for combined onboarding
     * @returns {string}
     */
    static getOnboardingTemplate() {
        return `unit_name,unit_type,building,floor,area_sqm,alicuota,dni,first_name,last_name,email,phone,percentage_ownership,is_primary
Apto 101,Apartment,Torre A,1,85.50,1.2500,12345678,Pedro,Pérez,pedro@email.com,04141234567,60,1
Apto 101,Apartment,Torre A,1,85.50,1.2500,87654321,Anabel,Pérez,anabel@email.com,04149876543,40,0
Apto 102,Apartment,Torre A,1,92.00,1.3400,23456789,Juan,García,juan@email.com,04142345678,100,1
Casa 1,House,,,120.00,2.5000,34567890,María,López,maria@email.com,04143456789,50,1
Casa 1,House,,,120.00,2.5000,45678901,Carlos,López,carlos@email.com,04144567890,50,0`;
    }

    /**
     * Validate email format
     * @param {string} email 
     * @returns {boolean}
     */
    static _isValidEmail(email) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return emailRegex.test(email);
    }
}

module.exports = CSVParser;
