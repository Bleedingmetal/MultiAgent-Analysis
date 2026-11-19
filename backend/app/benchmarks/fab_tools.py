"""Research tools for the Finance Agent Benchmark (FAB v2.1).

The official harness (vals-ai/finance-agent-v2) gives the agent:
  edgar_search         full-text search of SEC filings (sec-api.io, paid key)
  web_search           Tavily (paid key)
  parse_html_page      fetch a page, keep its text under a key in the run's document store
  retrieve_information an LLM answers a prompt over stored documents ({{key}} placeholders)
  calculator
  price_history        Tiingo (paid key)

Here, edgar_search uses SEC EDGAR's own free full-text search and filing index instead of
sec-api.io (same filings, different search engine and ranking), so it needs no key. The
page store, retrieval and calculator behave like the official ones. web_search and
price_history are offered only when TAVILY_API_KEY / TIINGO_API_KEY are set.
"""

from __future__ import annotations

import json
import re
import threading
import urllib.error
import urllib.parse
import urllib.request
from functools import lru_cache
from html.parser import HTMLParser
from typing import Any

from app.config import settings
from app.llm import ToolSpec, complete, infer_provider
from app.runners.tools import calculate

# Kept small: tool results go back into the agent's context on every later step
PREVIEW_CHARS = 1_500
# What one retrieval call may read (~70K tokens; stays in Haiku's cheaper <=100K tier)
RETRIEVAL_CHARS = 280_000
MAX_PAGE_BYTES = 12_000_000
_SEC_HOSTS = ("sec.gov", "www.sec.gov", "efts.sec.gov", "data.sec.gov")


def _user_agent() -> str:
    # SEC asks automated clients for an identifying User-Agent. Generic by default; set
    # SEC_USER_AGENT in .env to your organisation's name and contact address.
    return settings()["sec_user_agent"]


def _get(url: str, *, timeout: int = 30, headers: dict[str, str] | None = None) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": _user_agent(), **(headers or {})})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read(MAX_PAGE_BYTES)


class _TextExtractor(HTMLParser):
    """HTML to readable text: drops scripts/styles and hidden XBRL headers, keeps table rows."""

    _SKIP = {"script", "style", "head", "ix:header", "noscript"}
    _BLOCK = {"p", "div", "br", "tr", "li", "h1", "h2", "h3", "h4", "h5", "h6", "table", "section"}

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self._skip = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in self._SKIP:
            self._skip += 1
        elif tag in self._BLOCK:
            self.parts.append("\n")
        elif tag in {"td", "th"}:
            self.parts.append(" | ")

    def handle_endtag(self, tag: str) -> None:
        if tag in self._SKIP and self._skip:
            self._skip -= 1

    def handle_data(self, data: str) -> None:
        if not self._skip:
            self.parts.append(data)


def html_to_text(html: str) -> str:
    parser = _TextExtractor()
    parser.feed(html)
    text = "".join(parser.parts).replace("\xa0", " ")
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"( ?\| ?){2,}", " | ", text)
    return re.sub(r"\n\s*\n+", "\n", text).strip()


@lru_cache(maxsize=1)
def _ticker_map() -> dict[str, tuple[str, str]]:
    data = json.loads(_get("https://www.sec.gov/files/company_tickers.json"))
    return {v["ticker"].upper(): (str(v["cik_str"]).zfill(10), v["title"]) for v in data.values()}


def _cik_for(ticker: str) -> tuple[str, str] | None:
    t = ticker.upper().split(":")[-1].strip()  # "NASDAQ:CRWD" -> CRWD
    return _ticker_map().get(t) or _ticker_map().get(t.replace(".", "-"))


def _filing_url(cik: str, accession: str, document: str) -> str:
    return f"https://www.sec.gov/Archives/edgar/data/{int(cik)}/{accession.replace('-', '')}/{document}"


def edgar_search(
    query: str = "",
    ticker: str = "",
    form_types: list[str] | None = None,
    start_date: str = "",
    end_date: str = "",
    limit: int = 10,
) -> str:
    limit = max(1, min(int(limit or 10), 20))
    forms = [f.strip().upper() for f in (form_types or []) if f and f.strip()]
    company = _cik_for(ticker) if ticker else None
    if ticker and not company:
        return f"error: unknown ticker {ticker}"
    rows: list[dict[str, Any]] = []
    if query.strip():
        params = {"q": query}
        if forms:
            params["forms"] = ",".join(forms)
        if company:
            params["ciks"] = company[0]
        if start_date or end_date:
            params.update(dateRange="custom", startdt=start_date or "2001-01-01", enddt=end_date or "2100-01-01")
        data = json.loads(_get("https://efts.sec.gov/LATEST/search-index?" + urllib.parse.urlencode(params)))
        for hit in data.get("hits", {}).get("hits", [])[:limit]:
            src = hit.get("_source", {})
            accession, _, document = hit.get("_id", "").partition(":")
            cik = (src.get("ciks") or [""])[0]
            rows.append({
                "company": (src.get("display_names") or [""])[0],
                "form": src.get("form"),
                "filed": src.get("file_date"),
                "period": src.get("period_ending"),
                "url": _filing_url(cik, accession, document) if cik and document else None,
            })
    elif company:
        # No search text: the company's latest filings, newest first
        recent = json.loads(_get(f"https://data.sec.gov/submissions/CIK{company[0]}.json"))["filings"]["recent"]
        for i, form in enumerate(recent["form"]):
            if forms and form.upper() not in forms:
                continue
            if start_date and recent["filingDate"][i] < start_date or end_date and recent["filingDate"][i] > end_date:
                continue
            rows.append({
                "company": company[1],
                "form": form,
                "filed": recent["filingDate"][i],
                "period": recent["reportDate"][i],
                "url": _filing_url(company[0], recent["accessionNumber"][i], recent["primaryDocument"][i]),
            })
            if len(rows) >= limit:
                break
    else:
        return "error: give a query, a ticker, or both"
    return json.dumps(rows, indent=1) if rows else "no filings found"


def web_search(query: str) -> str:
    key = settings()["tavily_api_key"]
    body = json.dumps({"query": query, "max_results": 5}).encode()
    req = urllib.request.Request(
        "https://api.tavily.com/search", data=body,
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {key}"},
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        data = json.loads(resp.read())
    return json.dumps(
        [{"title": r.get("title"), "url": r.get("url"), "content": (r.get("content") or "")[:600]}
         for r in data.get("results", [])],
        indent=1,
    )


def price_history(ticker: str, start_date: str, end_date: str) -> str:
    key = settings()["tiingo_api_key"]
    t = urllib.parse.quote(ticker.split(":")[-1].strip().lower())
    url = (f"https://api.tiingo.com/tiingo/daily/{t}/prices?"
           + urllib.parse.urlencode({"startDate": start_date, "endDate": end_date, "token": key}))
    rows = json.loads(_get(url, headers={"Content-Type": "application/json"}))
    keep = [{k: r.get(k) for k in ("date", "close", "adjClose", "volume")} for r in rows]
    if len(keep) > 60:  # long ranges: first, last and every nth day
        step = len(keep) // 50 + 1
        keep = keep[:1] + keep[1:-1:step] + keep[-1:]
    return json.dumps(keep)


_SPECS: dict[str, ToolSpec] = {
    "edgar_search": ToolSpec(
        name="edgar_search",
        description=(
            "Search SEC EDGAR filings. With `query`, full-text search of filing documents "
            "(use quotes for exact phrases); with only `ticker`, the company's latest filings. "
            "Filter by form types (10-K, 10-Q, 8-K, DEF 14A, S-1, ...) and filing dates "
            "(YYYY-MM-DD). Returns company, form, filing date, period and document URL."
        ),
        parameters={
            "type": "object",
            "properties": {
                "query": {"type": "string"},
                "ticker": {"type": "string"},
                "form_types": {"type": "array", "items": {"type": "string"}},
                "start_date": {"type": "string"},
                "end_date": {"type": "string"},
                "limit": {"type": "integer"},
            },
        },
    ),
    "parse_html_page": ToolSpec(
        name="parse_html_page",
        description=(
            "Fetch a web page or SEC filing, convert it to text and save it under `key` in "
            "your document store. Returns its length and the opening text; read it with "
            "retrieve_information."
        ),
        parameters={
            "type": "object",
            "properties": {"url": {"type": "string"}, "key": {"type": "string"}},
            "required": ["url", "key"],
        },
    ),
    "retrieve_information": ToolSpec(
        name="retrieve_information",
        description=(
            "Ask a question about saved documents. Put {{key}} in the prompt where a saved "
            "document should go, e.g. 'From {{crwd_10k}}, list total revenue for each fiscal "
            "year with the exact figures.' Optionally restrict a long document to character "
            "ranges, e.g. {\"crwd_10k\": [0, 200000]}."
        ),
        parameters={
            "type": "object",
            "properties": {
                "prompt": {"type": "string"},
                "input_character_ranges": {"type": "object"},
            },
            "required": ["prompt"],
        },
    ),
    "calculator": ToolSpec(
        name="calculator",
        description="Evaluate an arithmetic expression exactly, e.g. (5829 - 5735) / 5735.",
        parameters={
            "type": "object",
            "properties": {"expression": {"type": "string"}},
            "required": ["expression"],
        },
    ),
    "web_search": ToolSpec(
        name="web_search",
        description="Search the web (news, investor relations, press releases).",
        parameters={"type": "object", "properties": {"query": {"type": "string"}}, "required": ["query"]},
    ),
    "price_history": ToolSpec(
        name="price_history",
        description="Daily closing prices for a ticker between two dates (YYYY-MM-DD).",
        parameters={
            "type": "object",
            "properties": {
                "ticker": {"type": "string"},
                "start_date": {"type": "string"},
                "end_date": {"type": "string"},
            },
            "required": ["ticker", "start_date", "end_date"],
        },
    ),
}


def available_tools() -> list[str]:
    s = settings()
    names = ["edgar_search", "parse_html_page", "retrieve_information", "calculator"]
    if s["tavily_api_key"]:
        names.append("web_search")
    if s["tiingo_api_key"]:
        names.append("price_history")
    return names


def _relevant_slice(text: str, prompt: str, budget: int) -> str:
    """A long document cut to the passages that share the most words with the prompt."""
    if len(text) <= budget:
        return text
    terms = {w for w in re.findall(r"[a-z0-9]{4,}", prompt.lower())}
    size = 4_000
    chunks = [(i, text[i : i + size]) for i in range(0, len(text), size)]
    ranked = sorted(chunks, key=lambda c: -sum(c[1].lower().count(t) for t in terms))
    keep = sorted(ranked[: max(1, budget // size)])
    return "\n[...]\n".join(chunk for _, chunk in keep)


class FabToolbox:
    """One run's tools and document store. Shared by every agent in the run."""

    def __init__(self, *, before_call=None, on_cost=None) -> None:
        self.names = available_tools()
        self.specs = [_SPECS[n] for n in self.names]
        self.docs: dict[str, str] = {}
        self._before_call = before_call
        self._on_cost = on_cost
        self._local = threading.local()

    def take_cost(self) -> float:
        """Retrieval spend since the last call, on this thread (one agent's turn)."""
        spent = getattr(self._local, "cost", 0.0)
        self._local.cost = 0.0
        return spent

    def execute(self, name: str, args: dict[str, Any]) -> str:
        if name not in self.names:
            return f"error: unknown tool {name}"
        try:
            if name == "edgar_search":
                return edgar_search(
                    str(args.get("query") or ""), str(args.get("ticker") or ""),
                    args.get("form_types") if isinstance(args.get("form_types"), list) else None,
                    str(args.get("start_date") or ""), str(args.get("end_date") or ""),
                    args.get("limit") or 10,
                )
            if name == "parse_html_page":
                return self.parse_html_page(str(args.get("url") or ""), str(args.get("key") or ""))
            if name == "retrieve_information":
                ranges = args.get("input_character_ranges")
                return self.retrieve(str(args.get("prompt") or ""), ranges if isinstance(ranges, dict) else {})
            if name == "calculator":
                return calculate(str(args.get("expression") or ""))
            if name == "web_search":
                return web_search(str(args.get("query") or ""))
            if name == "price_history":
                return price_history(str(args["ticker"]), str(args["start_date"]), str(args["end_date"]))
        except urllib.error.HTTPError as exc:
            return f"error: HTTP {exc.code} from {exc.url}"
        except Exception as exc:  # noqa: BLE001 - the agent sees the error and can adapt
            return f"error: {type(exc).__name__}: {exc}"[:300]
        return f"error: unknown tool {name}"

    def parse_html_page(self, url: str, key: str) -> str:
        parts = urllib.parse.urlparse(url)
        if parts.scheme not in {"http", "https"} or not parts.netloc:
            return "error: url must be http(s)"
        key = re.sub(r"[^A-Za-z0-9_.-]", "_", key.strip()) or "doc"
        raw = _get(url, timeout=60)
        text = html_to_text(raw.decode("utf-8", errors="replace"))
        self.docs[key] = text
        return (
            f"saved {len(text):,} characters as {{{{{key}}}}}. Stored keys: {', '.join(self.docs)}.\n"
            f"Opening text:\n{text[:PREVIEW_CHARS]}"
        )

    def retrieve(self, prompt: str, ranges: dict[str, Any]) -> str:
        keys = re.findall(r"\{\{([^{}]+)\}\}", prompt)
        if not keys:
            return "error: put {{key}} for a saved document in the prompt"
        missing = [k for k in keys if k not in self.docs]
        if missing:
            return f"error: no saved document {', '.join(missing)}. Stored keys: {', '.join(self.docs) or 'none'}"
        budget = RETRIEVAL_CHARS // len(set(keys))
        filled = prompt
        for key in dict.fromkeys(keys):
            text = self.docs[key]
            span = ranges.get(key)
            if isinstance(span, list) and len(span) == 2:
                text = text[int(span[0]) : int(span[1])]
            filled = filled.replace("{{" + key + "}}", f"<document key=\"{key}\">\n{_relevant_slice(text, prompt, budget)}\n</document>")
        model = settings()["fab_retrieval_model"]
        result = complete(
            provider=infer_provider(model),
            model=model,
            system=(
                "You read financial documents and answer precisely from them. Quote exact "
                "figures with their units and periods. If the document does not contain the "
                "answer, say so."
            ),
            user=filled,
            temperature=0.0,
            max_tokens=2_000,
            before_call=self._before_call,
        )
        self._local.cost = getattr(self._local, "cost", 0.0) + result.cost_usd
        if self._on_cost:
            self._on_cost(result.cost_usd)
        return result.text or "(no answer)"
