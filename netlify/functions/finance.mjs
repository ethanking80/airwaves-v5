import { neon } from '@netlify/neon';

const sql = neon();

const headers = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS'
};

function getAdminId(req) {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return null;
  try {
    const token = authHeader.replace('Bearer ', '');
    const [data] = token.split('.');
    const payload = JSON.parse(Buffer.from(data, 'base64url').toString());
    return payload.role === 'admin' ? payload.id : null;
  } catch { return null; }
}

export default async (req, context) => {
  if (req.method === 'OPTIONS') {
    return new Response('', { status: 204, headers });
  }

  const adminId = getAdminId(req);
  if (!adminId) {
    return new Response(JSON.stringify({ error: 'Admin access required' }), { status: 403, headers });
  }

  const url = new URL(req.url);
  const action = url.searchParams.get('action') || 'summary';

  try {
    // GET requests
    if (req.method === 'GET') {

      // Current cash balance
      if (action === 'balance') {
        const openingSetting = await sql`SELECT value FROM settings WHERE key = 'opening_cash_balance'`;
        const openingBalance = parseFloat(openingSetting[0]?.value || '0');

        const totals = await sql`
          SELECT
            COALESCE(SUM(CASE WHEN type = 'cash_in' THEN amount ELSE 0 END), 0) as total_in,
            COALESCE(SUM(CASE WHEN type = 'cash_out' THEN amount ELSE 0 END), 0) as total_out
          FROM cash_transactions
        `;
        const totalIn = parseFloat(totals[0].total_in);
        const totalOut = parseFloat(totals[0].total_out);

        // Cash revenue from orders
        const cashRevenue = await sql`
          SELECT COALESCE(SUM(total), 0) as cash_rev
          FROM orders WHERE payment_method = 'cash' AND status != 'cancelled'
        `;
        const cashRev = parseFloat(cashRevenue[0].cash_rev);

        const currentBalance = openingBalance + cashRev + totalIn - totalOut;

        // Today's activity
        const today = await sql`
          SELECT
            COALESCE(SUM(CASE WHEN type = 'cash_in' THEN amount ELSE 0 END), 0) as today_in,
            COALESCE(SUM(CASE WHEN type = 'cash_out' THEN amount ELSE 0 END), 0) as today_out
          FROM cash_transactions WHERE created_at::date = CURRENT_DATE
        `;
        const todayCashOrders = await sql`
          SELECT COALESCE(SUM(total), 0) as today_cash_rev
          FROM orders WHERE payment_method = 'cash' AND status != 'cancelled' AND created_at::date = CURRENT_DATE
        `;

        return new Response(JSON.stringify({
          opening_balance: openingBalance,
          current_balance: currentBalance,
          total_cash_in: totalIn,
          total_cash_out: totalOut,
          cash_revenue: cashRev,
          today_in: parseFloat(today[0].today_in) + parseFloat(todayCashOrders[0].today_cash_rev),
          today_out: parseFloat(today[0].today_out)
        }), { status: 200, headers });
      }

      // Transaction history
      if (action === 'transactions') {
        const type = url.searchParams.get('type') || 'all';
        const days = parseInt(url.searchParams.get('days') || '30');
        const limit = parseInt(url.searchParams.get('limit') || '100');
        const offset = parseInt(url.searchParams.get('offset') || '0');

        let transactions;
        if (type === 'all') {
          transactions = await sql`
            SELECT ct.*, u.name as created_by_name
            FROM cash_transactions ct
            LEFT JOIN users u ON ct.created_by = u.id
            WHERE ct.created_at >= NOW() - MAKE_INTERVAL(days => ${days})
            ORDER BY ct.created_at DESC
            LIMIT ${limit} OFFSET ${offset}
          `;
        } else {
          transactions = await sql`
            SELECT ct.*, u.name as created_by_name
            FROM cash_transactions ct
            LEFT JOIN users u ON ct.created_by = u.id
            WHERE ct.type = ${type} AND ct.created_at >= NOW() - MAKE_INTERVAL(days => ${days})
            ORDER BY ct.created_at DESC
            LIMIT ${limit} OFFSET ${offset}
          `;
        }

        const countResult = type === 'all'
          ? await sql`SELECT COUNT(*) as total FROM cash_transactions WHERE created_at >= NOW() - MAKE_INTERVAL(days => ${days})`
          : await sql`SELECT COUNT(*) as total FROM cash_transactions WHERE type = ${type} AND created_at >= NOW() - MAKE_INTERVAL(days => ${days})`;

        return new Response(JSON.stringify({
          transactions,
          total: parseInt(countResult[0].total),
          limit,
          offset
        }), { status: 200, headers });
      }

      // Financial summary (default)
      if (action === 'summary') {
        const period = url.searchParams.get('period') || 'all';
        let dateFilter = '';
        let periodSql;

        if (period === 'today') {
          periodSql = await sql`
            SELECT
              COUNT(*) as order_count,
              COALESCE(SUM(total), 0) as total_revenue,
              COALESCE(SUM(CASE WHEN payment_method = 'btc' THEN total ELSE 0 END), 0) as btc_revenue,
              COALESCE(SUM(CASE WHEN payment_method = 'xmr' THEN total ELSE 0 END), 0) as xmr_revenue,
              COALESCE(SUM(CASE WHEN payment_method = 'cash' THEN total ELSE 0 END), 0) as cash_revenue,
              COALESCE(AVG(total), 0) as avg_order
            FROM orders WHERE status != 'cancelled' AND created_at::date = CURRENT_DATE
          `;
        } else if (period === 'week') {
          periodSql = await sql`
            SELECT
              COUNT(*) as order_count,
              COALESCE(SUM(total), 0) as total_revenue,
              COALESCE(SUM(CASE WHEN payment_method = 'btc' THEN total ELSE 0 END), 0) as btc_revenue,
              COALESCE(SUM(CASE WHEN payment_method = 'xmr' THEN total ELSE 0 END), 0) as xmr_revenue,
              COALESCE(SUM(CASE WHEN payment_method = 'cash' THEN total ELSE 0 END), 0) as cash_revenue,
              COALESCE(AVG(total), 0) as avg_order
            FROM orders WHERE status != 'cancelled' AND created_at >= NOW() - INTERVAL '7 days'
          `;
        } else if (period === 'month') {
          periodSql = await sql`
            SELECT
              COUNT(*) as order_count,
              COALESCE(SUM(total), 0) as total_revenue,
              COALESCE(SUM(CASE WHEN payment_method = 'btc' THEN total ELSE 0 END), 0) as btc_revenue,
              COALESCE(SUM(CASE WHEN payment_method = 'xmr' THEN total ELSE 0 END), 0) as xmr_revenue,
              COALESCE(SUM(CASE WHEN payment_method = 'cash' THEN total ELSE 0 END), 0) as cash_revenue,
              COALESCE(AVG(total), 0) as avg_order
            FROM orders WHERE status != 'cancelled' AND created_at >= NOW() - INTERVAL '30 days'
          `;
        } else {
          periodSql = await sql`
            SELECT
              COUNT(*) as order_count,
              COALESCE(SUM(total), 0) as total_revenue,
              COALESCE(SUM(CASE WHEN payment_method = 'btc' THEN total ELSE 0 END), 0) as btc_revenue,
              COALESCE(SUM(CASE WHEN payment_method = 'xmr' THEN total ELSE 0 END), 0) as xmr_revenue,
              COALESCE(SUM(CASE WHEN payment_method = 'cash' THEN total ELSE 0 END), 0) as cash_revenue,
              COALESCE(AVG(total), 0) as avg_order
            FROM orders WHERE status != 'cancelled'
          `;
        }

        const stats = periodSql[0];

        // Top selling products
        const topProducts = await sql`
          SELECT oi.product_name, SUM(oi.quantity) as total_qty, SUM(oi.price * oi.quantity) as total_rev
          FROM order_items oi
          JOIN orders o ON oi.order_id = o.id
          WHERE o.status != 'cancelled'
          GROUP BY oi.product_name
          ORDER BY total_rev DESC
          LIMIT 5
        `;

        // Daily revenue for last 7 days
        const dailyRevenue = await sql`
          SELECT created_at::date as day,
            COALESCE(SUM(total), 0) as revenue,
            COUNT(*) as orders
          FROM orders WHERE status != 'cancelled' AND created_at >= NOW() - INTERVAL '7 days'
          GROUP BY created_at::date
          ORDER BY day
        `;

        return new Response(JSON.stringify({
          order_count: parseInt(stats.order_count),
          total_revenue: parseFloat(stats.total_revenue),
          btc_revenue: parseFloat(stats.btc_revenue),
          xmr_revenue: parseFloat(stats.xmr_revenue),
          cash_revenue: parseFloat(stats.cash_revenue),
          avg_order: parseFloat(stats.avg_order),
          top_products: topProducts,
          daily_revenue: dailyRevenue
        }), { status: 200, headers });
      }

      return new Response(JSON.stringify({ error: 'Unknown action' }), { status: 400, headers });
    }

    // POST - log cash transaction
    if (req.method === 'POST') {
      const { type, amount, description } = await req.json();

      if (!type || !['cash_in', 'cash_out'].includes(type)) {
        return new Response(JSON.stringify({ error: 'Type must be cash_in or cash_out' }), { status: 400, headers });
      }
      if (!amount || parseFloat(amount) <= 0) {
        return new Response(JSON.stringify({ error: 'Amount must be positive' }), { status: 400, headers });
      }

      const [transaction] = await sql`
        INSERT INTO cash_transactions (type, amount, description, created_by)
        VALUES (${type}, ${parseFloat(amount)}, ${description || ''}, ${adminId})
        RETURNING *
      `;

      return new Response(JSON.stringify({ success: true, transaction }), { status: 201, headers });
    }

    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers });
  } catch (error) {
    console.error('Finance Error:', error);
    return new Response(JSON.stringify({ error: 'Server error: ' + error.message }), { status: 500, headers });
  }
};

export const config = { path: "/api/finance" };
