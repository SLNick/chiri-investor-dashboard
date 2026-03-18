export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  const normalizedEmail = email.trim().toLowerCase();

  if (!normalizedEmail.endsWith('@chiri.ai')) {
    return res.status(401).json({ error: 'Access restricted to @chiri.ai emails' });
  }

  if (password !== 'Chiri2026') {
    return res.status(401).json({ error: 'Invalid password' });
  }

  // Simple token: base64 of email + timestamp
  const token = Buffer.from(JSON.stringify({
    email: normalizedEmail,
    exp: Date.now() + (24 * 60 * 60 * 1000) // 24h expiry
  })).toString('base64');

  return res.status(200).json({ token, email: normalizedEmail });
}
