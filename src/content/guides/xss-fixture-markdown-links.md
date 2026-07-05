---
title: XSS Fixture - Markdown Link and Image Syntax
category: Test
level: LOW
summary: Unpublished fixture covering markdown-native link/image syntax carrying dangerous javascript-scheme and data-scheme URLs (as opposed to raw HTML anchors) — exercises the sanitize schema's href/src protocol allow-list directly. published:false keeps it off the live site.
sources: []
lastVerified: 2026-07-01
published: false
---

[click me](javascript:alert(1))

![alt text](javascript:alert(1))

[data uri](data:text/html,%3Cscript%3Ewindow.__xss_datauri=1%3C/script%3E)
