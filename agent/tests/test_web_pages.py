import httpx
import pytest

from web_pages import PageReader


async def dns(host):
    return ["93.184.216.34"]


def reader(html, headers=None):
    return PageReader(
        transport=httpx.MockTransport(
            lambda request: httpx.Response(
                200, headers=headers or {"content-type": "text/html"}, text=html
            )
        ),
        resolve=dns,
    )


async def test_extract_focus_and_followable_links_without_scripts():
    result = await reader(
        """<html><head><title>Show details</title><script>secret()</script></head><body><nav>Menu</nav><h1>Show details</h1><p>Tickets cost $25. Doors open at 7 pm.</p><a href="/tickets">Buy tickets</a><script>INJECTED_SCRIPT</script><p hidden>HIDDEN_TEXT</p></body></html>"""
    ).read("https://example.org/show", "tickets cost")
    assert result["status"] == "ok"
    assert "$25" in result["content"]
    assert "INJECTED_SCRIPT" not in result["content"]
    assert "HIDDEN_TEXT" not in result["content"]
    assert result["links"][0]["url"] == "https://example.org/tickets"
    assert result["title"] == "Show details"
    assert result["untrusted_content"] is True


async def test_focus_finds_details_late_in_page():
    result = await reader(
        "<p>General introduction.</p>" * 1800 + "<p>Warranty lasts 24 months.</p>"
    ).read("https://example.org", "warranty")
    assert "Warranty lasts 24 months." in result["content"]
    assert len(result["content"]) <= 12000
    assert result["focus_matches"] > 0
    result = await reader("<p>Welcome to the site.</p>").read(
        "https://example.org", "warranty"
    )
    assert result["focus_matches"] == 0


@pytest.mark.parametrize(
    "url",
    [
        "https://127.0.0.1",
        "https://169.254.169.254/latest",
        "file:///etc/passwd",
        "https://user:pass@example.org",
        "https://example.org:8080",
    ],
)
async def test_private_targets_never_requested(url):
    def handle(request):
        pytest.fail("Unsafe request")

    result = await PageReader(transport=httpx.MockTransport(handle), resolve=dns).read(
        url, ""
    )
    assert result["status"] == "unavailable"


async def test_private_dns_and_redirect_are_blocked():
    async def private(host):
        return ["10.0.0.1"]

    def handle(request):
        pytest.fail("Private DNS contacted")

    assert (
        await PageReader(transport=httpx.MockTransport(handle), resolve=private).read(
            "https://example.org", ""
        )
    )["status"] == "unavailable"
    calls = []

    def redirect(request):
        calls.append(request)
        return httpx.Response(302, headers={"location": "https://169.254.169.254/"})

    assert (
        await PageReader(transport=httpx.MockTransport(redirect), resolve=dns).read(
            "https://example.org", ""
        )
    )["status"] == "unavailable"
    assert len(calls) == 1


async def test_unsupported_and_script_only_pages_are_not_claimed_read():
    assert (
        await reader("PDF", {"content-type": "application/pdf"}).read(
            "https://example.org", ""
        )
    )["status"] == "unavailable"
    assert (
        await reader("<script>renderEverything()</script>").read(
            "https://example.org", ""
        )
    )["status"] == "unavailable"


async def test_tool_acknowledges_and_publishes_source_without_raw_page():
    from types import SimpleNamespace
    from unittest.mock import AsyncMock, Mock, patch

    from agent import Diana

    pages = reader("<title>Tickets</title><p>Tickets cost $25.</p>")
    publish = AsyncMock()
    ctx = SimpleNamespace(session=Mock(), speech_handle=object())
    with patch("agent.create_llm", return_value=None):
        diana = Diana(page_reader=pages, publish_sources=publish)
        result = await diana.read_web_page(
            "https://example.org/tickets", "price", ctx, "Let me check the ticket page."
        )
        await diana.read_web_page(
            "https://example.org/tickets", "price", ctx, "Checking again."
        )
    assert result["status"] == "ok"
    ctx.session.say.assert_called_once()
    assert (
        publish.call_args.args[0]["sources"][0]["url"] == "https://example.org/tickets"
    )
    assert "content" not in publish.call_args.args[0]["sources"][0]


async def test_redirect_uses_final_url_and_does_not_forward_cookies():
    requests = []

    def handle(request):
        requests.append(request)
        if len(requests) == 1:
            return httpx.Response(
                302,
                headers={
                    "location": "https://other.example.org/details/",
                    "set-cookie": "secret=abc",
                },
            )
        return httpx.Response(
            200,
            headers={"content-type": "text/html"},
            text='<p>Public details</p><a href="tickets">Tickets</a>',
        )

    result = await PageReader(transport=httpx.MockTransport(handle), resolve=dns).read(
        "https://example.org", "tickets"
    )
    assert result["url"] == "https://other.example.org/details/"
    assert result["links"][0]["url"] == "https://other.example.org/details/tickets"
    assert requests[1].url.host == "93.184.216.34"
    assert requests[1].extensions["sni_hostname"] == "other.example.org"
    assert "cookie" not in requests[1].headers
    assert "authorization" not in requests[1].headers


async def test_bounded_download_marks_partial_content():
    class Body(httpx.AsyncByteStream):
        async def __aiter__(self):
            for _ in range(130):
                yield b"<p>Details</p>" + b" " * 8192
            pytest.fail("Download should stop at the size limit")

    transport = httpx.MockTransport(
        lambda request: httpx.Response(
            200, headers={"content-type": "text/html"}, stream=Body()
        )
    )
    result = await PageReader(transport=transport, resolve=dns).read(
        "https://example.org", ""
    )
    assert result["status"] == "ok" and result["truncated"]


async def test_page_budget_resets_on_new_turn():
    from types import SimpleNamespace
    from unittest.mock import AsyncMock, Mock, patch

    from agent import Diana

    pages = AsyncMock()
    pages.read.return_value = {"status": "unavailable"}
    ctx = SimpleNamespace(session=Mock(), speech_handle=object())
    with patch("agent.create_llm", return_value=None):
        diana = Diana(page_reader=pages)
        for _ in range(4):
            await diana.read_web_page("https://example.org", "", ctx)
        assert pages.read.await_count == 3
        ctx.speech_handle = object()
        await diana.read_web_page("https://example.org", "", ctx)
        assert pages.read.await_count == 4
