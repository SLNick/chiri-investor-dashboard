import { neon } from '@neondatabase/serverless';
import { verifyAuth } from './_auth.js';

export default async function handler(req, res) {
  if (!verifyAuth(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const sql = neon(process.env.DATABASE_URL);

  await sql`
    CREATE TABLE IF NOT EXISTS investors (
      id SERIAL PRIMARY KEY,
      firm TEXT NOT NULL,
      contact TEXT DEFAULT '',
      owner TEXT DEFAULT 'NB',
      stage TEXT DEFAULT 'not-started',
      priority TEXT DEFAULT 'Medium',
      fit TEXT DEFAULT 'Strong',
      url TEXT DEFAULT '',
      follow_up DATE,
      notes TEXT DEFAULT '',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS config (
      id SERIAL PRIMARY KEY,
      key TEXT UNIQUE NOT NULL,
      value JSONB NOT NULL
    )
  `;

  // Enrichment columns on investors
  await sql`ALTER TABLE investors ADD COLUMN IF NOT EXISTS description TEXT DEFAULT ''`;
  await sql`ALTER TABLE investors ADD COLUMN IF NOT EXISTS aum TEXT DEFAULT ''`;
  await sql`ALTER TABLE investors ADD COLUMN IF NOT EXISTS investment_focus TEXT DEFAULT ''`;
  await sql`ALTER TABLE investors ADD COLUMN IF NOT EXISTS check_size_min BIGINT`;
  await sql`ALTER TABLE investors ADD COLUMN IF NOT EXISTS check_size_max BIGINT`;
  await sql`ALTER TABLE investors ADD COLUMN IF NOT EXISTS fund_stage TEXT DEFAULT ''`;
  await sql`ALTER TABLE investors ADD COLUMN IF NOT EXISTS portfolio_companies JSONB DEFAULT '[]'::jsonb`;
  await sql`ALTER TABLE investors ADD COLUMN IF NOT EXISTS investor_type TEXT DEFAULT ''`;
  await sql`ALTER TABLE investors ADD COLUMN IF NOT EXISTS location TEXT DEFAULT ''`;
  await sql`ALTER TABLE investors ADD COLUMN IF NOT EXISTS linkedin_url TEXT DEFAULT ''`;
  await sql`ALTER TABLE investors ADD COLUMN IF NOT EXISTS twitter_url TEXT DEFAULT ''`;
  await sql`ALTER TABLE investors ADD COLUMN IF NOT EXISTS website TEXT DEFAULT ''`;
  await sql`ALTER TABLE investors ADD COLUMN IF NOT EXISTS enrichment_status TEXT DEFAULT 'none'`;
  await sql`ALTER TABLE investors ADD COLUMN IF NOT EXISTS enriched_at TIMESTAMPTZ`;
  await sql`ALTER TABLE investors ADD COLUMN IF NOT EXISTS enrichment_data JSONB`;

  // Fit scoring columns
  await sql`ALTER TABLE investors ADD COLUMN IF NOT EXISTS fit_score SMALLINT`;
  await sql`ALTER TABLE investors ADD COLUMN IF NOT EXISTS fit_assessment TEXT DEFAULT ''`;
  await sql`ALTER TABLE investors ADD COLUMN IF NOT EXISTS fit_signals JSONB DEFAULT '[]'::jsonb`;

  // Enrichment requests table
  await sql`
    CREATE TABLE IF NOT EXISTS enrichment_requests (
      id SERIAL PRIMARY KEY,
      investor_id INTEGER NOT NULL REFERENCES investors(id) ON DELETE CASCADE,
      status TEXT DEFAULT 'pending',
      proposed_changes JSONB,
      summary TEXT DEFAULT '',
      sources JSONB DEFAULT '[]'::jsonb,
      error TEXT,
      requested_by TEXT DEFAULT '',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      completed_at TIMESTAMPTZ,
      reviewed_at TIMESTAMPTZ,
      reviewed_by TEXT DEFAULT ''
    )
  `;

  // Discovery requests table
  await sql`
    CREATE TABLE IF NOT EXISTS discovery_requests (
      id SERIAL PRIMARY KEY,
      status TEXT DEFAULT 'pending',
      candidate_count INTEGER DEFAULT 0,
      error TEXT,
      requested_by TEXT DEFAULT '',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      completed_at TIMESTAMPTZ
    )
  `;

  // Discovery candidates table
  await sql`
    CREATE TABLE IF NOT EXISTS discovery_candidates (
      id SERIAL PRIMARY KEY,
      request_id INTEGER NOT NULL REFERENCES discovery_requests(id) ON DELETE CASCADE,
      firm_name TEXT NOT NULL,
      contact_name TEXT DEFAULT '',
      investor_type TEXT DEFAULT '',
      rationale TEXT DEFAULT '',
      thesis_alignment TEXT DEFAULT '',
      location TEXT DEFAULT '',
      check_size_min BIGINT,
      check_size_max BIGINT,
      website TEXT DEFAULT '',
      source_url TEXT DEFAULT '',
      source_name TEXT DEFAULT '',
      status TEXT DEFAULT 'pending',
      investor_id INTEGER,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;

  return res.status(200).json({ message: 'Tables created successfully' });
}
