import { neon } from '@neondatabase/serverless';
import { verifyAuth } from './_auth.js';

export default async function handler(req, res) {
  if (!verifyAuth(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const sql = neon(process.env.DATABASE_URL);

  if (req.method === 'GET') {
    const rows = await sql`SELECT key, value FROM config`;
    const config = {};
    for (const row of rows) {
      config[row.key] = row.value;
    }
    return res.status(200).json(config);
  }

  if (req.method === 'PUT') {
    const entries = req.body;
    for (const [key, value] of Object.entries(entries)) {
      await sql`
        INSERT INTO config (key, value)
        VALUES (${key}, ${JSON.stringify(value)})
        ON CONFLICT (key) DO UPDATE SET value = ${JSON.stringify(value)}
      `;
    }
    return res.status(200).json({ message: 'Config saved' });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
