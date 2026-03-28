const headers = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

const SYSTEM = `You are a friendly, knowledgeable support agent for AIRWAVES, a premium hemp and cannabis dispensary brand. You help customers with:
- Product questions (strains, CBD, hemp flower, effects, terpenes, Delta-8, CBG, CBN)
- Order status and shipping (free shipping on orders over $75, otherwise $5.99 flat rate)
- Payment methods
- Returns and refunds
- General cannabis/hemp education

Keep responses concise and conversational — 1-3 sentences unless more detail is genuinely needed. Be warm and approachable. Never give medical advice. If you don't know something specific about an order, ask for their order number. All products contain less than 0.3% THC and are federally legal hemp products.`;

export default async (req, context) => {
  if (req.method === 'OPTIONS') {
    return new Response('', { status: 204, headers });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'Support service not configured' }), { status: 503, headers });
  }

  try {
    const { messages } = await req.json();
    if (!messages || !Array.isArray(messages)) {
      return new Response(JSON.stringify({ error: 'messages array required' }), { status: 400, headers });
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 512,
        system: SYSTEM,
        messages
      })
    });

    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error?.message || 'Claude API error');
    }

    const data = await response.json();
    const reply = data.content[0].text;

    return new Response(JSON.stringify({ reply }), { status: 200, headers });
  } catch (error) {
    console.error('Support Error:', error);
    return new Response(JSON.stringify({ error: 'Support unavailable, please try again shortly.' }), { status: 500, headers });
  }
};

export const config = { path: '/api/support/chat' };
