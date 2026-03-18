import { neon } from '@neondatabase/serverless';
import { verifyAuth } from '../_auth.js';

export default async function handler(req, res) {
  if (!verifyAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const sql = neon(process.env.DATABASE_URL);

  const rows = await sql`
    SELECT er.*, i.firm
    FROM enrichment_requests er
    JOIN investors i ON i.id = er.investor_id
    ORDER BY er.created_at DESC
    LIMIT 100
  `;

  return res.status(200).json(rows);
}
