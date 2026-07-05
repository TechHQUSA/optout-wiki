---
title: XSS Fixture - HTML Tag Vectors
category: Test
level: LOW
summary: Unpublished fixture covering classic HTML-tag-based XSS vectors (SVG/body onload, iframe javascript:/srcdoc) embedded as raw HTML in a guide body. published:false keeps it off the live site and out of getStaticPaths.
sources: []
lastVerified: 2026-07-01
published: false
---

Normal paragraph.

<svg onload="window.__xss_svg = 1"></svg>

<body onload="window.__xss_body = 1"></body>

<iframe src="javascript:alert(1)"></iframe>

<iframe srcdoc="<script>window.__xss_srcdoc = 1</script>"></iframe>
