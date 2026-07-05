---
title: XSS Fixture - CSS Injection Vectors
category: Test
level: LOW
summary: Unpublished fixture covering style-attribute and style-block CSS injection payloads (legacy IE expression(), url(javascript:), @import). style is not in the sanitize schema's attribute allow-list, so these should be inert. published:false keeps it off the live site.
sources: []
lastVerified: 2026-07-01
published: false
---

<div style="background:url(javascript:alert(1))">styled div</div>

<p style="width:expression(alert(1))">expression paragraph</p>

<style>
  @import url(https://evil.example/inject.css);
  body { background: url(javascript:alert(1)); }
</style>
