import { neon } from '@netlify/neon';

const sql = neon();

async function logOrderEvent(orderId, action, details = '', performedBy = '') {
  try {
    await sql`INSERT INTO order_log (order_id, action, details, performed_by) VALUES (${orderId}, ${action}, ${details}, ${performedBy})`;
  } catch (e) { console.error('Order log error:', e.message); }
}

function getAdminName(req) {
  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return '';
    const token = authHeader.replace('Bearer ', '');
    const [data] = token.split('.');
    const payload = JSON.parse(Buffer.from(data, 'base64url').toString());
    return payload.name || payload.email || 'Admin #' + payload.id;
  } catch { return ''; }
}

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
  return url.searchParams.get('session') || null;
}

export default async (req, context) => {
  if (req.method === 'OPTIONS') {
    return new Response('', { status: 204, headers });
  }

  const url = new URL(req.url);
  const orderId = url.searchParams.get('id');
  const allOrders = url.searchParams.get('all');

  try {
    // GET - list orders
    if (req.method === 'GET') {
      if (orderId) {
        const action = url.searchParams.get('action');

        // Log a view event
        if (action === 'log-view') {
          const admin = getAdminName(req);
          await logOrderEvent(orderId, 'viewed', 'Order viewed by admin', admin);
          return new Response(JSON.stringify({ success: true }), { status: 200, headers });
        }

        const [order] = await sql`SELECT * FROM orders WHERE id = ${orderId}`;
        if (!order) return new Response(JSON.stringify({ error: 'Order not found' }), { status: 404, headers });
        let items = [];
        let log = [];
        try { items = await sql`SELECT * FROM order_items WHERE order_id = ${orderId}`; } catch {}
        try { log = await sql`SELECT * FROM order_log WHERE order_id = ${orderId} ORDER BY created_at DESC`; } catch {}
        return new Response(JSON.stringify({ ...order, items, log }), { status: 200, headers });
      }
      // Admin: get all orders
      if (allOrders === 'true') {
        const orders = await sql`SELECT * FROM orders ORDER BY created_at DESC`;
        return new Response(JSON.stringify(orders), { status: 200, headers });
      }
      // Customer: get their orders
      const sessionId = getSessionId(req);
      if (!sessionId) return new Response(JSON.stringify([]), { status: 200, headers });
      const orders = await sql`SELECT * FROM orders WHERE session_id = ${sessionId} ORDER BY created_at DESC`;
      return new Response(JSON.stringify(orders), { status: 200, headers });
    }

    // POST - create order
    if (req.method === 'POST') {
      const action = url.searchParams.get('action');

      // Admin: create order directly (no cart)
      if (action === 'admin-create') {
        const { customer_name, customer_email, shipping_address, total, payment_method, status, delivery_type, delivery_borough } = await req.json();
        if (!payment_method) {
          return new Response(JSON.stringify({ error: 'Payment method is required' }), { status: 400, headers });
        }
        if (!total || parseFloat(total) <= 0) {
          return new Response(JSON.stringify({ error: 'Total must be greater than 0' }), { status: 400, headers });
        }
        const [order] = await sql`
          INSERT INTO orders (session_id, total, customer_name, customer_email, shipping_address, status, payment_method, delivery_type, delivery_borough, payment_status)
          VALUES (${'admin_manual'}, ${parseFloat(total).toFixed(2)}, ${customer_name || ''}, ${customer_email || ''}, ${shipping_address || ''}, ${status || 'pending'}, ${payment_method}, ${delivery_type || 'delivery'}, ${delivery_borough || ''}, 'pending')
          RETURNING *
        `;
        const admin = getAdminName(req);
        await logOrderEvent(order.id, 'created', `Order created manually by admin. Total: $${parseFloat(total).toFixed(2)}, Payment: ${payment_method}`, admin);
        return new Response(JSON.stringify({ success: true, order }), { status: 201, headers });
      }

      // Customer: create order from cart
      const sessionId = getSessionId(req);
      const { customer_name, customer_email, shipping_address, payment_method, delivery_type, delivery_borough, device_info } = await req.json();

      if (!payment_method) {
        return new Response(JSON.stringify({ error: 'Payment method is required' }), { status: 400, headers });
      }

      // Get cart items
      const cartItems = await sql`
        SELECT ci.*, p.name as product_name, p.price
        FROM cart_items ci JOIN products p ON ci.product_id = p.id
        WHERE ci.session_id = ${sessionId}
      `;
      if (cartItems.length === 0) {
        return new Response(JSON.stringify({ error: 'Cart is empty' }), { status: 400, headers });
      }

      const total = cartItems.reduce((sum, item) => sum + (parseFloat(item.price) * item.quantity), 0);

      // Create order
      const [order] = await sql`
        INSERT INTO orders (session_id, total, customer_name, customer_email, shipping_address, status, payment_method, delivery_type, delivery_borough, payment_status, device_info)
        VALUES (${sessionId}, ${total.toFixed(2)}, ${customer_name || ''}, ${customer_email || ''}, ${shipping_address || ''}, 'pending', ${payment_method}, ${delivery_type || 'delivery'}, ${delivery_borough || ''}, 'pending', ${device_info || ''})
        RETURNING *
      `;

      // Create order items
      for (const item of cartItems) {
        await sql`
          INSERT INTO order_items (order_id, product_id, product_name, quantity, price)
          VALUES (${order.id}, ${item.product_id}, ${item.product_name}, ${item.quantity}, ${item.price})
        `;
      }

      // Clear cart
      await sql`DELETE FROM cart_items WHERE session_id = ${sessionId}`;

      await logOrderEvent(order.id, 'created', `Order placed by customer. ${cartItems.length} item(s), Total: $${total.toFixed(2)}, Payment: ${payment_method}`, customer_name || customer_email || sessionId);
      return new Response(JSON.stringify({ success: true, order }), { status: 201, headers });
    }

    // PUT - update order (admin)
    if (req.method === 'PUT') {
      if (!orderId) return new Response(JSON.stringify({ error: 'Order ID required' }), { status: 400, headers });
      const body = await req.json();
      const { status, customer_name, customer_email, shipping_address, payment_method, delivery_type, delivery_borough, total } = body;

      // Get current order for change detection
      const [currentOrder] = await sql`SELECT * FROM orders WHERE id = ${orderId}`;

      const fields = [];
      const values = {};
      if (status !== undefined) { fields.push('status'); values.status = status; }
      if (customer_name !== undefined) { fields.push('customer_name'); values.customer_name = customer_name; }
      if (customer_email !== undefined) { fields.push('customer_email'); values.customer_email = customer_email; }
      if (shipping_address !== undefined) { fields.push('shipping_address'); values.shipping_address = shipping_address; }
      if (payment_method !== undefined) { fields.push('payment_method'); values.payment_method = payment_method; }
      if (delivery_type !== undefined) { fields.push('delivery_type'); values.delivery_type = delivery_type; }
      if (delivery_borough !== undefined) { fields.push('delivery_borough'); values.delivery_borough = delivery_borough; }
      if (total !== undefined) { fields.push('total'); values.total = total; }

      if (fields.length === 0) return new Response(JSON.stringify({ error: 'No fields to update' }), { status: 400, headers });

      // Build dynamic update — neon tagged template requires individual field handling
      let order;
      if (fields.length === 1 && fields[0] === 'status') {
        [order] = await sql`UPDATE orders SET status = ${values.status} WHERE id = ${orderId} RETURNING *`;
      } else {
        [order] = await sql`UPDATE orders SET
          status = COALESCE(${values.status ?? null}, status),
          customer_name = COALESCE(${values.customer_name ?? null}, customer_name),
          customer_email = COALESCE(${values.customer_email ?? null}, customer_email),
          shipping_address = COALESCE(${values.shipping_address ?? null}, shipping_address),
          payment_method = COALESCE(${values.payment_method ?? null}, payment_method),
          delivery_type = COALESCE(${values.delivery_type ?? null}, delivery_type),
          delivery_borough = COALESCE(${values.delivery_borough ?? null}, delivery_borough),
          total = COALESCE(${values.total !== undefined ? values.total : null}, total)
          WHERE id = ${orderId} RETURNING *`;
      }
      // Log changes
      const admin = getAdminName(req);
      if (currentOrder) {
        const changes = [];
        if (status !== undefined && status !== currentOrder.status) changes.push(`Status: ${currentOrder.status} → ${status}`);
        if (customer_name !== undefined && customer_name !== currentOrder.customer_name) changes.push(`Customer name updated`);
        if (customer_email !== undefined && customer_email !== currentOrder.customer_email) changes.push(`Email updated`);
        if (shipping_address !== undefined && shipping_address !== currentOrder.shipping_address) changes.push(`Shipping address updated`);
        if (payment_method !== undefined && payment_method !== currentOrder.payment_method) changes.push(`Payment: ${currentOrder.payment_method} → ${payment_method}`);
        if (total !== undefined && parseFloat(total) !== parseFloat(currentOrder.total)) changes.push(`Total: $${parseFloat(currentOrder.total).toFixed(2)} → $${parseFloat(total).toFixed(2)}`);
        if (delivery_type !== undefined && delivery_type !== currentOrder.delivery_type) changes.push(`Delivery: ${currentOrder.delivery_type} → ${delivery_type}`);
        if (changes.length > 0) {
          await logOrderEvent(orderId, 'updated', changes.join('; '), admin);
        }
      }

      return new Response(JSON.stringify({ success: true, order }), { status: 200, headers });
    }

    // DELETE - delete order (admin)
    if (req.method === 'DELETE') {
      if (!orderId) return new Response(JSON.stringify({ error: 'Order ID required' }), { status: 400, headers });
      const admin = getAdminName(req);
      await logOrderEvent(orderId, 'deleted', 'Order deleted by admin', admin);
      await sql`DELETE FROM order_items WHERE order_id = ${orderId}`;
      await sql`DELETE FROM orders WHERE id = ${orderId}`;
      return new Response(JSON.stringify({ success: true }), { status: 200, headers });
    }

    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers });
  } catch (error) {
    console.error('Orders Error:', error);
    return new Response(JSON.stringify({ error: 'Server error: ' + error.message }), { status: 500, headers });
  }
};

export const config = { path: "/api/orders" };
