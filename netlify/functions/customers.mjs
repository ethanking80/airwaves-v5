import { neon } from '@netlify/neon';
import crypto from 'crypto';

const sql = neon();

const headers = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS'
};

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
  return salt + ':' + hash;
}

function verifyAdmin(req) {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return null;
  try {
    const token = authHeader.replace('Bearer ', '');
    const [data] = token.split('.');
    const payload = JSON.parse(Buffer.from(data, 'base64url').toString());
    return (payload.role === 'admin' || payload.role === 'site_admin') ? payload : null;
  } catch { return null; }
}

export default async (req, context) => {
  if (req.method === 'OPTIONS') return new Response('', { status: 204, headers });

  const url = new URL(req.url);
  const userId = url.searchParams.get('id');

  try {
    if (req.method === 'GET') {
      const admin = verifyAdmin(req);
      if (!admin) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers });
      const customers = await sql`SELECT id, name, email, role, created_at FROM users ORDER BY created_at DESC`;
      return new Response(JSON.stringify(customers), { status: 200, headers });
    }

    if (req.method === 'POST') {
      const admin = verifyAdmin(req);
      if (!admin) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers });
      const { name, email, password, role } = await req.json();
      if (!name || !email || !password) return new Response(JSON.stringify({ error: 'Name, email, and password are required' }), { status: 400, headers });
      // site_admin can only create customers
      const assignRole = role || 'customer';
      if (admin.role === 'site_admin' && assignRole !== 'customer') {
        return new Response(JSON.stringify({ error: 'Site admins can only create customer accounts' }), { status: 403, headers });
      }
      const existing = await sql`SELECT id FROM users WHERE email = ${email.toLowerCase()}`;
      if (existing.length > 0) return new Response(JSON.stringify({ error: 'A user with this email already exists' }), { status: 409, headers });
      const passwordHash = hashPassword(password);
      const [user] = await sql`INSERT INTO users (email, password_hash, name, role) VALUES (${email.toLowerCase()}, ${passwordHash}, ${name}, ${assignRole}) RETURNING id, email, name, role, created_at`;
      return new Response(JSON.stringify(user), { status: 201, headers });
    }

    if (req.method === 'PUT') {
      const admin = verifyAdmin(req);
      if (!admin) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers });
      if (!userId) return new Response(JSON.stringify({ error: 'User ID required' }), { status: 400, headers });
      const { name, email, role, password } = await req.json();
      // site_admin restrictions
      if (admin.role === 'site_admin') {
        // Cannot set role to admin or site_admin
        if (role && role !== 'customer') {
          return new Response(JSON.stringify({ error: 'Site admins can only assign the customer role' }), { status: 403, headers });
        }
        // Cannot edit admin or site_admin accounts
        const [targetUser] = await sql`SELECT role FROM users WHERE id = ${userId}`;
        if (targetUser && (targetUser.role === 'admin' || targetUser.role === 'site_admin')) {
          return new Response(JSON.stringify({ error: 'Site admins cannot edit admin or site_admin accounts' }), { status: 403, headers });
        }
      }
      let user;
      if (password) {
        const passwordHash = hashPassword(password);
        [user] = await sql`UPDATE users SET name=COALESCE(${name},name), email=COALESCE(${email?email.toLowerCase():null},email), role=COALESCE(${role},role), password_hash=${passwordHash} WHERE id=${userId} RETURNING id,email,name,role,created_at`;
      } else {
        [user] = await sql`UPDATE users SET name=COALESCE(${name},name), email=COALESCE(${email?email.toLowerCase():null},email), role=COALESCE(${role},role) WHERE id=${userId} RETURNING id,email,name,role,created_at`;
      }
      return new Response(JSON.stringify(user), { status: 200, headers });
    }

    if (req.method === 'DELETE') {
      const admin = verifyAdmin(req);
      if (!admin) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers });
      if (admin.role === 'site_admin') {
        return new Response(JSON.stringify({ error: 'Site admins cannot delete users' }), { status: 403, headers });
      }
      if (!userId) return new Response(JSON.stringify({ error: 'User ID required' }), { status: 400, headers });
      if (parseInt(userId) === admin.id) return new Response(JSON.stringify({ error: "You can't delete your own account" }), { status: 400, headers });
      await sql`DELETE FROM users WHERE id=${userId}`;
      return new Response(JSON.stringify({ success: true }), { status: 200, headers });
    }

    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers });
  } catch (error) {
    console.error('Customers Error:', error);
    return new Response(JSON.stringify({ error: 'Server error: ' + error.message }), { status: 500, headers });
  }
};

export const config = { path: '/api/customers' };
