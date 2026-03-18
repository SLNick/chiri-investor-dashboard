import { neon } from '@neondatabase/serverless';
import { verifyAuth } from '../../../_auth.js';

const ALLOWED_FIELDS = new Set([
  'description', 'aum', 'investment_focus', 'check_size_min', 'check_size_max',
  'fund_stage', 'portfolio_companies', 'investor_type', 'location',
  'linkedin_url', 'twitter_url', 'website',
  'fit_score', 'fit_assessment', 'fit_signals'
]);

// Per-field update functions — Neon tagged templates don't support dynamic column names
const FIELD_UPDATERS = {
  description: (sql, id, val) => sql`UPDATE investors SET description = ${val}, updated_at = NOW() WHERE id = ${id}`,
  aum: (sql, id, val) => sql`UPDATE investors SET aum = ${val}, updated_at = NOW() WHERE id = ${id}`,
  investment_focus: (sql, id, val) => sql`UPDATE investors SET investment_focus = ${val}, updated_at = NOW() WHERE id = ${id}`,
  check_size_min: (sql, id, val) => sql`UPDATE investors SET check_size_min = ${val ? parseInt(val) : null}, updated_at = NOW() WHERE id = ${id}`,
  check_size_max: (sql, id, val) => sql`UPDATE investors SET check_size_max = ${val ? parseInt(val) : null}, updated_at = NOW() WHERE id = ${id}`,
  fund_stage: (sql, id, val) => sql`UPDATE investors SET fund_stage = ${val}, updated_at = NOW() WHERE id = ${id}`,
  portfolio_companies: (sql, id, val) => sql`UPDATE investors SET portfolio_companies = ${JSON.stringify(val)}, updated_at = NOW() WHERE id = ${id}`,
  investor_type: (sql, id, val) => sql`UPDATE investors SET investor_type = ${val}, updated_at = NOW() WHERE id = ${id}`,
  location: (sql, id, val) => sql`UPDATE investors SET location = ${val}, updated_at = NOW() WHERE id = ${id}`,
  linkedin_url: (sql, id, val) => sql`UPDATE investors SET linkedin_url = ${val}, updated_at = NOW() WHERE id = ${id}`,
  twitter_url: (sql, id, val) => sql`UPDATE investors SET twitter_url = ${val}, updated_at = NOW() WHERE id = ${id}`,
  website: (sql, id, val) => sql`UPDATE investors SET website = ${val}, updated_at = NOW() WHERE id = ${id}`,
  fit_score: (sql, id, val) => sql`UPDATE investors SET fit_score = ${val ? parseInt(val) : null}, updated_at = NOW() WHERE id = ${id}`,
  fit_assessment: (sql, id, val) => sql`UPDATE investors SET fit_assessment = ${val}, updated_at = NOW() WHERE id = ${id}`,
  fit_signals: (sql, id, val) => sql`UPDATE investors SET fit_signals = ${JSON.stringify(val)}, updated_at = NOW() WHERE id = ${id}`,
};

export default async function handler(req, res) {
  const email = verifyAuth(req);
  if (!email) return res.status(401).json({ error: 'Unauthorized' });

  const sql = neon(process.env.DATABASE_URL);
  const investorId = parseInt(req.query.id);
  if (isNaN(investorId)) return res.status(400).json({ error: 'Invalid investor ID' });

  // POST — approve and apply enrichment changes
  if (req.method === 'POST') {
    const [request] = await sql`
      SELECT * FROM enrichment_requests
      WHERE investor_id = ${investorId} AND status = 'completed'
      ORDER BY created_at DESC LIMIT 1
    `;
    if (!request) return res.status(404).json({ error: 'No completed enrichment to approve' });

    const changes = request.proposed_changes || [];

    // Apply each change via allowlisted updater
    for (const change of changes) {
      const updater = FIELD_UPDATERS[change.field];
      if (updater) {
        await updater(sql, investorId, change.new_value);
      }
    }

    // Mark request as approved
    await sql`
      UPDATE enrichment_requests
      SET status = 'approved', reviewed_at = NOW(), reviewed_by = ${email}
      WHERE id = ${request.id}
    `;

    // Update investor enrichment status and store full enrichment data
    await sql`
      UPDATE investors
      SET enrichment_status = 'enriched',
          enriched_at = NOW(),
          enrichment_data = ${JSON.stringify(request)},
          updated_at = NOW()
      WHERE id = ${investorId}
    `;

    return res.status(200).json({ success: true, applied: changes.length });
  }

  // DELETE — reject enrichment
  if (req.method === 'DELETE') {
    await sql`
      UPDATE enrichment_requests
      SET status = 'rejected', reviewed_at = NOW(), reviewed_by = ${email}
      WHERE investor_id = ${investorId} AND status = 'completed'
    `;
    await sql`UPDATE investors SET enrichment_status = 'none' WHERE id = ${investorId}`;

    return res.status(200).json({ success: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
