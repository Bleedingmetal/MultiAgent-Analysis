import unittest

from app.pricing import cost_usd


class CachedPricingTests(unittest.TestCase):
    def test_fresh_tokens_cost_list_price(self):
        # claude-haiku-5-5: $0.10 in, $0.50 out per million
        self.assertAlmostEqual(cost_usd("claude-haiku-5-5", 1_000_000, 0), 0.10)
        self.assertAlmostEqual(cost_usd("claude-haiku-5-5", 0, 1_000_000), 0.50)

    def test_anthropic_cache_reads_cost_a_tenth(self):
        full = cost_usd("claude-haiku-5-5", 1_000_000, 0)
        cached = cost_usd("claude-haiku-5-5", 1_000_000, 0, cache_read_tokens=1_000_000)
        self.assertAlmostEqual(cached, full * 0.10)

    def test_anthropic_cache_writes_cost_a_quarter_more(self):
        full = cost_usd("claude-haiku-5-5", 1_000_000, 0)
        written = cost_usd("claude-haiku-5-5", 1_000_000, 0, cache_write_tokens=1_000_000)
        self.assertAlmostEqual(written, full * 1.25)

    def test_openai_cache_reads_cost_half(self):
        full = cost_usd("gpt-4o-mini", 1_000_000, 0)
        cached = cost_usd("gpt-4o-mini", 1_000_000, 0, cache_read_tokens=600_000)
        self.assertAlmostEqual(cached, full * (0.4 + 0.6 * 0.5))

    def test_a_conversation_turn_is_mostly_cached(self):
        # 12,000-token turn on Haiku where 11,000 tokens came from the cache
        fresh = cost_usd("claude-haiku-5-5", 12_000, 200)
        cached = cost_usd("claude-haiku-5-5", 12_000, 200, cache_read_tokens=11_000)
        self.assertLess(cached, fresh * 0.3)


if __name__ == "__main__":
    unittest.main()
