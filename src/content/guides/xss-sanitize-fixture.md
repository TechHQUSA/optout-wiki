---
title: XSS Sanitize Fixture
category: Test
level: LOW
summary: Unpublished fixture whose body carries raw HTML, used only to prove the markdown pipeline strips dangerous markup. published:false keeps it off the live site and out of getStaticPaths.
sources: []
lastVerified: 2026-07-01
published: false
---

Normal paragraph.

<script>window.__xss = 1;</script>

<img src="x" onerror="window.__xss = 1" />

<a href="javascript:alert(1)">click</a>

## A real heading

Regular **markdown** still works.
