(() => {
  'use strict';

  const SUPERINTENDENCIA_WHATSAPP = '5531988636425';
  const ADMIN_TOKEN_KEY = 'pedidosEbdAdminToken';

  const state = {
    boot: null,
    quantities: {},
    currentStep: 1,
    existingOrder: null,
    isSubmitting: false,
    admin: {
      token: readSessionToken(),
      dashboard: null,
      filter: 'all',
      returnView: 'appView',
      isBusy: false
    }
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

    el('adminAccessBtn').addEventListener('click', openAdmin);
    el('backToOrdersBtn').addEventListener('click', () => window.location.reload());
    el('adminLoginForm').addEventListener('submit', adminLogin);
    el('adminRefreshBtn').addEventListener('click', loadAdminDashboard);
    el('adminLogoutBtn').addEventListener('click', adminLogout);
    el('adminUnitFilter').addEventListener('change', event => {
      state.admin.filter = event.target.value;
      renderAdminUnitList();
    });
    el('copyPendingBtn').addEventListener('click', copyPendingMessage);
    el('toggleOrdersBtn').addEventListener('click', toggleOrdersStatus);
    el('adminUnitList').addEventListener('click', event => {
      const row = event.target.closest('[data-admin-unit]');
      if (row) openAdminOrder(row.dataset.adminUnit);
    });
    el('adminOrderModalClose').addEventListener('click', closeAdminOrderModal);
    el('adminOrderModal').addEventListener('click', event => {
      if (event.target === el('adminOrderModal')) closeAdminOrderModal();
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

    const protocolo = confirmation.protocolo || '—';
    const unidade = confirmation.unidade || el('reviewUnit').textContent || '—';
    const periodo = el('periodLabel').textContent;
    const responsavel = el('responsibleInput').value.trim();
    const telefone = el('phoneInput').value.trim();
    const itens = getSelectedItems();
    const total = getTotal();

    el('protocolLabel').textContent = protocolo;
    el('successSummary').innerHTML = `
      <strong>${escapeHtml(unidade)}</strong><br>
      ${escapeHtml(periodo)}<br>
      Total: <strong>${total} exemplares</strong>`;

    el('successOrderItems').innerHTML = itens
      .map(item => `
        <div class="success-order-row">
          <span>${escapeHtml(item.nome)}</span>
          <strong>${item.quantidade}</strong>
        </div>`)
      .join('');
    el('successOrderTotal').textContent = String(total);

    const mensagem = buildWhatsAppMessage({
      protocolo,
      unidade,
      periodo,
      responsavel,
      telefone,
      itens,
      total
    });
    el('whatsappBtn').href = `https://wa.me/${SUPERINTENDENCIA_WHATSAPP}?text=${encodeURIComponent(mensagem)}`;

    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function getSelectedItems() {
    if (!state.boot?.produtos) return [];
    return state.boot.produtos
      .map(product => ({
        nome: product.nome,
        quantidade: Number(state.quantities[product.id] || 0)
      }))
      .filter(item => item.quantidade > 0);
  }

  function buildWhatsAppMessage({ protocolo, unidade, periodo, responsavel, telefone, itens, total }) {
    const linhasItens = itens.map(item => `${item.quantidade}x ${item.nome}`).join('\n');
    return [
      '*PEDIDO DE REVISTAS EBD*',
      '',
      `Congregação/Unidade: ${unidade}`,
      `Protocolo: ${protocolo}`,
      `Período: ${periodo}`,
      `Responsável: ${responsavel}`,
      `Telefone: ${telefone}`,
      '',
      '*Itens solicitados:*',
      linhasItens,
      '',
      `*Total: ${total} exemplares*`,
      '',
      'Pedido registrado pelo aplicativo Pedidos de Revistas EBD - AD Viçosa.'
    ].join('\n');
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

  async function openAdmin() {
    const currentPublicView = ['loadingView', 'setupView', 'closedView', 'appView']
      .find(id => !el(id).classList.contains('hidden'));
    if (currentPublicView) state.admin.returnView = currentPublicView;

    showOnly('adminView');
    closeAdminOrderModal();

    if (state.admin.token) {
      await loadAdminDashboard();
    } else {
      showAdminLogin();
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function showAdminLogin(message = '') {
    el('adminLoginPanel').classList.remove('hidden');
    el('adminDashboardPanel').classList.add('hidden');
    el('adminPasswordInput').value = '';
    if (message) toast(message, true);
    setTimeout(() => el('adminPasswordInput').focus(), 50);
  }

  async function adminLogin(event) {
    event.preventDefault();
    if (state.admin.isBusy) return;

    const password = el('adminPasswordInput').value;
    if (password.length < 8) {
      toast('Digite a senha do painel com pelo menos 8 caracteres.', true);
      return;
    }

    state.admin.isBusy = true;
    const button = el('adminLoginBtn');
    const originalText = button.textContent;
    button.disabled = true;
    button.textContent = 'Entrando...';

    const requestId = createRequestId();
    try {
      await postNoCors({ action: 'adminLogin', requestId, password });
      const result = await waitForAdminResult('adminLoginStatus', requestId);
      if (!result?.ok || !result?.token) throw new Error(result?.message || 'Senha inválida.');

      state.admin.token = result.token;
      writeSessionToken(result.token);
      el('adminPasswordInput').value = '';
      state.admin.isBusy = false;
      await loadAdminDashboard();
    } catch (error) {
      console.error(error);
      toast(error.message || 'Não foi possível acessar o painel.', true);
    } finally {
      state.admin.isBusy = false;
      button.disabled = false;
      button.textContent = originalText;
    }
  }

  async function loadAdminDashboard() {
    if (!state.admin.token || state.admin.isBusy) {
      if (!state.admin.token) showAdminLogin();
      return;
    }

    state.admin.isBusy = true;
    try {
      const result = await jsonp('adminDashboard', { token: state.admin.token }, 12000);
      if (!result?.ok) {
        if (result?.code === 'ADMIN_SESSION_INVALID') {
          clearAdminToken();
          showAdminLogin('Sua sessão administrativa expirou. Entre novamente.');
          return;
        }
        throw new Error(result?.message || 'Não foi possível carregar o painel.');
      }

      state.admin.dashboard = result;
      el('adminLoginPanel').classList.add('hidden');
      el('adminDashboardPanel').classList.remove('hidden');
      renderAdminDashboard();
    } catch (error) {
      console.error(error);
      toast(error.message || 'Não foi possível atualizar o painel.', true);
    } finally {
      state.admin.isBusy = false;
    }
  }

  function renderAdminDashboard() {
    const data = state.admin.dashboard;
    if (!data) return;

    const p = data.periodo;
    const periodoLabel = `${ordinal(p.trimestre)} Trimestre de ${p.ano}`;
    el('adminPeriodLabel').textContent = periodoLabel;
    el('metricUnits').textContent = String(data.metricas.unidades);
    el('metricReceived').textContent = String(data.metricas.recebidos);
    el('metricPending').textContent = String(data.metricas.pendentes);
    el('metricCopies').textContent = String(data.metricas.exemplares);

    el('adminOpenStatus').textContent = p.pedidosAbertos ? 'Pedidos abertos' : 'Pedidos fechados';
    el('adminDeadlineText').textContent = p.dataLimite
      ? `Prazo configurado: ${formatDate(p.dataLimite)}`
      : 'Nenhuma data-limite foi definida.';
    el('toggleOrdersBtn').textContent = p.pedidosAbertos ? 'Fechar pedidos' : 'Abrir pedidos';
    el('toggleOrdersBtn').dataset.nextOpen = p.pedidosAbertos ? 'false' : 'true';

    renderAdminUnitList();
    renderPendingList();
    renderAdminBetelSummary();
  }

  function renderAdminUnitList() {
    const data = state.admin.dashboard;
    if (!data) return;

    const filter = state.admin.filter;
    const rows = data.unidades.filter(unit => {
      if (filter === 'sent') return unit.enviado;
      if (filter === 'pending') return !unit.enviado;
      return true;
    });

    el('adminUnitList').innerHTML = rows.map(unit => {
      const tag = unit.enviado
        ? '<span class="status-badge sent">✓ Enviado</span>'
        : '<span class="status-badge pending">⏳ Pendente</span>';
      const meta = unit.enviado
        ? `${escapeHtml(unit.responsavel || 'Responsável não informado')} • ${escapeHtml(formatDateTime(unit.atualizadoEm))}`
        : 'Nenhum pedido registrado neste trimestre';
      const inner = `
        <div class="admin-unit-main">
          <div class="admin-unit-name">${escapeHtml(unit.nome)}</div>
          <div class="admin-unit-meta">${meta}</div>
        </div>
        <div class="admin-unit-side">
          ${tag}
          <span class="admin-unit-total">${unit.enviado ? `${Number(unit.total || 0)} exemplares` : '—'}</span>
        </div>`;
      return unit.enviado
        ? `<button class="admin-unit-row" type="button" data-admin-unit="${escapeHtml(unit.id)}">${inner}</button>`
        : `<div class="admin-unit-row">${inner}</div>`;
    }).join('') || '<div class="pending-empty">Nenhuma unidade neste filtro.</div>';
  }

  function renderPendingList() {
    const data = state.admin.dashboard;
    if (!data) return;
    const pending = data.unidades.filter(unit => !unit.enviado);
    const container = el('adminPendingList');
    if (!pending.length) {
      container.innerHTML = '<div class="pending-empty">Todas as unidades já enviaram o pedido.</div>';
      el('copyPendingBtn').disabled = true;
      return;
    }
    container.innerHTML = pending.map(unit => `<span class="pending-chip">${escapeHtml(unit.nome)}</span>`).join('');
    el('copyPendingBtn').disabled = false;
  }

  function renderAdminBetelSummary() {
    const data = state.admin.dashboard;
    if (!data) return;
    el('adminBetelBody').innerHTML = data.resumoBetel.map(item => {
      const qtd = Number(item.quantidade || 0);
      return `
        <tr>
          <td>${escapeHtml(item.produto)}</td>
          <td>${escapeHtml(item.categoria)}</td>
          <td>${escapeHtml(item.codigo || '—')}</td>
          <td class="${qtd > 0 ? 'positive' : 'zero'}">${qtd}</td>
        </tr>`;
    }).join('');
    el('adminBetelTotal').textContent = String(data.metricas.exemplares || 0);
  }

  async function openAdminOrder(unitId) {
    if (!state.admin.token) return;
    try {
      const result = await jsonp('adminPedido', { token: state.admin.token, unidadeId: unitId }, 10000);
      if (!result?.ok) {
        if (result?.code === 'ADMIN_SESSION_INVALID') {
          clearAdminToken();
          showAdminLogin('Sua sessão administrativa expirou. Entre novamente.');
          return;
        }
        throw new Error(result?.message || 'Não foi possível abrir o pedido.');
      }
      const order = result.pedido;
      if (!order) {
        toast('Esta unidade ainda não possui pedido no período atual.', true);
        return;
      }

      el('adminOrderModalTitle').textContent = order.unidade;
      el('adminOrderMeta').innerHTML = `
        <div><span>Protocolo</span><strong>${escapeHtml(order.protocolo)}</strong></div>
        <div><span>Responsável</span><strong>${escapeHtml(order.responsavel || '—')}</strong></div>
        <div><span>Telefone</span><strong>${escapeHtml(order.telefone || '—')}</strong></div>
        <div><span>Atualizado em</span><strong>${escapeHtml(formatDateTime(order.atualizadoEm))}</strong></div>`;
      el('adminOrderItems').innerHTML = order.itens.map(item => `
        <tr>
          <td>${escapeHtml(item.produto)}</td>
          <td>${escapeHtml(item.codigo || '—')}</td>
          <td class="positive">${Number(item.quantidade || 0)}</td>
        </tr>`).join('');
      el('adminOrderTotal').textContent = String(order.total || 0);
      el('adminOrderModal').classList.remove('hidden');
      document.body.style.overflow = 'hidden';
    } catch (error) {
      console.error(error);
      toast(error.message || 'Não foi possível abrir os detalhes.', true);
    }
  }

  function closeAdminOrderModal() {
    const modal = el('adminOrderModal');
    if (modal) modal.classList.add('hidden');
    document.body.style.overflow = '';
  }

  async function copyPendingMessage() {
    const data = state.admin.dashboard;
    if (!data) return;
    const pending = data.unidades.filter(unit => !unit.enviado).map(unit => unit.nome);
    if (!pending.length) {
      toast('Não há unidades pendentes.');
      return;
    }
    const periodo = `${ordinal(data.periodo.trimestre)} Trimestre de ${data.periodo.ano}`;
    const deadline = data.periodo.dataLimite ? ` O prazo é ${formatDate(data.periodo.dataLimite)}.` : '';
    const message = [
      '*PEDIDOS DE REVISTAS EBD*',
      '',
      `Prezados responsáveis pela EBD, ainda não identificamos o envio do pedido de revistas do ${periodo}.${deadline}`,
      '',
      '*Unidades pendentes:*',
      ...pending.map(name => `• ${name}`),
      '',
      'Pedimos a gentileza de realizar o pedido dentro do prazo estabelecido.'
    ].join('\n');

    try {
      await copyText(message);
      toast('Mensagem de cobrança copiada.');
    } catch (error) {
      console.error(error);
      toast('Não foi possível copiar a mensagem.', true);
    }
  }

  async function toggleOrdersStatus() {
    const data = state.admin.dashboard;
    if (!data || state.admin.isBusy) return;
    const nextOpen = el('toggleOrdersBtn').dataset.nextOpen === 'true';
    const verb = nextOpen ? 'abrir' : 'fechar';
    if (!window.confirm(`Deseja realmente ${verb} os pedidos do período atual?`)) return;

    state.admin.isBusy = true;
    const button = el('toggleOrdersBtn');
    const originalText = button.textContent;
    button.disabled = true;
    button.textContent = 'Atualizando...';
    const requestId = createRequestId();

    try {
      await postNoCors({
        action: 'adminAlterarPedidos',
        requestId,
        token: state.admin.token,
        aberto: nextOpen
      });
      const result = await waitForAdminResult('adminActionStatus', requestId);
      if (!result?.ok) throw new Error(result?.message || 'Não foi possível alterar o período.');
      state.admin.isBusy = false;
      await loadAdminDashboard();
      toast(nextOpen ? 'Pedidos abertos com sucesso.' : 'Pedidos fechados com sucesso.');
    } catch (error) {
      console.error(error);
      toast(error.message || 'Não foi possível alterar o período.', true);
    } finally {
      state.admin.isBusy = false;
      button.disabled = false;
      if (button.textContent === 'Atualizando...') button.textContent = originalText;
    }
  }

  function adminLogout() {
    clearAdminToken();
    state.admin.dashboard = null;
    showAdminLogin();
    toast('Sessão administrativa encerrada.');
  }

  function clearAdminToken() {
    state.admin.token = '';
    try { sessionStorage.removeItem(ADMIN_TOKEN_KEY); } catch (_) {}
  }

  function readSessionToken() {
    try { return sessionStorage.getItem(ADMIN_TOKEN_KEY) || ''; } catch (_) { return ''; }
  }

  function writeSessionToken(token) {
    try { sessionStorage.setItem(ADMIN_TOKEN_KEY, token); } catch (_) {}
  }

  async function postNoCors(payload) {
    await fetch(getApiUrl(), {
      method: 'POST',
      mode: 'no-cors',
      cache: 'no-store',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload)
    });
  }

  async function waitForAdminResult(action, requestId) {
    let lastResult = null;
    for (let attempt = 0; attempt < 12; attempt += 1) {
      if (attempt > 0) await sleep(500);
      try {
        const result = await jsonp(action, { requestId }, 7000);
        lastResult = result;
        if (result?.ready) return result;
      } catch (_) {}
    }
    if (lastResult?.message) throw new Error(lastResult.message);
    throw new Error('O servidor não confirmou a operação administrativa.');
  }

  async function copyText(text) {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    if (!ok) throw new Error('Falha ao copiar.');
  }

  function formatDateTime(value) {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return new Intl.DateTimeFormat('pt-BR', {
      dateStyle: 'short',
      timeStyle: 'short'
    }).format(date);
  }

  function showOnly(viewId) {
    ['loadingView', 'setupView', 'closedView', 'appView', 'adminView'].forEach(id => {
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
