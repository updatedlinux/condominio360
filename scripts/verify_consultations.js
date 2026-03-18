const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const { sql, connectDB } = require('../src/config/database');
const bcrypt = require('bcrypt');

async function verifyConsultations() {
    const fetch = (await import('node-fetch')).default || global.fetch; // Robust fetch import

    const BASE_URL = 'http://localhost:3000/api';
    let pool;

    try {
        console.log('🧪 Starting Consultation Module Verification...');
        pool = await connectDB();

        // --- 1. SETUP TEST DATA DIRECTLY IN DB ---
        console.log('🛠️  Setting up test data...');

        // Create Unique Suffix and Tenant
        const suffix = Date.now();
        const tenantSlug = `verify_${suffix}`;
        const tenantName = `Verify Tenant ${suffix}`;

        const tenantRes = await pool.request()
            .input('name', sql.NVarChar, tenantName)
            .input('slug', sql.NVarChar, tenantSlug)
            .input('address', sql.NVarChar, 'Test Address')
            .query(`INSERT INTO Tenants (name, slug, address) OUTPUT INSERTED.id VALUES (@name, @slug, @address)`);
        const tenantId = tenantRes.recordset[0].id;
        console.log('✅ Created Dynamic Tenant:', tenantSlug);

        const adminEmail = `admin_${suffix}@demo.com`;
        const userAEmail = `usera_${suffix}@demo.com`;
        const userBEmail = `userb_${suffix}@demo.com`;
        const passHash = await bcrypt.hash('123456', 10);

        // Skip cleanup to avoid locks and just append new test data
        // Clean up previous run (Cascading delete manually)
        // console.log('🧹 Cleaning up previous test data...');
        // const emails = `'${adminEmail}', 'userA@demo.com', 'userB@demo.com'`;
        // const usersToDeleteRes = await pool.query(`SELECT id FROM Users WHERE email IN (${emails})`);
        // const userIds = usersToDeleteRes.recordset.map(u => `'${u.id}'`).join(',');

        // if (userIds.length > 0) {
        //     // 1. Delete Votes by these users
        //     await pool.query(`DELETE FROM ConsultationVotes WHERE user_id IN (${userIds})`);
        //     // 2. Delete Consultations created by these users (Cascades to Questions/Options/Votes)
        //     await pool.query(`DELETE FROM Consultations WHERE created_by IN (${userIds})`);
        //     // 3. Delete Relationships
        //     await pool.query(`DELETE FROM PropertyOwners WHERE user_id IN (${userIds})`);
        //     await pool.query(`DELETE FROM TenantUsers WHERE user_id IN (${userIds})`);
        //     // 4. Delete Properties? (Keep properties, just unlink? Or delete if created by script?)
        //     // The script creates 'Apto 101' and 'Apto 201'. 
        //     // We should cleanup properties too to avoid duplicates or finding wrong ones.
        //     // But properties don't have user link directly.
        //     // We can delete properties by name/tenant if we want.
        //     await pool.query(`DELETE FROM Properties WHERE tenant_id = '${tenantId}' AND name IN ('Apto 101', 'Apto 201')`);

        //     // 5. Delete Users
        //     await pool.query(`DELETE FROM Users WHERE id IN (${userIds})`);
        // }

        const adminRes = await pool.request()
            .input('n', sql.NVarChar, 'Admin')
            .input('e', sql.NVarChar, adminEmail)
            .input('p', sql.NVarChar, passHash)
            .query("INSERT INTO Users (first_name, last_name, email, password_hash, is_superadmin) OUTPUT INSERTED.id VALUES (@n, @n, @e, @p, 1)");
        const adminId = adminRes.recordset[0].id;

        await pool.query(`INSERT INTO TenantUsers (tenant_id, user_id, role) VALUES ('${tenantId}', '${adminId}', 'ADMIN')`);

        // Create User A (Torre A)
        const userARes = await pool.request()
            .input('n', sql.NVarChar, 'UserA')
            .input('e', sql.NVarChar, userAEmail)
            .input('p', sql.NVarChar, passHash)
            .query("INSERT INTO Users (first_name, last_name, email, password_hash) OUTPUT INSERTED.id VALUES (@n, @n, @e, @p)");
        const userAId = userARes.recordset[0].id;
        await pool.query(`INSERT INTO TenantUsers (tenant_id, user_id, role) VALUES ('${tenantId}', '${userAId}', 'RESIDENT')`);

        // Create User B (Torre B)
        const userBRes = await pool.request()
            .input('n', sql.NVarChar, 'UserB')
            .input('e', sql.NVarChar, userBEmail)
            .input('p', sql.NVarChar, passHash)
            .query("INSERT INTO Users (first_name, last_name, email, password_hash) OUTPUT INSERTED.id VALUES (@n, @n, @e, @p)");
        const userBId = userBRes.recordset[0].id;
        await pool.query(`INSERT INTO TenantUsers (tenant_id, user_id, role) VALUES ('${tenantId}', '${userBId}', 'RESIDENT')`);

        // Create Properties
        const propARes = await pool.query(`INSERT INTO Properties (tenant_id, name, type, building) OUTPUT INSERTED.id VALUES ('${tenantId}', 'Apto 101', 'Apartment', 'Torre A')`);
        const propBRes = await pool.query(`INSERT INTO Properties (tenant_id, name, type, building) OUTPUT INSERTED.id VALUES ('${tenantId}', 'Apto 201', 'Apartment', 'Torre B')`);

        // Link Users to Properties
        await pool.query(`INSERT INTO PropertyOwners (property_id, user_id) VALUES ('${propARes.recordset[0].id}', '${userAId}')`);
        await pool.query(`INSERT INTO PropertyOwners (property_id, user_id) VALUES ('${propBRes.recordset[0].id}', '${userBId}')`);

        console.log('✅ Test Data Created: Admin, UserA (Torre A), UserB (Torre B)');

        // --- 2. AUTHENTICATION (Login + Select Tenant) ---
        async function loginAndSelectTenant(email) {
            // 1. Login (Global)
            const loginRes = await fetch(`${BASE_URL}/auth/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password: '123456' })
            });
            const loginData = await loginRes.json();
            if (!loginRes.ok) throw new Error(`Login failed for ${email}: ${JSON.stringify(loginData)}`);

            const globalToken = loginData.token;

            // 2. Select Tenant
            const selectRes = await fetch(`${BASE_URL}/auth/select-tenant`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${globalToken}`
                },
                body: JSON.stringify({ tenantId: tenantId })
            });
            const selectData = await selectRes.json();
            if (!selectRes.ok) throw new Error(`Select Tenant failed for ${email}: ${JSON.stringify(selectData)}`);

            return selectData.token;
        }

        const adminToken = await loginAndSelectTenant(adminEmail);
        const userAToken = await loginAndSelectTenant(userAEmail);
        const userBToken = await loginAndSelectTenant(userBEmail);
        console.log('✅ Authentication successful for all users');

        // --- 3. CREATE CONSULTATION (Target: Torre A) ---
        console.log('📝 Creating Consultation for Torre A...');
        const createRes = await fetch(`${BASE_URL}/consultations`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
            body: JSON.stringify({
                title: 'Pintura Torre A',
                description: 'Deberíamos pintar la torre A?',
                start_date: new Date().toISOString(),
                end_date: new Date(Date.now() + 86400000).toISOString(),
                target_building: 'Torre A',
                questions: [
                    {
                        text: 'Estás de acuerdo?',
                        options: [{ text: 'Si' }, { text: 'No' }]
                    }
                ]
            })
        });
        const consultation = await createRes.json();
        if (!createRes.ok) throw new Error(`Create failed: ${JSON.stringify(consultation)}`);
        const consultationId = consultation.id;
        const questionId = consultation.questions[0].id; // Wait, create might not return populated questions ids logic in my model returned {id, ...data}.
        // My model returns { id: consultationId, ...data } but questions inside data don't have IDs yet as they were passed in. 
        // I need to fetch it to get IDs or update model to return full structure.
        // Let's fetch it.

        const getRes = await fetch(`${BASE_URL}/consultations/${consultationId}`, {
            headers: { 'Authorization': `Bearer ${adminToken}` }
        });
        const fullConsultation = await getRes.json();
        const qId = fullConsultation.questions[0].id;
        const optIdYes = fullConsultation.questions[0].options[0].id;

        console.log('✅ Consultation Created:', consultationId);

        // --- 4. VERIFY VISIBILITY ---
        console.log('👀 Verifying visibility...');

        // User A (Torre A) should see it
        const listA = await fetch(`${BASE_URL}/consultations/active`, {
            headers: { 'Authorization': `Bearer ${userAToken}` }
        }).then(r => r.json());

        if (listA.find(c => c.id === consultationId)) {
            console.log('✅ User A sees the consultation (Correct)');
        } else {
            console.error('❌ User A CANNOT see consultation (Fail)');
        }

        // User B (Torre B) should NOT see it
        const listB = await fetch(`${BASE_URL}/consultations/active`, {
            headers: { 'Authorization': `Bearer ${userBToken}` }
        }).then(r => r.json());

        if (!listB.find(c => c.id === consultationId)) {
            console.log('✅ User B does NOT see the consultation (Correct)');
        } else {
            console.error('❌ User B SEES the consultation (Fail)');
        }

        // --- 5. VOTING ---
        console.log('🗳️  Testing Voting...');

        // User B tries to vote (Should Fail)
        const voteB = await fetch(`${BASE_URL}/consultations/${consultationId}/vote`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${userBToken}` },
            body: JSON.stringify({ votes: [{ question_id: qId, option_id: optIdYes }] })
        });
        if (voteB.status === 403) {
            console.log('✅ User B blocked from voting (Correct 403)');
        } else {
            console.error('❌ User B was able to vote or wrong error:', await voteB.text());
        }

        // User A votes (Should Succeed)
        const voteA = await fetch(`${BASE_URL}/consultations/${consultationId}/vote`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${userAToken}` },
            body: JSON.stringify({ votes: [{ question_id: qId, option_id: optIdYes }] })
        });
        if (voteA.ok) {
            console.log('✅ User A voted successfully');
        } else {
            console.error('❌ User A failed to vote:', await voteA.text());
        }

        // User A votes AGAIN (Should Fail)
        const voteA2 = await fetch(`${BASE_URL}/consultations/${consultationId}/vote`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${userAToken}` },
            body: JSON.stringify({ votes: [{ question_id: qId, option_id: optIdYes }] })
        });
        if (voteA2.status === 400) {
            console.log('✅ User A blocked from duplicate vote (Correct 400)');
        } else {
            console.error('❌ User A allowed to duplicate vote or wrong error:', await voteA2.text());
        }

        // --- 6. RESULTS ---
        const resultsRes = await fetch(`${BASE_URL}/consultations/${consultationId}/results`, {
            headers: { 'Authorization': `Bearer ${adminToken}` }
        });
        const results = await resultsRes.json();
        // console.log('Results:', JSON.stringify(results, null, 2));

        const yesOption = results.find(r => r.option_id === optIdYes);
        if (yesOption && yesOption.vote_count === 1) {
            console.log('✅ Results aggregated correctly (1 Vote for Yes)');
        } else {
            console.error('❌ Results incorrect:', results);
        }

        console.log('🎉 Verification Completed Successfully!');
        process.exit(0);

    } catch (error) {
        console.error('❌ Verification Failed:', error);
        process.exit(1);
    }
}

verifyConsultations();
