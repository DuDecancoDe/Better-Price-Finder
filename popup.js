const content = document.getElementById("content");
const footerNote = document.getElementById("footer-note");
const sameBrandToggle = document.getElementById("same-brand-toggle");

function formatMoney(amount, currency) {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currency || "USD"
    }).format(amount);
  } catch {
    return `$${Number(amount).toFixed(2)}`;
  }
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function renderNoProduct() {
  content.innerHTML = `
    <p class="pf-muted">No product detected on this page yet.</p>
    <button class="pf-cta" id="recheck-btn">Check this page</button>
  `;
  document.getElementById("recheck-btn").addEventListener("click", recheckActiveTab);
  footerNote.textContent = "";
}

function renderLoading() {
  content.innerHTML = `<p class="pf-muted">Checking this page&hellip;</p>`;
}

function productHeaderHtml(product, result) {
  const img = product.image
    ? `<img src="${escapeHtml(product.image)}" alt="" />`
    : `<img src="icons/icon48.png" alt="" />`;
  const showBrand = result && result.sameBrandSearch && product.brand;
  const brandLine = showBrand
    ? `<span class="pf-brand">${escapeHtml(product.brand)}</span>`
    : "";
  return `
    <div class="pf-product">
      ${img}
      <div class="pf-product-info">
        <p class="pf-product-title">${escapeHtml(product.title)}</p>
        ${brandLine}
        <span class="pf-current-price">This page: ${formatMoney(
          product.price,
          product.currency
        )}</span>
      </div>
    </div>
  `;
}

function renderState(product, result) {
  if (!product || !result || result.mode !== "manual") {
    renderNoProduct();
    return;
  }

  const links = (result.links || [])
    .map(
      (l) =>
        `<a href="${l.url}" target="_blank" rel="noopener"><span>${escapeHtml(
          l.retailer
        )}</span><span>&rarr;</span></a>`
    )
    .join("");

  const brandHint =
    result.sameBrandSearch && !product.brand
      ? "Brand wasn't found on this page, so searches use the product name only."
      : "";

  content.innerHTML = `
    ${productHeaderHtml(product, result)}
    <p class="pf-muted">Compare this price:</p>
    <div class="pf-linklist">${links}</div>
  `;
  footerNote.textContent = brandHint;
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function applyToggle(checked) {
  sameBrandToggle.checked = !!checked;
}

async function loadSettings() {
  chrome.runtime.sendMessage({ type: "GET_SETTINGS" }, (response) => {
    if (chrome.runtime.lastError || !response || !response.ok) return;
    applyToggle(response.settings.sameBrandSearch);
  });
}

async function loadState() {
  renderLoading();
  const tab = await getActiveTab();
  if (!tab || !tab.id) {
    renderNoProduct();
    return;
  }

  chrome.runtime.sendMessage({ type: "GET_TAB_STATE", tabId: tab.id }, (response) => {
    if (chrome.runtime.lastError || !response || !response.ok || !response.state) {
      renderNoProduct();
      return;
    }
    renderState(response.state.product, response.state.result);
  });
}

async function recheckActiveTab() {
  renderLoading();
  const tab = await getActiveTab();
  if (!tab || !tab.id) return;

  chrome.tabs.sendMessage(tab.id, { type: "FORCE_CHECK" }, () => {
    if (chrome.runtime.lastError) {
      content.innerHTML = `<p class="pf-muted">This page can't be checked.</p>`;
      return;
    }
    setTimeout(loadState, 1200);
  });
}

sameBrandToggle.addEventListener("change", async () => {
  const tab = await getActiveTab();
  chrome.runtime.sendMessage(
    {
      type: "SET_SAME_BRAND_SEARCH",
      sameBrandSearch: sameBrandToggle.checked,
      tabId: tab && tab.id
    },
    (response) => {
      if (chrome.runtime.lastError || !response || !response.ok) return;
      applyToggle(response.settings.sameBrandSearch);
      if (response.state) {
        renderState(response.state.product, response.state.result);
      }
      if (tab && tab.id) {
        chrome.tabs.sendMessage(tab.id, { type: "FORCE_CHECK" }, () => {
          void chrome.runtime.lastError;
          setTimeout(loadState, 900);
        });
      }
    }
  );
});

loadSettings();
loadState();
