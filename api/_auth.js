export function verifyAuth(req) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }

  try {
    const token = authHeader.split(' ')[1];
    const data = JSON.parse(Buffer.from(token, 'base64').toString());

    if (!data.email || !data.email.endsWith('@chiri.ai')) {
      return null;
    }

    if (data.exp && data.exp < Date.now()) {
      return null;
    }

    return data.email;
  } catch {
    return null;
  }
}
