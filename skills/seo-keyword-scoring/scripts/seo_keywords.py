#!/usr/bin/env python3
"""Compare Chinese keyword signals from public search-suggestion endpoints."""

import argparse
import json
import sys
from datetime import datetime, timezone
from urllib.parse import urlencode
from urllib.request import Request, urlopen

TIMEOUT = 10
USER_AGENT = "Mozilla/5.0 (compatible; keyword-signal-checker/2.0)"


def fetch_json(base_url: str, params: dict[str, str]) -> object:
    url = f"{base_url}?{urlencode(params)}"
    request = Request(url, headers={"User-Agent": USER_AGENT})
    with urlopen(request, timeout=TIMEOUT) as response:
        if response.status != 200:
            raise RuntimeError(f"HTTP {response.status}")
        return json.loads(response.read().decode("utf-8-sig"))


def baidu_suggestions(keyword: str) -> list[str]:
    data = fetch_json(
        "https://suggestion.baidu.com/su",
        {"wd": keyword, "action": "opensearch", "ie": "utf-8"},
    )
    if not isinstance(data, list) or len(data) < 2 or not isinstance(data[1], list):
        raise ValueError("unexpected response shape")
    return [str(item) for item in data[1] if item]


def so360_suggestions(keyword: str) -> list[str]:
    data = fetch_json(
        "https://sug.so.360.cn/suggest",
        {"word": keyword, "encodein": "utf-8", "encodeout": "utf-8", "format": "json"},
    )
    if not isinstance(data, dict) or not isinstance(data.get("result"), list):
        raise ValueError("unexpected response shape")
    return [str(item["word"]) for item in data["result"] if isinstance(item, dict) and item.get("word")]


def query_source(name: str, fetcher, keyword: str) -> dict:
    try:
        suggestions = fetcher(keyword)
        return {"status": "ok", "count": len(suggestions), "suggestions": suggestions[:10]}
    except Exception as exc:  # Network and upstream response errors must remain visible.
        print(f"[warn] {name} suggestions failed for {keyword!r}: {exc}", file=sys.stderr)
        return {"status": "unavailable", "count": None, "suggestions": [], "error": str(exc)}


def analyze_keyword(keyword: str) -> dict:
    sources = {
        "baidu": query_source("baidu", baidu_suggestions, keyword),
        "so360": query_source("so360", so360_suggestions, keyword),
    }
    available_counts = [source["count"] for source in sources.values() if source["status"] == "ok"]
    score = round(sum(min(count, 10) for count in available_counts) / len(available_counts), 1) if available_counts else None
    related = list(
        dict.fromkeys(
            suggestion
            for source in sources.values()
            for suggestion in source["suggestions"]
        )
    )
    return {
        "keyword": keyword,
        "seo_score": score,
        "available_sources": sum(source["status"] == "ok" for source in sources.values()),
        "source_status": sources,
        "related_keywords": related[:10],
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Compare public search-suggestion signals")
    parser.add_argument("keywords", nargs="+", help="One or more keywords")
    parser.add_argument("--json", action="store_true", help="Output JSON")
    args = parser.parse_args()
    payload = {
        "checked_at": datetime.now(timezone.utc).isoformat(),
        "method": "mean capped suggestion count across available sources",
        "limitations": "Relative suggestion signal only; not search volume or WeChat traffic.",
        "results": [analyze_keyword(keyword.strip()) for keyword in args.keywords if keyword.strip()],
    }
    if not payload["results"]:
        parser.error("at least one non-empty keyword is required")
    if args.json:
        json.dump(payload, sys.stdout, ensure_ascii=False, indent=2)
        print()
        return
    for result in payload["results"]:
        score = "数据不可用" if result["seo_score"] is None else f"{result['seo_score']}/10"
        print(f"{result['keyword']}: {score}（可用来源 {result['available_sources']}/2）")
        if result["related_keywords"]:
            print(f"  相关词: {', '.join(result['related_keywords'][:5])}")


if __name__ == "__main__":
    main()
