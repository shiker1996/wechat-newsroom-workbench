#!/usr/bin/env python3
"""Fetch a public hotspot URL and extract an auditable article snapshot.

Usage: python -X utf8 scripts/fetch-hotspot-url.py --url https://example.com/article
Prints one UTF-8 JSON object to stdout. Uses only Python's standard library.
"""

from __future__ import annotations

import argparse
import datetime as dt
import html
import ipaddress
import json
import re
import socket
import sys
import urllib.error
import urllib.parse
import urllib.request
from html.parser import HTMLParser

MAX_BYTES = 3_000_000
BLOCK_TAGS = {"script", "style", "noscript", "svg", "canvas", "nav", "footer", "header", "form", "aside"}


def clean(value: str) -> str:
    return re.sub(r"\s+", " ", html.unescape(value or "")).strip()


def validate_url(value: str) -> str:
    parsed = urllib.parse.urlparse(value)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname or parsed.username or parsed.password:
        raise ValueError("鍙厑璁镐笉鍚处鍙蜂俊鎭殑 HTTP/HTTPS URL")
    try:
        addresses = socket.getaddrinfo(parsed.hostname, parsed.port or (443 if parsed.scheme == "https" else 80))
    except socket.gaierror as error:
        raise ValueError(f"鍩熷悕瑙ｆ瀽澶辫触锛歿error}") from error
    for address in addresses:
        ip = ipaddress.ip_address(address[4][0])
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_multicast or ip.is_reserved or ip.is_unspecified:
            raise ValueError("鎷掔粷璁块棶鏈満銆佸唴缃戞垨淇濈暀鍦板潃")
    return value


class SafeRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):  # noqa: ANN001
        return super().redirect_request(req, fp, code, msg, headers, validate_url(newurl))


class ArticleParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.title = ""
        self.meta: dict[str, str] = {}
        self.jsonld: list[str] = []
        self._title_parts: list[str] = []
        self._script_parts: list[str] = []
        self._paragraph_parts: list[str] = []
        self._paragraphs: list[tuple[bool, str]] = []
        self._blocked = 0
        self._article = 0
        self._main = 0
        self._in_title = False
        self._in_jsonld = False
        self._in_p = False

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        tag = tag.lower()
        values = {str(k).lower(): str(v or "") for k, v in attrs}
        if tag in BLOCK_TAGS:
            self._blocked += 1
        if tag == "article": self._article += 1
        if tag == "main": self._main += 1
        if tag == "title": self._in_title = True
        if tag == "script" and "ld+json" in values.get("type", "").lower():
            self._in_jsonld = True; self._script_parts = []
        if tag == "meta":
            key = (values.get("property") or values.get("name") or "").lower()
            content = clean(values.get("content", ""))
            if key and content: self.meta[key] = content
        if tag == "p" and not self._blocked:
            self._in_p = True; self._paragraph_parts = []

    def handle_endtag(self, tag: str) -> None:
        tag = tag.lower()
        if tag == "p" and self._in_p:
            paragraph = clean(" ".join(self._paragraph_parts))
            if len(paragraph) >= 12: self._paragraphs.append((bool(self._article or self._main), paragraph))
            self._in_p = False; self._paragraph_parts = []
        if tag == "title": self._in_title = False
        if tag == "script" and self._in_jsonld:
            payload = "".join(self._script_parts).strip()
            if payload: self.jsonld.append(payload)
            self._in_jsonld = False; self._script_parts = []
        if tag == "article" and self._article: self._article -= 1
        if tag == "main" and self._main: self._main -= 1
        if tag in BLOCK_TAGS and self._blocked: self._blocked -= 1

    def handle_data(self, data: str) -> None:
        if self._in_title: self._title_parts.append(data)
        if self._in_jsonld: self._script_parts.append(data)
        if self._in_p and not self._blocked: self._paragraph_parts.append(data)

    def result(self) -> dict[str, str]:
        title = clean(" ".join(self._title_parts))
        structured: dict[str, str] = {}

        def visit(node) -> None:  # noqa: ANN001
            if isinstance(node, list):
                for item in node: visit(item)
            elif isinstance(node, dict):
                node_type = str(node.get("@type", "")).lower()
                if node_type in {"article", "newsarticle", "reportage", "blogposting"} or "articleBody" in node:
                    for source, target in (("headline", "title"), ("articleBody", "content"), ("datePublished", "published_at"), ("description", "description")):
                        value = node.get(source)
                        if isinstance(value, str) and clean(value): structured.setdefault(target, clean(value))
                    author = node.get("author")
                    if isinstance(author, dict) and author.get("name"): structured.setdefault("author", clean(str(author["name"])))
                    elif isinstance(author, list):
                        names = [clean(str(item.get("name", ""))) for item in author if isinstance(item, dict)]
                        if any(names): structured.setdefault("author", "銆?.join(filter(None, names)))
                for child in node.values():
                    if isinstance(child, (dict, list)): visit(child)

        for payload in self.jsonld:
            try: visit(json.loads(payload))
            except (json.JSONDecodeError, TypeError): pass
        preferred = [text for inside, text in self._paragraphs if inside]
        paragraphs = preferred if sum(map(len, preferred)) >= 200 else [text for _, text in self._paragraphs]
        content = structured.get("content") or "\n\n".join(dict.fromkeys(paragraphs))
        return {
            "title": structured.get("title") or self.meta.get("og:title") or self.meta.get("twitter:title") or title,
            "description": structured.get("description") or self.meta.get("description") or self.meta.get("og:description") or "",
            "author": structured.get("author") or self.meta.get("author") or "",
            "published_at": structured.get("published_at") or self.meta.get("article:published_time") or "",
            "content": clean(content.replace("\n\n", "\n")),
        }


def decode_body(payload: bytes, content_type: str) -> str:
    match = re.search(r"charset=([\w-]+)", content_type, re.I)
    candidates = [match.group(1)] if match else []
    head = payload[:4096].decode("ascii", errors="ignore")
    meta = re.search(r"charset=[\"']?\s*([\w-]+)", head, re.I)
    if meta: candidates.append(meta.group(1))
    candidates.extend(["utf-8", "gb18030"])
    for encoding in dict.fromkeys(candidates):
        try: return payload.decode(encoding)
        except (UnicodeDecodeError, LookupError): pass
    return payload.decode("utf-8", errors="replace")


def fetch(url: str, timeout: float, max_chars: int) -> dict:
    validate_url(url)
    opener = urllib.request.build_opener(SafeRedirect())
    request = urllib.request.Request(url, headers={
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36 WriteAssistant/1.0",
        "Accept": "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.7",
    })
    with opener.open(request, timeout=timeout) as response:
        final_url = validate_url(response.geturl())
        content_type = response.headers.get("Content-Type", "")
        if "html" not in content_type.lower(): raise ValueError(f"涓嶆敮鎸佺殑鍐呭绫诲瀷锛歿content_type or '鏈煡'}")
        payload = response.read(MAX_BYTES + 1)
        if len(payload) > MAX_BYTES: raise ValueError(f"椤甸潰瓒呰繃 {MAX_BYTES} 瀛楄妭闄愬埗")
    parser = ArticleParser(); parser.feed(decode_body(payload, content_type)); result = parser.result()
    result["content"] = result["content"][:max_chars]
    chars = len(result["content"])
    status = "ok" if chars >= 200 else "partial"
    return {"status": status, "url": url, "final_url": final_url, **result, "content_chars": chars,
            "fetched_at": dt.datetime.now(dt.timezone.utc).isoformat(), "error": "" if status == "ok" else "姝ｆ枃涓嶈冻 200 瀛楋紝鍙兘瀛樺湪 JS 娓叉煋銆佺櫥褰曟垨浠樿垂澧?}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", required=True)
    parser.add_argument("--timeout", type=float, default=20)
    parser.add_argument("--max-chars", type=int, default=30000)
    args = parser.parse_args()
    try: result = fetch(args.url, max(3, min(args.timeout, 60)), max(1000, min(args.max_chars, 100000)))
    except (ValueError, urllib.error.URLError, urllib.error.HTTPError, TimeoutError, OSError) as error:
        result = {"status":"error", "url":args.url, "final_url":"", "title":"", "description":"", "author":"", "published_at":"", "content":"", "content_chars":0,
                  "fetched_at":dt.datetime.now(dt.timezone.utc).isoformat(), "error":str(error)}
    json.dump(result, sys.stdout, ensure_ascii=False)


if __name__ == "__main__": main()


