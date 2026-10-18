"""Best-effort page thumbnails, fetched independently of the voice reply."""

import asyncio
import ipaddress
import logging
import socket
from html.parser import HTMLParser
from urllib.parse import urljoin, urlsplit

import httpx

logger = logging.getLogger("agent")


def public_https(url):
    if not isinstance(url, str) or len(url) > 2048:
        return False
    try:
        parsed = urlsplit(url)
        host = (parsed.hostname or "").rstrip(".").lower()
        if (
            parsed.scheme != "https"
            or not host
            or parsed.username
            or parsed.password
            or parsed.port not in (None, 443)
            or "." not in host
            or host.endswith((".localhost", ".local", ".internal"))
        ):
            return False
        try:
            return ipaddress.ip_address(host).is_global
        except ValueError:
            return True
    except ValueError:
        return False


async def resolve_public(host):
    records = await asyncio.get_running_loop().getaddrinfo(
        host, 443, type=socket.SOCK_STREAM
    )
    return list(dict.fromkeys(record[4][0] for record in records))


async def pinned_url(url, resolve):
    if not public_https(url):
        raise ValueError("Non-public HTTPS URL")
    original = httpx.URL(url)
    addresses = await resolve(original.host)
    if not addresses or any(not ipaddress.ip_address(x).is_global for x in addresses):
        raise ValueError("Non-public DNS answer")
    # Connect to the checked IP, preserving the original Host and TLS certificate
    # verification name. No second DNS resolution (including on redirects).
    return original.copy_with(host=addresses[0]), original.host


class ImageMetadata(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.images = {}

    def handle_starttag(self, tag, attrs):
        if tag != "meta":
            return
        attrs = dict(attrs)
        name = (attrs.get("property") or attrs.get("name") or "").lower()
        value = attrs.get("content")
        if (
            name
            in ("og:image", "og:image:secure_url", "twitter:image", "twitter:image:src")
            and value
        ):
            self.images.setdefault(name, value.strip())


async def preview_image(url, *, transport=None, resolve=resolve_public):
    async def fetch():
        # Dedicated unauthenticated client: no provider tokens, cookies or proxy
        # credentials. Redirects are checked individually and requests are bounded.
        async with httpx.AsyncClient(
            transport=transport, timeout=3, trust_env=False
        ) as client:
            for _ in range(4):
                nonlocal url
                target, host = await pinned_url(url, resolve)
                client.cookies.clear()
                async with client.stream(
                    "GET",
                    target,
                    headers={
                        "Host": host,
                        "User-Agent": "Diana/1.0 (link previews)",
                        "Accept": "text/html",
                        "Accept-Encoding": "identity",
                    },
                    extensions={"sni_hostname": host},
                ) as response:
                    if response.is_redirect:
                        url = urljoin(url, response.headers.get("location", ""))
                        continue
                    response.raise_for_status()
                    if response.headers.get("content-type", "").split(";")[
                        0
                    ].strip().lower() not in ("text/html", "application/xhtml+xml"):
                        return None
                    # Decline compressed responses to bound decoding memory too.
                    if (
                        response.headers.get("content-encoding", "identity")
                        != "identity"
                    ):
                        return None
                    body = bytearray()
                    async for chunk in response.aiter_bytes(chunk_size=8192):
                        body.extend(chunk[: 256_000 - len(body)])
                        if len(body) >= 256_000:
                            break
                parser = ImageMetadata()
                parser.feed(body.decode("utf-8", errors="replace"))
                for name in (
                    "og:image:secure_url",
                    "og:image",
                    "twitter:image",
                    "twitter:image:src",
                ):
                    candidate = urljoin(url, parser.images.get(name, ""))
                    if name not in parser.images or not public_https(candidate):
                        continue
                    # Also validate the image host before exposing it to the client.
                    await pinned_url(candidate, resolve)
                    return candidate
                return None
        return None

    try:
        return await asyncio.wait_for(fetch(), timeout=5)
    except (httpx.HTTPError, OSError, ValueError, asyncio.TimeoutError):
        return None


class LinkPreviews:
    def __init__(self, *, fetch=preview_image):
        self.fetch = fetch
        self.tasks = set()
        self.closed = False
        self.limit = asyncio.Semaphore(3)

    def schedule(self, payload, publish):
        if self.closed or len(self.tasks) >= 4:
            return
        task = asyncio.create_task(self._enrich(payload, publish))
        self.tasks.add(task)
        task.add_done_callback(self.tasks.discard)

    async def _enrich(self, payload, publish):
        async def enrich(source):
            if source.get("imageUrl"):
                return dict(source)
            async with self.limit:
                image = await self.fetch(source["url"])
            return {**source, **({"imageUrl": image} if image else {})}

        try:
            sources = await asyncio.gather(*(enrich(x) for x in payload["sources"][:6]))
            if not self.closed and sources != payload["sources"]:
                await publish({**payload, "sources": sources})
        except Exception:
            logger.warning("Could not enrich search previews")

    async def close(self):
        self.closed = True
        tasks = list(self.tasks)
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        self.tasks.clear()
