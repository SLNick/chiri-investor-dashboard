import { neon } from '@neondatabase/serverless';
import { verifyAuth } from '../../_auth.js';

export default async function handler(req, res) {
  const email = verifyAuth(req);
  if (!email) return res.status(401).json({ error: 'Unauthorized' });

  const sql = neon(process.env.DATABASE_URL);
  const candidateId = parseInt(req.query.id);
  if (isNaN(candidateId)) return res.status(400).json({ error: 'Invalid candidate ID' });

  // POST — approve candidate (add to investor pipeline)
  if (req.method === 'POST') {
    const [candidate] = await sql`SELECT * FROM discovery_candidates WHERE id = ${candidateId}`;
    if (!candidate) return res.status(404).json({ error: 'Candidate not found' });
    if (candidate.status !== 'pending') return res.status(400).json({ error: 'Candidate already processed' });

    // Add to investors table
    const [investor] = await sql`
      INSERT INTO investors (firm, contact, owner, stage, priority, fit, url, notes, investor_type, location, website)
      VALUES (
        ${candidate.firm_name},
        ${candidate.contact_name || ''},
        'NC',
        'not-started',
        'Medium',
        'Strong',
        ${candidate.website || ''},
        ${`[Discovery Agent] ${candidate.rationale}\n\nThesis alignment: ${candidate.thesis_alignment || 'N/A'}\nSource: ${candidate.source_name || ''} ${candidate.source_url || ''}`},
        ${candidate.investor_type || ''},
        ${candidate.location || ''},
        ${candidate.website || ''}
      )
      RETURNING id
    `;

    // Update check sizes if available
    if (candidate.check_size_min || candidate.check_size_max) {
      await sql`
        UPDATE investors
        SET check_size_min = ${candidate.check_size_min || null},
            check_size_max = ${candidate.check_size_max || null}
        WHERE id = ${investor.id}
      `;
    }

    // Mark candidate as approved
    await sql`UPDATE discovery_candidates SET status = 'approved', investor_id = ${investor.id} WHERE id = ${candidateId}`;

    return res.status(200).json({ success: true, investorId: investor.id });
  }

  // DELETE — reject candidate
  if (req.method === 'DELETE') {
    const [candidate] = await sql`SELECT * FROM discovery_candidates WHERE id = ${candidateId}`;
    if (!candidate) return res.status(404).json({ error: 'Candidate not found' });
    if (candidate.status !== 'pending') return res.status(400).json({ error: 'Candidate already processed' });

    await sql`UPDATE discovery_candidates SET status = 'rejected' WHERE id = ${candidateId}`;
    return res.status(200).json({ success: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
