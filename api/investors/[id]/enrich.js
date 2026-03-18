import { neon } from '@neondatabase/serverless';
import { verifyAuth } from '../../_auth.js';

export default async function handler(req, res) {
  const email = verifyAuth(req);
  if (!email) return res.status(401).json({ error: 'Unauthorized' });

  const sql = neon(process.env.DATABASE_URL);
  const investorId = parseInt(req.query.id);
  if (isNaN(investorId)) return res.status(400).json({ error: 'Invalid investor ID' });

  // GET — poll for enrichment status
  if (req.method === 'GET') {
    const rows = await sql`
      SELECT * FROM enrichment_requests
      WHERE investor_id = ${investorId}
      ORDER BY created_at DESC LIMIT 1
    `;
    return res.status(200).json(rows[0] || null);
  }

  // POST — create enrichment request (returns immediately, frontend calls worker)
  if (req.method === 'POST') {
    const investors = await sql`SELECT * FROM investors WHERE id = ${investorId}`;
    if (!investors.length) return res.status(404).json({ error: 'Investor not found' });
    const investor = investors[0];

    // Prevent concurrent enrichment — but allow retry if stuck/failed
    if (investor.enrichment_status === 'running') {
      const [lastReq] = await sql`
        SELECT id, status, created_at FROM enrichment_requests
        WHERE investor_id = ${investorId}
        ORDER BY created_at DESC LIMIT 1
      `;
      // If truly running and recent (within 5 min), block
      if (lastReq && lastReq.status === 'running') {
        const ageMs = Date.now() - new Date(lastReq.created_at).getTime();
        if (ageMs < 330000) {
          return res.status(409).json({ error: 'Enrichment already in progress' });
        }
        // Stale running request — mark it failed and continue
        await sql`UPDATE enrichment_requests SET status = 'failed', error = 'Timed out' WHERE id = ${lastReq.id}`;
      }
    }

    // Create enrichment request
    const [request] = await sql`
      INSERT INTO enrichment_requests (investor_id, status, requested_by)
      VALUES (${investorId}, 'running', ${email})
      RETURNING *
    `;

    // Update investor status
    await sql`UPDATE investors SET enrichment_status = 'running' WHERE id = ${investorId}`;

    // Return immediately — frontend will call the worker endpoint
    return res.status(202).json({ requestId: request.id, status: 'running' });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
