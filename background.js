

const DEFAULT_SETTINGS = { sameBrandSearch: false };

function searchQuery(title, brand, sameBrandSearch) {
  const base = (title || "").trim();
  if (!sameBrandSearch || !brand) return base;
  const brandText = String(brand).trim();
  if (!brandText) return base;
  if (base.toLowerCase().includes(brandText.toLowerCase())) return base;
  return `${brandText} ${base}`.trim();
}

function buildSearchLinks(query) {
  const q = encodeURIComponent(query);
  return [
    { retailer: "Google Shopping", url: `https://www.google.com/search?tbm=shop&q=${q}` },
    { retailer: "Amazon", url: `https://www.amazon.com/s?k=${q}` },
    { retailer: "Walmart", url: `https://www.walmart.com/search?q=${q}` },
    { retailer: "eBay", url: `https://www.ebay.com/sch/i.html?_nkw=${q}` },
    { retailer: "Target", url: `https://www.target.com/s?searchTerm=${q}` }
  ];
}

async function getSettings() {
  return chrome.storage.sync.get(DEFAULT_SETTINGS);
}

async function handleCheckPrice(payload) {
  const { title, price, brand } = payload;
  if (!title) {
    return { mode: "no-product" };
  }

  const { sameBrandSearch } = await getSettings();
  const query = searchQuery(title, brand, sameBrandSearch);

  return {
    mode: "manual",
    currentPrice: price,
    brand: brand || null,
    sameBrandSearch,
    query,
    links: buildSearchLinks(query)
  };
}

async function tabStateKey(tabId) {
  return `tabstate:${tabId}`;
}

async function rebuildTabState(tabId) {
  const key = await tabStateKey(tabId);
  const stored = await chrome.storage.session.get(key);
  const prev = stored[key];
  if (!prev || !prev.product) return prev || null;
  const result = await handleCheckPrice(prev.product);
  const next = { product: prev.product, result, ts: Date.now() };
  await chrome.storage.session.set({ [key]: next });
  return next;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "CHECK_PRICE") {
    const tabId = sender.tab && sender.tab.id;

    (async () => {
      const result = await handleCheckPrice(message.payload);
      if (tabId != null) {
        const key = await tabStateKey(tabId);
        await chrome.storage.session.set({
          [key]: { product: message.payload, result, ts: Date.now() }
        });
      }
      sendResponse({ ok: true, result });
    })();
    return true; // keep the message channel open for the async response
  }

  if (message.type === "GET_TAB_STATE") {
    (async () => {
      const key = await tabStateKey(message.tabId);
      const stored = await chrome.storage.session.get(key);
      sendResponse({ ok: true, state: stored[key] || null });
    })();
    return true;
  }

  if (message.type === "GET_SETTINGS") {
    (async () => {
      sendResponse({ ok: true, settings: await getSettings() });
    })();
    return true;
  }

  if (message.type === "SET_SAME_BRAND_SEARCH") {
    (async () => {
      await chrome.storage.sync.set({
        sameBrandSearch: !!message.sameBrandSearch
      });
      let state = null;
      if (message.tabId != null) {
        state = await rebuildTabState(message.tabId);
      }
      sendResponse({ ok: true, settings: await getSettings(), state });
    })();
    return true;
  }
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const key = await tabStateKey(tabId);
  chrome.storage.session.remove(key);
});
