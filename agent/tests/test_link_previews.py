import asyncio

import httpx
import pytest

from link_previews import LinkPreviews, preview_image


async def public_dns(host):
    return ["93.184.216.34"]


async def test_relative_og_image_and_pinned_tls():
    requests = []

    def handle(request):
        requests.append(request)
        return httpx.Response(
            200,
            headers={"content-type": "text/html"},
            text="""
          <meta name="twitter:image" content="/fallback.jpg">
          <meta property="og:image" content="/photos/item.jpg">
        """,
        )

    result = await preview_image(
        "https://example.org/item",
        transport=httpx.MockTransport(handle),
        resolve=public_dns,
    )
    assert result == "https://example.org/photos/item.jpg"
    assert requests[0].url.host == "93.184.216.34"
    assert requests[0].headers["host"] == "example.org"
    assert requests[0].extensions["sni_hostname"] == "example.org"
    assert "authorization" not in requests[0].headers


@pytest.mark.parametrize("address", ["127.0.0.1", "169.254.169.254", "10.0.0.1", "::1"])
async def test_private_dns_never_requested(address):
    async def resolve(host):
        return [address]

    def handle(request):
        pytest.fail("Unsafe destination was contacted")

    assert (
        await preview_image(
            "https://example.org",
            transport=httpx.MockTransport(handle),
            resolve=resolve,
        )
        is None
    )


async def test_redirect_revalidated_and_private_images_rejected():
    count = 0

    def handle(request):
        nonlocal count
        count += 1
        return httpx.Response(
            302, headers={"location": "https://169.254.169.254/latest/meta-data/"}
        )

    assert (
        await preview_image(
            "https://example.org",
            transport=httpx.MockTransport(handle),
            resolve=public_dns,
        )
        is None
    )
    assert count == 1

    def page(request):
        return httpx.Response(
            200,
            headers={"content-type": "text/html"},
            text='<meta property="og:image" content="https://127.0.0.1/a.jpg">',
        )

    assert (
        await preview_image(
            "https://example.org",
            transport=httpx.MockTransport(page),
            resolve=public_dns,
        )
        is None
    )


@pytest.mark.parametrize(
    "headers,body",
    [
        ({"content-type": "application/pdf"}, "x"),
        ({"content-type": "text/html"}, "x" * 300_000),
    ],
    ids=["not-html", "oversized"],
)
async def test_invalid_or_oversized_page_has_no_preview(headers, body):
    transport = httpx.MockTransport(
        lambda request: httpx.Response(200, headers=headers, text=body)
    )
    assert (
        await preview_image(
            "https://example.org", transport=transport, resolve=public_dns
        )
        is None
    )


async def test_background_enrichment_preserves_links_and_closes():
    ready = asyncio.Event()
    sent = []

    async def fetch(url):
        await ready.wait()
        return "https://example.org/image.jpg" if url.endswith("/good") else None

    async def publish(payload):
        sent.append(payload)

    previews = LinkPreviews(fetch=fetch)
    payload = {
        "id": "one",
        "sources": [
            {"url": "https://example.org/good", "title": "Good"},
            {"url": "https://example.org/missing", "title": "Missing"},
        ],
    }
    previews.schedule(payload, publish)
    assert sent == []
    ready.set()
    await asyncio.gather(*previews.tasks)
    assert sent[0]["id"] == "one"
    assert sent[0]["sources"][0]["imageUrl"].endswith("image.jpg")
    assert sent[0]["sources"][1] == payload["sources"][1]
    assert "imageUrl" not in payload["sources"][0]
    ready.clear()
    previews.schedule(payload, publish)
    await previews.close()
    assert not previews.tasks


async def test_redirect_preserves_final_base_and_never_forwards_cookies():
    requests = []

    def handle(request):
        requests.append(request)
        if len(requests) == 1:
            return httpx.Response(
                302,
                headers={
                    "location": "https://other.example.org/new/page",
                    "set-cookie": "secret=one",
                },
            )
        return httpx.Response(
            200,
            headers={"content-type": "text/html"},
            text='<meta name="twitter:image" content="../preview.jpg">',
        )

    assert (
        await preview_image(
            "https://example.org/start",
            transport=httpx.MockTransport(handle),
            resolve=public_dns,
        )
        == "https://other.example.org/preview.jpg"
    )
    assert requests[1].headers["host"] == "other.example.org"
    assert "cookie" not in requests[1].headers


async def test_network_failure_leaves_link_usable():
    def handle(request):
        raise httpx.ReadTimeout("Timeout")

    assert (
        await preview_image(
            "https://example.org",
            transport=httpx.MockTransport(handle),
            resolve=public_dns,
        )
        is None
    )


async def test_metadata_in_large_page_is_read_without_full_download():
    class Body(httpx.AsyncByteStream):
        async def __aiter__(self):
            yield b'<meta property="og:image" content="/image.jpg">'
            for _ in range(40):
                yield b"x" * 8192
            pytest.fail("Should stop reading after bounded prefix")

    transport = httpx.MockTransport(
        lambda request: httpx.Response(
            200, headers={"content-type": "text/html"}, stream=Body()
        )
    )
    assert (
        await preview_image(
            "https://example.org", transport=transport, resolve=public_dns
        )
        == "https://example.org/image.jpg"
    )
