import { neon } from '@neondatabase/serverless';
import { verifyAuth } from '../_auth.js';

export default async function handler(req, res) {
  const email = verifyAuth(req);
  if (!email) return res.status(401).json({ error: 'Unauthorized' });

  const sql = neon(process.env.DATABASE_URL);

  if (req.method === 'GET') {
    // Get candidates from the latest completed discovery run
    const [latestRun] = await sql`
      SELECT id FROM discovery_requests
      WHERE status = 'completed'
      ORDER BY created_at DESC LIMIT 1
    `;
    if (!latestRun) return res.status(200).json([]);

    const rows = await sql`
      SELECT * FROM discovery_candidates
      WHERE request_id = ${latestRun.id}
      ORDER BY id
    `;
    return res.status(200).json(rows);
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
