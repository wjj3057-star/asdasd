'use strict';

const IDS = require('./ids');
const buy = require('./flows/buy');
const charge = require('./flows/charge');
const info = require('./flows/info');
const products = require('./flows/products');

// 모든 상호작용을 라우팅
async function handleInteraction(interaction) {
  try {
    if (interaction.isButton()) return handleButton(interaction);
    if (interaction.isStringSelectMenu()) return handleSelect(interaction);
    if (interaction.isModalSubmit()) return handleModal(interaction);
  } catch (err) {
    console.error('[interaction] 오류:', err);
    replyError(interaction);
  }
}

async function handleButton(interaction) {
  const id = interaction.customId;

  if (id === IDS.BTN_BUY) return buy.startBuy(interaction);
  if (id === IDS.BTN_PRODUCTS) return products.showProducts(interaction);
  if (id === IDS.BTN_CHARGE) return charge.startCharge(interaction);
  if (id === IDS.BTN_INFO) return info.showInfo(interaction);

  if (id === IDS.CHARGE_ACCOUNT) return charge.openAccountModal(interaction);
  if (id === IDS.CHARGE_COIN) return charge.openCoinModal(interaction);

  // vm:buy:qtymodal:<productId>
  if (id.startsWith(IDS.BUY_QTY_MODAL + ':')) {
    const productId = parseInt(id.split(':').pop(), 10);
    return buy.openQtyModal(interaction, productId);
  }
  // vm:buy:confirm:<productId>:<qty>
  if (id.startsWith(IDS.BUY_CONFIRM + ':') && !id.includes(':modal:')) {
    const parts = id.split(':'); // vm buy confirm pid qty
    const productId = parseInt(parts[3], 10);
    const qty = parseInt(parts[4], 10) || 1;
    return buy.processPurchase(interaction, productId, qty);
  }
}

async function handleSelect(interaction) {
  const id = interaction.customId;
  if (id === IDS.SELECT_COIN) return charge.onCoinSelected(interaction);
  if (id === IDS.SELECT_CATEGORY) return buy.onCategorySelected(interaction);
  if (id.startsWith(IDS.SELECT_PRODUCT)) return buy.onProductSelected(interaction);
}

async function handleModal(interaction) {
  const id = interaction.customId;
  if (id === IDS.CHARGE_ACCOUNT_MODAL) return charge.submitAccountCharge(interaction);
  // vm:charge:coin:modal:<coinId>
  if (id.startsWith(IDS.CHARGE_COIN_MODAL + ':')) {
    const coinId = parseInt(id.split(':').pop(), 10);
    return charge.submitCoinCharge(interaction, coinId);
  }
  // vm:buy:confirm:modal:<productId>
  if (id.startsWith(IDS.BUY_CONFIRM + ':modal:')) {
    const productId = parseInt(id.split(':').pop(), 10);
    const qty = interaction.fields.getTextInputValue('qty');
    return buy.processPurchase(interaction, productId, qty);
  }
}

function replyError(interaction) {
  const payload = { content: '⚠️ 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.', ephemeral: true };
  if (interaction.replied || interaction.deferred) {
    interaction.followUp(payload).catch(() => {});
  } else {
    interaction.reply(payload).catch(() => {});
  }
}

module.exports = { handleInteraction };
