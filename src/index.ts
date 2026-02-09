import { createAgent } from '@lucid-agents/core';
import { http } from '@lucid-agents/http';
import { paymentMiddlewareFromConfig } from '@x402/hono';
import { HTTPFacilitatorClient } from '@x402/core/server';
import { ExactEvmScheme } from '@x402/evm/exact/server';
import { serve } from '@hono/node-server';
import { z } from 'zod';
import { Hono } from 'hono';

// ============================================================================
// TREND SCOUT - Trending topics from HackerNews & Reddit
// by CephaloBot 🐙
// ============================================================================

// Environment config
type NetworkId = `${string}:${string}`;
const NETWORK = (process.env.NETWORK || 'eip155:8453') as NetworkId;
const PAY_TO = process.env.PAYMENTS_RECEIVABLE_ADDRESS || '';
const FACILITATOR_URL = process.env.FACILITATOR_URL || 'https://facilitator.daydreams.systems';

// Input schemas
const ScoutInputSchema = z.object({
  query: z.string().optional(),
  sources: z.array(z.enum(['hackernews', 'reddit'])).optional().default(['hackernews', 'reddit'])
});

// API helpers
async function fetchHackerNews(limit = 5): Promise<any[]> {
  const res = await fetch('https://hacker-news.firebaseio.com/v0/topstories.json');
  const topIds = await res.json() as number[];
  const stories = await Promise.all(
    topIds.slice(0, limit).map(async (id) => {
      const r = await fetch(`https://hacker-news.firebaseio.com/v0/item/${id}.json`);
      return r.json();
    })
  );
  return stories.map((s: any) => ({
    title: s.title,
    url: s.url,
    score: s.score,
    by: s.by,
    comments: s.descendants || 0
  }));
}

async function fetchReddit(subreddit = 'technology', limit = 5): Promise<any[]> {
  const res = await fetch(
    `https://www.reddit.com/r/${subreddit}/hot.json?limit=${limit}`,
    { headers: { 'User-Agent': 'TrendScout/1.0' } }
  );
  const data = await res.json() as any;
  return data.data?.children?.map((c: any) => ({
    title: c.data.title,
    url: `https://reddit.com${c.data.permalink}`,
    score: c.data.score,
    subreddit: c.data.subreddit,
    comments: c.data.num_comments
  })) || [];
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  const app = new Hono();

  // Set up x402 payment middleware
  const facilitatorClient = new HTTPFacilitatorClient({ url: FACILITATOR_URL });
  const evmScheme = new ExactEvmScheme();

  // Paid routes
  const paidRoutes = {
    'POST /entrypoints/scout/invoke': {
      accepts: { scheme: 'exact' as const, payTo: PAY_TO, price: '3000', network: NETWORK },
      description: 'Scout trending topics',
      mimeType: 'application/json'
    },
    'POST /entrypoints/deep-scout/invoke': {
      accepts: { scheme: 'exact' as const, payTo: PAY_TO, price: '5000', network: NETWORK },
      description: 'Deep scout with more results',
      mimeType: 'application/json'
    }
  };

  const paymentMiddleware = paymentMiddlewareFromConfig(
    paidRoutes,
    facilitatorClient,
    [{ network: NETWORK, server: evmScheme }]
  );

  // Apply payment middleware to paid routes
  app.use('/entrypoints/scout/invoke', paymentMiddleware);
  app.use('/entrypoints/deep-scout/invoke', paymentMiddleware);

  // FREE: Ping
  app.post('/entrypoints/ping/invoke', async (c) => {
    return c.json({
      run_id: crypto.randomUUID(),
      status: 'succeeded',
      output: {
        status: 'alive',
        agent: 'Trend Scout 🔍',
        version: '1.0.0',
        by: 'CephaloBot 🐙',
        timestamp: new Date().toISOString()
      }
    });
  });

  // PAID: Scout (basic)
  app.post('/entrypoints/scout/invoke', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const input = body.input || {};
    const sources = input.sources || ['hackernews', 'reddit'];
    const query = input.query || 'technology';
    
    const trends: Record<string, any[]> = {};
    
    if (sources.includes('hackernews')) {
      try {
        trends.hackernews = await fetchHackerNews(5);
      } catch { trends.hackernews = [{ error: 'Failed to fetch' }]; }
    }
    
    if (sources.includes('reddit')) {
      try {
        trends.reddit = await fetchReddit(query, 5);
      } catch { trends.reddit = [{ error: 'Failed to fetch' }]; }
    }
    
    return c.json({
      run_id: crypto.randomUUID(),
      status: 'succeeded',
      output: {
        query,
        sources,
        trends,
        scoutedAt: new Date().toISOString()
      }
    });
  });

  // PAID: Deep Scout (more results)
  app.post('/entrypoints/deep-scout/invoke', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const input = body.input || {};
    const sources = input.sources || ['hackernews', 'reddit'];
    const query = input.query || 'technology';
    
    const trends: Record<string, any[]> = {};
    
    if (sources.includes('hackernews')) {
      try {
        trends.hackernews = await fetchHackerNews(15);
      } catch { trends.hackernews = [{ error: 'Failed to fetch' }]; }
    }
    
    if (sources.includes('reddit')) {
      try {
        trends.reddit = await fetchReddit(query, 15);
      } catch { trends.reddit = [{ error: 'Failed to fetch' }]; }
    }
    
    return c.json({
      run_id: crypto.randomUUID(),
      status: 'succeeded',
      output: {
        query,
        sources,
        trends,
        totalItems: (trends.hackernews?.length || 0) + (trends.reddit?.length || 0),
        scoutedAt: new Date().toISOString()
      }
    });
  });

  // Base URL for this agent
  const BASE_URL = process.env.BASE_URL || 'https://trend-scout-production.up.railway.app';

  // Agent card (A2A)
  app.get('/.well-known/agent.json', (c) => {
    return c.json({
      protocolVersion: '1.0',
      name: 'Trend Scout',
      description: 'Scouts trending topics from HackerNews and Reddit',
      url: BASE_URL,
      version: '1.0.0',
      capabilities: { streaming: false, pushNotifications: false },
      skills: [
        { id: 'ping', name: 'ping', description: 'Health check' },
        { id: 'scout', name: 'scout', description: 'Scout trending topics (5 per source)' },
        { id: 'deep-scout', name: 'deep-scout', description: 'Deep scout (15 per source)' }
      ],
      entrypoints: {
        ping: { description: 'Health check', pricing: { invoke: '0' } },
        scout: { description: 'Scout trends', pricing: { invoke: '3000' } },
        'deep-scout': { description: 'Deep scout', pricing: { invoke: '5000' } }
      },
      payments: [{
        method: 'x402',
        payee: PAY_TO,
        network: NETWORK,
        endpoint: FACILITATOR_URL
      }]
    });
  });

  // ERC-8004 Registration File
  app.get('/.well-known/erc8004.json', (c) => {
    return c.json({
      type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
      name: "Trend Scout",
      description: "Trending topics discovery agent. Scouts HackerNews and Reddit for the hottest discussions in tech, crypto, and beyond. Paid via x402 micropayments. Built by CephaloBot 🐙",
      image: `${BASE_URL}/icon.png`,
      services: [
        { name: "web", endpoint: BASE_URL },
        { name: "A2A", endpoint: `${BASE_URL}/.well-known/agent.json`, version: "1.0" },
        { name: "x402", endpoint: `${BASE_URL}/entrypoints/scout/invoke` }
      ],
      x402Support: true,
      active: true,
      registrations: [],  // Will be populated after on-chain registration
      supportedTrust: ["reputation"]
    });
  });

  // Agent Icon (SVG)
  app.get('/icon.png', (c) => {
    // SVG icon: magnifying glass with trend arrow
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
      <defs>
        <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" style="stop-color:#2d1b69"/>
          <stop offset="100%" style="stop-color:#11998e"/>
        </linearGradient>
      </defs>
      <rect width="512" height="512" rx="100" fill="url(#bg)"/>
      <circle cx="220" cy="220" r="120" stroke="#ffffff" stroke-width="32" fill="none"/>
      <line x1="310" y1="310" x2="420" y2="420" stroke="#ffffff" stroke-width="40" stroke-linecap="round"/>
      <path d="M160 260 L200 200 L240 230 L280 170" stroke="#00ff88" stroke-width="16" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
      <polygon points="280,150 300,180 260,180" fill="#00ff88"/>
      <text x="256" y="480" text-anchor="middle" fill="#ffffff" font-family="Arial" font-size="36" font-weight="bold">SCOUT</text>
    </svg>`;
    return new Response(svg, {
      headers: { 'Content-Type': 'image/svg+xml' }
    });
  });

  // Health check endpoint
  app.get('/health', (c) => c.json({ status: 'ok', agent: 'trend-scout', version: '1.0.0' }));

  // Start server
  const port = parseInt(process.env.PORT || '3000');
  console.log(`🔍 Trend Scout starting on port ${port}...`);
  console.log(`💰 Payments: ${NETWORK} → ${PAY_TO}`);
  
  serve({ fetch: app.fetch, port }, (info) => {
    console.log(`✅ Trend Scout running at http://localhost:${info.port}`);
    console.log(`\n📈 Entrypoints:`);
    console.log(`   POST /entrypoints/ping/invoke        - Health check (FREE)`);
    console.log(`   POST /entrypoints/scout/invoke       - Scout trends (0.003 USDC)`);
    console.log(`   POST /entrypoints/deep-scout/invoke  - Deep scout (0.005 USDC)`);
    console.log(`\n📋 Agent Card:`);
    console.log(`   GET  /.well-known/agent.json`);
  });
}

main().catch(console.error);
