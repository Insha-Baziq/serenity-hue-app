# Serenity Hue visual report preview

This directory is intentionally isolated from the application. It contains a
static HTML preview of the five one-page report compositions:

- Product Performance
- Customer Performance
- Orders & Sales
- TikTok Ads
- TikTok Affiliate

Open index.html in a browser, choose a report, and use Print / Save PDF. The
preview uses illustrative values only. It does not connect to the database, add
routes, import application components, or modify the reporting system.

The real integration should replace the preview data/rendering with the
approved report view models and shadcn/Recharts components.
