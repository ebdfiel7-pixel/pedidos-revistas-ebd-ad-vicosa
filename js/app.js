(() => {
  'use strict';

  const SUPERINTENDENCIA_WHATSAPP = '5531988636425';
  const ADMIN_TOKEN_KEY = 'pedidosEbdAdminToken';

  const state = {
    boot: null,
    quantities: {},
    currentStep: 1,
    existingOrder: null,
    editProtocol: '',
    unitHasExistingOrder: false,
    isSubmitting: false,
    lastSubmittedOrder: null,
    admin: {
      token: readSessionToken(),
      dashboard: null,
      filter: 'all',
      periodoSelecionado: '',
      returnView: 'appView',
      currentOrder: null,
      isBusy: false,
      pricesDirty: false
    }
  };

  const el = id => document.getElementById(id);
  const $all = selector => Array.from(document.querySelectorAll(selector));

  document.addEventListener('DOMContentLoaded', () => { initSplash(); init(); });

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


  function initSplash() {
    const splash = el('splashScreen');
    if (!splash) return;

    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
    const minimumTime = reduceMotion ? 300 : 1650;
    const startedAt = performance.now();

    const dismiss = () => {
      const elapsed = performance.now() - startedAt;
      const wait = Math.max(0, minimumTime - elapsed);
      window.setTimeout(() => {
        document.body.classList.remove('splash-active');
        splash.classList.add('splash-leaving');
        window.setTimeout(() => splash.remove(), reduceMotion ? 100 : 650);
      }, wait);
    };

    if (document.readyState === 'complete') dismiss();
    else window.addEventListener('load', dismiss, { once: true });

    // Segurança: nunca mantenha a tela de abertura presa por falha de rede.
    window.setTimeout(dismiss, reduceMotion ? 600 : 2600);
  }

  function getApiUrl() {
    const value = String(window.APP_CONFIG?.GAS_WEB_APP_URL || '').trim();
    if (!value || value.includes('COLE_AQUI')) return '';
    return value.replace(/\/$/, '');
  }

  function bindEvents() {
    el('goProductsBtn').addEventListener('click', continueFromIdentification);

    el('goReviewBtn').addEventListener('click', () => {
      if (getTotal() <= 0) {
        toast('Informe pelo menos uma quantidade antes de continuar.', true);
        return;
      }
      renderReview();
      goToStep(3);
    });

    el('submitBtn').addEventListener('click', submitOrder);
    el('sharePdfBtn').addEventListener('click', shareLastOrderPdf);
    el('newOrderBtn').addEventListener('click', () => returnToHome({ skipConfirm: true }));
    el('homeLogoBtn').addEventListener('click', returnToHome);
    $all('[data-home]').forEach(button => button.addEventListener('click', returnToHome));
    el('openEditOrderBtn').addEventListener('click', openEditOrderPanel);
    el('cancelEditOrderBtn').addEventListener('click', cancelEditOrder);
    el('findEditOrderBtn').addEventListener('click', findOrderByProtocol);
    el('editProtocolInput').addEventListener('input', event => {
      event.target.value = String(event.target.value || '').toUpperCase().replace(/\s+/g, '');
    });
    el('editProtocolInput').addEventListener('keydown', event => {
      if (event.key === 'Enter') {
        event.preventDefault();
        findOrderByProtocol();
      }
    });
    el('unitSelect').addEventListener('change', () => checkExistingOrderForUnit());
    el('phoneInput').addEventListener('input', event => {
      event.target.value = formatPhone(event.target.value);
    });

    $all('[data-back]').forEach(button => {
      button.addEventListener('click', () => goToStep(Number(button.dataset.back)));
    });

    el('adminAccessBtn').addEventListener('click', openAdmin);
    el('backToOrdersBtn').addEventListener('click', () => window.location.reload());
    el('adminLoginForm').addEventListener('submit', adminLogin);
    el('adminRefreshBtn').addEventListener('click', () => {
      if (state.admin.pricesDirty && !window.confirm('Existem alterações de preços não salvas. Deseja descartá-las e atualizar o painel?')) return;
      state.admin.pricesDirty = false;
      loadAdminDashboard();
    });
    el('adminPeriodSelect').addEventListener('change', event => {
      if (state.admin.pricesDirty && !window.confirm('Existem alterações de preços não salvas. Deseja descartá-las e trocar o período?')) {
        event.target.value = state.admin.periodoSelecionado;
        return;
      }
      state.admin.pricesDirty = false;
      state.admin.periodoSelecionado = event.target.value;
      state.admin.filter = 'all';
      el('adminUnitFilter').value = 'all';
      loadAdminDashboard();
    });
    el('adminLogoutBtn').addEventListener('click', adminLogout);
    el('adminUnitFilter').addEventListener('change', event => {
      state.admin.filter = event.target.value;
      renderAdminUnitList();
    });
    el('copyPendingBtn').addEventListener('click', copyPendingMessage);
    el('whatsappPendingBtn').addEventListener('click', preparePendingWhatsApp);
    el('toggleOrdersBtn').addEventListener('click', toggleOrdersStatus);
    el('adminUnitList').addEventListener('click', event => {
      const row = event.target.closest('[data-admin-unit]');
      if (row) openAdminOrder(row.dataset.adminUnit);
    });
    el('adminOrderModalClose').addEventListener('click', closeAdminOrderModal);
    el('adminOrderModal').addEventListener('click', event => {
      if (event.target === el('adminOrderModal')) closeAdminOrderModal();
    });
    el('adminShareOrderPdfBtn').addEventListener('click', shareAdminOrderPdf);
    el('adminDownloadOrderPdfBtn').addEventListener('click', downloadAdminOrderPdf);
    el('adminConfirmFinancialBtn').addEventListener('click', confirmAdminOrderFinancial);
    el('adminOrderWhatsappBtn').addEventListener('click', prepareOrderFinancialWhatsApp);
    el('adminMarkSentBtn').addEventListener('click', markAdminOrderSent);
    el('adminSavePricesBtn').addEventListener('click', saveAdminPrices);
    el('adminResetPricesBtn').addEventListener('click', () => { state.admin.pricesDirty = false; renderAdminPricesEditor(); });
    el('adminPricesBody').addEventListener('input', handleAdminPriceInput);
    el('adminPricesBody').addEventListener('focusin', event => {
      if (!event.target.matches('.admin-price-input')) return;
      window.setTimeout(() => event.target.select(), 0);
    });
    el('adminSaveDeadlineBtn').addEventListener('click', saveAdminDeadline);
    el('adminStartNextPeriodBtn').addEventListener('click', startAdminNextPeriod);
    $all('[data-admin-jump]').forEach(button => {
      button.addEventListener('click', () => {
        const target = el(button.dataset.adminJump);
        if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
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

  function openEditOrderPanel() {
    el('editOrderPanel').classList.remove('hidden');
    el('existingOrderBanner').classList.add('hidden');
    window.setTimeout(() => el('editProtocolInput').focus(), 50);
  }

  function cancelEditOrder() {
    state.editProtocol = '';
    state.existingOrder = null;
    state.unitHasExistingOrder = false;
    state.lastSubmittedOrder = null;
    el('editProtocolInput').value = '';
    el('editOrderPanel').classList.add('hidden');
    el('existingOrderBanner').classList.add('hidden');
    el('unitSelect').disabled = false;
    el('unitSelect').value = '';
    el('responsibleInput').value = '';
    el('phoneInput').value = '';
    Object.keys(state.quantities).forEach(id => { state.quantities[id] = 0; });
    syncQuantityInputs();
    toast('Alteração cancelada. Você pode fazer um novo pedido normalmente.');
  }

  async function checkExistingOrderForUnit() {
    if (state.editProtocol || !state.boot) return false;
    const unitId = el('unitSelect').value;
    state.unitHasExistingOrder = false;
    if (!unitId) return false;

    try {
      const response = await jsonp('pedidoExiste', {
        unidadeId: unitId,
        ano: state.boot.configuracao.ano,
        trimestre: state.boot.configuracao.trimestre
      });
      state.unitHasExistingOrder = Boolean(response?.ok && response?.existe);
      return state.unitHasExistingOrder;
    } catch (error) {
      console.warn('Não foi possível verificar pedido existente:', error);
      return false;
    }
  }

  async function continueFromIdentification() {
    if (!validateIdentification()) return;

    if (!state.editProtocol) {
      const exists = await checkExistingOrderForUnit();
      if (exists) {
        offerExistingOrderCorrection();
        return;
      }
    }

    goToStep(2);
  }

  function offerExistingOrderCorrection() {
    const unit = state.boot?.unidades?.find(item => item.id === el('unitSelect').value);
    const unitName = unit?.nome || 'esta Sede / congregação';
    const wantsCorrection = window.confirm(
      `Já existe um pedido enviado para ${unitName} neste trimestre.\n\nDeseja corrigir o pedido existente?`
    );

    if (wantsCorrection) {
      goToStep(1);
      openEditOrderPanel();
      toast('Informe o número do protocolo do pedido para fazer a correção.');
    } else {
      toast('O pedido existente foi mantido. Nenhum novo pedido foi criado.');
    }
  }

  async function findOrderByProtocol() {
    if (!state.boot) return;
    const protocolo = String(el('editProtocolInput').value || '').trim().toUpperCase();
    if (protocolo.length < 8) {
      toast('Informe o número completo do protocolo.', true);
      el('editProtocolInput').focus();
      return;
    }

    const button = el('findEditOrderBtn');
    const original = button.textContent;
    button.disabled = true;
    button.textContent = 'Localizando...';

    try {
      const response = await jsonp('pedidoPorProtocolo', { protocolo }, 10000);
      if (!response?.ok) throw new Error(response?.message || 'Não foi possível localizar o pedido.');
      if (!response.pedido) {
        toast('Protocolo não localizado no trimestre atual. Confira o número e tente novamente.', true);
        return;
      }

      const pedido = response.pedido;
      const periodoLocalizado = `${ordinal(pedido.trimestre)} Trimestre de ${pedido.ano}`;
      if (!window.confirm(`Pedido localizado\n\nSede / Congregação: ${pedido.unidade}\nPeríodo: ${periodoLocalizado}\nProtocolo: ${pedido.protocolo}\n\nDeseja editar este pedido?`)) return;

      state.existingOrder = pedido;
      state.editProtocol = pedido.protocolo;
      state.unitHasExistingOrder = false;
      state.lastSubmittedOrder = null;

      el('unitSelect').value = pedido.unidadeId || '';
      el('unitSelect').disabled = true;
      el('responsibleInput').value = pedido.responsavel || '';
      el('phoneInput').value = pedido.telefone || '';

      Object.keys(state.quantities).forEach(id => { state.quantities[id] = 0; });
      (pedido.itens || []).forEach(item => {
        if (Object.prototype.hasOwnProperty.call(state.quantities, item.produtoId)) {
          state.quantities[item.produtoId] = Number(item.quantidade) || 0;
        }
      });
      syncQuantityInputs();

      el('existingOrderTitle').textContent = `Pedido localizado: ${pedido.protocolo}`;
      el('existingOrderText').textContent = `${pedido.unidade} • ${ordinal(pedido.trimestre)} Trimestre de ${pedido.ano}. As quantidades foram carregadas e podem ser corrigidas.`;
      el('existingOrderBanner').classList.remove('hidden');
      el('editOrderPanel').classList.add('hidden');
      toast('Pedido localizado. Confira os dados e continue para alterar as quantidades.');
      el('responsibleInput').focus();
    } catch (error) {
      console.error(error);
      toast(error.message || 'Não foi possível localizar o pedido.', true);
    } finally {
      button.disabled = false;
      button.textContent = original;
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

    if (!state.editProtocol) {
      const exists = await checkExistingOrderForUnit();
      if (exists) {
        offerExistingOrderCorrection();
        return;
      }
    }

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
      edicaoProtocolo: state.editProtocol || '',
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
      const message = String(error?.message || '');
      if (/já existe um pedido/i.test(message)) {
        state.unitHasExistingOrder = true;
        offerExistingOrderCorrection();
      } else {
        toast(message || 'Não foi possível confirmar o envio. Verifique sua internet e tente novamente.', true);
      }
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
        if (response?.found && response?.ok === false) throw new Error(response.message || 'Não foi possível registrar o pedido.');
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

    const atualizado = Boolean(confirmation.atualizado || state.editProtocol);
    el('successTitle').textContent = atualizado ? 'Pedido atualizado com sucesso' : 'Pedido enviado com sucesso';
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

    state.lastSubmittedOrder = {
      protocolo,
      unidade,
      periodo,
      responsavel,
      telefone,
      itens,
      total,
      atualizado
    };

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

  function buildOrderShareMessage({ protocolo, unidade, periodo, responsavel, atualizado = false }) {
    const local = String(unidade || '').trim().toLowerCase() === 'sede'
      ? 'da Sede'
      : `da Congregação ${unidade}`;
    const tipo = atualizado ? 'pedido atualizado' : 'pedido';
    return [
      'A Paz do Senhor!',
      '',
      `Segue o ${tipo} das revistas do ${periodo} ${local}.`,
      `Responsável: ${responsavel}`,
      `Protocolo: ${protocolo}`,
      '',
      `O ${tipo} completo segue em PDF anexo.`
    ].join('\n');
  }

  async function shareLastOrderPdf() {
    const order = state.lastSubmittedOrder;
    if (!order) {
      toast('Não foi possível localizar os dados do pedido para gerar o PDF.', true);
      return;
    }

    const button = el('sharePdfBtn');
    const originalText = button.textContent;
    button.disabled = true;
    button.textContent = 'Gerando PDF...';

    try {
      const blob = await generateOrderPdf(order);
      const filename = buildOrderPdfFilename(order);
      const file = new File([blob], filename, { type: 'application/pdf' });
      const text = buildOrderShareMessage(order);

      if (navigator.share && navigator.canShare?.({ files: [file] })) {
        await navigator.share({
          title: `Pedido de Revistas EBD - ${order.unidade}`,
          text,
          files: [file]
        });
        return;
      }

      downloadBlob(blob, filename);
      const whatsappUrl = `https://wa.me/${SUPERINTENDENCIA_WHATSAPP}?text=${encodeURIComponent(text)}`;
      window.open(whatsappUrl, '_blank', 'noopener,noreferrer');
      toast('O PDF foi baixado. No WhatsApp, anexe o arquivo baixado à mensagem aberta.');
    } catch (error) {
      if (error?.name === 'AbortError') return;
      console.error(error);
      toast('Não foi possível gerar ou compartilhar o PDF. Tente novamente.', true);
    } finally {
      button.disabled = false;
      button.textContent = originalText;
    }
  }

  async function generateOrderPdf(order) {
    if (!window.jspdf?.jsPDF) {
      throw new Error('Biblioteca de PDF não carregada.');
    }

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 15;
    const contentWidth = pageWidth - (margin * 2);
    const navy = [10, 52, 91];
    const blue = [15, 101, 168];
    const cyan = [16, 176, 200];
    const ink = [22, 43, 63];
    const muted = [91, 112, 131];
    const line = [220, 231, 239];
    const soft = [244, 249, 252];

    // Cabeçalho institucional
    doc.setFillColor(...navy);
    doc.rect(0, 0, pageWidth, 47, 'F');
    doc.setFillColor(...cyan);
    doc.rect(0, 44, pageWidth, 3, 'F');

    try {
      const logo = await loadImageDataUrl('img/icon-512.png?v=2.8.0');
      doc.setFillColor(255, 255, 255);
      doc.roundedRect(margin, 9, 28, 28, 3, 3, 'F');
      doc.addImage(logo, 'PNG', margin + 1.5, 10.5, 25, 25, undefined, 'FAST');
    } catch (error) {
      try {
        const logo = await loadImageDataUrl('img/logo-ad-vicosa.png?v=2.8.0');
        doc.addImage(logo, 'PNG', margin, 15, 55, 16, undefined, 'FAST');
      } catch (_) {
        // O PDF continua funcional mesmo se a imagem não puder ser carregada.
      }
    }

    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(18);
    doc.text('PEDIDO DE REVISTAS EBD', 49, 18);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10.5);
    doc.text('AD Viçosa Madureira • Superintendência da Escola Bíblica Dominical', 49, 25);
    doc.setFontSize(9.5);
    doc.text('Documento de pedido • sem valores financeiros', 49, 31.5);

    // Identificação do pedido
    let y = 58;
    doc.setTextColor(...ink);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.text('Identificação do pedido', margin, y);
    y += 5;

    doc.setFillColor(...soft);
    doc.setDrawColor(...line);
    doc.roundedRect(margin, y, contentWidth, 37, 3, 3, 'FD');

    const leftX = margin + 6;
    const rightX = margin + 98;
    const topY = y + 8;
    pdfLabelValue(doc, 'Sede / Congregação', order.unidade, leftX, topY, ink, muted, 78);
    pdfLabelValue(doc, 'Período', order.periodo, rightX, topY, ink, muted, 74);
    pdfLabelValue(doc, 'Responsável', order.responsavel, leftX, topY + 14, ink, muted, 78);
    pdfLabelValue(doc, 'Protocolo', order.protocolo, rightX, topY + 14, ink, muted, 74);
    y += 47;

    // Tabela de itens
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.setTextColor(...ink);
    doc.text('Revistas e materiais solicitados', margin, y);
    y += 6;

    const tableX = margin;
    const tableW = contentWidth;
    const qtyW = 30;
    const nameW = tableW - qtyW;
    const rowH = 8;

    const drawTableHeader = () => {
      doc.setFillColor(...blue);
      doc.roundedRect(tableX, y, tableW, rowH, 2, 2, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9.5);
      doc.text('Revista / material', tableX + 4, y + 5.4);
      doc.text('Quantidade', tableX + nameW + (qtyW / 2), y + 5.4, { align: 'center' });
      y += rowH;
    };

    drawTableHeader();

    order.itens.forEach((item, index) => {
      const wrapped = doc.splitTextToSize(String(item.nome || ''), nameW - 8);
      const actualRowH = Math.max(rowH, wrapped.length * 4.2 + 3.5);
      if (y + actualRowH + 24 > pageHeight) {
        addPdfFooter(doc, pageWidth, pageHeight, order.protocolo, navy, muted);
        doc.addPage();
        y = 18;
        drawTableHeader();
      }

      if (index % 2 === 0) {
        doc.setFillColor(248, 251, 253);
        doc.rect(tableX, y, tableW, actualRowH, 'F');
      }
      doc.setDrawColor(...line);
      doc.line(tableX, y + actualRowH, tableX + tableW, y + actualRowH);
      doc.line(tableX + nameW, y, tableX + nameW, y + actualRowH);

      doc.setTextColor(...ink);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9.2);
      doc.text(wrapped, tableX + 4, y + 5.2);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10.5);
      doc.text(String(item.quantidade), tableX + nameW + (qtyW / 2), y + 5.5, { align: 'center' });
      y += actualRowH;
    });

    // Total
    if (y + 23 > pageHeight) {
      addPdfFooter(doc, pageWidth, pageHeight, order.protocolo, navy, muted);
      doc.addPage();
      y = 18;
    }
    y += 6;
    doc.setFillColor(...navy);
    doc.roundedRect(margin, y, contentWidth, 16, 3, 3, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10.5);
    doc.text('TOTAL DE EXEMPLARES', margin + 6, y + 10.2);
    doc.setFontSize(15);
    doc.text(String(order.total), pageWidth - margin - 7, y + 10.5, { align: 'right' });

    addPdfFooter(doc, pageWidth, pageHeight, order.protocolo, navy, muted);
    doc.setProperties({
      title: `Pedido de Revistas EBD - ${order.unidade}`,
      subject: `${order.periodo} - ${order.protocolo}`,
      author: 'AD Viçosa Madureira - EBD',
      creator: 'Pedidos de Revistas EBD - AD Viçosa'
    });

    return doc.output('blob');
  }

  function pdfLabelValue(doc, label, value, x, y, ink, muted, maxWidth) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(...muted);
    doc.text(String(label).toUpperCase(), x, y);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10.2);
    doc.setTextColor(...ink);
    const text = doc.splitTextToSize(String(value || '—'), maxWidth);
    doc.text(text.slice(0, 2), x, y + 5.3);
  }

  function addPdfFooter(doc, pageWidth, pageHeight, protocolo, navy, muted) {
    const footerY = pageHeight - 10;
    doc.setDrawColor(220, 231, 239);
    doc.line(15, footerY - 4, pageWidth - 15, footerY - 4);
    doc.setTextColor(...muted);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.text('Pedidos de Revistas EBD - AD Viçosa', 15, footerY);
    doc.text(`Protocolo: ${protocolo}`, pageWidth - 15, footerY, { align: 'right' });
    doc.setTextColor(...navy);
  }

  async function loadImageDataUrl(src) {
    const response = await fetch(src, { cache: 'force-cache' });
    if (!response.ok) throw new Error(`Não foi possível carregar a imagem: ${src}`);
    const blob = await response.blob();
    return blobToDataUrl(blob);
  }

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  function buildOrderPdfFilename(order) {
    const cleanUnit = String(order.unidade || 'Congregacao')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
    return `Pedido_Revistas_EBD_${cleanUnit}_${order.protocolo}.pdf`;
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  function hasPublicDraft() {
    if (!state.boot) return false;
    return Boolean(
      state.currentStep > 1 ||
      state.editProtocol ||
      state.lastSubmittedOrder ||
      el('unitSelect')?.value ||
      el('responsibleInput')?.value?.trim() ||
      el('phoneInput')?.value?.trim() ||
      getTotal() > 0 ||
      !el('editOrderPanel')?.classList.contains('hidden')
    );
  }

  function returnToHome(options = {}) {
    const skipConfirm = Boolean(options && options.skipConfirm);
    const adminVisible = !el('adminView')?.classList.contains('hidden');

    if (!skipConfirm && state.admin.pricesDirty) {
      const discardPrices = window.confirm('Existem alterações de preços não salvas. Deseja descartá-las e voltar ao início?');
      if (!discardPrices) return;
      state.admin.pricesDirty = false;
    } else if (!skipConfirm && !adminVisible && hasPublicDraft() && !state.lastSubmittedOrder) {
      const discardDraft = window.confirm('Voltar ao início? Os dados ainda não enviados serão descartados.');
      if (!discardDraft) return;
    }

    closeAdminOrderModal();
    if (!state.boot || !state.boot.configuracao?.pedidosAbertos) {
      window.location.reload();
      return;
    }

    showOnly('appView');
    resetApp();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function resetApp() {
    state.existingOrder = null;
    state.editProtocol = '';
    state.unitHasExistingOrder = false;
    state.lastSubmittedOrder = null;
    Object.keys(state.quantities).forEach(id => { state.quantities[id] = 0; });
    syncQuantityInputs();
    el('unitSelect').disabled = false;
    el('unitSelect').value = '';
    el('responsibleInput').value = '';
    el('phoneInput').value = '';
    el('editProtocolInput').value = '';
    el('editOrderPanel').classList.add('hidden');
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
      const params = { token: state.admin.token };
      if (state.admin.periodoSelecionado) {
        const [ano, trimestre] = state.admin.periodoSelecionado.split('-').map(Number);
        if (ano && trimestre) {
          params.ano = ano;
          params.trimestre = trimestre;
        }
      }
      const result = await jsonp('adminDashboard', params, 12000);
      if (!result?.ok) {
        if (result?.code === 'ADMIN_SESSION_INVALID') {
          clearAdminToken();
          showAdminLogin('Sua sessão administrativa expirou. Entre novamente.');
          return;
        }
        throw new Error(result?.message || 'Não foi possível carregar o painel.');
      }

      state.admin.dashboard = result;
      state.admin.periodoSelecionado = `${result.periodo.ano}-${result.periodo.trimestre}`;
      state.admin.pricesDirty = false;
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
    renderAdminPeriodSelector();
    el('metricUnits').textContent = String(data.metricas.unidades);
    el('metricReceived').textContent = String(data.metricas.recebidos);
    el('metricPending').textContent = String(data.metricas.pendentes);
    el('metricCopies').textContent = String(data.metricas.exemplares);
    el('metricChecked').textContent = String(data.metricas.conferidos || 0);
    el('metricFinancial').textContent = formatCurrency(data.metricas.valorConferido || 0);

    const totalCadastros = Number(data.metricas.unidades || 0);
    const recebidos = Number(data.metricas.recebidos || 0);
    const progresso = totalCadastros > 0 ? Math.round((recebidos / totalCadastros) * 100) : 0;
    el('adminProgressLabel').textContent = `${recebidos} de ${totalCadastros} pedidos recebidos`;
    el('adminProgressPercent').textContent = `${progresso}%`;
    el('adminProgressFill').style.width = `${Math.max(0, Math.min(100, progresso))}%`;

    if (p.atual) {
      el('adminOpenStatus').textContent = p.pedidosAbertos ? 'Pedidos abertos' : 'Pedidos fechados';
      el('adminDeadlineText').textContent = p.dataLimite
        ? `Prazo configurado: ${formatDate(p.dataLimite)}`
        : 'Nenhuma data-limite foi definida.';
      el('toggleOrdersBtn').classList.remove('hidden');
      el('toggleOrdersBtn').disabled = false;
      el('toggleOrdersBtn').textContent = p.pedidosAbertos ? 'Fechar pedidos' : 'Abrir pedidos';
      el('toggleOrdersBtn').dataset.nextOpen = p.pedidosAbertos ? 'false' : 'true';
    } else {
      el('adminOpenStatus').textContent = 'Consulta histórica';
      el('adminDeadlineText').textContent = 'Este trimestre está em modo somente leitura. Os registros permanecem preservados.';
      el('toggleOrdersBtn').classList.add('hidden');
      el('toggleOrdersBtn').disabled = true;
    }

    renderAdminUnitList();
    renderPendingList();
    renderAdminPricesEditor();
    renderAdminSettings();
    renderAdminFinancialSummary();
    renderAdminBetelSummary();
  }


  function renderAdminPeriodSelector() {
    const data = state.admin.dashboard;
    if (!data) return;
    const select = el('adminPeriodSelect');
    const periods = Array.isArray(data.periodosDisponiveis) ? data.periodosDisponiveis : [];
    select.innerHTML = periods.map(item => {
      const value = `${item.ano}-${item.trimestre}`;
      const suffix = item.atual ? ' — atual' : '';
      return `<option value="${escapeHtml(value)}">${escapeHtml(item.label + suffix)}</option>`;
    }).join('');
    select.value = `${data.periodo.ano}-${data.periodo.trimestre}`;

    const badge = el('adminHistoryModeBadge');
    badge.textContent = data.periodo.atual ? 'Período atual' : 'Histórico';
    badge.classList.toggle('history', !data.periodo.atual);
    el('adminHistoryHelp').textContent = data.periodo.atual
      ? 'Você está acompanhando o trimestre em andamento. Períodos anteriores ficam preservados para consulta.'
      : 'Consulta de um trimestre anterior. Nenhum dado histórico pode ser alterado por esta tela.';
  }

  function renderAdminUnitList() {
    const data = state.admin.dashboard;
    if (!data) return;

    const filter = state.admin.filter;
    const rows = data.unidades.filter(item => {
      if (filter === 'sent') return item.enviado;
      if (filter === 'pending') return !item.enviado;
      return true;
    });

    el('adminUnitList').innerHTML = rows.map(item => {
      const tag = item.enviado
        ? '<span class="status-badge sent">✓ Enviado</span>'
        : '<span class="status-badge pending">⏳ Pendente</span>';

      const details = item.enviado
        ? `<div class="admin-unit-details">
             <span><b>Responsável:</b> ${escapeHtml(item.responsavel || '—')}</span>
             <span><b>Telefone:</b> ${escapeHtml(item.telefone || '—')}</span>
             <span><b>Protocolo:</b> ${escapeHtml(item.protocolo || '—')}</span>
             <span><b>Financeiro:</b> ${escapeHtml(item.situacaoFinanceira || 'A CONFERIR')}</span>
             <span><b>Atualizado:</b> ${escapeHtml(formatDateTime(item.atualizadoEm))}</span>
             ${String(item.statusPedido || '').toUpperCase() === 'ALTERADO' ? '<span class="finance-status review">Pedido alterado</span>' : ''}
           </div>`
        : '<div class="admin-unit-details pending-text"><span>Nenhum pedido registrado neste trimestre.</span></div>';

      const inner = `
        <div class="admin-unit-main">
          <div class="admin-unit-name">${escapeHtml(item.nome)}</div>
          ${details}
        </div>
        <div class="admin-unit-side">
          ${tag}
          <span class="admin-unit-total">${item.enviado ? `${Number(item.total || 0)} exemplares` : '—'}</span>
          ${item.enviado && Number(item.valorTotal || 0) > 0 ? `<span class="admin-unit-value">${formatCurrency(item.valorTotal)}</span>` : ''}
          ${item.enviado ? '<span class="admin-unit-open">Ver pedido →</span>' : ''}
        </div>`;

      return item.enviado
        ? `<button class="admin-unit-row sent-row" type="button" data-admin-unit="${escapeHtml(item.id)}">${inner}</button>`
        : `<div class="admin-unit-row pending-row">${inner}</div>`;
    }).join('') || '<div class="pending-empty">Nenhum registro neste filtro.</div>';
  }

  function renderPendingList() {
    const data = state.admin.dashboard;
    if (!data) return;
    const pending = data.unidades.filter(unit => !unit.enviado);
    const container = el('adminPendingList');
    if (!pending.length) {
      container.innerHTML = '<div class="pending-empty">A Sede e todas as congregações já enviaram o pedido.</div>';
      el('copyPendingBtn').disabled = true;
      el('whatsappPendingBtn').classList.add('disabled');
      el('whatsappPendingBtn').setAttribute('aria-disabled', 'true');
      el('whatsappPendingBtn').href = '#';
      return;
    }
    container.innerHTML = pending.map(unit => `<span class="pending-chip">${escapeHtml(unit.nome)}</span>`).join('');
    if (data.periodo.atual) {
      el('copyPendingBtn').disabled = false;
      el('whatsappPendingBtn').classList.remove('disabled');
      el('whatsappPendingBtn').removeAttribute('aria-disabled');
    } else {
      el('copyPendingBtn').disabled = true;
      el('whatsappPendingBtn').classList.add('disabled');
      el('whatsappPendingBtn').setAttribute('aria-disabled', 'true');
      el('whatsappPendingBtn').href = '#';
    }
  }


  function renderAdminPricesEditor() {
    const data = state.admin.dashboard;
    if (!data) return;
    const prices = Array.isArray(data.precos) ? data.precos : [];
    const isCurrent = Boolean(data.periodo?.atual);
    const filled = prices.filter(item => item.valor != null).length;
    const body = el('adminPricesBody');
    const status = el('adminPricesEditorStatus');

    body.innerHTML = prices.map(item => {
      const value = item.valor == null ? '' : formatAdminPriceFromCents(Math.round(Number(item.valor) * 100));
      return `
        <tr>
          <td data-label="Produto"><strong>${escapeHtml(item.produto)}</strong></td>
          <td data-label="Categoria">${escapeHtml(item.categoria)}</td>
          <td data-label="Código Betel">${escapeHtml(item.codigo || '—')}</td>
          <td data-label="Valor unitário">
            <div class="price-input-wrap">
              <span>R$</span>
              <input class="admin-price-input" type="text" inputmode="numeric" pattern="[0-9]*" autocomplete="off"
                data-price-id="${escapeHtml(item.id)}" value="${escapeHtml(value)}" placeholder="0,00" ${isCurrent ? '' : 'disabled'}>
            </div>
          </td>
        </tr>`;
    }).join('') || '<tr><td colspan="4">Nenhum produto disponível.</td></tr>';

    if (!isCurrent) {
      status.textContent = 'Histórico — somente leitura';
      status.className = 'price-status-chip complete';
    } else if (state.admin.pricesDirty) {
      status.textContent = 'Alterações não salvas';
      status.className = 'price-status-chip pending';
    } else {
      status.textContent = `${filled}/${prices.length} preços cadastrados`;
      status.className = `price-status-chip ${filled === prices.length && prices.length ? 'complete' : 'pending'}`;
    }

    el('adminSavePricesBtn').disabled = !isCurrent || !state.admin.pricesDirty;
    el('adminResetPricesBtn').disabled = !isCurrent || !state.admin.pricesDirty;
  }

  function handleAdminPriceInput(event) {
    if (!event.target.matches('.admin-price-input')) return;
    const input = event.target;
    const digits = String(input.value || '').replace(/\D/g, '');

    if (!digits) {
      input.value = '';
    } else {
      // Máscara monetária por centavos: 1550 -> 15,50.
      // Assim o superintendente digita somente números, sem vírgula ou ponto.
      const cents = Number(digits.slice(0, 11));
      input.value = formatAdminPriceFromCents(Number.isFinite(cents) ? cents : 0);
      window.requestAnimationFrame(() => {
        try { input.setSelectionRange(input.value.length, input.value.length); } catch (_) {}
      });
    }

    input.classList.remove('invalid');
    state.admin.pricesDirty = true;
    el('adminPricesEditorStatus').textContent = 'Alterações não salvas';
    el('adminPricesEditorStatus').className = 'price-status-chip pending';
    el('adminSavePricesBtn').disabled = false;
    el('adminResetPricesBtn').disabled = false;
  }

  function formatAdminPriceFromCents(cents) {
    const safeCents = Math.max(0, Math.trunc(Number(cents) || 0));
    return (safeCents / 100).toFixed(2).replace('.', ',');
  }

  function parseAdminPrice(value) {
    const raw = String(value == null ? '' : value).trim();
    if (!raw) return null;
    let normalized = raw.replace(/\s/g, '').replace(/^R\$/i, '');
    if (normalized.includes(',')) normalized = normalized.replace(/\./g, '').replace(',', '.');
    const number = Number(normalized);
    return Number.isFinite(number) && number >= 0 ? number : NaN;
  }

  async function saveAdminPrices() {
    const data = state.admin.dashboard;
    if (!data?.periodo?.atual || state.admin.isBusy) return;

    const inputs = $all('#adminPricesBody .admin-price-input');
    const precos = [];
    let invalid = false;
    inputs.forEach(input => {
      const value = parseAdminPrice(input.value);
      input.classList.toggle('invalid', Number.isNaN(value));
      if (Number.isNaN(value)) invalid = true;
      precos.push({ id: input.dataset.priceId, valor: Number.isNaN(value) ? null : value });
    });
    if (invalid) {
      toast('Revise os valores destacados. Use, por exemplo, 15,90.', true);
      return;
    }

    if (!window.confirm('Salvar os preços deste trimestre? Pedidos já conferidos manterão os valores registrados anteriormente.')) return;

    const button = el('adminSavePricesBtn');
    const original = button.textContent;
    state.admin.isBusy = true;
    button.disabled = true;
    button.textContent = 'Salvando...';
    const requestId = createRequestId();

    try {
      await postNoCors({
        action: 'adminSalvarPrecos',
        requestId,
        token: state.admin.token,
        ano: data.periodo.ano,
        trimestre: data.periodo.trimestre,
        precos
      });
      const result = await waitForAdminResult('adminActionStatus', requestId);
      if (!result?.ok) throw new Error(result?.message || 'Não foi possível salvar os preços.');
      state.admin.pricesDirty = false;
      state.admin.isBusy = false;
      await loadAdminDashboard();
      toast('Preços atualizados com sucesso.');
    } catch (error) {
      console.error(error);
      toast(error.message || 'Não foi possível salvar os preços.', true);
    } finally {
      state.admin.isBusy = false;
      button.disabled = !state.admin.pricesDirty;
      if (button.textContent === 'Salvando...') button.textContent = original;
    }
  }

  function renderAdminSettings() {
    const data = state.admin.dashboard;
    if (!data) return;
    const isCurrent = Boolean(data.periodo?.atual);
    el('adminCurrentPeriodInput').value = `${ordinal(data.periodo.trimestre)} Trimestre de ${data.periodo.ano}`;
    el('adminDeadlineInput').value = data.periodo.dataLimite || '';
    el('adminDeadlineInput').disabled = !isCurrent;
    el('adminSaveDeadlineBtn').disabled = !isCurrent;
    el('adminSettingsHelp').textContent = isCurrent
      ? 'Defina ou altere o prazo de envio diretamente pelo painel.'
      : 'Períodos anteriores ficam disponíveis somente para consulta.';

    const nextBox = el('adminNextPeriodBox');
    const nextButton = el('adminStartNextPeriodBtn');
    if (isCurrent) {
      const next = getNextQuarter(data.periodo.ano, data.periodo.trimestre);
      el('adminNextPeriodLabel').textContent = `${ordinal(next.trimestre)} Trimestre de ${next.ano}`;
      nextBox.classList.remove('hidden');
      nextButton.disabled = false;
    } else {
      nextBox.classList.add('hidden');
      nextButton.disabled = true;
    }
  }

  function getNextQuarter(ano, trimestre) {
    const t = Number(trimestre);
    const a = Number(ano);
    return t >= 4 ? { ano: a + 1, trimestre: 1 } : { ano: a, trimestre: t + 1 };
  }

  async function saveAdminDeadline() {
    const data = state.admin.dashboard;
    if (!data?.periodo?.atual || state.admin.isBusy) return;
    const dataLimite = el('adminDeadlineInput').value || '';
    const button = el('adminSaveDeadlineBtn');
    const original = button.textContent;
    state.admin.isBusy = true;
    button.disabled = true;
    button.textContent = 'Salvando...';
    const requestId = createRequestId();

    try {
      await postNoCors({
        action: 'adminSalvarConfiguracoes',
        requestId,
        token: state.admin.token,
        ano: data.periodo.ano,
        trimestre: data.periodo.trimestre,
        dataLimite
      });
      const result = await waitForAdminResult('adminActionStatus', requestId);
      if (!result?.ok) throw new Error(result?.message || 'Não foi possível salvar o prazo.');
      state.admin.isBusy = false;
      await loadAdminDashboard();
      toast(dataLimite ? 'Prazo atualizado com sucesso.' : 'Data-limite removida.');
    } catch (error) {
      console.error(error);
      toast(error.message || 'Não foi possível salvar o prazo.', true);
    } finally {
      state.admin.isBusy = false;
      button.disabled = !state.admin.dashboard?.periodo?.atual;
      if (button.textContent === 'Salvando...') button.textContent = original;
    }
  }

  async function startAdminNextPeriod() {
    const data = state.admin.dashboard;
    if (!data?.periodo?.atual || state.admin.isBusy) return;
    if (state.admin.pricesDirty) {
      toast('Salve ou descarte as alterações de preços antes de iniciar o próximo trimestre.', true);
      return;
    }
    const next = getNextQuarter(data.periodo.ano, data.periodo.trimestre);
    const labelAtual = `${ordinal(data.periodo.trimestre)} Trimestre de ${data.periodo.ano}`;
    const labelNovo = `${ordinal(next.trimestre)} Trimestre de ${next.ano}`;
    const message = `Iniciar ${labelNovo}?\n\n${labelAtual} será preservado no Histórico. O novo trimestre começará com pedidos fechados e sem data-limite. Depois, cadastre os preços e abra os pedidos quando estiver pronto.`;
    if (!window.confirm(message)) return;

    const button = el('adminStartNextPeriodBtn');
    const original = button.textContent;
    state.admin.isBusy = true;
    button.disabled = true;
    button.textContent = 'Preparando...';
    const requestId = createRequestId();

    try {
      await postNoCors({
        action: 'adminIniciarProximoPeriodo',
        requestId,
        token: state.admin.token,
        ano: next.ano,
        trimestre: next.trimestre
      });
      const result = await waitForAdminResult('adminActionStatus', requestId);
      if (!result?.ok) throw new Error(result?.message || 'Não foi possível iniciar o próximo trimestre.');
      state.admin.periodoSelecionado = `${next.ano}-${next.trimestre}`;
      state.admin.pricesDirty = false;
      state.admin.isBusy = false;
      await loadAdminDashboard();
      toast(`${labelNovo} preparado. Cadastre os preços e abra os pedidos quando estiver pronto.`);
    } catch (error) {
      console.error(error);
      toast(error.message || 'Não foi possível iniciar o próximo trimestre.', true);
    } finally {
      state.admin.isBusy = false;
      button.disabled = !state.admin.dashboard?.periodo?.atual;
      if (button.textContent === 'Preparando...') button.textContent = original;
    }
  }

  function renderAdminFinancialSummary() {
    const data = state.admin.dashboard;
    if (!data) return;
    const financeiro = data.financeiro || { linhas: [], precosCadastrados: 0, totalProdutos: 0, totalCalculado: 0, totalConferido: 0 };
    const cadastrados = Number(financeiro.precosCadastrados || 0);
    const totalProdutos = Number(financeiro.totalProdutos || 0);
    const completos = totalProdutos > 0 && cadastrados === totalProdutos;

    const statusChip = el('adminPriceStatus');
    if (data.periodo?.atual) {
      statusChip.textContent = totalProdutos
        ? `${cadastrados}/${totalProdutos} preços cadastrados`
        : 'Preços não preparados';
      statusChip.classList.toggle('complete', completos);
      statusChip.classList.toggle('pending', !completos);
      el('adminFinanceHelp').innerHTML = 'Cadastre os valores na seção <strong>Preços das revistas</strong> deste painel. Depois confira cada pedido para gerar o demonstrativo.';
    } else {
      statusChip.textContent = 'Histórico — somente leitura';
      statusChip.classList.add('complete');
      statusChip.classList.remove('pending');
      el('adminFinanceHelp').textContent = 'Valores e situações preservados do trimestre selecionado.';
    }

    el('adminFinanceBody').innerHTML = (financeiro.linhas || []).map(item => {
      const situacao = String(item.situacao || '—');
      const cls = financialStatusClass(situacao);
      return `
        <tr>
          <td>${escapeHtml(item.nome)}</td>
          <td>${Number(item.exemplares || 0) || '—'}</td>
          <td>${item.valor == null ? '—' : formatCurrency(item.valor)}</td>
          <td><span class="finance-status ${cls}">${escapeHtml(situacao)}</span></td>
        </tr>`;
    }).join('');

    el('adminFinancialCalculated').textContent = formatCurrency(financeiro.totalCalculado || 0);
    el('adminFinancialConfirmed').textContent = formatCurrency(financeiro.totalConferido || 0);
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
      const p = state.admin.dashboard?.periodo;
      const result = await jsonp('adminPedido', {
        token: state.admin.token,
        unidadeId: unitId,
        ano: p?.ano,
        trimestre: p?.trimestre
      }, 10000);
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
        toast('Esta Sede ou congregação não possui pedido no período selecionado.', true);
        return;
      }

      state.admin.currentOrder = order;
      el('adminOrderModalTitle').textContent = order.unidade;
      el('adminOrderMeta').innerHTML = `
        <div><span>Protocolo</span><strong>${escapeHtml(order.protocolo)}</strong></div>
        <div><span>Responsável</span><strong>${escapeHtml(order.responsavel || '—')}</strong></div>
        <div><span>Telefone</span><strong>${escapeHtml(order.telefone || '—')}</strong></div>
        <div><span>Período</span><strong>${ordinal(order.trimestre)} Trimestre de ${order.ano}</strong></div>
        <div><span>Exemplares</span><strong>${Number(order.total || 0)}</strong></div>
        <div><span>Situação do pedido</span><strong>${String(order.statusPedido || '').toUpperCase() === 'ALTERADO' ? 'Pedido alterado' : 'Pedido enviado'}</strong></div>
        <div><span>Atualizado em</span><strong>${escapeHtml(formatDateTime(order.atualizadoEm))}</strong></div>`;
      el('adminOrderItems').innerHTML = order.itens.map(item => `
        <tr>
          <td>${escapeHtml(item.produto)}</td>
          <td>${escapeHtml(item.codigo || '—')}</td>
          <td class="positive">${Number(item.quantidade || 0)}</td>
          <td>${item.valorUnitario == null ? '—' : formatCurrency(item.valorUnitario)}</td>
          <td class="${item.subtotal == null ? 'zero' : 'positive'}">${item.subtotal == null ? '—' : formatCurrency(item.subtotal)}</td>
        </tr>`).join('');
      el('adminOrderFinancialTotal').textContent = order.valorTotal == null ? '—' : formatCurrency(order.valorTotal);
      renderAdminOrderFinancialStatus(order);
      configureAdminOrderFinancialActions(order);
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
    state.admin.currentOrder = null;
    document.body.style.overflow = '';
  }


  function buildAdminOrderPdfData(order) {
    if (!order) return null;
    return {
      protocolo: order.protocolo,
      unidade: order.unidade,
      periodo: `${ordinal(order.trimestre)} Trimestre de ${order.ano}`,
      responsavel: order.responsavel || '—',
      telefone: order.telefone || '',
      itens: (order.itens || []).map(item => ({ nome: item.produto, quantidade: Number(item.quantidade || 0) })).filter(item => item.quantidade > 0),
      total: Number(order.total || 0),
      atualizado: String(order.statusPedido || '').toUpperCase() === 'ALTERADO'
    };
  }

  function buildAdminOrderCopyMessage(order) {
    const data = buildAdminOrderPdfData(order);
    if (!data) return '';
    const local = String(data.unidade || '').trim().toLowerCase() === 'sede' ? 'da Sede' : `da Congregação ${data.unidade}`;
    return [
      'A Paz do Senhor!',
      '',
      `Segue uma cópia do pedido das revistas do ${data.periodo} ${local}.`,
      `Responsável: ${data.responsavel}`,
      `Protocolo: ${data.protocolo}`,
      '',
      'O pedido completo segue em PDF anexo.'
    ].join('\n');
  }

  async function shareAdminOrderPdf() {
    const order = state.admin.currentOrder;
    if (!order) return;
    const button = el('adminShareOrderPdfBtn');
    const original = button.textContent;
    button.disabled = true;
    button.textContent = 'Gerando PDF...';
    try {
      const data = buildAdminOrderPdfData(order);
      const blob = await generateOrderPdf(data);
      const filename = buildOrderPdfFilename(data);
      const file = new File([blob], filename, { type: 'application/pdf' });
      const text = buildAdminOrderCopyMessage(order);
      if (navigator.share && navigator.canShare?.({ files: [file] })) {
        await navigator.share({ title: `Pedido de Revistas EBD - ${data.unidade}`, text, files: [file] });
        return;
      }
      downloadBlob(blob, filename);
      const number = normalizeWhatsAppNumber(order.telefone);
      const whatsappUrl = number ? `https://wa.me/${number}?text=${encodeURIComponent(text)}` : `https://wa.me/?text=${encodeURIComponent(text)}`;
      window.open(whatsappUrl, '_blank', 'noopener,noreferrer');
      toast('O PDF foi baixado. No WhatsApp, anexe o arquivo à mensagem aberta para o responsável.');
    } catch (error) {
      if (error?.name === 'AbortError') return;
      console.error(error);
      toast('Não foi possível gerar ou compartilhar a cópia do pedido.', true);
    } finally {
      button.disabled = false;
      button.textContent = original;
    }
  }

  async function downloadAdminOrderPdf() {
    const order = state.admin.currentOrder;
    if (!order) return;
    const button = el('adminDownloadOrderPdfBtn');
    const original = button.textContent;
    button.disabled = true;
    button.textContent = 'Gerando PDF...';
    try {
      const data = buildAdminOrderPdfData(order);
      const blob = await generateOrderPdf(data);
      downloadBlob(blob, buildOrderPdfFilename(data));
      toast('PDF do pedido baixado.');
    } catch (error) {
      console.error(error);
      toast('Não foi possível gerar o PDF do pedido.', true);
    } finally {
      button.disabled = false;
      button.textContent = original;
    }
  }

  function renderAdminOrderFinancialStatus(order) {
    const container = el('adminOrderFinancialStatus');
    const status = String(order.situacaoFinanceira || 'A CONFERIR').toUpperCase();
    const missing = Array.isArray(order.itensSemPreco) ? order.itensSemPreco : [];
    let title = status;
    let message = '';

    if (!order.precosCompletos) {
      title = 'PREÇOS PENDENTES';
      message = `Cadastre os preços pendentes no painel: ${missing.join(', ')}.`;
    } else if (status === 'COMPROVANTE ENVIADO') {
      message = order.comprovanteEnviadoEm
        ? `Demonstrativo marcado como enviado em ${formatDateTime(order.comprovanteEnviadoEm)}.`
        : 'Demonstrativo marcado como enviado.';
    } else if (status === 'CONFERIDO') {
      message = order.conferidoEm
        ? `Valores conferidos em ${formatDateTime(order.conferidoEm)}.`
        : 'Valores conferidos pela Superintendência.';
    } else {
      message = 'Os valores estão calculados com os preços atuais. Clique em “Conferir valores” para fixar o demonstrativo.';
    }

    container.className = `financial-status-card ${financialStatusClass(title)}`;
    container.innerHTML = `<strong>${escapeHtml(title)}</strong><span>${escapeHtml(message)}</span>`;
  }

  function configureAdminOrderFinancialActions(order) {
    const isCurrent = Boolean(order.periodoAtual);
    const status = String(order.situacaoFinanceira || 'A CONFERIR').toUpperCase();
    const confirmed = ['CONFERIDO', 'COMPROVANTE ENVIADO'].includes(status);

    const confirmBtn = el('adminConfirmFinancialBtn');
    confirmBtn.classList.toggle('hidden', !isCurrent);
    confirmBtn.disabled = !isCurrent || !order.precosCompletos;
    confirmBtn.textContent = confirmed ? 'Reconferir valores' : 'Conferir valores';

    const whatsapp = el('adminOrderWhatsappBtn');
    whatsapp.classList.toggle('disabled', !confirmed);
    whatsapp.setAttribute('aria-disabled', confirmed ? 'false' : 'true');
    whatsapp.href = confirmed ? buildFinancialWhatsAppUrl(order) : '#';

    const sentBtn = el('adminMarkSentBtn');
    sentBtn.classList.toggle('hidden', !isCurrent);
    sentBtn.disabled = !isCurrent || !confirmed || status === 'COMPROVANTE ENVIADO';
    sentBtn.textContent = status === 'COMPROVANTE ENVIADO' ? 'Comprovante enviado ✓' : 'Marcar como enviado';
  }

  async function confirmAdminOrderFinancial() {
    const order = state.admin.currentOrder;
    if (!order || state.admin.isBusy) return;
    if (!order.periodoAtual) {
      toast('O histórico é somente para consulta.', true);
      return;
    }
    if (!order.precosCompletos) {
      toast('Cadastre os preços pendentes no painel antes de conferir.', true);
      return;
    }
    if (!window.confirm(`Conferir e fixar os valores do pedido de ${order.unidade}?`)) return;

    state.admin.isBusy = true;
    const button = el('adminConfirmFinancialBtn');
    const original = button.textContent;
    button.disabled = true;
    button.textContent = 'Conferindo...';
    const requestId = createRequestId();

    try {
      await postNoCors({
        action: 'adminConferirPedido',
        requestId,
        token: state.admin.token,
        unidadeId: order.unidadeId,
        ano: order.ano,
        trimestre: order.trimestre
      });
      const result = await waitForAdminResult('adminActionStatus', requestId);
      if (!result?.ok) throw new Error(result?.message || 'Não foi possível conferir os valores.');

      const unitId = order.unidadeId;
      state.admin.isBusy = false;
      await loadAdminDashboard();
      await openAdminOrder(unitId);
      toast(`Pedido conferido: ${formatCurrency(result.valorTotal || 0)}.`);
    } catch (error) {
      console.error(error);
      toast(error.message || 'Não foi possível conferir os valores.', true);
    } finally {
      state.admin.isBusy = false;
      button.disabled = false;
      if (button.textContent === 'Conferindo...') button.textContent = original;
    }
  }

  function buildFinancialMessage(order) {
    if (!order) return '';
    const status = String(order.situacaoFinanceira || '').toUpperCase();
    if (!['CONFERIDO', 'COMPROVANTE ENVIADO'].includes(status)) return '';

    const lines = [
      '*PEDIDOS DE REVISTAS EBD — AD VIÇOSA*',
      '*DEMONSTRATIVO DO PEDIDO*',
      '',
      `*Sede / Congregação:* ${order.unidade}`,
      `*Protocolo:* ${order.protocolo}`,
      `*Período:* ${ordinal(order.trimestre)} Trimestre de ${order.ano}`,
      '',
      '*Itens:*'
    ];

    (order.itens || []).forEach(item => {
      lines.push(`${Number(item.quantidade || 0)} × ${item.produto} — ${formatCurrency(item.valorUnitario || 0)} = *${formatCurrency(item.subtotal || 0)}*`);
    });

    lines.push(
      '',
      `*TOTAL DO PEDIDO: ${formatCurrency(order.valorTotal || 0)}*`,
      '',
      'Pedido conferido pela Superintendência da EBD.',
      '_Documento de conferência — não fiscal._'
    );
    return lines.join('\n');
  }

  function buildFinancialWhatsAppUrl(order) {
    const message = buildFinancialMessage(order);
    if (!message) return '#';
    const number = normalizeWhatsAppNumber(order.telefone);
    return number
      ? `https://wa.me/${number}?text=${encodeURIComponent(message)}`
      : `https://wa.me/?text=${encodeURIComponent(message)}`;
  }

  function prepareOrderFinancialWhatsApp(event) {
    const order = state.admin.currentOrder;
    const message = buildFinancialMessage(order);
    if (!message) {
      event.preventDefault();
      toast('Confira os valores antes de gerar o demonstrativo.', true);
      return;
    }
    el('adminOrderWhatsappBtn').href = buildFinancialWhatsAppUrl(order);
  }

  async function markAdminOrderSent() {
    const order = state.admin.currentOrder;
    if (!order || state.admin.isBusy || !order.periodoAtual) return;
    if (!window.confirm(`Marcar o demonstrativo de ${order.unidade} como enviado?`)) return;

    state.admin.isBusy = true;
    const button = el('adminMarkSentBtn');
    const original = button.textContent;
    button.disabled = true;
    button.textContent = 'Salvando...';
    const requestId = createRequestId();

    try {
      await postNoCors({
        action: 'adminMarcarComprovanteEnviado',
        requestId,
        token: state.admin.token,
        unidadeId: order.unidadeId,
        ano: order.ano,
        trimestre: order.trimestre
      });
      const result = await waitForAdminResult('adminActionStatus', requestId);
      if (!result?.ok) throw new Error(result?.message || 'Não foi possível atualizar a situação.');

      const unitId = order.unidadeId;
      state.admin.isBusy = false;
      await loadAdminDashboard();
      await openAdminOrder(unitId);
      toast('Demonstrativo marcado como enviado.');
    } catch (error) {
      console.error(error);
      toast(error.message || 'Não foi possível atualizar a situação.', true);
    } finally {
      state.admin.isBusy = false;
      button.disabled = false;
      if (button.textContent === 'Salvando...') button.textContent = original;
    }
  }

  function buildPendingMessage() {
    const data = state.admin.dashboard;
    if (!data || !data.periodo?.atual) return '';
    const pending = data.unidades.filter(item => !item.enviado).map(item => item.nome);
    if (!pending.length) return '';

    const periodo = `${ordinal(data.periodo.trimestre)} Trimestre de ${data.periodo.ano}`;
    const deadline = data.periodo.dataLimite ? ` O prazo é ${formatDate(data.periodo.dataLimite)}.` : '';
    return [
      '*PEDIDOS DE REVISTAS EBD*',
      '',
      `Prezados responsáveis pela EBD, ainda não identificamos o envio do pedido de revistas do ${periodo}.${deadline}`,
      '',
      '*Sede / Congregações pendentes:*',
      ...pending.map(name => `• ${name}`),
      '',
      'Pedimos a gentileza de realizar o pedido dentro do prazo estabelecido.'
    ].join('\n');
  }

  async function copyPendingMessage() {
    const message = buildPendingMessage();
    if (!message) {
      toast('Não há pedidos pendentes.');
      return;
    }

    try {
      await copyText(message);
      toast('Mensagem de cobrança copiada.');
    } catch (error) {
      console.error(error);
      toast('Não foi possível copiar a mensagem.', true);
    }
  }

  function preparePendingWhatsApp(event) {
    const message = buildPendingMessage();
    if (!message) {
      event.preventDefault();
      toast('Não há pedidos pendentes.');
      return;
    }
    el('whatsappPendingBtn').href = `https://wa.me/?text=${encodeURIComponent(message)}`;
  }

  async function toggleOrdersStatus() {
    const data = state.admin.dashboard;
    if (!data || state.admin.isBusy || !data.periodo?.atual) return;
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
    state.admin.periodoSelecionado = '';
    state.admin.currentOrder = null;
    state.admin.pricesDirty = false;
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


  function formatCurrency(value) {
    const number = Number(value || 0);
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL'
    }).format(Number.isFinite(number) ? number : 0);
  }

  function normalizeWhatsAppNumber(value) {
    let digits = String(value || '').replace(/\D/g, '');
    if (!digits) return '';
    if (digits.startsWith('55') && digits.length >= 12) return digits;
    if (digits.length === 10 || digits.length === 11) digits = `55${digits}`;
    return digits;
  }

  function financialStatusClass(value) {
    const status = String(value || '').toUpperCase();
    if (status === 'COMPROVANTE ENVIADO') return 'sent';
    if (status === 'CONFERIDO') return 'confirmed';
    if (status === 'A CONFERIR') return 'review';
    if (status === 'PREÇOS PENDENTES') return 'missing';
    if (status === 'PENDENTE') return 'pending';
    return 'neutral';
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
        navigator.serviceWorker.register('./sw.js?v=2.8.0').catch(error => console.warn('Service Worker:', error));
      });
    }
  }
})();
