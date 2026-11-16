(function () {
  "use strict";

  const STORAGE_KEY = "neigou-cart-v1";
  const SHIPPING_KEY = "neigou-shipping-v2";
  const ADDRESS_BOOK_KEY = "neigou-address-book-v1";
  const ORDER_HISTORY_KEY = "neigou-order-history-v1";
  const PAGE_SIZE = 24;
  const state = {
    items: [],
    filtered: [],
    cart: loadJson(STORAGE_KEY, {}),
    orderHistory: loadJson(ORDER_HISTORY_KEY, []),
    query: "",
    category: "全部",
    sort: "default",
    page: 1,
    selectedItem: null,
    selectedSize: null,
    modalQty: 1,
    campaign: null,
    closed: false,
  };

  const $ = (selector) => document.querySelector(selector);
  const elements = {
    grid: $("#productGrid"),
    meta: $("#catalogMeta"),
    search: $("#searchInput"),
    clearSearch: $("#clearSearch"),
    filters: $("#categoryFilters"),
    sort: $("#sortSelect"),
    empty: $("#emptyState"),
    reset: $("#resetFilters"),
    pagination: $("#pagination"),
    backdrop: $("#modalBackdrop"),
    productModal: $("#productModal"),
    modalProduct: $("#modalProduct"),
    cartPanel: $("#cartPanel"),
    cartButton: $("#cartButton"),
    historyButton: $("#historyButton"),
    historyBadge: $("#historyBadge"),
    mobileCartButton: $("#mobileCartButton"),
    closeCart: $("#closeCart"),
    historyModal: $("#historyModal"),
    closeHistory: $("#closeHistory"),
    historyItems: $("#historyItems"),
    historyEmpty: $("#historyEmpty"),
    cartItems: $("#cartItems"),
    cartEmpty: $("#cartEmpty"),
    cartSelection: $("#cartSelection"),
    selectAllCart: $("#selectAllCart"),
    cartBadge: $("#cartBadge"),
    totalQty: $("#totalQty"),
    cartQty: $("#cartQty"),
    totalAmount: $("#totalAmount"),
    mobileQty: $("#mobileQty"),
    mobileAmount: $("#mobileAmount"),
    buyerName: $("#buyerName"),
    buyerPhone: $("#buyerPhone"),
    buyerProvince: $("#buyerProvince"),
    buyerCity: $("#buyerCity"),
    buyerDistrict: $("#buyerDistrict"),
    buyerAddress: $("#buyerAddress"),
    addressSelect: $("#addressSelect"),
    saveAddressButton: $("#saveAddressButton"),
    deleteAddressButton: $("#deleteAddressButton"),
    exportError: $("#exportError"),
    exportButton: $("#exportButton"),
    submitOrderButton: $("#submitOrderButton"),
    orderSuccess: $("#orderSuccess"),
    campaignBanner: $("#campaignBanner"),
    campaignStatus: $("#campaignStatus"),
    campaignTime: $("#campaignTime"),
    toast: $("#toast"),
  };

  const shippingInputs = ["buyerName", "buyerPhone", "buyerProvince", "buyerCity", "buyerDistrict", "buyerAddress"];
  let savedAddresses = loadJson(ADDRESS_BOOK_KEY, []);
  if (!Array.isArray(savedAddresses)) savedAddresses = [];
  if (!Array.isArray(state.orderHistory)) state.orderHistory = [];
  const savedShipping = loadJson(SHIPPING_KEY, {});
  shippingInputs.forEach((key) => {
    elements[key].value = savedShipping[key] || "";
  });

  function shippingValues() {
    return Object.fromEntries(shippingInputs.map((key) => [key, elements[key].value.trim()]));
  }

  function saveShipping() {
    localStorage.setItem(SHIPPING_KEY, JSON.stringify(shippingValues()));
  }

  function addressLabel(address) {
    return `${address.buyerName} · ${address.buyerCity}${address.buyerDistrict} · ${address.buyerAddress}`;
  }

  function renderAddressBook(selectedId = elements.addressSelect.value) {
    elements.addressSelect.innerHTML = [
      `<option value="">选择地址（已保存 ${savedAddresses.length} 条）</option>`,
      ...savedAddresses.map((address) => `<option value="${escapeHtml(address.id)}"${address.id === selectedId ? " selected" : ""}>${escapeHtml(addressLabel(address))}</option>`),
    ].join("");
    elements.deleteAddressButton.disabled = !elements.addressSelect.value;
  }

  function saveCurrentAddress() {
    const address = shippingValues();
    const missingKey = shippingInputs.find((key) => !address[key]);
    if (missingKey) {
      elements.exportError.textContent = "请完整填写收件人、电话和地址后再保存。";
      elements[missingKey].focus();
      return;
    }
    const fingerprint = shippingInputs.map((key) => address[key].toLocaleLowerCase("zh-CN")).join("\u001f");
    const existing = savedAddresses.find((item) => item.fingerprint === fingerprint);
    const saved = existing || {
      id: `address-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      fingerprint,
    };
    Object.assign(saved, address);
    if (!existing) savedAddresses.unshift(saved);
    savedAddresses = savedAddresses.slice(0, 20);
    localStorage.setItem(ADDRESS_BOOK_KEY, JSON.stringify(savedAddresses));
    renderAddressBook(saved.id);
    showToast(existing ? "该地址已保存" : "地址已保存");
  }

  function selectSavedAddress(id) {
    const address = savedAddresses.find((item) => item.id === id);
    if (!address) return;
    shippingInputs.forEach((key) => {
      elements[key].value = address[key] || "";
    });
    saveShipping();
    elements.exportError.textContent = "";
  }

  function deleteSelectedAddress() {
    const id = elements.addressSelect.value;
    if (!id) return;
    savedAddresses = savedAddresses.filter((item) => item.id !== id);
    localStorage.setItem(ADDRESS_BOOK_KEY, JSON.stringify(savedAddresses));
    renderAddressBook("");
    showToast("已删除保存的地址");
  }

  function loadJson(key, fallback) {
    try {
      return JSON.parse(localStorage.getItem(key)) || fallback;
    } catch (_) {
      return fallback;
    }
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function escapeXml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&apos;");
  }

  function money(value) {
    return `¥${Number(value).toLocaleString("zh-CN", { maximumFractionDigits: 2 })}`;
  }

  function cartKey(sku, size) {
    return `${sku}::${size}`;
  }

  function stockLimit(value) {
    const number = Number(value);
    return value !== null && value !== "" && Number.isFinite(number) && number > 0 ? number : null;
  }

  async function init() {
    try {
      const response = await fetch("data/catalog.json", { cache: "no-store" });
      if (!response.ok) throw new Error(`商品数据读取失败：${response.status}`);
      const catalog = await response.json();
      state.campaign = catalog.meta?.campaign || null;
      applyCampaignState();
      state.items = catalog.items || [];
      reconcileCart();
      renderFilters();
      applyFilters();
      renderCart();
      const count = catalog.meta?.itemCount ?? state.items.length;
      const variants = catalog.meta?.variantCount ?? state.items.reduce((sum, item) => sum + item.sizes.length, 0);
      elements.meta.textContent = `${count.toLocaleString("zh-CN")} 个颜色款 · ${variants.toLocaleString("zh-CN")} 个可选规格`;
      if (state.campaign?.endsAt) window.setInterval(applyCampaignState, 30000);
    } catch (error) {
      elements.meta.textContent = "商品读取失败，请刷新页面重试。";
      elements.grid.innerHTML = `<div class="empty-state"><h3>暂时无法读取商品</h3><p>${escapeHtml(error.message)}</p></div>`;
    }
  }

  function reconcileCart() {
    const next = {};
    Object.values(state.cart).forEach((line) => {
      const item = state.items.find((candidate) => candidate.sku === line.sku);
      const size = item?.sizes.find((candidate) => candidate.size === String(line.size));
      if (!item || !size) return;
      const key = cartKey(item.sku, size.size);
      const limit = stockLimit(size.stock);
      next[key] = {
        sku: item.sku,
        style: item.style,
        name: item.name,
        color: item.color,
        size: size.size,
        price: item.price,
        qty: limit === null ? Math.max(1, Number(line.qty) || 1) : Math.max(1, Math.min(Number(line.qty) || 1, limit)),
        stock: limit,
        image: item.image,
        selected: line.selected !== false,
      };
    });
    state.cart = next;
    saveCart();
  }

  function renderFilters() {
    const counts = new Map();
    state.items.forEach((item) => counts.set(item.name, (counts.get(item.name) || 0) + 1));
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 9).map(([name]) => name);
    elements.filters.innerHTML = ["全部", ...top]
      .map((name) => `<button class="chip${name === state.category ? " active" : ""}" type="button" data-category="${escapeHtml(name)}">${escapeHtml(name)}</button>`)
      .join("");
  }

  function applyFilters() {
    const query = state.query.trim().toLocaleLowerCase("zh-CN");
    let result = state.items.filter((item) => {
      const categoryMatch = state.category === "全部" || item.name === state.category;
      const searchable = `${item.name} ${item.style} ${item.sku} ${item.color}`.toLocaleLowerCase("zh-CN");
      return categoryMatch && (!query || searchable.includes(query));
    });
    if (state.sort === "priceAsc") result.sort((a, b) => a.price - b.price || a.row - b.row);
    if (state.sort === "priceDesc") result.sort((a, b) => b.price - a.price || a.row - b.row);
    if (state.sort === "name") result.sort((a, b) => a.name.localeCompare(b.name, "zh-CN") || a.row - b.row);
    state.filtered = result;
    const pages = Math.max(1, Math.ceil(result.length / PAGE_SIZE));
    state.page = Math.min(state.page, pages);
    renderProducts();
    renderPagination();
  }

  function renderProducts() {
    const start = (state.page - 1) * PAGE_SIZE;
    const pageItems = state.filtered.slice(start, start + PAGE_SIZE);
    elements.empty.hidden = pageItems.length > 0;
    elements.grid.hidden = pageItems.length === 0;
    elements.pagination.hidden = pageItems.length === 0;
    elements.grid.innerHTML = pageItems.map(productCard).join("");
  }

  function productCard(item) {
    const image = item.image
      ? `<img class="product-image" src="${escapeHtml(item.image)}" alt="${escapeHtml(`${item.name} ${item.color}`)}" loading="lazy" decoding="async" />`
      : `<div class="product-image-placeholder">暂无图片</div>`;
    return `
      <article class="product-card">
        <div class="product-image-wrap">
          ${image}
          <span class="stock-pill">${item.sizes.length} 个尺码</span>
        </div>
        <div class="product-body">
          <div class="product-topline">
            <h3 class="product-name">${escapeHtml(item.name)}</h3>
            <span class="product-price"><small>内购价</small><b>¥${escapeHtml(item.price)}</b></span>
          </div>
          <p class="product-color" title="${escapeHtml(item.color)}">${escapeHtml(item.color)}</p>
          <div class="product-info">
            <span>款号 ${escapeHtml(item.sku)}</span>
            <span>${escapeHtml(item.season || "季节未标注")}</span>
            <span>${escapeHtml(item.gender || "性别未标注")}</span>
          </div>
          <div class="product-actions">
            <button class="select-button" type="button" data-select-sku="${escapeHtml(item.sku)}" ${state.closed ? "disabled" : ""}>${state.closed ? "内购已结束" : "选择尺码与数量"}</button>
            ${item.link ? `<a class="detail-link" href="${escapeHtml(item.link)}" target="_blank" rel="noopener noreferrer">查看商品详情</a>` : ""}
          </div>
        </div>
      </article>`;
  }

  function renderPagination() {
    const totalPages = Math.max(1, Math.ceil(state.filtered.length / PAGE_SIZE));
    if (totalPages <= 1) {
      elements.pagination.innerHTML = "";
      return;
    }
    const pageNumbers = [];
    for (let page = 1; page <= totalPages; page += 1) {
      if (page === 1 || page === totalPages || Math.abs(page - state.page) <= 1) pageNumbers.push(page);
    }
    const pieces = [`<button class="page-button" type="button" data-page="${state.page - 1}" ${state.page === 1 ? "disabled" : ""} aria-label="上一页">‹</button>`];
    let last = 0;
    pageNumbers.forEach((page) => {
      if (last && page - last > 1) pieces.push(`<span class="page-button" aria-hidden="true">…</span>`);
      pieces.push(`<button class="page-button${page === state.page ? " current" : ""}" type="button" data-page="${page}" aria-label="第 ${page} 页" ${page === state.page ? 'aria-current="page"' : ""}>${page}</button>`);
      last = page;
    });
    pieces.push(`<button class="page-button" type="button" data-page="${state.page + 1}" ${state.page === totalPages ? "disabled" : ""} aria-label="下一页">›</button>`);
    elements.pagination.innerHTML = pieces.join("");
  }

  function openProduct(sku) {
    const item = state.items.find((candidate) => candidate.sku === sku);
    if (!item) return;
    state.selectedItem = item;
    state.selectedSize = item.sizes[0]?.size || null;
    state.modalQty = 1;
    renderProductModal();
    elements.productModal.hidden = false;
    elements.backdrop.hidden = false;
    document.body.style.overflow = "hidden";
    pushOverlayHistory("product");
    setTimeout(() => elements.productModal.querySelector(".size-button")?.focus(), 0);
  }

  function renderProductModal() {
    const item = state.selectedItem;
    if (!item) return;
    const selected = item.sizes.find((size) => size.size === state.selectedSize) || item.sizes[0];
    const max = stockLimit(selected?.stock);
    state.modalQty = max === null ? Math.max(1, state.modalQty) : Math.max(1, Math.min(state.modalQty, max));
    elements.modalProduct.innerHTML = `
      <div class="modal-visual">
        ${item.image ? `<img src="${escapeHtml(item.image)}" alt="${escapeHtml(`${item.name} ${item.color}`)}" />` : `<div class="product-image-placeholder">暂无图片</div>`}
      </div>
      <div class="modal-content">
        <p class="eyebrow">选择规格</p>
        <h2 id="modalTitle">${escapeHtml(item.name)}</h2>
        <p class="modal-color">${escapeHtml(item.color)}</p>
        <div class="modal-price"><small>内购价</small>${money(item.price)}</div>
        <div class="modal-details">
          <span>款号 ${escapeHtml(item.sku)}</span>
          <span>${escapeHtml(item.season)}</span>
          <span>${escapeHtml(item.gender)}</span>
        </div>
        ${item.link ? `<a class="modal-detail-link" href="${escapeHtml(item.link)}" target="_blank" rel="noopener noreferrer">打开商品详情页</a>` : ""}
        <span class="field-label">尺码</span>
        <div class="size-grid">
          ${item.sizes.map((size) => `<button class="size-button${size.size === selected.size ? " active" : ""}" type="button" data-size="${escapeHtml(size.size)}">${escapeHtml(size.size)}<small>${stockLimit(size.stock) === null ? "可选" : `库存 ${escapeHtml(size.stock)}`}</small></button>`).join("")}
        </div>
        <div class="quantity-row">
          <span class="field-label">数量</span>
          <div class="quantity-control">
            <button type="button" data-modal-qty="-1" aria-label="减少数量">−</button>
            <input id="modalQty" type="number" min="1" ${max === null ? "" : `max="${max}"`} value="${state.modalQty}" inputmode="numeric" aria-label="选购数量" />
            <button type="button" data-modal-qty="1" aria-label="增加数量">＋</button>
          </div>
        </div>
        <button class="primary-button modal-add" type="button" data-add-to-cart ${state.closed ? "disabled" : ""}>${state.closed ? "本次内购已结束" : "加入选购清单"}</button>
      </div>`;
  }

  function pushOverlayHistory(type) {
    if (window.history.state?.neigouOverlay === type) return;
    try {
      window.history.pushState({ ...(window.history.state || {}), neigouOverlay: type }, "", `#${type}`);
    } catch (_) {
      // file:// previews and privacy-focused browsers may restrict history updates.
    }
  }

  function closeProduct(fromHistory = false) {
    if (!fromHistory && window.history.state?.neigouOverlay === "product") {
      window.history.back();
      return;
    }
    elements.productModal.hidden = true;
    state.selectedItem = null;
    closeBackdropIfUnused();
  }

  function openCart() {
    elements.cartPanel.classList.add("open");
    elements.cartPanel.setAttribute("aria-hidden", "false");
    elements.cartButton.setAttribute("aria-expanded", "true");
    elements.backdrop.hidden = false;
    document.body.style.overflow = "hidden";
    pushOverlayHistory("cart");
    setTimeout(() => elements.closeCart.focus(), 0);
  }

  function openHistory() {
    renderOrderHistory();
    elements.historyModal.hidden = false;
    elements.backdrop.hidden = false;
    document.body.style.overflow = "hidden";
    pushOverlayHistory("history");
    setTimeout(() => elements.closeHistory.focus(), 0);
  }

  function closeHistory(fromHistory = false) {
    if (!fromHistory && window.history.state?.neigouOverlay === "history") {
      window.history.back();
      return;
    }
    elements.historyModal.hidden = true;
    closeBackdropIfUnused();
  }

  function closeCart(fromHistory = false) {
    if (!fromHistory && window.history.state?.neigouOverlay === "cart") {
      window.history.back();
      return;
    }
    elements.cartPanel.classList.remove("open");
    elements.cartPanel.setAttribute("aria-hidden", "true");
    elements.cartButton.setAttribute("aria-expanded", "false");
    closeBackdropIfUnused();
  }

  function closeBackdropIfUnused() {
    const cartOpen = elements.cartPanel.classList.contains("open");
    const modalOpen = !elements.productModal.hidden;
    const historyOpen = !elements.historyModal.hidden;
    if (!cartOpen && !modalOpen && !historyOpen) {
      elements.backdrop.hidden = true;
      document.body.style.overflow = "";
    }
  }

  function addSelectedToCart() {
    const item = state.selectedItem;
    const size = item?.sizes.find((candidate) => candidate.size === state.selectedSize);
    if (!item || !size || state.closed) return;
    const key = cartKey(item.sku, size.size);
    const existing = state.cart[key];
    const requestedQty = (existing?.qty || 0) + state.modalQty;
    const limit = stockLimit(size.stock);
    const qty = limit === null ? requestedQty : Math.min(requestedQty, limit);
    state.cart[key] = {
      sku: item.sku,
      style: item.style,
      name: item.name,
      color: item.color,
      size: size.size,
      price: Number(item.price),
      qty,
      stock: limit,
      image: item.image,
      selected: existing ? existing.selected !== false : true,
    };
    saveCart();
    renderCart();
    closeProduct();
    showToast(limit !== null && qty < requestedQty ? `库存最多 ${size.stock} 件，已按库存加入` : "已加入选购清单");
  }

  function saveCart() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.cart));
  }

  function renderCart() {
    const lines = Object.entries(state.cart);
    elements.cartItems.innerHTML = lines.map(([key, line]) => `
      <article class="cart-item${line.selected === false ? " unselected" : ""}">
        <label class="cart-line-select" aria-label="选择 ${escapeHtml(line.name)} ${escapeHtml(line.size)}">
          <input type="checkbox" data-cart-selected="${escapeHtml(key)}" ${line.selected === false ? "" : "checked"} />
        </label>
        ${line.image ? `<img class="cart-thumb" src="${escapeHtml(line.image)}" alt="" loading="lazy" />` : `<div class="cart-thumb"></div>`}
        <div>
          <h3>${escapeHtml(line.name)}</h3>
          <p>${escapeHtml(line.color)} · 尺码 ${escapeHtml(line.size)}</p>
          <p>款号 ${escapeHtml(line.sku)}</p>
          <p class="cart-line-price">内购价小计 ${money(line.price * line.qty)}</p>
        </div>
        <div class="cart-actions">
          <button type="button" data-remove-key="${escapeHtml(key)}">删除</button>
          <div class="cart-qty">
            <button type="button" data-cart-key="${escapeHtml(key)}" data-cart-delta="-1" aria-label="减少数量">−</button>
            <input type="number" min="1" ${stockLimit(line.stock) === null ? "" : `max="${line.stock}"`} value="${line.qty}" data-cart-input="${escapeHtml(key)}" inputmode="numeric" aria-label="${escapeHtml(line.name)} 数量" />
            <button type="button" data-cart-key="${escapeHtml(key)}" data-cart-delta="1" aria-label="增加数量">＋</button>
          </div>
        </div>
      </article>`).join("");
    elements.cartEmpty.hidden = lines.length > 0;
    elements.cartItems.hidden = lines.length === 0;
    elements.cartSelection.hidden = lines.length === 0;
    const selected = lines.filter(([, line]) => line.selected !== false);
    const cartQty = lines.reduce((sum, [, line]) => sum + Number(line.qty), 0);
    const totalQty = selected.reduce((sum, [, line]) => sum + Number(line.qty), 0);
    const totalAmount = selected.reduce((sum, [, line]) => sum + Number(line.price) * Number(line.qty), 0);
    elements.selectAllCart.checked = lines.length > 0 && selected.length === lines.length;
    elements.selectAllCart.indeterminate = selected.length > 0 && selected.length < lines.length;
    elements.cartBadge.textContent = cartQty;
    elements.cartQty.textContent = cartQty;
    elements.totalQty.textContent = totalQty;
    elements.totalAmount.textContent = money(totalAmount);
    elements.mobileQty.textContent = totalQty;
    elements.mobileAmount.textContent = money(totalAmount);
  }

  function saveOrderHistoryRecord(type, shipping, lines, orderId = "") {
    const record = {
      id: orderId || `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      type,
      createdAt: new Date().toISOString(),
      campaignId: state.campaign?.id || "",
      buyerName: shipping.buyerName,
      totalQty: lines.reduce((sum, line) => sum + Number(line.qty), 0),
      totalAmount: lines.reduce((sum, line) => sum + Number(line.price) * Number(line.qty), 0),
      lines: lines.map(({ sku, style, name, color, size, price, qty }) => ({ sku, style, name, color, size, price, qty })),
    };
    state.orderHistory.unshift(record);
    state.orderHistory = state.orderHistory.slice(0, 30);
    localStorage.setItem(ORDER_HISTORY_KEY, JSON.stringify(state.orderHistory));
    renderOrderHistory();
  }

  function renderOrderHistory() {
    const records = state.orderHistory;
    elements.historyBadge.textContent = records.length;
    elements.historyEmpty.hidden = records.length > 0;
    elements.historyItems.hidden = records.length === 0;
    elements.historyItems.innerHTML = records.map((record) => {
      const createdAt = new Date(record.createdAt);
      const time = Number.isFinite(createdAt.getTime())
        ? createdAt.toLocaleString("zh-CN", { hour12: false })
        : "时间未知";
      const source = record.type === "online" ? "在线提交" : "Excel 已导出";
      return `<article class="history-record">
        <div class="history-record-head">
          <div><strong>${escapeHtml(record.buyerName || "未填写姓名")}</strong><span>${escapeHtml(time)} · ${source}</span></div>
          <div><b>${Number(record.totalQty) || 0} 件</b><strong>${money(record.totalAmount || 0)}</strong></div>
        </div>
        <details>
          <summary>查看 ${record.lines?.length || 0} 个商品规格</summary>
          <div class="history-lines">${(record.lines || []).map((line) => `<div>
            <span><b>${escapeHtml(line.name)}</b> · ${escapeHtml(line.color)} · ${escapeHtml(line.size)}</span>
            <span>${escapeHtml(line.sku)} · ${line.qty} 件 · ${money(Number(line.price) * Number(line.qty))}</span>
          </div>`).join("")}</div>
        </details>
      </article>`;
    }).join("");
  }

  function selectedLines() {
    return Object.values(state.cart).filter((line) => line.selected !== false);
  }

  function setLineSelected(key, selected) {
    if (!state.cart[key]) return;
    state.cart[key].selected = Boolean(selected);
    saveCart();
    renderCart();
  }

  function applyCampaignState() {
    const campaign = state.campaign;
    if (!campaign?.endsAt) {
      elements.campaignBanner.hidden = true;
      return;
    }
    const start = campaign.startsAt ? new Date(campaign.startsAt) : null;
    const end = new Date(campaign.endsAt);
    const now = new Date();
    state.closed = !Number.isFinite(end.getTime()) || now >= end || (start && Number.isFinite(start.getTime()) && now < start);
    elements.campaignBanner.hidden = false;
    elements.campaignBanner.classList.toggle("closed", state.closed);
    elements.campaignStatus.textContent = now >= end ? "本次内购已结束" : state.closed ? "本次内购尚未开始" : "本次内购进行中";
    elements.campaignTime.textContent = `截止 ${end.toLocaleString("zh-CN", { hour12: false })}`;
    elements.exportButton.disabled = state.closed;
    elements.submitOrderButton.disabled = state.closed;
    renderProducts();
    if (!elements.productModal.hidden) renderProductModal();
  }

  function changeCartQty(key, nextQty) {
    const line = state.cart[key];
    if (!line) return;
    const limit = stockLimit(line.stock);
    line.qty = limit === null ? Math.max(1, Number(nextQty) || 1) : Math.max(1, Math.min(Number(nextQty) || 1, limit));
    saveCart();
    renderCart();
  }

  function showToast(message) {
    elements.toast.textContent = message;
    elements.toast.classList.add("show");
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => elements.toast.classList.remove("show"), 2200);
  }

  let exportLibraryPromise;
  function ensureExportLibrary() {
    if (window.JSZip) return Promise.resolve();
    if (exportLibraryPromise) return exportLibraryPromise;
    exportLibraryPromise = new Promise((resolve, reject) => {
      const source = document.getElementById("jszipLoader")?.dataset.src;
      if (!source) {
        reject(new Error("导出组件地址缺失"));
        return;
      }
      const script = document.createElement("script");
      script.src = source;
      script.onload = () => window.JSZip ? resolve() : reject(new Error("导出组件未正确加载"));
      script.onerror = () => reject(new Error("导出组件加载失败，请检查网络后重试"));
      document.head.appendChild(script);
    });
    return exportLibraryPromise;
  }

  async function exportExcel() {
    const shipping = shippingValues();
    const lines = selectedLines();
    const selectedKeys = Object.entries(state.cart).filter(([, line]) => line.selected !== false).map(([key]) => key);
    elements.exportError.textContent = "";
    elements.orderSuccess.textContent = "";
    if (state.closed) {
      elements.exportError.textContent = "本次内购不在有效时间内，不能导出订单。";
      return;
    }
    if (!lines.length) {
      elements.exportError.textContent = "请至少勾选一件要下单的商品。";
      return;
    }
    const requiredFields = [
      ["buyerName", "收件人"],
      ["buyerPhone", "电话"],
      ["buyerProvince", "省（直辖市填 0）"],
      ["buyerCity", "市"],
      ["buyerDistrict", "区"],
      ["buyerAddress", "详细地址"],
    ];
    const missing = requiredFields.find(([key]) => !shipping[key]);
    if (missing) {
      elements.exportError.textContent = `请填写${missing[1]}。`;
      elements[missing[0]].focus();
      return;
    }
    saveShipping();
    elements.exportButton.disabled = true;
    elements.exportButton.textContent = "正在生成…";
    try {
      await ensureExportLibrary();
      const blob = await buildXlsx(shipping, lines);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      const date = new Date();
      const ymd = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;
      link.href = url;
      link.download = `内购下单表_${shipping.buyerName.replace(/[\\/:*?"<>|]/g, "_")}_${ymd}.xlsx`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 3000);
      saveOrderHistoryRecord("excel", shipping, lines);
      selectedKeys.forEach((key) => { delete state.cart[key]; });
      saveCart();
      renderCart();
      elements.orderSuccess.textContent = "Excel 已导出，本次勾选商品已从购物车移除。";
      showToast("已导出，勾选商品已清除");
    } catch (error) {
      elements.exportError.textContent = `导出失败：${error.message}`;
    } finally {
      elements.exportButton.disabled = false;
      elements.exportButton.textContent = "导出 Excel 选购清单";
    }
  }

  async function submitOrder() {
    const shipping = shippingValues();
    const lines = selectedLines();
    const selectedKeys = Object.entries(state.cart).filter(([, line]) => line.selected !== false).map(([key]) => key);
    elements.exportError.textContent = "";
    elements.orderSuccess.textContent = "";
    if (state.closed) {
      elements.exportError.textContent = "本次内购不在有效时间内，不能提交订单。";
      return;
    }
    if (!lines.length) {
      elements.exportError.textContent = "请至少勾选一件要下单的商品。";
      return;
    }
    const requiredFields = [
      ["buyerName", "收件人"], ["buyerPhone", "电话"], ["buyerProvince", "省（直辖市填 0）"],
      ["buyerCity", "市"], ["buyerDistrict", "区"], ["buyerAddress", "详细地址"],
    ];
    const missing = requiredFields.find(([key]) => !shipping[key]);
    if (missing) {
      elements.exportError.textContent = `请填写${missing[1]}。`;
      elements[missing[0]].focus();
      return;
    }
    const endpoint = state.campaign?.orderEndpoint;
    if (!endpoint) {
      elements.exportError.textContent = "当前分享版本未连接订单后台，请先导出 Excel 发给组织者。";
      return;
    }
    saveShipping();
    elements.submitOrderButton.disabled = true;
    elements.submitOrderButton.textContent = "正在提交…";
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          campaignId: state.campaign.id,
          shipping,
          lines: lines.map(({ sku, size, qty }) => ({ sku, size, qty })),
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message || "提交失败");
      saveOrderHistoryRecord("online", shipping, lines, payload.orderId);
      selectedKeys.forEach((key) => { delete state.cart[key]; });
      saveCart();
      renderCart();
      elements.orderSuccess.textContent = `订单已提交：${payload.orderId}（${payload.totalQty} 件，${money(payload.totalAmount)}）`;
      showToast("订单已提交给组织者");
    } catch (error) {
      elements.exportError.textContent = `提交失败：${error.message}`;
    } finally {
      elements.submitOrderButton.disabled = state.closed;
      elements.submitOrderButton.textContent = "提交订单给组织者";
    }
  }

  function textCell(ref, value, style = 0) {
    return `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
  }

  function numberCell(ref, value, style = 0) {
    return `<c r="${ref}" s="${style}"><v>${Number(value)}</v></c>`;
  }

  async function buildXlsx(shipping, lines) {
    const zip = new window.JSZip();
    const now = new Date().toISOString();
    const headers = ["款色号—清单B列", "尺码", "数量", "收件人", "电话", "省", "市", "区", "详细地址", "直辖市省那栏写0"];
    const rows = [];
    const finalRow = Math.max(46, lines.length + 2);
    rows.push(`<row r="1" ht="32" customHeight="1">${textCell("B1", "内购下单表", 1)}</row>`);
    rows.push(`<row r="2" ht="27" customHeight="1">${headers.map((header, index) => textCell(`${String.fromCharCode(66 + index)}2`, header, index === 9 ? 3 : 2)).join("")}</row>`);
    for (let row = 3; row <= finalRow; row += 1) {
      const line = lines[row - 3];
      const height = row <= 4 ? 50 : 21.5;
      if (line) {
        rows.push(`<row r="${row}" ht="${height}" customHeight="1">${[
          textCell(`B${row}`, line.sku, 4),
          textCell(`C${row}`, line.size, 4),
          numberCell(`D${row}`, line.qty, 4),
          textCell(`E${row}`, shipping.buyerName, 4),
          textCell(`F${row}`, shipping.buyerPhone, 4),
          textCell(`G${row}`, shipping.buyerProvince, 4),
          textCell(`H${row}`, shipping.buyerCity, 4),
          textCell(`I${row}`, shipping.buyerDistrict, 4),
          textCell(`J${row}`, shipping.buyerAddress, 5),
          row === 3 ? textCell(`K${row}`, "如上海，北京等", 6) : "",
        ].join("")}</row>`);
      } else {
        const blankCells = ["B", "C", "D", "E", "F", "G", "H", "I", "J"]
          .map((column) => textCell(`${column}${row}`, "", column === "J" ? 5 : 4))
          .join("");
        rows.push(`<row r="${row}" ht="${height}" customHeight="1">${blankCells}${row === 3 ? textCell(`K${row}`, "如上海，北京等", 6) : ""}</row>`);
      }
    }

    const worksheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <dimension ref="A1:K${finalRow}"/>
  <sheetViews><sheetView workbookViewId="0"/></sheetViews>
  <sheetFormatPr defaultRowHeight="21.5"/>
  <cols><col min="1" max="1" width="9" customWidth="1"/><col min="2" max="2" width="21" customWidth="1"/><col min="3" max="3" width="8" customWidth="1"/><col min="4" max="4" width="9" customWidth="1"/><col min="5" max="5" width="9" customWidth="1"/><col min="6" max="6" width="13" customWidth="1"/><col min="7" max="9" width="9" customWidth="1"/><col min="10" max="10" width="38" customWidth="1"/><col min="11" max="11" width="33" customWidth="1"/></cols>
  <sheetData>${rows.join("")}</sheetData>
  <mergeCells count="1"><mergeCell ref="B1:J1"/></mergeCells>
  <pageMargins left="0.4" right="0.4" top="0.5" bottom="0.5" header="0.2" footer="0.2"/>
</worksheet>`;

    const emptyWorksheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1"/><sheetViews><sheetView workbookViewId="0"/></sheetViews><sheetFormatPr defaultRowHeight="15"/><sheetData/></worksheet>`;

    const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="3">
    <font><sz val="11"/><name val="宋体"/><family val="3"/></font>
    <font><b/><sz val="22"/><name val="宋体"/><family val="3"/></font>
    <font><b/><sz val="11"/><name val="宋体"/><family val="3"/></font>
  </fonts>
  <fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFFF00"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFF0000"/><bgColor indexed="64"/></patternFill></fill></fills>
  <borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color auto="1"/></left><right style="thin"><color auto="1"/></right><top style="thin"><color auto="1"/></top><bottom style="thin"><color auto="1"/></bottom><diagonal/></border></borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="7">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="0" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="2" fillId="2" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="2" fillId="3" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="left" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
  </cellXfs>
  <cellStyles count="1"><cellStyle name="常规" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

    zip.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet3.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`);
    zip.folder("_rels").file(".rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`);
    zip.folder("docProps").file("core.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>内购选购清单</dc:title><dc:creator>内购选购网页</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`);
    zip.folder("docProps").file("app.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>内购选购网页</Application></Properties>`);
    zip.folder("xl").file("workbook.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView/></bookViews><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/><sheet name="Sheet2" sheetId="2" r:id="rId2"/><sheet name="Sheet3" sheetId="3" r:id="rId3"/></sheets><calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>`);
    zip.folder("xl").folder("_rels").file("workbook.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet3.xml"/><Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`);
    const worksheets = zip.folder("xl").folder("worksheets");
    worksheets.file("sheet1.xml", worksheet);
    worksheets.file("sheet2.xml", emptyWorksheet);
    worksheets.file("sheet3.xml", emptyWorksheet);
    zip.folder("xl").file("styles.xml", styles);
    return zip.generateAsync({ type: "blob", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", compression: "DEFLATE", compressionOptions: { level: 6 } });
  }

  elements.search.addEventListener("input", () => {
    state.query = elements.search.value;
    state.page = 1;
    elements.clearSearch.hidden = !state.query;
    applyFilters();
  });
  elements.clearSearch.addEventListener("click", () => {
    elements.search.value = "";
    state.query = "";
    elements.clearSearch.hidden = true;
    state.page = 1;
    applyFilters();
    elements.search.focus();
  });
  elements.filters.addEventListener("click", (event) => {
    const button = event.target.closest("[data-category]");
    if (!button) return;
    state.category = button.dataset.category;
    state.page = 1;
    renderFilters();
    applyFilters();
  });
  elements.sort.addEventListener("change", () => {
    state.sort = elements.sort.value;
    state.page = 1;
    applyFilters();
  });
  elements.grid.addEventListener("click", (event) => {
    const button = event.target.closest("[data-select-sku]");
    if (button) openProduct(button.dataset.selectSku);
  });
  elements.pagination.addEventListener("click", (event) => {
    const button = event.target.closest("[data-page]");
    if (!button || button.disabled) return;
    state.page = Number(button.dataset.page);
    renderProducts();
    renderPagination();
    $("#catalogTitle").scrollIntoView({ behavior: "smooth", block: "start" });
  });
  elements.reset.addEventListener("click", () => {
    state.query = "";
    state.category = "全部";
    state.page = 1;
    elements.search.value = "";
    elements.clearSearch.hidden = true;
    renderFilters();
    applyFilters();
  });
  elements.productModal.addEventListener("click", (event) => {
    if (event.target.closest("[data-close-modal]")) closeProduct();
    const sizeButton = event.target.closest("[data-size]");
    if (sizeButton) {
      state.selectedSize = sizeButton.dataset.size;
      state.modalQty = 1;
      renderProductModal();
    }
    const qtyButton = event.target.closest("[data-modal-qty]");
    if (qtyButton) {
      state.modalQty += Number(qtyButton.dataset.modalQty);
      renderProductModal();
    }
    if (event.target.closest("[data-add-to-cart]")) addSelectedToCart();
  });
  elements.productModal.addEventListener("input", (event) => {
    if (event.target.id !== "modalQty") return;
    const size = state.selectedItem?.sizes.find((candidate) => candidate.size === state.selectedSize);
    const limit = stockLimit(size?.stock);
    state.modalQty = limit === null ? Math.max(1, Number(event.target.value) || 1) : Math.max(1, Math.min(Number(event.target.value) || 1, limit));
    renderProductModal();
  });
  elements.cartItems.addEventListener("click", (event) => {
    const remove = event.target.closest("[data-remove-key]");
    if (remove) {
      delete state.cart[remove.dataset.removeKey];
      saveCart();
      renderCart();
      return;
    }
    const qty = event.target.closest("[data-cart-key]");
    if (qty) changeCartQty(qty.dataset.cartKey, state.cart[qty.dataset.cartKey].qty + Number(qty.dataset.cartDelta));
  });
  elements.cartItems.addEventListener("change", (event) => {
    if (event.target.matches("[data-cart-input]")) changeCartQty(event.target.dataset.cartInput, event.target.value);
    if (event.target.matches("[data-cart-selected]")) setLineSelected(event.target.dataset.cartSelected, event.target.checked);
  });
  elements.selectAllCart.addEventListener("change", () => {
    Object.values(state.cart).forEach((line) => { line.selected = elements.selectAllCart.checked; });
    saveCart();
    renderCart();
  });
  elements.cartButton.addEventListener("click", openCart);
  elements.historyButton.addEventListener("click", openHistory);
  elements.mobileCartButton.addEventListener("click", openCart);
  elements.closeCart.addEventListener("click", closeCart);
  elements.closeHistory.addEventListener("click", closeHistory);
  elements.backdrop.addEventListener("click", () => {
    closeProduct();
    closeCart();
    closeHistory();
  });
  window.addEventListener("popstate", () => {
    if (!elements.productModal.hidden) closeProduct(true);
    if (elements.cartPanel.classList.contains("open")) closeCart(true);
    if (!elements.historyModal.hidden) closeHistory(true);
  });
  shippingInputs.forEach((key) => {
    elements[key].addEventListener("input", () => {
      elements.exportError.textContent = "";
      saveShipping();
    });
  });
  elements.addressSelect.addEventListener("change", () => {
    selectSavedAddress(elements.addressSelect.value);
    elements.deleteAddressButton.disabled = !elements.addressSelect.value;
  });
  elements.saveAddressButton.addEventListener("click", saveCurrentAddress);
  elements.deleteAddressButton.addEventListener("click", deleteSelectedAddress);
  elements.exportButton.addEventListener("click", exportExcel);
  elements.submitOrderButton.addEventListener("click", submitOrder);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeProduct();
      closeCart();
      closeHistory();
    }
  });

  renderAddressBook();
  renderOrderHistory();
  init();
})();
