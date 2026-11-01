using Neo.MarkdownPreview;
using Xunit;

public class PreviewRendererTests
{
    [Fact]
    public void Renders_headings_lists_tables_tasks_and_code()
    {
        string html = PreviewRenderer.RenderBody("# Title\n\nSome **bold** text.\n\n- [x] done\n- [ ] todo\n\n| A | B |\n|---|--:|\n| 1 | 2 |\n\n```js\nlet x = 1;\n```\n");
        Assert.Contains("<h1 id=\"title\">Title</h1>", html);
        Assert.Contains("<strong>bold</strong>", html);
        Assert.Contains("task-list-item", html);
        Assert.Contains("<table>", html);
        Assert.Contains("let x = 1;", html);
    }

    [Fact]
    public void Raw_html_and_scripts_are_shown_as_text_never_run()
    {
        string html = PreviewRenderer.RenderBody("Hello <script>alert(1)</script> <img src=x onerror=alert(2)>\n\n<iframe src=\"https://evil.example\"></iframe>\n");
        Assert.DoesNotContain("<script", html);
        Assert.DoesNotContain("<img", html);
        Assert.DoesNotContain("<iframe", html);
        Assert.Contains("&lt;script&gt;", html);
    }

    [Fact]
    public void Images_are_not_loaded_and_unsafe_links_go_nowhere()
    {
        string html = PreviewRenderer.RenderBody("![Company logo](https://tracker.example/pixel.png)\n\n[click](javascript:alert(1)) [file](file:///C:/Windows/System32/calc.exe) [web](https://example.com) [anchor](#title) [mail](mailto:a@b.c)\n");
        Assert.DoesNotContain("<img", html);
        Assert.Contains("[Image: Company logo]", html);
        Assert.DoesNotContain("]Company logo", html);   // the description appears once
        Assert.DoesNotContain("javascript:", html);
        Assert.DoesNotContain("file:", html);
        Assert.Contains("href=\"https://example.com\"", html);
        Assert.Contains("href=\"#title\"", html);
        Assert.Contains("href=\"mailto:a@b.c\"", html);
    }

    [Fact]
    public void Front_matter_becomes_an_escaped_header()
    {
        string html = PreviewRenderer.RenderBody("---\ntitle: \"Plan <b>Q3</b>\"\nsubtitle: How it went\nauthor: Ann\ndate: 2026-10-01\ntags: [a, b]\n---\n\nBody text.\n");
        Assert.Contains("<div class=\"meta-title\">Plan &lt;b&gt;Q3&lt;/b&gt;</div>", html);
        Assert.Contains("<div class=\"meta-sub\">How it went</div>", html);
        Assert.Contains("<div class=\"meta-by\">Ann · 2026-10-01</div>", html);
        Assert.DoesNotContain("title:", html);
        Assert.Contains("Body text.", html);
    }

    [Fact]
    public void Github_alerts_and_bom_and_crlf_are_handled()
    {
        string html = PreviewRenderer.RenderBody("\uFEFF# Hi\r\n\r\n> [!WARNING]\r\n> Careful.\r\n");
        Assert.Contains("<h1 id=\"hi\">Hi</h1>", html);
        Assert.Contains("markdown-alert", html);
        Assert.Contains("Careful.", html);
    }

    [Fact]
    public void Page_has_light_or_dark_colours_and_a_size_limit()
    {
        string light = PreviewRenderer.RenderPage("# x", dark: false);
        string dark = PreviewRenderer.RenderPage("# x", dark: true);
        Assert.Contains("background:#ffffff", light);
        Assert.Contains("background:#1b1e24", dark);
        Assert.Contains("IE=edge", light);
        string huge = PreviewRenderer.RenderPage(new string('a', PreviewRenderer.MaxChars + 1), dark: false);
        Assert.Contains("too large to preview", huge);
    }
}
