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

      const action = url.searchParams.get('action');

      if (action === 'dashboard-stats') {
        const [recentCustomers, recentReviews, recentLogins, paymentStats, totalCustomers, totalOrders, totalRevenue, activeProducts] = await Promise.all([
          // 5 most recently registered customers
          sql`SELECT id, name, email, username, role, created_at, last_login FROM users WHERE role = 'customer' ORDER BY created_at DESC LIMIT 5`,
          // 5 most recent reviews with product name
          sql`SELECT r.id, r.reviewer_name, r.rating, r.title, r.body, r.created_at, p.name as product_name FROM reviews r LEFT JOIN products p ON r.product_id = p.id ORDER BY r.created_at DESC LIMIT 5`,
          // 10 most recent logins (all roles)
          sql`SELECT id, name, email, username, role, last_login FROM users WHERE last_login IS NOT NULL ORDER BY last_login DESC LIMIT 10`,
          // Payment method breakdown (non-cancelled orders)
          sql`SELECT
            COALESCE(SUM(CASE WHEN payment_method = 'btc' THEN total ELSE 0 END), 0) as btc_revenue,
            COALESCE(SUM(CASE WHEN payment_method = 'btc' THEN 1 ELSE 0 END), 0) as btc_count,
            COALESCE(SUM(CASE WHEN payment_method = 'xmr' THEN total ELSE 0 END), 0) as xmr_revenue,
            COALESCE(SUM(CASE WHEN payment_method = 'xmr' THEN 1 ELSE 0 END), 0) as xmr_count,
            COALESCE(SUM(CASE WHEN payment_method = 'cash' THEN total ELSE 0 END), 0) as cash_revenue,
            COALESCE(SUM(CASE WHEN payment_method = 'cash' THEN 1 ELSE 0 END), 0) as cash_count,
            COALESCE(SUM(total), 0) as total_revenue,
            COUNT(*) as total_orders
          FROM orders WHERE status != 'cancelled'`,
          // Total customer count
          sql`SELECT COUNT(*) as count FROM users WHERE role = 'customer'`,
          // Total order count
          sql`SELECT COUNT(*) as count FROM orders`,
          // Total revenue
          sql`SELECT COALESCE(SUM(total), 0) as total FROM orders WHERE status != 'cancelled'`,
          // Active product count
          sql`SELECT COUNT(*) as count FROM products WHERE active = true`
        ]);

        return new Response(JSON.stringify({
          recent_customers: recentCustomers,
          recent_reviews: recentReviews,
          recent_logins: recentLogins,
          payment_stats: paymentStats[0],
          summary: {
            total_customers: parseInt(totalCustomers[0].count),
            total_orders: parseInt(totalOrders[0].count),
            total_revenue: parseFloat(totalRevenue[0].total),
            active_products: parseInt(activeProducts[0].count)
          }
        }), { status: 200, headers });
      }

      const customers = await sql`SELECT id, name, email, role, username, user_id, created_at, last_login FROM users ORDER BY created_at DESC`;
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
