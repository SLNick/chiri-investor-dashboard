import { neon } from '@neondatabase/serverless';
import { verifyAuth } from '../_auth.js';

export default async function handler(req, res) {
  const email = verifyAuth(req);
  if (!email) return res.status(401).json({ error: 'Unauthorized' });

  const sql = neon(process.env.DATABASE_URL);

  // GET — poll for latest discovery run status
  if (req.method === 'GET') {
    const rows = await sql`
      SELECT * FROM discovery_requests
      ORDER BY created_at DESC LIMIT 1
    `;
    return res.status(200).json(rows[0] || null);
  }

  // POST — create discovery request
  if (req.method === 'POST') {
    // Check company profile exists
    const [profileRow] = await sql`SELECT value FROM config WHERE key = 'company_profile'`;
    const profile = profileRow?.value;
    if (!profile || !profile.name) {
      return res.status(400).json({ error: 'Company profile required. Fill in at least the company name in Company Profile tab.' });
    }

    // Prevent concurrent runs
    const [lastRun] = await sql`
      SELECT id, status, created_at FROM discovery_requests
      ORDER BY created_at DESC LIMIT 1
    `;
    if (lastRun && lastRun.status === 'running') {
      const ageMs = Date.now() - new Date(lastRun.created_at).getTime();
      if (ageMs < 330000) {
        return res.status(409).json({ error: 'Discovery already in progress' });
      }
      await sql`UPDATE discovery_requests SET status = 'failed', error = 'Timed out' WHERE id = ${lastRun.id}`;
    }

    const [request] = await sql`
      INSERT INTO discovery_requests (status, requested_by)
      VALUES ('running', ${email})
      RETURNING *
    `;

    return res.status(202).json({ requestId: request.id, status: 'running' });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
