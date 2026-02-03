import { z } from "zod";

import { createAgentApp } from "@lucid-agents/hono";

import { createAgent } from "@lucid-agents/core";
import { http } from "@lucid-agents/http";
// Payments - uncomment when x402 facilitator is configured
// import { payments, paymentsFromEnv } from "@lucid-agents/payments";

const agent = await createAgent({
  name: process.env.AGENT_NAME ?? "trend-scout",
  version: process.env.AGENT_VERSION ?? "0.1.0",
  description: process.env.AGENT_DESCRIPTION ?? "AI agent that scouts trending topics across the web. Pay per query to get real-time trend intelligence.",
})
  .use(http())
  // .use(payments({ config: paymentsFromEnv() })) // Enable after deployment
  .build();

const { app, addEntrypoint } = await createAgentApp(agent);

// Types for trend data
interface TrendItem {
  title: string;
  source: string;
  url?: string;
  score?: number;
  comments?: number;
}

interface TrendResponse {
  trends: TrendItem[];
  sources: string[];
  timestamp: string;
}

// Fetch Reddit trending
async function fetchRedditTrends(): Promise<TrendItem[]> {
  try {
    const res = await fetch("https://www.reddit.com/r/all/hot.json?limit=10", {
      headers: { "User-Agent": "TrendScout/1.0" },
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data.data.children.map((post: any) => ({
      title: post.data.title,
      source: "reddit",
      url: `https://reddit.com${post.data.permalink}`,
      score: post.data.score,
      comments: post.data.num_comments,
    }));
  } catch {
    return [];
  }
}

// Fetch Hacker News trending
async function fetchHNTrends(): Promise<TrendItem[]> {
  try {
    const topRes = await fetch("https://hacker-news.firebaseio.com/v0/topstories.json");
    if (!topRes.ok) return [];
    const topIds = await topRes.json();
    
    const stories = await Promise.all(
      topIds.slice(0, 10).map(async (id: number) => {
        const storyRes = await fetch(`https://hacker-news.firebaseio.com/v0/item/${id}.json`);
        return storyRes.json();
      })
    );
    
    return stories.map((story: any) => ({
      title: story.title,
      source: "hackernews",
      url: story.url || `https://news.ycombinator.com/item?id=${story.id}`,
      score: story.score,
      comments: story.descendants || 0,
    }));
  } catch {
    return [];
  }
}

// Fetch Lobsters trending (tech community)
async function fetchLobstersTrends(): Promise<TrendItem[]> {
  try {
    const res = await fetch("https://lobste.rs/hottest.json");
    if (!res.ok) return [];
    const data = await res.json();
    return data.slice(0, 10).map((story: any) => ({
      title: story.title,
      source: "lobsters",
      url: story.url || story.short_id_url,
      score: story.score,
      comments: story.comment_count,
    }));
  } catch {
    return [];
  }
}

// Input schema for the trends endpoint
const trendsInputSchema = z.object({
  sources: z.array(z.enum(["reddit", "hackernews", "lobsters", "all"])).optional().default(["all"]),
  limit: z.number().min(1).max(50).optional().default(10),
  category: z.string().optional(),
});

// Main trends entrypoint
addEntrypoint({
  key: "get-trends",
  description: "Get trending topics from across the web. Returns hot topics from Reddit, Hacker News, and Lobsters.",
  input: trendsInputSchema,
  // Price: 1000 = 0.001 USDC (6 decimals on Base)
  // price: "1000", // Enable after payments configured
  handler: async (ctx) => {
    const input = ctx.input as z.infer<typeof trendsInputSchema>;
    const requestedSources = input.sources.includes("all") 
      ? ["reddit", "hackernews", "lobsters"] 
      : input.sources;
    
    const allTrends: TrendItem[] = [];
    const successSources: string[] = [];
    
    // Fetch from requested sources in parallel
    const fetchPromises: Promise<TrendItem[]>[] = [];
    
    if (requestedSources.includes("reddit")) {
      fetchPromises.push(fetchRedditTrends().then(trends => {
        if (trends.length > 0) successSources.push("reddit");
        return trends;
      }));
    }
    if (requestedSources.includes("hackernews")) {
      fetchPromises.push(fetchHNTrends().then(trends => {
        if (trends.length > 0) successSources.push("hackernews");
        return trends;
      }));
    }
    if (requestedSources.includes("lobsters")) {
      fetchPromises.push(fetchLobstersTrends().then(trends => {
        if (trends.length > 0) successSources.push("lobsters");
        return trends;
      }));
    }
    
    const results = await Promise.all(fetchPromises);
    results.forEach(trends => allTrends.push(...trends));
    
    // Sort by score (if available) and limit
    const sortedTrends = allTrends
      .sort((a, b) => (b.score || 0) - (a.score || 0))
      .slice(0, input.limit);
    
    const response: TrendResponse = {
      trends: sortedTrends,
      sources: successSources,
      timestamp: new Date().toISOString(),
    };
    
    return { output: response };
  },
});

// Free health/info endpoint
addEntrypoint({
  key: "info",
  description: "Get information about Trend Scout (free endpoint)",
  input: z.object({}),
  handler: async () => {
    return {
      output: {
        name: "Trend Scout",
        version: "0.1.0",
        description: "AI agent that scouts trending topics across the web",
        author: "CephaloBot",
        sources: ["reddit", "hackernews", "lobsters"],
        pricing: {
          "get-trends": "0.001 USDC per query",
        },
      },
    };
  },
});

export { app };
