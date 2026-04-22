import { useState, useEffect } from 'react';

const CACHE_TTL = 60 * 60 * 1000; // 1 hour

type CachedStars = {
  count: number;
  timestamp: number;
};

export const useGitHubStars = (owner: string, repo: string) => {
  const [starCount, setStarCount] = useState<number | null>(null);
  const cacheKey = `AGENT_ENHANCED_GITHUB_STARS:${owner}/${repo}`;

  useEffect(() => {
    if (!owner || !repo) {
      setStarCount(null);
      return;
    }

    // Check cache first
    try {
      const cached = localStorage.getItem(cacheKey);
      if (cached) {
        const parsed: CachedStars = JSON.parse(cached);
        if (Date.now() - parsed.timestamp < CACHE_TTL) {
          setStarCount(parsed.count);
          return;
        }
      }
    } catch {
      // ignore
    }

    const fetchStars = async () => {
      try {
        const response = await fetch(`https://api.github.com/repos/${owner}/${repo}`);
        if (!response.ok) return;
        const data = await response.json();
        const count = data.stargazers_count;
        if (typeof count === 'number') {
          setStarCount(count);
          try {
            localStorage.setItem(cacheKey, JSON.stringify({ count, timestamp: Date.now() }));
          } catch {
            // ignore
          }
        }
      } catch {
        // silent fail
      }
    };

    void fetchStars();
  }, [cacheKey, owner, repo]);

  const formattedCount = starCount !== null
    ? starCount >= 1000
      ? `${(starCount / 1000).toFixed(1)}k`
      : `${starCount}`
    : null;

  return { starCount, formattedCount };
};
