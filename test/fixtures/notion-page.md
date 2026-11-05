This page is for testing the Notion connection in RT Markdown Reader. It is safe to delete.

<p color="red">
This whole paragraph is red and must stay red.
</p>

This one has <b>bold</b>, <i>italic</i>, <s>struck</s>, <u>underlined</u>, <code>code <b></code>, a [link](https://example.com), <span color="blue">blue words</span>, and <date start="2026-11-04" />.

Change this line in the test.

Remove this line in the test.

# First heading

## Second heading

### Third heading

#### Fourth heading

- Bullet one
- Bullet two
  - Nested bullet

1. Number one
2. Number two

- [ ] A task to do
- [x] A task that is done

> A plain quote.

<quote color="purple_bg">
A coloured quote

- with a child
</quote>

<callout icon="💡" color="blue_bg">
A tip callout.
</callout>

<callout icon="📌" color="yellow_bg">
A pinned callout

- with a child
</callout>

<toggle>
A toggle

Inside the toggle.
</toggle>

<toggle heading="h2">
A toggle heading

Inside that one.
</toggle>

```py
def hello():

    return "<b>not a tag</b>"
```

| Name | Value |
| --- | --- |
| One | 1 |
| Pipe \| here | <b>2</b> |

<table header-row="true">
<tr color="yellow_bg">
<td>
Styled
</td>
<td>
Table
</td>
</tr>
<tr>
<td color="green_bg">
Green
</td>
<td>
Plain<br />second line
</td>
</tr>
</table>

---

$$
E = mc^2
$$

<columns>
<column ratio="50">
Left column
</column>
<column ratio="50">
Right column
</column>
</columns>

<table-of-contents />

![A web picture](https://www.notion.so/images/page-cover/woodcuts_1.jpg)

<bookmark source="https://example.com" />

<page url="https://app.notion.com/p/a4bc1b7a3a8147cba50a17d58a73cfb0">
A test subpage
</page>

<image source="https://prod-files-secure.s3.us-west-2.amazonaws.com/6fab2af3-f2a1-41ff-a380-850f37dc41f6/8ca577a4-d0c4-4467-9c88-2aa450d07ee1/test-picture.png?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Signature=abc&x-id=GetObject#notion_record=block.38e9e89b">
An uploaded picture
</image>

The last line of the page.

<database url="https://app.notion.com/p/1cc22053cf724b9288adbf85a2621640" data-source-url="collection://a6bc25da-0f0d-4e6e-9955-8e9b3e897898" inline="false">
RT test tasks
</database>
