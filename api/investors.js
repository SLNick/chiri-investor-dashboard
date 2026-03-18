import { neon } from '@neondatabase/serverless';
import { verifyAuth } from './_auth.js';

export default async function handler(req, res) {
  if (!verifyAuth(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const sql = neon(process.env.DATABASE_URL);

  if (req.method === 'GET') {
    const rows = await sql`SELECT * FROM investors ORDER BY id`;
    const investors = rows.map(r => ({
      id: r.id,
      firm: r.firm,
      contact: r.contact || '',
      owner: r.owner,
      stage: r.stage,
      priority: r.priority,
      fit: r.fit,
      url: r.url || '',
      followUp: r.follow_up ? String(r.follow_up).split('T')[0] : null,
      notes: r.notes || '',
      description: r.description || '',
      aum: r.aum || '',
      investmentFocus: r.investment_focus || '',
      checkSizeMin: r.check_size_min || null,
      checkSizeMax: r.check_size_max || null,
      fundStage: r.fund_stage || '',
      portfolioCompanies: r.portfolio_companies || [],
      investorType: r.investor_type || '',
      location: r.location || '',
      linkedinUrl: r.linkedin_url || '',
      twitterUrl: r.twitter_url || '',
      website: r.website || '',
      enrichmentStatus: r.enrichment_status || 'none',
      enrichedAt: r.enriched_at || null,
      fitScore: r.fit_score || null,
      fitAssessment: r.fit_assessment || '',
      fitSignals: r.fit_signals || []
    }));
    return res.status(200).json(investors);
  }

  if (req.method === 'POST') {
    const { firm, contact, owner, stage, priority, fit, url, followUp, notes } = req.body;
    if (!firm) return res.status(400).json({ error: 'Firm name is required' });

    const rows = await sql`
      INSERT INTO investors (firm, contact, owner, stage, priority, fit, url, follow_up, notes)
      VALUES (${firm}, ${contact || ''}, ${owner || 'NB'}, ${stage || 'not-started'}, ${priority || 'Medium'}, ${fit || 'Strong'}, ${url || ''}, ${followUp || null}, ${notes || ''})
      RETURNING *
    `;
    const r = rows[0];
    return res.status(201).json({
      id: r.id,
      firm: r.firm,
      contact: r.contact || '',
      owner: r.owner,
      stage: r.stage,
      priority: r.priority,
      fit: r.fit,
      url: r.url || '',
      followUp: r.follow_up ? String(r.follow_up).split('T')[0] : null,
      notes: r.notes || '',
      description: r.description || '',
      aum: r.aum || '',
      investmentFocus: r.investment_focus || '',
      checkSizeMin: r.check_size_min || null,
      checkSizeMax: r.check_size_max || null,
      fundStage: r.fund_stage || '',
      portfolioCompanies: r.portfolio_companies || [],
      investorType: r.investor_type || '',
      location: r.location || '',
      linkedinUrl: r.linkedin_url || '',
      twitterUrl: r.twitter_url || '',
      website: r.website || '',
      enrichmentStatus: r.enrichment_status || 'none',
      enrichedAt: r.enriched_at || null,
      fitScore: r.fit_score || null,
      fitAssessment: r.fit_assessment || '',
      fitSignals: r.fit_signals || []
    });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
