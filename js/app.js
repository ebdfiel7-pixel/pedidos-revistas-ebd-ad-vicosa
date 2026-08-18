(() => {
  'use strict';

  const state = {
    boot: null,
    quantities: {},
    currentStep: 1,
    existingOrder: null,
    isSubmitting: false
  };

  const el = id => document.getElementById(id);
  const $all = selector => Array.from(document.querySelectorAll(selector));

  document.addEventListener('DOMContentLoaded', init);

  async function init() {
    bindEvents();
    registerServiceWorker();

    const url = getApiUrl();
    if (!url) {
      showOnly('setupView');
      return;
    }

    try {
      const boot = await jsonp('bootstrap');
      if (!boot || boot.ok !== true) throw new Error(boot?.message || 'Não foi possível carregar o sistema.');
      state.boot = boot;
      state.quantities = {};
      renderBoot();
    } catch (error) {
      console.error(error);
      showOnly('setupView');
      el('setupView').querySelector('h1').textContent = 'Não foi possível conectar';
      el('setupView').querySelector('p').textContent = 'Verifique a publicação do Google Apps Script e tente novamente.';
    }
  }

  function getApiUrl() {
    const value = String(window.APP_CONFIG?.GAS_WEB_APP_URL || '').trim();
    if (!value || value.includes('COLE_AQUI')) return '';
    return value.replace(/\/$/, '');
  }

  function bindEvents() {
    el('goProductsBtn').addEventListener('click', () => {
      if (!validateIdentification()) return;
      goToStep(2);
    });

    el('goReviewBtn').addEventListener('click', () => {
      if (getTotal() <= 0) {
        toast('Informe pelo menos uma quantidade antes de continuar.', true);
        return;
      }
      renderReview();
      goToStep(3);
    });

    el('submitBtn').addEventListener('click', submitOrder);
    el('newOrderBtn').addEventListener('click', resetApp);
    el('unitSelect').addEventListener('change', loadExistingOrder);
    el('phoneInput').addEventListener('input', event => {
      event.target.value = formatPhone(event.target.value);
    });

    $all('[data-back]').forEach(button => {
      button.addEventListener('click', () => goToStep(Number(button.dataset.back)));
    });
  }

  function renderBoot() {
    const { configuracao, unidades, produtos } = state.boot;

    el('periodLabel').textContent = `${ordinal(configuracao.trimestre)} Trimestre de ${configuracao.ano}`;
    el('reviewPeriod').textContent = el('periodLabel').textContent;

    if (configuracao.dataLimite) {
      el('deadlineWrap').classList.remove('hidden');
      el('deadlineLabel').textContent = formatDate(configuracao.dataLimite);
    }

    const select = el('unitSelect');
    select.innerHTML = '<option value="">Selecione...</option>' + unidades
      .map(unit => `<option value="${escapeHtml(unit.id)}">${escapeHtml(unit.nome)}</option>`)
      .join('');

    produtos.forEach(product => { state.quantities[product.id] = 0; });
    renderCatalog(produtos);

    if (!configuracao.pedidosAbertos) {
      el('closedMessage').textContent = configuracao.dataLimite
        ? `O período de pedidos do ${ordinal(configuracao.trimestre)} trimestre de ${configuracao.ano} está encerrado.`
        : 'O período de pedidos está fechado pela Superintendência da EBD.';
      showOnly('closedView');
      return;
    }

    el('loadingView').classList.add('hidden');
    el('appView').classList.remove('hidden');
    goToStep(1);
  }

  function renderCatalog(products) {
    const groups = new Map();
    products.forEach(product => {
      if (!groups.has(product.categoria)) groups.set(product.categoria, []);
      groups.get(product.categoria).push(product);
    });

    const container = el('catalogContainer');
    container.innerHTML = '';

    groups.forEach((items, category) => {
      const section = document.createElement('section');
      section.className = 'category-card';
      section.innerHTML = `<h2 class="category-title">${escapeHtml(category)}</h2>`;

      items.forEach(product => {
        const row = document.createElement('div');
        row.className = 'product-row';
        row.innerHTML = `
          <div class="product-name">${escapeHtml(product.nome)}</div>
          <div class="qty-control" aria-label="Quantidade de ${escapeHtml(product.nome)}">
            <button type="button" class="qty-btn" data-delta="-1" data-product="${escapeHtml(product.id)}" aria-label="Diminuir">−</button>
            <input class="qty-input" type="number" min="0" max="9999" step="1" inputmode="numeric" value="0" data-product="${escapeHtml(product.id)}" aria-label="Quantidade">
            <button type="button" class="qty-btn" data-delta="1" data-product="${escapeHtml(product.id)}" aria-label="Aumentar">+</button>
          </div>`;
        section.appendChild(row);
      });

      container.appendChild(section);
    });

    container.addEventListener('click', event => {
      const button = event.target.closest('.qty-btn');
      if (!button) return;
      const id = button.dataset.product;
      const delta = Number(button.dataset.delta);
      setQuantity(id, Number(state.quantities[id] || 0) + delta);
    });

    container.addEventListener('input', event => {
      if (!event.target.matches('.qty-input')) return;
      const id = event.target.dataset.product;
      setQuantity(id, event.target.value, false);
    });
  }

  async function loadExistingOrder() {
    const unitId = el('unitSelect').value;
    state.existingOrder = null;
    el('existingOrderBanner').classList.add('hidden');

    if (!unitId || !state.boot) return;

    try {
      const response = await jsonp('pedido', {
        unidadeId: unitId,
        ano: state.boot.configuracao.ano,
        trimestre: state.boot.configuracao.trimestre
      });

      if (!response?.ok || !response?.pedido) return;

      state.existingOrder = response.pedido;
      el('responsibleInput').value = response.pedido.responsavel || '';
      el('phoneInput').value = response.pedido.telefone || '';

      Object.keys(state.quantities).forEach(id => { state.quantities[id] = 0; });
      (response.pedido.itens || []).forEach(item => {
        if (Object.prototype.hasOwnProperty.call(state.quantities, item.produtoId)) {
          state.quantities[item.produtoId] = Number(item.quantidade) || 0;
        }
      });
      syncQuantityInputs();
      el('existingOrderBanner').classList.remove('hidden');
    } catch (error) {
      console.warn('Não foi possível consultar pedido existente:', error);
    }
  }

  function setQuantity(productId, rawValue, updateInput = true) {
    let value = parseInt(rawValue, 10);
    if (!Number.isFinite(value) || value < 0) value = 0;
    if (value > 9999) value = 9999;
    state.quantities[productId] = value;

    if (updateInput) {
      const input = document.querySelector(`.qty-input[data-product="${cssEscape(productId)}"]`);
      if (input) input.value = value;
    }
    updateRunningTotal();
  }

  function syncQuantityInputs() {
    $all('.qty-input').forEach(input => {
      input.value = state.quantities[input.dataset.product] || 0;
    });
    updateRunningTotal();
  }

  function updateRunningTotal() {
    el('runningTotal').textContent = String(getTotal());
  }

  function getTotal() {
    return Object.values(state.quantities).reduce((sum, value) => sum + (Number(value) || 0), 0);
  }

  function validateIdentification() {
    const unit = el('unitSelect').value;
    const responsible = el('responsibleInput').value.trim();
    const phone = el('phoneInput').value.trim();

    if (!unit) {
      toast('Selecione a Sede ou a congregação.', true);
      el('unitSelect').focus();
      return false;
    }
    if (responsible.length < 3) {
      toast('Informe o nome do responsável pelo pedido.', true);
      el('responsibleInput').focus();
      return false;
    }
    if (phone.replace(/\D/g, '').length < 10) {
      toast('Informe um telefone/WhatsApp válido.', true);
      el('phoneInput').focus();
      return false;
    }
    return true;
  }

  function renderReview() {
    const unit = state.boot.unidades.find(item => item.id === el('unitSelect').value);
    el('reviewUnit').textContent = unit?.nome || '—';
    el('reviewResponsible').textContent = el('responsibleInput').value.trim();
    el('reviewPhone').textContent = el('phoneInput').value.trim();
    el('reviewPeriod').textContent = el('periodLabel').textContent;

    const rows = state.boot.produtos
      .filter(product => Number(state.quantities[product.id] || 0) > 0)
      .map(product => `
        <tr>
          <td>${escapeHtml(product.nome)}</td>
          <td>${Number(state.quantities[product.id])}</td>
        </tr>`)
      .join('');

    el('reviewBody').innerHTML = rows;
    el('reviewTotal').textContent = String(getTotal());
  }

  async function submitOrder() {
    if (state.isSubmitting) return;
    if (!validateIdentification() || getTotal() <= 0) return;

    state.isSubmitting = true;
    const button = el('submitBtn');
    const originalText = button.textContent;
    button.disabled = true;
    button.textContent = 'Enviando...';

    const requestId = createRequestId();
    const payload = {
      action: 'salvarPedido',
      requestId,
      unidadeId: el('unitSelect').value,
      responsavel: el('responsibleInput').value.trim(),
      telefone: el('phoneInput').value.trim(),
      ano: state.boot.configuracao.ano,
      trimestre: state.boot.configuracao.trimestre,
      itens: state.boot.produtos
        .map(product => ({ produtoId: product.id, quantidade: Number(state.quantities[product.id] || 0) }))
        .filter(item => item.quantidade > 0)
    };

    try {
      await fetch(getApiUrl(), {
        method: 'POST',
        mode: 'no-cors',
        cache: 'no-store',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(payload)
      });

      const confirmation = await waitForConfirmation(requestId);
      if (!confirmation?.ok || !confirmation?.found) {
        throw new Error('O servidor não confirmou o recebimento do pedido.');
      }

      showSuccess(confirmation);
    } catch (error) {
      console.error(error);
      toast('Não foi possível confirmar o envio. Verifique sua internet e tente novamente.', true);
    } finally {
      state.isSubmitting = false;
      button.disabled = false;
      button.textContent = originalText;
    }
  }

  async function waitForConfirmation(requestId) {
    let lastError = null;
    for (let attempt = 0; attempt < 10; attempt += 1) {
      if (attempt > 0) await sleep(700);
      try {
        const response = await jsonp('status', { requestId }, 7000);
        if (response?.ok && response?.found) return response;
      } catch (error) {
        lastError = error;
      }
    }
    if (lastError) throw lastError;
    return null;
  }

  function showSuccess(confirmation) {
    $all('.step-panel').forEach(panel => panel.classList.add('hidden'));
    el('successView').classList.remove('hidden');
    el('protocolLabel').textContent = confirmation.protocolo || '—';
    el('successSummary').innerHTML = `
      <strong>${escapeHtml(confirmation.unidade || el('reviewUnit').textContent)}</strong><br>
      ${escapeHtml(el('periodLabel').textContent)}<br>
      Total: <strong>${getTotal()} exemplares</strong>`;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function resetApp() {
    state.existingOrder = null;
    Object.keys(state.quantities).forEach(id => { state.quantities[id] = 0; });
    syncQuantityInputs();
    el('unitSelect').value = '';
    el('responsibleInput').value = '';
    el('phoneInput').value = '';
    el('existingOrderBanner').classList.add('hidden');
    el('successView').classList.add('hidden');
    goToStep(1);
  }

  function goToStep(stepNumber) {
    state.currentStep = stepNumber;
    [1, 2, 3].forEach(step => {
      el(`step${step}`).classList.toggle('hidden', step !== stepNumber);
    });
    el('successView').classList.add('hidden');

    $all('.step').forEach(button => {
      const step = Number(button.dataset.step);
      button.classList.toggle('active', step === stepNumber);
      button.classList.toggle('done', step < stepNumber);
    });

    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function showOnly(viewId) {
    ['loadingView', 'setupView', 'closedView', 'appView'].forEach(id => {
      el(id).classList.toggle('hidden', id !== viewId);
    });
  }

  function jsonp(action, params = {}, timeoutMs = 10000) {
    return new Promise((resolve, reject) => {
      const callbackName = `__ebd_cb_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      const script = document.createElement('script');
      const query = new URLSearchParams({ action, callback: callbackName, ...stringifyParams(params), _: String(Date.now()) });
      const timer = setTimeout(() => cleanup(new Error('Tempo de conexão esgotado.')), timeoutMs);

      function cleanup(error, data) {
        clearTimeout(timer);
        delete window[callbackName];
        script.remove();
        error ? reject(error) : resolve(data);
      }

      window[callbackName] = data => cleanup(null, data);
      script.onerror = () => cleanup(new Error('Falha ao conectar ao Google Apps Script.'));
      script.src = `${getApiUrl()}?${query.toString()}`;
      document.body.appendChild(script);
    });
  }

  function stringifyParams(params) {
    const result = {};
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null) result[key] = String(value);
    });
    return result;
  }

  function formatPhone(value) {
    const digits = String(value || '').replace(/\D/g, '').slice(0, 11);
    if (digits.length <= 2) return digits;
    if (digits.length <= 6) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
    if (digits.length <= 10) return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
  }

  function formatDate(value) {
    const date = new Date(`${value}T12:00:00`);
    if (Number.isNaN(date.getTime())) return value;
    return new Intl.DateTimeFormat('pt-BR').format(date);
  }

  function ordinal(number) {
    const n = Number(number) || 0;
    return `${n}º`;
  }

  function createRequestId() {
    if (window.crypto?.randomUUID) return crypto.randomUUID();
    return `req-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }

  function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

  function escapeHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function cssEscape(value) {
    if (window.CSS?.escape) return CSS.escape(value);
    return String(value).replace(/[^a-zA-Z0-9_-]/g, '\\$&');
  }

  function toast(message, isError = false) {
    const node = el('toast');
    node.textContent = message;
    node.classList.remove('hidden', 'error');
    if (isError) node.classList.add('error');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => node.classList.add('hidden'), 3800);
  }

  function registerServiceWorker() {
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js').catch(error => console.warn('Service Worker:', error));
      });
    }
  }
})();
