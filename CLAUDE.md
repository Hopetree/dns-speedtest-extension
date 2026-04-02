# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Chrome Extension (Manifest V3) that queries a domain's DNS records via multiple DoH (DNS over HTTPS) providers, measures access latency to each resolved IP, and generates hosts file entries. UI is in Chinese (zh-CN).

## Architecture

The extension is a single-file popup with no build system, bundler, or framework dependencies:

- **manifest.json** — Manifest V3 config with `activeTab` and `storage` permissions plus host permissions for 4 DoH providers and all HTTPS origins
- **popup.html** — Self-contained popup UI: all CSS is inline in a `<style>` block, references Google Fonts (JetBrains Mono, Syne)
- **popup.js** — All logic: DNS resolution, latency measurement, DOM rendering

### Data Flow

1. User enters domain (auto-populated from active tab)
2. `DNS_PROVIDERS` array (Google, Cloudflare, OpenDNS, AliDNS) queried in parallel via `fetch` to their DoH JSON APIs
3. IPs deduplicated into a `Set`, validated as IPv4
4. Each IP latency-tested in parallel via `fetch` with `no-cors` mode and a `Host` header (4s timeout)
5. Results rendered to DOM with sort options (latency/IP) and one-click hosts copy

### Key Patterns

- State is module-level variables (`currentDomain`, `ipResults`, `sortMode`) — no framework state management
- `AbortController` handles query cancellation when user re-triggers
- `Promise.allSettled` used for both DNS queries and latency tests so one failure doesn't block others
- DOM is rebuilt via `innerHTML` on each render cycle (`renderResults()`)

## Development

No build step required. Load as an unpacked extension:

1. Navigate to `chrome://extensions/`
2. Enable Developer Mode
3. Click "Load unpacked" and select this directory

Changes to `popup.html` or `popup.js` take effect after clicking the extension icon to reopen the popup (or use the refresh button on the extension card).
