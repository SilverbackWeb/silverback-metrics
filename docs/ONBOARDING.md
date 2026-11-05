# New client setup checklist

For the Silverback team. Do these in order. Budget about 30 minutes per site.

You'll need: the client's WordPress login, access to their Google Business Profile, their Google Ads account (under the Silverback MCC), and their GA4 property.

---

## 1. Create the client in Silverback Metrics

- [ ] **Clients → New client.** Enter business name, website, and default lead values (form lead $, call lead $).
- [ ] **Add site.** Enter the domain. Copy the **install snippet** and the **Elementor webhook URL** from the site page.
- [ ] **Invite the client.** Enter their email; they get a login link.

## 2. Website (WordPress + Elementor)

- [ ] Paste the snippet in the site header (Elementor → Custom Code → `<head>`, or WPCode "Header"):

  ```html
  <script async src="https://metrics.silverbackweb.com/t.js" data-site="SITE_KEY"></script>
  ```

- [ ] For **every** Elementor form (including popups):
  - [ ] Add a field, type **Hidden**. On its **Advanced** tab, set **ID** to `sb_data`.
  - [ ] **Actions After Submit → add Webhook.** Paste the webhook URL. Turn on **Advanced Data**.
  - [ ] Keep the **Email** action so the client still gets the normal notification.
- [ ] No GHL or Jotform iframes. Replace them with Elementor forms.
- [ ] Clear any cache plugin and CDN cache.

## 3. Google Analytics 4

- [ ] In GA4 **Admin → Property access management**, add the Silverback service account email as **Viewer**.
- [ ] In Silverback Metrics, enter the **property ID** (numbers, from Admin → Property details) and the **measurement ID** (`G-XXXXXXX`).
- [ ] Same for **Search Console**: add the service account as a **Full** user on the property, then enter the property URL.

## 4. Google Business Profile

- [ ] Make sure Silverback's Google account is a **Manager** on the profile.
- [ ] Set the **website** link to:
  `https://CLIENTSITE.com/?utm_source=google&utm_medium=gbp&utm_campaign=gbp-listing`
- [ ] If there's an **appointment** link:
  `https://CLIENTSITE.com/contact/?utm_source=google&utm_medium=gbp&utm_campaign=gbp-appointment`
- [ ] Any **post** buttons: use the UTM builder in the app (`utm_campaign=gbp-post`).
- [ ] In Silverback Metrics, pick the profile from the GBP list to connect it.

## 5. Google Ads

- [ ] Account is linked under the Silverback **MCC**.
- [ ] **Admin → Account settings → Auto-tagging: ON.**
- [ ] **Account settings → Tracking → Final URL suffix:**
  ```
  utm_source=google&utm_medium=cpc&utm_campaign={campaignid}&utm_content={creative}&utm_term={keyword}
  ```
- [ ] In Silverback Metrics, pick the customer ID from the Ads list to connect it.

## 6. Rankings and heat map (optional per client)

- [ ] Add 5 to 15 keywords.
- [ ] Confirm the GBP listing match (the app looks it up by business name and address; confirm it picked the right one).
- [ ] Set the heat map grid (default 7x7, 5 miles) and frequency (default monthly).

## 7. Verify (do not skip)

- [ ] Open the site in a private window with `?utm_source=test&utm_medium=test&utm_campaign=setup-check` on the URL.
- [ ] Click to another page, then submit each form with the name "TEST Silverback".
- [ ] Open **Verify** for the site in Silverback Metrics. Every line should be green:
  - Snippet seen in the last 24 hours
  - Hidden `sb_data` field found
  - Test lead received **with** source `test / test / setup-check`
  - GA4 and Search Console return data
  - Ads auto-tagging on and Final URL suffix set
  - GBP website link has UTMs
- [ ] Mark the test leads as **Spam** so they don't count.
- [ ] Tell the client their dashboard is live.
