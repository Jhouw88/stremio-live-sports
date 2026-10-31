# Stremio Live Sports

A Stremio add-on for browsing and watching live sports streams through a lightweight Node.js backend. This project fetches live sports data and match information, then exposes Stremio catalog, metadata, and stream endpoints that can be consumed directly in the Stremio app.

## What this project does

This repository creates a custom Stremio add-on that:

- fetches sports categories from `streamed.pk`
- fetches live and upcoming match data
- builds a `tv` catalog in Stremio
- provides match metadata, posters, and descriptions
- resolves stream embed URLs to playable HLS links using Puppeteer
- serves the add-on via an Express server

## Features

- Live sports catalog for Stremio
- Match list filtered by sport category
- Metadata generation for each match
- Direct stream extraction from embedded player URLs
- Support for live match resolution with `m3u8` extraction
- CORS-enabled API server
- Docker support

## Project structure

- `server.js` — Express server and Stremio router setup
- `addon.js` — manifest creation, catalog/meta/stream handlers, and stream extraction
- `package.json` — dependencies and scripts
- `Dockerfile` — container configuration
- `.dockerignore` — Docker ignore rules
- `.gitignore` — repository ignore rules
- `output.txt` and `output_utf8.txt` — generated output samples
- `test.js` — project test file

## Stack

- Node.js
- Express
- Stremio Add-on SDK
- Puppeteer
- `node-fetch`
- `cheerio`
- CORS

## Requirements

- Node.js 18+
- npm
- A browser-compatible environment for Puppeteer
- Internet access to resolve upstream sports/stream data

## Installation

```bash
git clone https://github.com/Jhouw88/stremio-live-sports.git
cd stremio-live-sports
npm install
```

## Run locally

```bash
npm start
```

The server starts on port `7000` by default:

```bash
http://127.0.0.1:7000/manifest.json
```

## Environment variables

- `PORT` — override the default Express port (`7000`)
- `ADDON_URL` — public URL used when deploying remotely
- `PUPPETEER_EXECUTABLE_PATH` — custom Chromium/Puppeteer executable path if needed

## How it works

1. The add-on calls the upstream `streamed.pk` APIs to get sports and match data.
2. It builds a Stremio catalog with a `tv` type.
3. When a user selects a match, the add-on gathers available stream sources.
4. It opens the embed URL in a headless browser and watches for `.m3u8` requests.
5. The resolved HLS URL is returned to Stremio as a playable stream.

## Important notes

- This project depends on external services and may break if upstream APIs change.
- Some streams may require browser-based extraction and can fail if the upstream site blocks headless browsers.
- Use `ADDON_URL` when hosting this add-on in a public environment so streams resolve correctly.

## Docker

Build:

```bash
docker build -t stremio-live-sports .
```

Run:

```bash
docker run -p 7000:7000 --env PORT=7000 stremio-live-sports
```

## License

This project currently declares the ISC license in `package.json`.

## Disclaimer

This project is intended for educational and personal use. Be sure to follow local laws and applicable terms of service for any third-party media sources used by this add-on.
