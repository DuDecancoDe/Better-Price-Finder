// content.js
// Runs on every page. Tries to determine whether the page is a product
// detail page, and if so extracts a title/price and asks the background
// worker to check for a cheaper offer elsewhere.

(function () {
  function parseJsonLdProducts() {
    const scripts = Array.from(
      document.querySelectorAll('script[type="application/ld+json"]')
    );
    const products = [];

    for (const script of scripts) {
      const data = parseJsonLd(script.textContent);
      if (data == null) continue;
      collectJsonLdProducts(data, products);
    }
    return products;
  }

  function parseJsonLd(text) {
    if (!text) return null;
    let s = text.trim();
    if (s.startsWith("<!--")) {
      s = s.replace(/^<!--/, "").replace(/-->\s*$/, "").trim();
    }
    try {
      return JSON.parse(s);
    } catch {
      try {
        return JSON.parse(s.replace(/,\s*([}\]])/g, "$1"));
      } catch {
        return null;
      }
    }
  }

  function isProductType(type) {
    const types = Array.isArray(type) ? type : [type];
    return types.some((t) => {
      if (!t || typeof t !== "string") return false;
      return /(^|\/|#)(Product|ProductGroup|IndividualProduct)$/i.test(t);
    });
  }

  function collectJsonLdProducts(node, products, seen) {
    if (!node || typeof node !== "object") return;
    const visited = seen || new Set();
    if (visited.has(node)) return;
    visited.add(node);

    if (Array.isArray(node)) {
      for (const child of node) collectJsonLdProducts(child, products, visited);
      return;
    }

    if (isProductType(node["@type"])) products.push(node);

    for (const key of ["@graph", "mainEntity", "mainEntityOfPage", "about"]) {
      if (node[key]) collectJsonLdProducts(node[key], products, visited);
    }
  }

  // JSON-LD `name` is often a string, but templates also emit arrays,
  // language maps, and `{ "@value": "..." }` objects. Those are truthy
  // but are not usable titles until flattened.
  function jsonLdText(value, depth) {
    if (value == null || (depth || 0) > 4) return null;
    if (typeof value === "string") {
      const t = value.trim();
      return t || null;
    }
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
    if (Array.isArray(value)) {
      for (const item of value) {
        const t = jsonLdText(item, (depth || 0) + 1);
        if (t) return t;
      }
      return null;
    }
    if (typeof value === "object") {
      return jsonLdText(
        value["@value"] || value.name || value.headline,
        (depth || 0) + 1
      );
    }
    return null;
  }

  function firstOffer(node) {
    let offers = node.offers;
    if (!offers) return null;
    if (Array.isArray(offers)) offers = offers[0];
    if (offers && (offers["@type"] === "AggregateOffer" || (Array.isArray(offers["@type"]) && offers["@type"].includes("AggregateOffer"))) && offers.offers) {
      offers = Array.isArray(offers.offers) ? offers.offers[0] : offers.offers;
    }
    return offers || null;
  }

  function metaContent(selector) {
    const el = document.querySelector(selector);
    return el ? el.getAttribute("content") : null;
  }

  function textFromSelectors(selectors) {
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el && el.textContent.trim()) return el.textContent.trim();
    }
    return null;
  }

  // Site chrome frequently contains its own <h1> for the logo, and its own
  // price-looking text (e.g. nav "deals" links). Skip that — but do not skip
  // every HTML <header>: product/article headers commonly wrap the real title.
  function isSiteHeader(header) {
    if (!header) return false;
    if (header.getAttribute("role") === "banner") return true;
    if (header.querySelector("nav, [role='navigation']")) return true;
    if (header.closest("main, article, [role='main'], [itemtype*='Product']")) {
      return false;
    }
    return header.parentElement === document.body;
  }

  function isInSiteChrome(el) {
    if (
      el.closest(
        "nav, footer, [role='banner'], [role='navigation'], [role='contentinfo']"
      )
    ) {
      return true;
    }
    const header = el.closest("header");
    return !!(header && isSiteHeader(header));
  }

  function elementPlainText(el) {
    if (!el) return null;
    const attr = el.getAttribute("content") || el.getAttribute("title");
    if (attr && attr.trim()) return attr.trim();
    const text = el.textContent ? el.textContent.trim() : "";
    return text || null;
  }

  function textFromSelectorsExcludingChrome(selectors) {
    for (const sel of selectors) {
      const els = document.querySelectorAll(sel);
      for (const el of els) {
        if (isInSiteChrome(el)) continue;
        const text = elementPlainText(el);
        if (text) return text;
      }
    }
    return null;
  }

  // [itemprop="name"] alone is too broad — it also matches breadcrumb trails
  // (BreadcrumbList/ListItem microdata) and site/organization branding, which
  // sit earlier in the DOM than the actual product and get matched first.
  // Only trust it when the element sits inside a microdata scope that is
  // itself typed as a Product.
  function getScopedProductName() {
    const candidates = document.querySelectorAll('[itemprop="name"]');
    const fallbacks = [];
    for (const el of candidates) {
      if (isInSiteChrome(el)) continue;
      const text = elementPlainText(el);
      if (!text) continue;
      const scope = el.closest("[itemscope]");
      const itemtype = scope ? scope.getAttribute("itemtype") || "" : "";
      if (/BreadcrumbList|ListItem|Organization|WebSite|WebPage|Brand|Offer/i.test(itemtype) &&
          !/Product/i.test(itemtype)) {
        continue;
      }
      if (/Product/i.test(itemtype)) return text;
      fallbacks.push(text);
    }
    // Unscoped itemprop=name still beats a logo h1; pick the longest value
    // so a breadcrumb crumb like "Home" loses to the real product name.
    fallbacks.sort((a, b) => b.length - a.length);
    return fallbacks[0] || null;
  }

  function cleanDocumentTitle(rawTitle, siteName) {
    if (!rawTitle) return null;
    const separators = [" | ", " – ", " — ", " - ", " :: ", " › "];
    let segments = [rawTitle];
    for (const sep of separators) {
      if (rawTitle.includes(sep)) {
        segments = rawTitle.split(sep).map((s) => s.trim()).filter(Boolean);
        break;
      }
    }
    if (segments.length <= 1) return rawTitle.trim();

    const withoutSiteName = segments.filter(
      (seg) => !siteName || seg.toLowerCase() !== siteName.toLowerCase()
    );
    const candidates = withoutSiteName.length ? withoutSiteName : segments;
    // The product name is almost always the most specific (longest) segment;
    // the site/brand name segment is usually short and repeats on every page.
    candidates.sort((a, b) => b.length - a.length);
    return candidates[0];
  }

  function getProductTitle(siteName) {
    // 1. Microdata name, but only when it's actually scoped to a Product —
    // not a breadcrumb crumb or organization/site name.
    const scopedName = getScopedProductName();
    if (scopedName) return scopedName;

    // 2. Explicit product-name class/attribute markup, skipping header/nav/footer.
    const specific = textFromSelectorsExcludingChrome([
      "#productTitle",
      ".product-title",
      ".product__title",
      ".product-name",
      ".product_name",
      ".product_title",
      ".pdp-title",
      "[data-testid*='product-title']",
      "[data-testid*='product-name']",
      "[data-testid*='pdp-title']",
      "h1[class*='product']",
      "h1[class*='title']"
    ]);
    if (specific) return specific;

    // 3. Any remaining <h1> that isn't part of the site chrome.
    const h1 = textFromSelectorsExcludingChrome(["h1"]);
    if (h1) return h1;

    // 4. og:title, but only if it isn't just the site name (common on sites
    // that don't update meta tags on client-side navigation).
    const ogTitle = cleanDocumentTitle(
      metaContent('meta[property="og:title"]') ||
        metaContent('meta[name="twitter:title"]'),
      siteName
    );
    if (ogTitle && !isLikelySiteName(ogTitle, siteName)) {
      return ogTitle;
    }

    // 5. document.title, stripped of the trailing/leading " | Site Name" part.
    return cleanDocumentTitle(document.title, siteName);
  }

  function isLikelySiteName(candidate, siteName) {
    if (typeof candidate !== "string") return true;
    const normalized = candidate.trim().toLowerCase();
    if (!normalized) return true;
    if (siteName && normalized === siteName.trim().toLowerCase()) return true;
    const host = location.hostname.replace(/^www\./, "");
    const hostBrand = host.split(".")[0].toLowerCase();
    if (normalized === host.toLowerCase()) return true;
    if (normalized.replace(/[^a-z0-9]/g, "") === hostBrand.replace(/[^a-z0-9]/g, "")) {
      return true;
    }
    return false;
  }

  function parsePriceString(str) {
    if (!str) return null;
    const cleaned = String(str).replace(/[^0-9.,]/g, "");
    if (!cleaned) return null;
    // Handle both 1,234.56 and 1.234,56 styles by keeping the last separator as decimal
    const normalized = cleaned.replace(/,(?=\d{3}(\D|$))/g, "");
    const num = parseFloat(normalized.replace(",", "."));
    return Number.isFinite(num) ? num : null;
  }

  function getSiteName() {
    return (
      metaContent('meta[property="og:site_name"]') ||
      metaContent('meta[name="application-name"]') ||
      metaContent('meta[name="twitter:site"]')
    );
  }

  function cleanBrandName(raw) {
    if (!raw || typeof raw !== "string") return null;
    let s = raw.replace(/\s+/g, " ").trim();
    s = s.replace(/^visit the\s+/i, "").replace(/\s+store$/i, "");
    s = s.replace(/^shop\s+/i, "");
    s = s.replace(/^brand:\s*/i, "");
    s = s.replace(/^by\s+/i, "");
    s = s.replace(/^sold by\s+/i, "");
    s = s.replace(/\s*\(.*?\)\s*$/, "").trim();
    if (s.length < 2 || s.length > 48) return null;
    return s;
  }

  function isGenericRetailerName(name) {
    if (!name) return true;
    return /^(amazon|walmart|target|ebay|best buy|bestbuy|google|shopping)$/i.test(
      name.trim()
    );
  }

  function getProductBrand(jsonLdNode, siteName) {
    const fromJsonLd = jsonLdNode
      ? cleanBrandName(
          jsonLdText(jsonLdNode.brand) || jsonLdText(jsonLdNode.manufacturer)
        )
      : null;

    const fromMicrodata = (() => {
      const els = document.querySelectorAll(
        '[itemprop="brand"], [itemprop="manufacturer"]'
      );
      for (const el of els) {
        if (isInSiteChrome(el)) continue;
        const nested = el.querySelector('[itemprop="name"]');
        const text = cleanBrandName(elementPlainText(nested || el));
        if (text) return text;
      }
      return null;
    })();

    const fromDom = cleanBrandName(
      textFromSelectorsExcludingChrome([
        "#bylineInfo",
        ".product-brand",
        ".product__vendor",
        ".product-vendor",
        ".pdp-brand",
        "[data-testid*='brand']",
        "[data-brand]",
        "[class*='product-brand']",
        "[class*='ProductBrand']"
      ])
    );

    const candidates = [fromJsonLd, fromMicrodata, fromDom].filter(Boolean);
    for (const brand of candidates) {
      if (isGenericRetailerName(brand)) continue;
      if (siteName && brand.toLowerCase() === siteName.trim().toLowerCase()) {
        // On a brand's own store (nike.com) this is still the right brand.
        const host = location.hostname.replace(/^www\./, "").split(".")[0];
        const brandKey = brand.toLowerCase().replace(/[^a-z0-9]/g, "");
        const hostKey = host.toLowerCase().replace(/[^a-z0-9]/g, "");
        if (brandKey !== hostKey && !hostKey.includes(brandKey)) continue;
      }
      return brand;
    }
    return null;
  }

  function withBrand(product, jsonLdNode, siteName) {
    if (!product) return null;
    product.brand = getProductBrand(jsonLdNode, siteName);
    return product;
  }

  function extractProduct() {
    const siteName = getSiteName();
    const ogImage = metaContent('meta[property="og:image"]');
    const products = parseJsonLdProducts();
    const node = products.length > 0 ? products[0] : null;

    // 1. Structured data (most reliable)
    if (node) {
      const offer = firstOffer(node);
      const price = offer
        ? parsePriceString(offer.price || offer.lowPrice || offer.highPrice)
        : null;
      const currency = offer ? offer.priceCurrency : null;
      // Prefer the JSON-LD name, but if a site reuses one static JSON-LD
      // block across pages (rare, but seen on some templates), fall back to
      // the same DOM-scoped title logic used elsewhere.
      let title =
        jsonLdText(node.name) || jsonLdText(node.headline) || jsonLdText(node.title);
      if (!title || isLikelySiteName(title, siteName)) {
        title = getProductTitle(siteName);
      }
      const image = Array.isArray(node.image) ? node.image[0] : node.image;
      if (title && price != null) {
        return withBrand(
          {
            title,
            price,
            currency: currency || "USD",
            image: image || ogImage || null
          },
          node,
          siteName
        );
      }
    }

    // 2. Open Graph / meta price tags, paired with the DOM-scoped title
    // (not og:title directly — see getProductTitle for why).
    const metaPrice =
      metaContent('meta[property="product:price:amount"]') ||
      metaContent('meta[property="og:price:amount"]') ||
      metaContent('meta[itemprop="price"]');
    const metaCurrency =
      metaContent('meta[property="product:price:currency"]') ||
      metaContent('meta[property="og:price:currency"]') ||
      "USD";

    if (metaPrice) {
      const price = parsePriceString(metaPrice);
      const title = getProductTitle(siteName);
      if (price != null && title) {
        return withBrand(
          { title, price, currency: metaCurrency, image: ogImage },
          node,
          siteName
        );
      }
    }

    // 3. Common on-page price selectors (broad fallback for sites without
    // structured data). This list intentionally covers widely used patterns
    // rather than one specific retailer.
    const priceText = textFromSelectorsExcludingChrome([
      "#priceblock_ourprice",
      "#priceblock_dealprice",
      ".a-price .a-offscreen",
      '[itemprop="price"]',
      '[data-testid*="price"]',
      '[class*="Price"]',
      '[class*="price"]'
    ]);
    const price = parsePriceString(priceText);
    const title = getProductTitle(siteName);

    if (title && price != null) {
      return withBrand(
        { title, price, currency: "USD", image: ogImage || null },
        node,
        siteName
      );
    }

    return null;
  }

  function looksLikeProductPage(product, siteName) {
    if (!product) return false;
    if (product.price <= 0 || product.price >= 100000) return false;
    if (typeof product.title !== "string" || product.title.trim().length <= 2) {
      return false;
    }
    // Reject titles that are just the site/brand name — the clearest sign
    // we fell all the way back to a stale document.title or site header.
    if (isLikelySiteName(product.title, siteName)) return false;
    return true;
  }

  function buildWidget() {
    const wrap = document.createElement("div");
    wrap.id = "bpf-widget";
    wrap.innerHTML = `
      <div class="bpf-card" role="status" aria-live="polite">
        <div class="bpf-header">
          <span class="bpf-tag-dot"></span>
          <span class="bpf-title">Checking price…</span>
          <button class="bpf-close" aria-label="Dismiss">&times;</button>
        </div>
        <div class="bpf-body"></div>
      </div>
    `;
    document.documentElement.appendChild(wrap);
    wrap.querySelector(".bpf-close").addEventListener("click", () => {
      wrap.remove();
    });
    return wrap;
  }

  function renderResult(widget, product, result) {
    const header = widget.querySelector(".bpf-title");
    const body = widget.querySelector(".bpf-body");

    if (result.mode === "manual") {
      header.textContent = "Compare this item";
      const links = (result.links || [])
        .map(
          (l) =>
            `<a class="bpf-link" href="${l.url}" target="_blank" rel="noopener">${l.retailer} &rarr;</a>`
        )
        .join("");
      body.innerHTML = `<div class="bpf-linklist">${links}</div>`;
    } else {
      widget.remove();
    }
  }

  function dispatchCheck(product) {
    const payload = { ...product, url: location.href };
    const widget = buildWidget();

    chrome.runtime.sendMessage(
      { type: "CHECK_PRICE", payload },
      (response) => {
        if (chrome.runtime.lastError) return;
        if (response && response.ok) {
          renderResult(widget, product, response.result);
        } else {
          widget.remove();
        }
      }
    );
  }

  // Many storefronts render the product title/price client-side after the
  // initial page load (React/Vue apps), so a single check right at "load"
  // can still catch stale placeholder content. Retry a few times with
  // backoff, and stop as soon as a plausible, non-generic product is found.
  const RETRY_DELAYS_MS = [600, 1400, 2600, 4200];

  function attemptExtraction(attempt = 0) {
    const siteName = getSiteName();
    const product = extractProduct();

    if (looksLikeProductPage(product, siteName)) {
      dispatchCheck(product);
      return;
    }

    if (attempt < RETRY_DELAYS_MS.length - 1) {
      setTimeout(() => attemptExtraction(attempt + 1), RETRY_DELAYS_MS[attempt + 1] - RETRY_DELAYS_MS[attempt]);
    }
  }

  function run() {
    attemptExtraction(0);
  }

  if (document.readyState === "complete") {
    setTimeout(run, RETRY_DELAYS_MS[0]);
  } else {
    window.addEventListener("load", () => setTimeout(run, RETRY_DELAYS_MS[0]));
  }

  // Allow the popup to force a re-check, e.g. on single-page apps where the
  // URL/content changed without a full page load.
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === "FORCE_CHECK") {
      const existing = document.getElementById("bpf-widget");
      if (existing) existing.remove();
      run();
      sendResponse({ ok: true });
    }
  });
})();
