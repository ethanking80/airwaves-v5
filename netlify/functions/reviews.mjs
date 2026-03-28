import { neon } from '@netlify/neon';
import { verifyToken } from './auth.mjs';

const sql = neon();

const headers = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
};

export default async (req, context) => {
  if (req.method === 'OPTIONS') {
    return new Response('', { status: 204, headers });
  }

  const url = new URL(req.url);
  const productId = url.searchParams.get('product_id');

  try {
    // GET - fetch reviews for a product
    if (req.method === 'GET') {
      if (!productId) return new Response(JSON.stringify({ error: 'product_id required' }), { status: 400, headers });
      const reviews = await sql`
        SELECT id, product_id, reviewer_name, rating, title, body, verified_purchase, created_at
        FROM reviews WHERE product_id = ${productId}
        ORDER BY created_at DESC
      `;
      // Calculate summary
      const count = reviews.length;
      const avg = count > 0 ? reviews.reduce((s, r) => s + r.rating, 0) / count : 0;
      const distribution = [0, 0, 0, 0, 0];
      reviews.forEach(r => { distribution[r.rating - 1]++; });
      return new Response(JSON.stringify({ reviews, summary: { count, average: Math.round(avg * 10) / 10, distribution } }), { status: 200, headers });
    }

    // POST - submit a review (authenticated)
    if (req.method === 'POST') {
      const authHeader = req.headers.get('Authorization');
      if (!authHeader) return new Response(JSON.stringify({ error: 'Must be signed in to leave a review' }), { status: 401, headers });
      const user = verifyToken(authHeader.replace('Bearer ', ''));
      if (!user) return new Response(JSON.stringify({ error: 'Invalid token' }), { status: 401, headers });

      const { product_id, rating, title, body } = await req.json();
      if (!product_id || !rating) return new Response(JSON.stringify({ error: 'product_id and rating are required' }), { status: 400, headers });
      if (rating < 1 || rating > 5) return new Response(JSON.stringify({ error: 'Rating must be 1-5' }), { status: 400, headers });

      // Check if user already reviewed this product
      const existing = await sql`SELECT id FROM reviews WHERE product_id = ${product_id} AND user_id = ${user.id}`;
      if (existing.length > 0) return new Response(JSON.stringify({ error: 'You have already reviewed this product' }), { status: 409, headers });

      // Check if user has purchased this product
      const purchased = await sql`
        SELECT oi.id FROM order_items oi
        JOIN orders o ON oi.order_id = o.id
        WHERE o.user_id = ${user.id} AND oi.product_id = ${product_id}
        LIMIT 1
      `;

      const [review] = await sql`
        INSERT INTO reviews (product_id, user_id, reviewer_name, rating, title, body, verified_purchase)
        VALUES (${product_id}, ${user.id}, ${user.name}, ${rating}, ${title || ''}, ${body || ''}, ${purchased.length > 0})
        RETURNING *
      `;
      return new Response(JSON.stringify({ success: true, review }), { status: 201, headers });
    }

    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers });
  } catch (error) {
    console.error('Reviews Error:', error);
    return new Response(JSON.stringify({ error: 'Server error: ' + error.message }), { status: 500, headers });
  }
};

export const config = { path: "/api/reviews" };
