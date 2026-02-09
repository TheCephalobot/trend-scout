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

  // Agent card
  app.get('/.well-known/agent.json', (c) => {
    return c.json({
      protocolVersion: '1.0',
      name: 'Trend Scout',
      description: 'Scouts trending topics from HackerNews and Reddit',
      url: 'https://trend-scout-production.up.railway.app/',
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
