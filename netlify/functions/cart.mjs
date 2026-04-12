import { neon } from '@netlify/neon';

const sql = neon();

const headers = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS'
};

function getSessionId(req) {
  const authHeader = req.headers.get('Authorization');
  if (authHeader) {
    try {
      const token = authHeader.replace('Bearer ', '');
      const [data] = token.split('.');
      const payload = JSON.parse(Buffer.from(data, 'base64url').toString());
      return 'user_' + payload.id;
    } catch {}
  }
  const url = new URL(req.url);
  return url.searchParams.get('session') || 'anon_' + Date.now();
}

export default async (req, context) => {
  if (req.method === 'OPTIONS') {
    return new Response('', { status: 204, headers });
  }

  const sessionId = getSessionId(req);
  const url = new URL(req.url);
  const itemId = url.searchParams.get('id');

  try {
    // GET - get cart items
    if (req.method === 'GET') {
      const items = await sql`
        SELECT ci.id, ci.quantity, ci.product_id, ci.variant_id,
          p.name, p.image_url, p.stock as product_stock, p.weight,
          COALESCE(pv.price, p.price) as price,
          COALESCE(pv.label, '') as variant_label,
          COALESCE(pv.weight, p.weight) as variant_weight,
          COALESCE(pv.stock, p.stock) as stock
        FROM cart_items ci
        JOIN products p ON ci.product_id = p.id
        LEFT JOIN product_variants pv ON ci.variant_id = pv.id
        WHERE ci.session_id = ${sessionId}
        ORDER BY ci.created_at DESC
      `;
      const total = items.reduce((sum, item) => sum + (parseFloat(item.price) * item.quantity), 0);
      return new Response(JSON.stringify({ items, total: total.toFixed(2), count: items.length }), { status: 200, headers });
    }

    // POST - add to cart
    if (req.method === 'POST') {
      const { product_id, quantity, variant_id } = await req.json();
      if (!product_id) return new Response(JSON.stringify({ error: 'Product ID required' }), { status: 400, headers });

      // Check if product exists and has stock
      const [product] = await sql`SELECT * FROM products WHERE id = ${product_id} AND active = true`;
      if (!product) return new Response(JSON.stringify({ error: 'Product not found' }), { status: 404, headers });

      // Check if already in cart (same product + same variant)
      let existing;
      if (variant_id) {
        [existing] = await sql`SELECT * FROM cart_items WHERE session_id = ${sessionId} AND product_id = ${product_id} AND variant_id = ${variant_id}`;
      } else {
        [existing] = await sql`SELECT * FROM cart_items WHERE session_id = ${sessionId} AND product_id = ${product_id} AND variant_id IS NULL`;
      }
      if (existing) {
        const newQty = existing.quantity + (quantity || 1);
        const [updated] = await sql`UPDATE cart_items SET quantity = ${newQty} WHERE id = ${existing.id} RETURNING *`;
        return new Response(JSON.stringify({ success: true, item: updated }), { status: 200, headers });
      }

      const [item] = await sql`
        INSERT INTO cart_items (session_id, product_id, quantity, variant_id)
        VALUES (${sessionId}, ${product_id}, ${quantity || 1}, ${variant_id || null})
        RETURNING *
      `;
      return new Response(JSON.stringify({ success: true, item }), { status: 201, headers });
    }

    // PUT - update quantity
    if (req.method === 'PUT') {
      if (!itemId) return new Response(JSON.stringify({ error: 'Cart item ID required' }), { status: 400, headers });
      const { quantity } = await req.json();
      if (quantity <= 0) {
        await sql`DELETE FROM cart_items WHERE id = ${itemId} AND session_id = ${sessionId}`;
        return new Response(JSON.stringify({ success: true, removed: true }), { status: 200, headers });
      }
      const [item] = await sql`UPDATE cart_items SET quantity = ${quantity} WHERE id = ${itemId} AND session_id = ${sessionId} RETURNING *`;
      return new Response(JSON.stringify({ success: true, item }), { status: 200, headers });
    }

    // DELETE - remove item or clear cart
    if (req.method === 'DELETE') {
      if (itemId) {
        await sql`DELETE FROM cart_items WHERE id = ${itemId} AND session_id = ${sessionId}`;
      } else {
        await sql`DELETE FROM cart_items WHERE session_id = ${sessionId}`;
      }
      return new Response(JSON.stringify({ success: true }), { status: 200, headers });
    }

    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers });
  } catch (error) {
    console.error('Cart Error:', error);
    return new Response(JSON.stringify({ error: 'Server error: ' + error.message }), { status: 500, headers });
  }
};

export const config = { path: "/api/cart" };
