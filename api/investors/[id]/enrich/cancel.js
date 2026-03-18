import { neon } from '@neondatabase/serverless';
import { verifyAuth } from '../../../_auth.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const email = verifyAuth(req);
  if (!email) return res.status(401).json({ error: 'Unauthorized' });

  const sql = neon(process.env.DATABASE_URL);
  const investorId = parseInt(req.query.id);
  if (isNaN(investorId)) return res.status(400).json({ error: 'Invalid investor ID' });

  // Cancel any running enrichment requests for this investor
  await sql`
    UPDATE enrichment_requests
    SET status = 'failed', error = 'Cancelled by operator', completed_at = NOW()
    WHERE investor_id = ${investorId} AND status = 'running'
  `;

  // Reset investor enrichment status
  await sql`UPDATE investors SET enrichment_status = 'none' WHERE id = ${investorId}`;

  return res.status(200).json({ success: true });
}
