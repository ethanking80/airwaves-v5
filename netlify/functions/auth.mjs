import { neon } from '@netlify/neon';
import crypto from 'crypto';

const sql = neon();

const headers = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
};

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
  return salt + ':' + hash;
}

function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  const verify = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
  return hash === verify;
}

function generateUserId(id) {
  return 'AW-' + id.toString().padStart(4, '0') + crypto.randomBytes(2).toString('hex').toUpperCase();
}

function generateToken(user) {
  const payload = { id: user.id, email: user.email, role: user.role, name: user.name, user_id: user.user_id, username: user.username };
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', process.env.JWT_SECRET || 'airwaves-secret-key-2024').update(data).digest('base64url');
  return data + '.' + sig;
}

export function verifyToken(token) {
  try {
    const [data, sig] = token.split('.');
    const expected = crypto.createHmac('sha256', process.env.JWT_SECRET || 'airwaves-secret-key-2024').update(data).digest('base64url');
    if (sig !== expected) return null;
    return JSON.parse(Buffer.from(data, 'base64url').toString());
  } catch { return null; }
}

export default async (req, context) => {
  if (req.method === 'OPTIONS') {
    return new Response('', { status: 204, headers });
  }

  const url = new URL(req.url);
  const action = url.searchParams.get('action');

  try {
    if (req.method === 'POST' && action === 'register') {
      const { email, password, name, username } = await req.json();
      if (!email || !password || !name || !username) {
        return new Response(JSON.stringify({ error: 'Username, email, password, and name are all required' }), { status: 400, headers });
      }
      if (password.length < 6) {
        return new Response(JSON.stringify({ error: 'Password must be at least 6 characters' }), { status: 400, headers });
      }
      // Validate username
      const cleanUsername = username.trim().toLowerCase();
      if (cleanUsername.length < 3) {
        return new Response(JSON.stringify({ error: 'Username must be at least 3 characters' }), { status: 400, headers });
      }
      {
        if (!/^[a-z0-9_.-]+$/.test(cleanUsername)) {
          return new Response(JSON.stringify({ error: 'Username can only contain letters, numbers, dots, hyphens, and underscores' }), { status: 400, headers });
        }
        const existingUsername = await sql`SELECT id FROM users WHERE username = ${cleanUsername}`;
        if (existingUsername.length > 0) {
          return new Response(JSON.stringify({ error: 'This username is already taken' }), { status: 409, headers });
        }
      }
      // Check if email exists
      const existing = await sql`SELECT id FROM users WHERE email = ${email.toLowerCase()}`;
      if (existing.length > 0) {
        return new Response(JSON.stringify({ error: 'An account with this email already exists' }), { status: 409, headers });
      }
      const passwordHash = hashPassword(password);
      const [user] = await sql`
        INSERT INTO users (email, password_hash, name, role, username)
        VALUES (${email.toLowerCase()}, ${passwordHash}, ${name}, 'customer', ${cleanUsername})
        RETURNING id, email, name, role, username
      `;
      // Generate and assign unique user_id
      const userId = generateUserId(user.id);
      await sql`UPDATE users SET user_id = ${userId} WHERE id = ${user.id}`;
      user.user_id = userId;
      const token = generateToken(user);
      return new Response(JSON.stringify({ success: true, token, user: { id: user.id, user_id: userId, email: user.email, name: user.name, role: user.role, username: user.username } }), { status: 201, headers });
    }

    if (req.method === 'POST' && action === 'login') {
      const { email, password, username } = await req.json();
      const loginId = username || email;
      if (!loginId || !password) {
        return new Response(JSON.stringify({ error: 'Username/email and password are required' }), { status: 400, headers });
      }
      // Try username first, then email
      const loginLower = loginId.trim().toLowerCase();
      let [user] = await sql`SELECT * FROM users WHERE username = ${loginLower}`;
      if (!user) {
        [user] = await sql`SELECT * FROM users WHERE email = ${loginLower}`;
      }
      if (!user || !verifyPassword(password, user.password_hash)) {
        return new Response(JSON.stringify({ error: 'Invalid credentials' }), { status: 401, headers });
      }
      const token = generateToken(user);
      return new Response(JSON.stringify({ success: true, token, user: {
        id: user.id, user_id: user.user_id, email: user.email, name: user.name, role: user.role, username: user.username,
        phone: user.phone, shipping_address: user.shipping_address, city: user.city, state: user.state, zip_code: user.zip_code
      } }), { status: 200, headers });
    }

    if (req.method === 'GET' && action === 'me') {
      const authHeader = req.headers.get('Authorization');
      if (!authHeader) return new Response(JSON.stringify({ error: 'Not authenticated' }), { status: 401, headers });
      const token = authHeader.replace('Bearer ', '');
      const payload = verifyToken(token);
      if (!payload) return new Response(JSON.stringify({ error: 'Invalid token' }), { status: 401, headers });
      const [user] = await sql`SELECT id, user_id, username, email, name, role, phone, shipping_address, city, state, zip_code, created_at FROM users WHERE id = ${payload.id}`;
      if (!user) return new Response(JSON.stringify({ error: 'User not found' }), { status: 404, headers });
      return new Response(JSON.stringify({ user }), { status: 200, headers });
    }

    // Change password
    if (req.method === 'POST' && action === 'change-password') {
      const authHeader = req.headers.get('Authorization');
      if (!authHeader) return new Response(JSON.stringify({ error: 'Not authenticated' }), { status: 401, headers });
      const payload = verifyToken(authHeader.replace('Bearer ', ''));
      if (!payload) return new Response(JSON.stringify({ error: 'Invalid token' }), { status: 401, headers });
      const { current_password, new_password } = await req.json();
      if (!current_password || !new_password) {
        return new Response(JSON.stringify({ error: 'Current and new password are required' }), { status: 400, headers });
      }
      if (new_password.length < 6) {
        return new Response(JSON.stringify({ error: 'New password must be at least 6 characters' }), { status: 400, headers });
      }
      const [user] = await sql`SELECT * FROM users WHERE id = ${payload.id}`;
      if (!user || !verifyPassword(current_password, user.password_hash)) {
        return new Response(JSON.stringify({ error: 'Current password is incorrect' }), { status: 401, headers });
      }
      const newHash = hashPassword(new_password);
      await sql`UPDATE users SET password_hash = ${newHash} WHERE id = ${payload.id}`;
      return new Response(JSON.stringify({ success: true, message: 'Password changed successfully' }), { status: 200, headers });
    }

    return new Response(JSON.stringify({ error: 'Invalid action' }), { status: 400, headers });
  } catch (error) {
    console.error('Auth Error:', error);
    return new Response(JSON.stringify({ error: 'Server error: ' + error.message }), { status: 500, headers });
  }
};

export const config = { path: "/api/auth" };
