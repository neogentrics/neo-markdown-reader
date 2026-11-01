// Turns a Markdown document into a small, self-contained HTML page for the File Explorer preview.
//
// The preview is a quick look, so it is deliberately cautious:
//  - raw HTML in the document is shown as text, never interpreted (no scripts, no iframes);
//  - images are not loaded (a document can't make Explorer fetch anything from the internet);
//  - links can't navigate anywhere (only http/https/mailto/#anchors are kept, and the preview
//    window blocks navigation anyway).
// This file has no Windows dependencies, so its tests run on any platform.
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Text.RegularExpressions;
using Markdig;
using Markdig.Extensions.Yaml;
using Markdig.Syntax;
using Markdig.Syntax.Inlines;

namespace Neo.MarkdownPreview
{
    public static class PreviewRenderer
    {
        /// <summary>Documents larger than this are not previewed (the app opens them fine).</summary>
        public const int MaxChars = 2_000_000;

        static readonly MarkdownPipeline Pipeline = new MarkdownPipelineBuilder()
            .DisableHtml()
            .UseYamlFrontMatter()
            .UseEmphasisExtras()
            .UsePipeTables()
            .UseGridTables()
            .UseTaskLists()
            .UseAutoLinks()
            .UseFootnotes()
            .UseDefinitionLists()
            .UseAlertBlocks()
            .UseAutoIdentifiers()
            .Build();

        static readonly Regex SafeUrl = new Regex(@"^(https?:|mailto:|#)", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);

        /// <summary>The complete preview page for a document.</summary>
        public static string RenderPage(string markdown, bool dark)
        {
            string body;
            if (markdown == null) markdown = string.Empty;
            if (markdown.Length > MaxChars)
                body = "<p class=\"note\">This document is too large to preview. Open it in Neo Markdown Reader.</p>";
            else
                body = RenderBody(markdown);
            return "<!DOCTYPE html><html><head><meta charset=\"utf-8\">"
                + "<meta http-equiv=\"X-UA-Compatible\" content=\"IE=edge\">"
                + "<style>" + Css(dark) + "</style></head><body><article class=\"doc\">"
                + body + "</article></body></html>";
        }

        /// <summary>The document as sanitized HTML (no page wrapper).</summary>
        public static string RenderBody(string markdown)
        {
            string text = (markdown ?? string.Empty).TrimStart('﻿').Replace("\r\n", "\n");
            MarkdownDocument doc = Markdown.Parse(text, Pipeline);

            string header = "";
            YamlFrontMatterBlock yaml = doc.Descendants<YamlFrontMatterBlock>().FirstOrDefault();
            if (yaml != null)
            {
                header = FrontMatterHeader(yaml.Lines.ToString());
                doc.Remove(yaml);
            }

            // Images become their description; unsafe link targets are dropped.
            foreach (LinkInline link in doc.Descendants<LinkInline>().ToList())
            {
                if (link.IsImage)
                {
                    string alt = InlineText(link).Trim();
                    link.ReplaceBy(new LiteralInline("[Image" + (alt.Length > 0 ? ": " + alt : "") + "]"), copyChildren: false);
                }
                else if (link.Url != null && !SafeUrl.IsMatch(link.Url.Trim()))
                {
                    link.Url = "#";
                }
            }
            foreach (AutolinkInline auto in doc.Descendants<AutolinkInline>().ToList())
            {
                if (!SafeUrl.IsMatch(auto.Url ?? "") && !auto.IsEmail) auto.ReplaceBy(new LiteralInline(auto.Url ?? ""));
            }

            return header + doc.ToHtml(Pipeline);
        }

        static string InlineText(ContainerInline container)
        {
            var sb = new StringBuilder();
            foreach (Inline inline in container.Descendants<Inline>())
                if (inline is LiteralInline lit) sb.Append(lit.Content.ToString());
            return sb.ToString();
        }

        /// <summary>Title, subtitle, author and date from simple "key: value" front matter.</summary>
        internal static string FrontMatterHeader(string yaml)
        {
            var values = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            foreach (string raw in (yaml ?? "").Split('\n'))
            {
                string line = raw.TrimEnd('\r');
                if (line.Length == 0 || line[0] == ' ' || line[0] == '#' || line.StartsWith("---")) continue;
                int colon = line.IndexOf(':');
                if (colon <= 0) continue;
                string key = line.Substring(0, colon).Trim();
                string value = line.Substring(colon + 1).Trim().Trim('"', '\'');
                if (value.StartsWith("[") && value.EndsWith("]")) value = value.Substring(1, value.Length - 2).Replace(",", " ·");
                if (!values.ContainsKey(key)) values[key] = value;
            }
            string Get(string k) { return values.TryGetValue(k, out string v) ? v : ""; }
            string title = Get("title"), sub = Get("subtitle");
            if (sub.Length == 0) sub = Get("description");
            string by = string.Join(" · ", new[] { Get("author"), Get("date") }.Where(x => x.Length > 0));
            if (title.Length == 0 && sub.Length == 0 && by.Length == 0) return "";
            var sb = new StringBuilder("<header class=\"meta\">");
            if (title.Length > 0) sb.Append("<div class=\"meta-title\">").Append(Esc(title)).Append("</div>");
            if (sub.Length > 0) sb.Append("<div class=\"meta-sub\">").Append(Esc(sub)).Append("</div>");
            if (by.Length > 0) sb.Append("<div class=\"meta-by\">").Append(Esc(by)).Append("</div>");
            return sb.Append("</header>").ToString();
        }

        static string Esc(string s)
        {
            return (s ?? "").Replace("&", "&amp;").Replace("<", "&lt;").Replace(">", "&gt;").Replace("\"", "&quot;").Replace("'", "&#39;");
        }

        /// <summary>A stylesheet the Windows preview's browser engine understands (no CSS variables).</summary>
        internal static string Css(bool dark)
        {
            string bg = dark ? "#1b1e24" : "#ffffff", text = dark ? "#dfe3ea" : "#1d2330", soft = dark ? "#a9b2c3" : "#4b5466";
            string heading = dark ? "#f3f5f9" : "#111827", accent = dark ? "#8eaaff" : "#2f54c9", rule = dark ? "#2e3542" : "#e4e8ef";
            string codeBg = dark ? "#14171d" : "#f5f7fb", codeBorder = dark ? "#2a303c" : "#e3e8f0", inline = dark ? "#ff8fb3" : "#c2255c";
            string quoteBg = dark ? "#1f2533" : "#f7f9fe", quoteBar = dark ? "#44507a" : "#b8c4e8", thead = dark ? "#232935" : "#f3f6fb";
            return
                "html,body{margin:0;background:" + bg + ";color:" + text + ";}" +
                "body{font:15px/1.65 'Segoe UI Variable Text','Segoe UI',Arial,sans-serif;padding:20px 24px 32px;word-wrap:break-word;}" +
                ".doc{max-width:860px;}" +
                "h1,h2,h3,h4,h5,h6{font-family:'Segoe UI Variable Display','Segoe UI',Arial,sans-serif;color:" + heading + ";line-height:1.25;margin:1.4em 0 .5em;font-weight:700;}" +
                "h1{font-size:1.9em;margin-top:.2em;border-bottom:1px solid " + rule + ";padding-bottom:.25em;}h2{font-size:1.45em;}h3{font-size:1.2em;}" +
                "p,ul,ol,dl,blockquote,pre,table{margin:0 0 1em;}" +
                "a{color:" + accent + ";text-decoration:none;}" +
                "code{font-family:'Cascadia Code',Consolas,monospace;font-size:.88em;background:" + codeBg + ";color:" + inline + ";padding:.1em .35em;border-radius:4px;}" +
                "pre{background:" + codeBg + ";border:1px solid " + codeBorder + ";border-radius:8px;padding:12px 14px;overflow:auto;}" +
                "pre code{background:none;color:" + text + ";padding:0;font-size:.86em;}" +
                "blockquote{margin-left:0;padding:.4em 1em;border-left:4px solid " + quoteBar + ";background:" + quoteBg + ";color:" + soft + ";}" +
                "table{border-collapse:collapse;}th,td{border:1px solid " + rule + ";padding:6px 10px;}th{background:" + thead + ";text-align:left;}" +
                "hr{border:0;border-top:1px solid " + rule + ";margin:1.6em 0;}" +
                "ul.contains-task-list{list-style:none;padding-left:1.2em;}li.task-list-item input{margin-right:.5em;}" +
                ".markdown-alert{border-left:4px solid " + accent + ";padding:.4em 1em;background:" + quoteBg + ";margin:0 0 1em;}" +
                ".markdown-alert-title{font-weight:700;margin:0 0 .3em;color:" + accent + ";}" +
                ".meta{margin:0 0 1.4em;padding:0 0 .8em;border-bottom:1px solid " + rule + ";}" +
                ".meta-title{font-family:'Segoe UI Variable Display','Segoe UI',Arial,sans-serif;font-size:2em;font-weight:700;color:" + heading + ";line-height:1.2;}" +
                ".meta-sub{font-size:1.1em;color:" + soft + ";margin-top:.3em;}.meta-by{font-size:.9em;color:" + soft + ";margin-top:.4em;}" +
                ".note{color:" + soft + ";font-style:italic;}";
        }
    }
}
