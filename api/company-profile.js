import { neon } from '@neondatabase/serverless';
import { verifyAuth } from './_auth.js';

export default async function handler(req, res) {
  if (!verifyAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
  const sql = neon(process.env.DATABASE_URL);

  if (req.method === 'GET') {
    const rows = await sql`SELECT value FROM config WHERE key = 'company_profile'`;
    return res.status(200).json(rows[0]?.value || {});
  }

  if (req.method === 'PUT') {
    const profile = req.body;
    await sql`
      INSERT INTO config (key, value)
      VALUES ('company_profile', ${JSON.stringify(profile)})
      ON CONFLICT (key) DO UPDATE SET value = ${JSON.stringify(profile)}
    `;
    return res.status(200).json({ success: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
