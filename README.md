# stickies-api

The HTTP API behind Stickies: notes, folders, sharing and live updates, in 1 small Node service your own clients can talk to.

![A shared note's link-preview card, rendered by this API](docs/screenshots/og-public.png)

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
![Node](https://img.shields.io/badge/Node-22.18+-339933?logo=node.js&logoColor=white)
![Hono](https://img.shields.io/badge/Hono-4-E36002?logo=hono&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-no_build_step-3178c6?logo=typescript&logoColor=white)
![Postgres](https://img.shields.io/badge/Postgres-or_Supabase-4169E1?logo=postgresql&logoColor=white)
![Deps](https://img.shields.io/badge/runtime_deps-6-brightgreen)

## How it fits

```mermaid
flowchart LR
    web["stickies-web<br/>(browser)"]
    noto["Noto<br/>(macOS app)"]
    agents["Scripts and agents<br/>(API key)"]

    subgraph api["stickies-api"]
        auth["Auth<br/>Google sign-in, JWT, API keys"]
        notes["/notes<br/>read, write, search"]
        live["/live<br/>server-sent events"]
        share["/share and /og<br/>public links, preview cards"]
    end

    google[("Google<br/>your OAuth client")]
    db[("Postgres<br/>or Supabase")]

    web --> auth
    noto --> auth
    agents --> auth
    auth --> notes
    auth --> live
    auth -. verifies id_token .-> google
    notes --> db
    share --> db
    notes -. new / updated / deleted .-> live
    live -. pushes changes .-> web
    live -. pushes changes .-> noto
```

Every client signs in the same way: Google sign-in, then the API issues a 15-minute access token and a 60-day refresh token. Scripts use an API key instead. When any client changes a note, the rest see it instantly over `/live`.

## Features

- **Notes and folders:** 13 read modes on 1 path, batch writes of up to 500, fuzzy folder matching
- **Live updates:** server-sent events, no Pusher or third-party realtime
- **Sharing:** public links, passcode-locked notes, 1200x630 link-preview cards
- **Safe keys:** no API key can delete a note, and no machine key can manage keys
- **Typed contract:** `openapi.yaml` for generated clients, with contract tests that catch drift
- **Small:** 6 runtime dependencies, no build step, Node runs the TypeScript directly

## Quick start

You bring 2 things: **your own database** and **your own Google sign-in**.

**1. Database: Postgres or Supabase.** Any Postgres 13+ works. Load the schema once:

```bash
psql "$DATABASE_URL" -f schema.sql
```

On Supabase, copy the connection string from **Project Settings > Database** and use it as `DATABASE_URL`.

**2. Google sign-in.** In [Google Cloud Console](https://console.cloud.google.com/apis/credentials), create an **OAuth client ID** (Web application). Copy its client ID and secret into `.env`, and set `OWNER_EMAIL` to the Google address allowed to sign in.

**3. Run it.**

```bash
git clone https://github.com/bunlongheng/stickies-api.git
cd stickies-api
npm install
cp .env.example .env     # fill in the values below
npm run dev              # http://localhost:4446
npm test
```

## Configuration

| Env var | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | yes | Your Postgres or Supabase connection string |
| `AUTH_SECRET` | yes | Long random string that signs access and refresh tokens |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | yes | Your Google OAuth client |
| `OWNER_EMAIL` | yes | The only Google account allowed to sign in |
| `STICKIES_API_KEY` | no | Shared bearer token for scripts and agents |
| `CORS_ORIGINS` | no | Browser origins allowed to call the API |
| `DATABASE_CA_CERT` | prod | Postgres TLS certificate; production refuses to connect without it |

Optional integrations (AI, Philips Hue, GitHub backup) are listed in `.env.example`. Each one answers 503 until it is configured.

## Related repos

| Repo | What it is |
|---|---|
| [stickies-web](https://github.com/bunlongheng/stickies-web) | The web client: the whole board in the browser |
| [noto](https://github.com/bunlongheng/noto) | A fast macOS app onto every note, in Swift |
| [quick-stick-lite](https://github.com/bunlongheng/quick-stick-lite) | A sticky-note grid in 1 file, no build |


---

<div align="center">

<a href="https://bunlongheng.com"><img src="https://img.shields.io/badge/-bunlongheng.com-3A3A3C?style=for-the-badge&amp;labelColor=2A2A2C&amp;logo=data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABwAAAAcCAMAAABF0y%2BmAAADAFBMVEXx8vLq6v%2F19fX09PT8%2Ff309PT5%2BfnAwMBMaXHx8vL19fX5%2Bfny8vL09PT39%2Ff6%2Bfn6%2Bvr09PTx8fH4%2BPn%2F8vLy8%2FP09PTz8%2FPy8vL%2F%2F%2F%2Fz9PTz9PP19fby8vP19PXz8%2FT19%2Fb08%2FTx8vLy8vL09vby8%2FL29vf19fTv8PDz9vb7%2Bvn%2F%2Ff%2F9%2Ff3w8vH29fb%2F%2FP339%2Ff5%2Bfn59%2Ff19PT09PR7rao3VF3%2F%2Fv8AKDR6sqsBV1vv8fL4%2BPiux8b8%2Bvq90NDy8%2FR%2BlpppnZyZqrACLTxclZJSkI9en5ssZ2luqaUAeWgqbW4BX1gCfG0%2Fa3QaVG0MN0UKNUKUpKsGpYMAKjoRQ1UDf3AQRloJqIgEm32d0cUBg3ElbnQIln8eVWgrmIdP0KzF5d5s2acdfHwppJCP5MMXl4Tz8%2FLv8%2FP39%2FiewL5%2BqahYf4IrTFZkk5KlxsREiIYAHiqDnKFmnJowc3IdVllvpKK7zc3D2tnk5%2BmuycdwpKKuub2yv8Ly%2B%2FkAMT7z%2Bvjq7e09gH93q6kGdWpGgoJZmJSlw8M7c3WwyceTw76w1M8mYmpFfX8lW2AFOEpGiYhxqqRrqaRb2rdIsZ8AVE91jpU7d3t3saqBoKhako4AWVEcUlg3aWwDupAHb2YwmIkPP1ERSVA7WmZ8tq8HT14oZW%2BYuLsMl3wQT10ROksENUc8Z3MJSGVLh4dqpJ%2BXr7U51awUgHM4v6ad1MkPuJZAiowVd3IEhnZH0aoYrI05p5sDtYwkzZ8EPViYxsRel5USbHAIgmwIM0gQamzU4uF2malQi4oWQFQ1zaYrp4UXlYwfiHoyxqFE1q4qeX4yn5JIxKkdrX1b1rAbWGvd5Oh91sRijpomsJEVc3Ukc34dqIcwuJVKwZIXkoQZcXlNv5g%2BqZUZvpNl2rPG9N0WkIoNqouW4sVPwp%2BM0b6h0ssfq4d%2F1r8hpo%2Fh9e4AamUjnI9avaBixqgklYWSwL4xtItUxplYl5qZ58mq78wMgnYXfnlOmJaR1L%2Bj78ny9fS%2FrXQPAAAAFXRSTlP7Brvx%2FsJhAgD87r4U72C4uGH8vhRDodYHAAAACXBIWXMAAAsTAAALEwEAmpwYAAAC6UlEQVQokS2Sd3BUVRSHb0KS3QRCiZw5t%2By9j33zXjZkyUs2uekhEAi9dwRCL4JUEQRFAQUs9A4WOopKU0GpFoqCBZUivaqoFKkWLIS5GX7%2FfnPO78yZj%2Fj8UTViK6HggvNgSGuluEZRKbZqlN9H%2FFWiWUzIFQK5fhjOIRTDoqv4ia86S4q3KSByHdSqIhxofBKr5iNxLMm2bQqWVkorJ%2BAkO46nkQJhceSRmCTDvKJIJBLJzMxMLU6POJ4eBPF1KpNEbdt2Cms4LCcnZ%2FX6D3d%2BsKJJ7VSlNLoqgbjUtmkKKxlVmpf3bsFXW3d1b77gueJAQIPQBCilkMKemNi23Ts9T35%2FaMe2rsvmTypylGUFCSIYWJLXrm2nUwOPfNO5w%2B73Okxnjqe0JigQEL3JizoeONr%2F2u99vju4fd1rdZnyspQmnGvAUBprWNqz348%2FhXN%2F6P1%2By4Uvs%2FJkpRQRwpJBRVn7vf16Dfitz5XevQqWt3yalXtKaRIUQmglWfsu5y7%2BMrDs0TMftWo1ZVy64xioOVpcIdt8%2Fvqvf9%2F859KJsrLmrzA%2BOKC0IkFEtJza7JOfr%2FYd0P9G98tdOxe0Hp9qJrOIBgDuOeEtp%2F%2B4d%2FvWX%2F%2F9u%2B%2FtlaUTmOWZg7SQEEyuFe52%2BML9O3cZO%2F5xl06zn2VcadOJUqJTzt7a82XfP7sx9vmGNm1m1MstV4IHCVAAoTLqL1372ddn%2Fz%2B2v%2FWq12c1fSpsaeQWAZAANntxzuI3e3zbo8XGpm%2FMnNqiXrh%2BljaPd6UUabkjps19tdGnX2zKb9b4pTFDCzOMLmYtpW5h%2BpCRTeYtyV%2BT36zx808OL4xYGoFrkqDTbJpSXLdRgwbPZL%2BQnT129OOPFVEEsAMJpHKdeKMJgJSAiALdjJANQKnRJI4R6boAKEwLCiGoBBegQjBftQo1KQWOlplFKSV9qGaF1NpAE7QQESTlMSy6pp%2F4%2FFFVYxMNRBTaiM0tkImxNaL8vgfDR8gvoYRaxgAAAABJRU5ErkJggg%3D%3D" alt="bunlongheng.com"></a>
<a href="https://www.linkedin.com/in/bunlongheng/"><img src="https://img.shields.io/badge/LinkedIn-0A66C2?style=for-the-badge&logo=linkedin&logoColor=white" alt="LinkedIn"></a>
<a href="https://www.instagram.com/ibunlong/"><img src="https://img.shields.io/badge/Instagram-C13584?style=for-the-badge&logo=instagram&logoColor=white" alt="Instagram"></a>
<a href="mailto:bheng.code@gmail.com"><img src="https://img.shields.io/badge/Email-2E7D32?style=for-the-badge&logo=gmail&logoColor=white" alt="Email"></a>

<br>

Built by **[Bunlong](https://bunlongheng.com)** &nbsp;·&nbsp; [more apps](https://bunlongheng.com/projects)

</div>
